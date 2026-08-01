// Unit tests for the diff renderer + visual-row grouping (pure, no DOM/vscode).

import * as assert from 'assert';
import { computeDiff } from '../../core/diff';
import type { CompactParseResult } from '../../core/parser/compact';
import { renderDiffSummaryHtml } from '../../webview/diff/diffRenderer';
import { renderHexViewComponentHtml } from '../../webview/diff/hexViewComponent';
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

function componentHtml(overrides: Partial<Parameters<typeof renderHexViewComponentHtml>[1]> = {}, label = 'file.hex'): string {
    const a = parse([seg(0x1000, [1, 2, 3, 4])]);
    const b = parse([seg(0x1000, [1, 2, 3, 4])]);
    const d = computeDiff(a, b);
    return renderHexViewComponentHtml('a', {
        label,
        rows: groupVisualRows(d.rows),
        searchRowIndex: -1,
        matchSet: new Set(),
        error: null,
        visibleRange: [0, 1],
        totalHeight: 22,
        ...overrides,
    });
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

    test('rendered component shows the real bytes, not a repeated first byte', () => {
        const html = componentHtml();
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
    test('component = address gutter + one side panel, tagged with its side', () => {
        const html = componentHtml();
        const addr = html.indexOf('class="addr"');
        const side = html.indexOf('class="side"');
        assert.ok(addr >= 0 && side > addr, 'address gutter precedes the side cells');
        assert.ok(html.includes('data-side="a"'), 'cells carry the side tag');
        assert.ok(!html.includes('data-side="b"'), 'a component renders one side only');
    });

    test('match addresses get the match class', () => {
        const html = componentHtml({ matchSet: new Set([0x1003]) });
        assert.strictEqual((html.match(/class="data-cell unchanged match"/g) ?? []).length, 1);
    });

    test('a side with a parse error is flagged panel-error', () => {
        const html = componentHtml({ error: 'parse error' });
        assert.ok(html.includes('side panel-error'), 'affected side carries the error flag');
    });

    test('label is optional: present when given, omitted when empty', () => {
        assert.ok(componentHtml(undefined, 'a.hex').includes('class="panel-label"'));
        assert.ok(!componentHtml(undefined, '').includes('class="panel-label"'));
    });

    test('changed/added/removed all render as the single bd status', () => {
        const a = parse([seg(0x1000, [1, 2, 3, 4])]);
        const b = parse([seg(0x1000, [1, 9, 3, 4])]);
        const d = computeDiff(a, b);
        const html = renderHexViewComponentHtml('a', {
            label: 'f.hex',
            rows: groupVisualRows(d.rows),
            searchRowIndex: -1,
            matchSet: new Set(),
            error: null,
            visibleRange: [0, 1],
            totalHeight: 22,
        });
        assert.ok(html.includes('data-cell bd'), 'differing byte renders as bd');
        assert.ok(!html.includes('data-cell added'), 'no separate added class');
        assert.ok(!html.includes('data-cell removed'), 'no separate removed class');
    });

    test('identical files render an identical summary', () => {
        const a = parse([seg(0x1000, [1])]);
        const d = computeDiff(a, a);
        const html = renderDiffSummaryHtml({ result: d, aError: null, bError: null });
        assert.ok(html.includes('Files are identical'));
    });
});

