// ── Data processing ───────────────────────────────────────────────
// Builds S.flatBytes / S.sortedAddrs from parse result segments,
// and S.memRows (BPR-aligned row list with gap entries) from flatBytes.

import { S, BPR } from './state';

/** Populate flatBytes + sortedAddrs from the current parseResult. */
export function initFlatBytes(): void {
    S.flatBytes.clear();
    if (!S.parseResult) { S.sortedAddrs = []; return; }

    for (const seg of S.parseResult.segments) {
        for (let i = 0; i < seg.data.length; i++) {
            S.flatBytes.set(seg.startAddress + i, seg.data[i]);
        }
    }
    S.sortedAddrs = [...S.flatBytes.keys()].sort((a, b) => a - b);
}

/**
 * Build S.memRows — one `{ type:'data', address }` entry per BPR-aligned
 * row that contains at least one mapped byte, with `{ type:'gap' }` entries
 * inserted between non-adjacent rows.
 */
export function buildMemRows(): void {
    S.memRows = [];
    if (S.sortedAddrs.length === 0) { return; }

    // Collect every BPR-aligned row base that has at least one byte
    const rowSet = new Set<number>();
    for (const a of S.sortedAddrs) {
        rowSet.add(a - (a % BPR));
    }
    const rows = [...rowSet].sort((a, b) => a - b);

    for (let i = 0; i < rows.length; i++) {
        if (i > 0) {
            const prev = rows[i - 1];
            const cur  = rows[i];
            if (cur - prev > BPR) {
                S.memRows.push({ type: 'gap', from: prev + BPR, to: cur - 1, bytes: cur - prev - BPR });
            }
        }
        S.memRows.push({ type: 'data', address: rows[i] });
    }
}
