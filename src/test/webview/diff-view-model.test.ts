// Unit tests for the diff view model helpers (node-safe, no vscode/DOM).

import * as assert from 'assert';
import type { DiffResult, DiffRow } from '../../core/diff';
import {
    DIFF_ROW_BYTES,
    rowIndexForAddress,
    columnForAddress,
    diffRunFocus,
    searchMatchFocus,
    formatAddress,
} from '../../webview/diff/diffViewModel';

function row(address: number, status: DiffRow['status'] = 'unchanged'): DiffRow {
    const a = status === 'removed' ? null : { present: true, byte: 0x10 };
    const b = status === 'added' ? null : { present: true, byte: 0x20 };
    return { address, a, b, status };
}

function resultWith(rows: DiffRow[], runs: Array<{ start: number; end: number }>): DiffResult {
    return {
        rows,
        summary: { unchanged: 0, changed: 0, added: 0, removed: 0 },
        runs,
        totalBytes: rows.length,
        identical: false,
    };
}

suite('diff view model', () => {
    test('rowIndexForAddress locates the owning row', () => {
        const rows = [row(0x0000), row(0x0010), row(0x0020)];
        const result = resultWith(rows, []);
        assert.strictEqual(rowIndexForAddress(result, 0x0000), 0);
        assert.strictEqual(rowIndexForAddress(result, 0x0005), 0);
        assert.strictEqual(rowIndexForAddress(result, 0x0010), 1);
        assert.strictEqual(rowIndexForAddress(result, 0x002F), 2);
        assert.strictEqual(rowIndexForAddress(result, 0x0100), -1);
    });

    test('columnForAddress is offset within row', () => {
        const r = row(0x1000);
        assert.strictEqual(columnForAddress(r, 0x1000), 0);
        assert.strictEqual(columnForAddress(r, 0x100F), 15);
    });

    test('diffRunFocus wraps and picks nearest run', () => {
        const rows = [row(0x0000, 'changed'), row(0x0010, 'changed'), row(0x0020, 'changed')];
        const result = resultWith(rows, [{ start: 0x0000, end: 0x0003 }, { start: 0x0010, end: 0x0013 }, { start: 0x0020, end: 0x0023 }]);

        // from before first run -> next goes to first
        assert.deepStrictEqual(diffRunFocus(result, 0x0000 - 1, 1), { address: 0x0000, rowIndex: 0, column: 0 });
        // forward from run 0 -> run 1
        assert.deepStrictEqual(diffRunFocus(result, 0x0001, 1), { address: 0x0010, rowIndex: 1, column: 0 });
        // from last run forward -> wraps to first
        assert.deepStrictEqual(diffRunFocus(result, 0x0022, 1), { address: 0x0000, rowIndex: 0, column: 0 });
        // backward from first -> wraps to last
        assert.deepStrictEqual(diffRunFocus(result, 0x0002, -1), { address: 0x0020, rowIndex: 2, column: 0 });
        // no runs -> null
        assert.strictEqual(diffRunFocus(resultWith([row(0x0000)], []), 0, 1), null);
    });

    test('searchMatchFocus wraps and maps address to row/column', () => {
        const rows = [row(0x0000), row(0x0010), row(0x0020)];
        const result = resultWith(rows, []);
        const matches = [0x0003, 0x0015, 0x002A];

        assert.deepStrictEqual(searchMatchFocus(result, matches, -1, 1), { address: 0x0003, rowIndex: 0, column: 3 });
        assert.deepStrictEqual(searchMatchFocus(result, matches, 0x0003, 1), { address: 0x0015, rowIndex: 1, column: 5 });
        // wrap from last forward
        assert.deepStrictEqual(searchMatchFocus(result, matches, 0x002A, 1), { address: 0x0003, rowIndex: 0, column: 3 });
        // backward wrap
        assert.deepStrictEqual(searchMatchFocus(result, matches, 0x0003, -1), { address: 0x002A, rowIndex: 2, column: 10 });
        // empty matches -> null
        assert.strictEqual(searchMatchFocus(result, [], 0, 1), null);
    });

    test('formatAddress is 8-digit uppercase hex', () => {
        assert.strictEqual(formatAddress(0), '00000000');
        assert.strictEqual(formatAddress(0x1A2B3C4D), '1A2B3C4D');
    });

    test('DIFF_ROW_BYTES matches core diff constant', () => {
        assert.strictEqual(DIFF_ROW_BYTES, 16);
    });
});

