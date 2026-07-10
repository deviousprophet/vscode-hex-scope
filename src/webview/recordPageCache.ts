import type { SerializedRecord } from '../core/types';
import { RECORD_PAGE_SIZE } from '../webviewProtocol';

export class RecordPageCache {
    private readonly pages = new Map<number, SerializedRecord[]>();
    private readonly pending = new Set<number>();
    private generationValue = 0;

    constructor(private readonly pageLimit = 8) {}

    public get generation(): number { return this.generationValue; }

    public reset(generation: number): void {
        this.generationValue = generation;
        this.pages.clear();
        this.pending.clear();
    }

    public request(start: number, recordCount: number): boolean {
        const valid = start >= 0 && start < recordCount && start % RECORD_PAGE_SIZE === 0;
        if (!valid || this.pages.has(start) || this.pending.has(start)) { return false; }
        this.pending.add(start);
        return true;
    }

    public accept(generation: number, start: number, records: SerializedRecord[]): boolean {
        if (generation !== this.generationValue || start % RECORD_PAGE_SIZE !== 0) { return false; }
        this.pending.delete(start);
        this.pages.delete(start);
        this.pages.set(start, records);
        while (this.pages.size > this.pageLimit) {
            const oldest = this.pages.keys().next().value as number | undefined;
            if (oldest === undefined) { break; }
            this.pages.delete(oldest);
        }
        return true;
    }

    public get(index: number): SerializedRecord | undefined {
        const start = Math.floor(index / RECORD_PAGE_SIZE) * RECORD_PAGE_SIZE;
        const page = this.pages.get(start);
        if (!page) { return undefined; }
        this.pages.delete(start);
        this.pages.set(start, page);
        return page[index - start];
    }
}
