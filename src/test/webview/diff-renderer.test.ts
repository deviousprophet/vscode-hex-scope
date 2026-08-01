// Unit tests for the diff renderer + visual-row grouping (pure, no DOM/vscode).

import * as assert from 'assert';
import { computeDiff } from '../../core/diff';
import type { CompactParseResult } from '../../core/parser/compact';
import type { DiffRow } from '../../core/diff';
import { renderDiffRowsHtml, renderDiffSummaryHtml, renderDiffPanelLabelsHtml } from '../../webview/diff/diffRenderer';
import { groupVisualRows } from '../../webview/diff/diffViewModel';

function parse(segments: Array<{ startAddress: number; data: Uint8Array }>): CompactParseResult {
    return {
        records: { pageCount: 0, get: () => undefined } as never,
        segments,
        totalDataBytes: segments.reduce((n, s) => n + s.data.length, 0),
        checksumErrors: 0,
        malformedLines: 0,
    };
}

function seg(startAddress: number, bytes: number[]): { startAddress: number; data: Uint8Array } {
    return { startAddress, data: Uint8Array.from(bytes) };
}

function row(address: number, status: DiffRow['status'], byte?: number): DiffRow {
    const present = byte !== undefined;
    const a = status === 'removed' ? null : present ? { present: true, byte: byte! } : null;
    const b = status === 'added' ? null : present ? { present: true, byte: byte! } : null;
    return { address, a, b, status };
}

function render(overrides: Partial<Parameters<typeof renderDiffRowsHtml>[0]> = {}): string {
    const rows = [row(0x1000, 'unchanged', 0x01)];
    return renderDiffRowsHtml(
        {
            result: null,
            visualRows: groupVisualRows(rows),
            searchRowIndex: -1,
            matchSet: new Set(),
            aError: null,
            bError: null,
            selection: null,
            ...overrides,
        },
        [0, 1],
        22,
    );
}

suite('diff visual-row grouping', () => {
    test('16 address rows collapse into one 16-byte visual row', () => {
        const a = parse([seg(0x1000, [1, 2, 3, 4])]);
        const b = parse([seg(0x1000, [1, 2, 3, 4])]);
        const d = computeDiff(a, b);
        assert.strictEqual(d.rows.length, 16, 'computeDiff emits one row per address');
        const visual = groupVisualRows(d.rows);
        assert.strictEqual(visual.length, 1, '16 address rows become one visual row');
        assert.strictEqual(visual[0].baseAddress, 0x1000);
    });

    test('visual row carries distinct per-address bytes, not one repeated byte', () => {
        const a = parse([seg(0x1000, [1, 2, 3, 4])]);
        const b = parse([seg(0x1000, [1, 2, 3, 4])]);
        const d = computeDiff(a, b);
        const [vr] = groupVisualRows(d.rows);
        assert.deepStrictEqual(
            vr.a.slice(0, 4).map(c => c?.byte),
            [1, 2, 3, 4],
        );
        assert.strictEqual(vr.a[4], null, 'addresses past the file end are empty cells');
    });

    test('rendered grid shows the real bytes, not a repeated first byte', () => {
        const a = parse([seg(0x1000, [1, 2, 3, 4])]);
        const b = parse([seg(0x1000, [1, 2, 3, 4])]);
        const d = computeDiff(a, b);
        const html = renderDiffRowsHtml(
            { result: d, visualRows: groupVisualRows(d.rows), searchRowIndex: -1, matchSet: new Set(), aError: null, bError: null, selection: null },
            [0, 1],
            22,
        );
        assert.ok(html.includes('>01<'), 'byte 01 present');
        assert.ok(html.includes('>04<'), 'byte 04 present');
        assert.ok(html.includes('>··<'), 'empty cells after the data');
    });

    test('a gap creates its own visual rows aligned to 16', () => {
        const a = parse([seg(0x1000, [1, 2])]);
        const b = parse([seg(0x1010, [5])]);
        const d = computeDiff(a, b);
        const visual = groupVisualRows(d.rows);
        assert.strictEqual(visual.length, 2);
        assert.strictEqual(visual[0].baseAddress, 0x1000);
        assert.strictEqual(visual[1].baseAddress, 0x1010);
    });
});

suite('diff renderer', () => {
    test('match addresses get the match class on both panels', () => {
        const html = render({ matchSet: new Set([0x1000]) });
        const matches = html.match(/class="data-cell unchanged match"/g) ?? [];
        assert.strictEqual(matches.length, 2, 'the match address should be highlighted on both A and B');
    });

    test('non-match cells are not highlighted', () => {
        const html = render();
        assert.strictEqual((html.match(/class="data-cell unchanged match"/g) ?? []).length, 0);
    });

    test('a side with a parse error is flagged panel-error', () => {
        const html = render({ aError: 'parse error' });
        assert.ok(html.includes('side a panel-error'), 'side A should carry the error flag');
        assert.ok(!html.includes('side b panel-error'), 'side B should be unaffected');
    });

    test('selected cells get the sel class on the selected side only', () => {
        const html = render({ selection: { side: 'a', start: 0x1000, end: 0x1000 } });
        const selCells = html.match(/class="data-cell unchanged sel"/g) ?? [];
        assert.strictEqual(selCells.length, 1, 'the single selected A cell should carry sel');
        assert.ok(!/data-side="b" class="data-cell unchanged sel"/.test(html), 'B side must not be selected');
    });

    test('row structure is addr.a, side.a, fixed separator, addr.b, side.b', () => {
        const html = render();
        const a = html.indexOf('class="addr a"');
        const sa = html.indexOf('class="side a"');
        const sep = html.indexOf('class="diff-sep"');
        const ab = html.indexOf('class="addr b"');
        const sb = html.indexOf('class="side b"');
        assert.ok(a >= 0 && sa > a && sep > sa && ab > sep && sb > ab,
            'separator must sit between the two panels (addr/side a | sep | addr/side b)');
    });

    test('panel labels render per side as plain filenames, no A/B tags', () => {
        const html = renderDiffPanelLabelsHtml('a.hex', 'b.hex');
        assert.ok(html.includes('>a.hex<') && html.includes('>b.hex<'), 'both filenames shown');
        assert.ok(!/>[AB]<\/span>/.test(html), 'no A/B side tags');
        const sa = html.indexOf('class="side a"');
        const sep = html.indexOf('class="diff-sep"');
        const sb = html.indexOf('class="side b"');
        assert.ok(sa >= 0 && sep > sa && sb > sep, 'labels separated by the fixed divider');
    });

    test('identical files render an identical summary', () => {
        const a = parse([seg(0x1000, [1])]);
        const d = computeDiff(a, a);
        const html = renderDiffSummaryHtml({ result: d, visualRows: groupVisualRows(d.rows), searchRowIndex: -1, matchSet: new Set(), aError: null, bError: null, selection: null });
        assert.ok(html.includes('Files are identical'));
    });
});
