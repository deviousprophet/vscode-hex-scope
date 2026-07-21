import type { ScriptHost as IScriptHost } from './core/scripting/types';
import type { MemorySegment } from './core/parser/types';

export interface WriteEdit {
    address: number;
    value: number;
}

interface SegmentLookup {
    startAddress: number;
    endAddress: number;
    data: Uint8Array;
}

function buildLookup(segments: MemorySegment[]): SegmentLookup[] {
    return segments
        .map(s => ({ startAddress: s.startAddress, endAddress: s.startAddress + s.data.length - 1, data: s.data }))
        .sort((a, b) => a.startAddress - b.startAddress);
}

function findSegment(lookup: SegmentLookup[], addr: number): SegmentLookup | undefined {
    let lo = 0, hi = lookup.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const seg = lookup[mid];
        if (addr < seg.startAddress) { hi = mid - 1; }
        else if (addr > seg.endAddress) { lo = mid + 1; }
        else { return seg; }
    }
    return undefined;
}

export class VSCodeScriptHost implements IScriptHost {
    private readonly edits = new Map<number, number>();
    public readonly pendingWrites: WriteEdit[] = [];
    private readonly lookup: SegmentLookup[];
    private readonly _output: (text: string) => void;
    private readonly _setResult: (label: string, value: string) => void;
    private readonly _confirm: (type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;

    constructor(
        segments: MemorySegment[],
        options: {
            output: (text: string) => void;
            setResult: (label: string, value: string) => void;
            confirm: (type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;
        },
    ) {
        this.lookup = buildLookup(segments);
        this._output = options.output;
        this._setResult = options.setResult;
        this._confirm = options.confirm;
    }

    get totalSize(): number {
        return this.lookup.reduce((sum, s) => sum + s.data.length, 0);
    }

    readBytes(address: number, length: number): Uint8Array {
        const bytes: number[] = [];
        for (let i = 0; i < length; i++) {
            const addr = address + i;
            const editVal = this.edits.get(addr);
            if (editVal !== undefined) { bytes.push(editVal); continue; }
            const seg = findSegment(this.lookup, addr);
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
