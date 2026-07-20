import type { ScriptHost as IScriptHost } from './core/scripting/types';
import type { MemorySegment } from './core/parser/types';

export interface WriteEdit {
    address: number;
    value: number;
}

export class VSCodeScriptHost implements IScriptHost {
    private readonly edits = new Map<number, number>();
    public readonly pendingWrites: WriteEdit[] = [];
    private readonly _output: (text: string) => void;
    private readonly _setResult: (label: string, value: string) => void;
    private readonly _confirm: (type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;

    constructor(
        private readonly segments: MemorySegment[],
        options: {
            output: (text: string) => void;
            setResult: (label: string, value: string) => void;
            confirm: (type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;
        },
    ) {
        this._output = options.output;
        this._setResult = options.setResult;
        this._confirm = options.confirm;
    }

    get totalSize(): number {
        return this.segments.reduce((sum, s) => sum + s.data.length, 0);
    }

    readBytes(address: number, length: number): Uint8Array {
        const bytes: number[] = [];
        for (let i = 0; i < length; i++) {
            const addr = address + i;
            const editVal = this.edits.get(addr);
            if (editVal !== undefined) { bytes.push(editVal); continue; }
            const seg = this.segments.find(s => addr >= s.startAddress && addr < s.startAddress + s.data.length);
            if (!seg) { break; }
            bytes.push(seg.data[addr - seg.startAddress]);
        }
        return Uint8Array.from(bytes);
    }

    writeBytes(address: number, data: Uint8Array): boolean {
        for (let i = 0; i < data.length; i++) {
            this.edits.set(address + i, data[i]);
            this.pendingWrites.push({ address: address + i, value: data[i] });
        }
        return true;
    }

    async confirm(type: 'write' | 'exec' | 'fetch', detail: string): Promise<boolean> {
        return this._confirm(type, detail);
    }

    output(text: string): void { this._output(text); }
    setResult(label: string, value: string): void { this._setResult(label, value); }
}
