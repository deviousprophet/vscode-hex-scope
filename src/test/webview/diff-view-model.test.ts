// Unit tests for the diff view model helpers (node-safe, no vscode/DOM).

import * as assert from 'assert';
import type { DiffMeta } from '../../core/diff';
import { DIFF_BPR } from '../../core/diff';
import {
    DIFF_ROW_BYTES,
    rowIndexForAddress,
    columnForAddress,
    visualRowIndexForAddress,
    diffRunFocus,
    searchMatchFocus,
    groupVisualRows,
    formatAddress,
} from '../../webview/diff/diffViewModel';

function meta(rowStarts: number[], runs: Array<{ start: number; end: number }>, hasDiff?: number[]): DiffMeta {
    return {
        rowStarts: Uint32Array.from(rowStarts),
        hasDiff: Uint8Array.from(hasDiff ?? rowStarts.map(() => 1)),
        summary: { unchanged: 0, changed: 0, added: 0, removed: 0 },
        runs,
        identical: false,
        totalRows: rowStarts.length,
    };
}

suite('diff view model', () => {
    test('rowIndexForAddress locates the owning union row', () => {
        const m = meta([0x0000, 0x0010, 0x0020], []);
        assert.strictEqual(rowIndexForAddress(m, 0x0000), 0);
        assert.strictEqual(rowIndexForAddress(m, 0x0005), 0);
        assert.strictEqual(rowIndexForAddress(m, 0x0010), 1);
        assert.strictEqual(rowIndexForAddress(m, 0x002F), 2);
        assert.strictEqual(rowIndexForAddress(m, 0x0100), -1);
    });

    test('rowIndexForAddress treats gaps between rows as not part of any row', () => {
        const m = meta([0x1000, 0x1100], []);
        assert.strictEqual(rowIndexForAddress(m, 0x1015), -1, 'address in the gap belongs to no row');
        assert.strictEqual(rowIndexForAddress(m, 0x1100), 1);
    });

    test('columnForAddress is offset within a BPR-aligned row', () => {
        assert.strictEqual(columnForAddress(0x1000, 0x1000), 0);
        assert.strictEqual(columnForAddress(0x1000, 0x100F), 15);
    });

    test('visualRowIndexForAddress finds rows and misses gaps', () => {
        const rows = groupVisualRows(meta([0x1000, 0x1100], [], [1, 0]));
        assert.strictEqual(visualRowIndexForAddress(rows, 0x1003), 0);
        assert.strictEqual(visualRowIndexForAddress(rows, 0x1010), -1);
        assert.strictEqual(visualRowIndexForAddress(rows, 0x1102), 1);
    });

    test('groupVisualRows builds the light row list from the meta pass', () => {
        const rows = groupVisualRows(meta([0x1000, 0x1010, 0x1020], [], [1, 0, 1]));
        assert.deepStrictEqual(rows, [
            { baseAddress: 0x1000, hasDiff: true },
            { baseAddress: 0x1010, hasDiff: false },
            { baseAddress: 0x1020, hasDiff: true },
        ]);
    });

    test('diffRunFocus wraps and picks nearest run', () => {
        const m = meta(
            [0x0000, 0x0010, 0x0020],
            [{ start: 0x0000, end: 0x0003 }, { start: 0x0010, end: 0x0013 }, { start: 0x0020, end: 0x0023 }],
        );

        // from before first run -> next goes to first
        assert.deepStrictEqual(diffRunFocus(m, 0x0000 - 1, 1), { address: 0x0000, rowIndex: 0, column: 0 });
        // forward from run 0 -> run 1
        assert.deepStrictEqual(diffRunFocus(m, 0x0001, 1), { address: 0x0010, rowIndex: 1, column: 0 });
        // from last run forward -> wraps to first
        assert.deepStrictEqual(diffRunFocus(m, 0x0022, 1), { address: 0x0000, rowIndex: 0, column: 0 });
        // backward from first -> wraps to last
        assert.deepStrictEqual(diffRunFocus(m, 0x0002, -1), { address: 0x0020, rowIndex: 2, column: 0 });
        // no runs -> null
        assert.strictEqual(diffRunFocus(meta([0x0000], []), 0, 1), null);
        // null meta -> null
        assert.strictEqual(diffRunFocus(null, 0, 1), null);
    });

    test('diffRunFocus advances past single-address runs and run ends', () => {
        const m = meta(
            [0x0000, 0x0010, 0x0020],
            [{ start: 0x0005, end: 0x0005 }, { start: 0x0010, end: 0x0013 }],
        );
        // landing on a single-address run start must advance, not loop on itself
        assert.deepStrictEqual(diffRunFocus(m, 0x0005, 1), { address: 0x0010, rowIndex: 1, column: 0 });
        // the last address of a run is part of that run; next leaves it
        assert.deepStrictEqual(diffRunFocus(m, 0x0013, 1), { address: 0x0005, rowIndex: 0, column: 5 });
        // prev from the single-address run wraps to the last run
        assert.deepStrictEqual(diffRunFocus(m, 0x0005, -1), { address: 0x0010, rowIndex: 1, column: 0 });
        // a lone single-address run stays put (it is the only run)
        const lone = meta([0x0000], [{ start: 0x0007, end: 0x0007 }]);
        assert.deepStrictEqual(diffRunFocus(lone, 0x0007, 1), { address: 0x0007, rowIndex: 0, column: 7 });
        assert.deepStrictEqual(diffRunFocus(lone, 0x0007, -1), { address: 0x0007, rowIndex: 0, column: 7 });
    });

    test('searchMatchFocus wraps and maps address to row/column', () => {
        const m = meta([0x0000, 0x0010, 0x0020], []);
        const matches = [0x0003, 0x0015, 0x002A];

        assert.deepStrictEqual(searchMatchFocus(m, matches, -1, 1), { address: 0x0003, rowIndex: 0, column: 3 });
        assert.deepStrictEqual(searchMatchFocus(m, matches, 0x0003, 1), { address: 0x0015, rowIndex: 1, column: 5 });
        // wrap from last forward
        assert.deepStrictEqual(searchMatchFocus(m, matches, 0x002A, 1), { address: 0x0003, rowIndex: 0, column: 3 });
        // backward wrap
        assert.deepStrictEqual(searchMatchFocus(m, matches, 0x0003, -1), { address: 0x002A, rowIndex: 2, column: 10 });
        // prev with no focus wraps to the LAST match (next would start at the first)
        assert.deepStrictEqual(searchMatchFocus(m, matches, -1, -1), { address: 0x002A, rowIndex: 2, column: 10 });
        // empty matches -> null
        assert.strictEqual(searchMatchFocus(m, [], 0, 1), null);
    });

    test('formatAddress is 8-digit uppercase hex', () => {
        assert.strictEqual(formatAddress(0), '00000000');
        assert.strictEqual(formatAddress(0x1A2B3C4D), '1A2B3C4D');
    });

    test('DIFF_ROW_BYTES matches core diff constant', () => {
        assert.strictEqual(DIFF_ROW_BYTES, DIFF_BPR);
    });
});
