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
    private readonly resultsAcc: Array<{ label: string; value: string }> = [];
    private readonly logAcc: string[] = [];
    private readonly _outputHook: (text: string) => void;
    private readonly _resultHook: (label: string, value: string) => void;
    private readonly _confirm: (type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;

    constructor(
        segments: MemorySegment[],
        options: {
            output?: (text: string) => void;
            setResult?: (label: string, value: string) => void;
            confirm?: (type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;
        },
    ) {
        this.lookup = buildLookup(segments);
        this._outputHook = options.output ?? (() => {});
        this._resultHook = options.setResult ?? (() => {});
        this._confirm = options.confirm ?? (async () => false);
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

    output(text: string): void {
        this.logAcc.push(text);
        this._outputHook(text);
    }

    setResult(label: string, value: string): void {
        this.resultsAcc.push({ label, value });
        this._resultHook(label, value);
    }

    assert(condition: boolean, label: string): void {
        const icon = condition ? '\u2705' : '\u274C';
        this.resultsAcc.push({ label, value: `${icon} ${condition ? 'PASS' : 'FAIL'}` });
    }

    collectOutput(): { results: Array<{ label: string; value: string }>; log: string[] } {
        return { results: this.resultsAcc, log: this.logAcc };
    }
}
