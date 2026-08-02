// Unit tests for the diff renderer + visual-row windowing (pure, no DOM/vscode).

import * as assert from 'assert';
import { buildDiffMeta, diffCellWindow } from '../../core/diff';
import type { CompactParseResult } from '../../core/parser/compact';
import type { SerializedParseResult } from '../../core/types';
import { buildSegmentIndex } from '../../core/memory';
import { renderDiffSummaryHtml } from '../../webview/diff/diffRenderer';
import { renderHexViewComponentHtml, type HexViewCell, type HexViewRow } from '../../webview/ui-components/hex-view/hexViewComponent';

function parse(segments: Array<{ startAddress: number; data: Uint8Array }>): CompactParseResult {
    return {
        records: { pageCount: 0, get: () => undefined } as never,
        segments,
        totalDataBytes: segments.reduce((n, s) => n + s.data.length, 0),
        checksumErrors: 0,
        malformedLines: 0,
    };
}

function serialized(segments: Array<{ startAddress: number; data: Uint8Array }>): SerializedParseResult {
    return {
        records: [],
        segments,
        totalDataBytes: segments.reduce((n, s) => n + s.data.length, 0),
        checksumErrors: 0,
        malformedLines: 0,
        format: 'ihex',
    };
}

function seg(startAddress: number, bytes: number[]): { startAddress: number; data: Uint8Array } {
    return { startAddress, data: Uint8Array.from(bytes) };
}

function windowsFor(segmentsA: Array<{ startAddress: number; data: Uint8Array }>, segmentsB: Array<{ startAddress: number; data: Uint8Array }>): ReturnType<typeof diffCellWindow>[] {
    const a = serialized(segmentsA);
    const b = serialized(segmentsB);
    const aIndex = buildSegmentIndex(a);
    const bIndex = buildSegmentIndex(b);
    const meta = buildDiffMeta(parse(segmentsA), parse(segmentsB));
    return Array.from(meta.rowStarts, base => diffCellWindow(a, aIndex, b, bIndex, base));
}

/** The diff host's DiffVisualRow -> HexViewRow mapping, for the a side. */
function toRow(vr: ReturnType<typeof diffCellWindow>): HexViewRow {
    const cells: HexViewCell[] = [];
    for (let j = 0; j < vr.a.length; j++) {
        const cell = vr.a[j];
        const status = vr.statuses[j];
        const cls = status === 'unchanged' ? 'bn' : status === 'empty' ? 'be' : 'bd';
        cells.push({
            hex: cell && cell.present ? cell.byte.toString(16).toUpperCase().padStart(2, '0') : '··',
            char: '',
            cls,
        });
    }
    return { address: vr.baseAddress, kind: 'data', cells };
}

function componentHtml(
    overrides: Partial<Omit<Parameters<typeof renderHexViewComponentHtml>[1], 'label'>> = {},
    label = 'file.hex',
): string {
    const windows = windowsFor([seg(0x1000, [1, 2, 3, 4])], [seg(0x1000, [1, 2, 3, 4])]);
    return renderHexViewComponentHtml('a', {
        label,
        rows: windows.map(toRow),
        rowOffset: 0,
        searchRowIndex: -1,
        matchSet: new Set(),
        error: null,
        totalHeight: 22,
        ...overrides,
    });
}

suite('diff visual-row windowing', () => {
    test('one 16-byte window per union row', () => {
        const windows = windowsFor([seg(0x1000, [1, 2, 3, 4])], [seg(0x1000, [1, 2, 3, 4])]);
        assert.strictEqual(windows.length, 1);
        assert.strictEqual(windows[0].baseAddress, 0x1000);
        assert.strictEqual(windows[0].a.length, 16, 'window carries 16 cells per side');
    });

    test('window carries distinct per-address bytes, not one repeated byte', () => {
        const [w] = windowsFor([seg(0x1000, [1, 2, 3, 4])], [seg(0x1000, [1, 2, 3, 4])]);
        assert.deepStrictEqual(
            w.a.slice(0, 4).map(c => c?.byte),
            [1, 2, 3, 4],
        );
        assert.strictEqual(w.a[4], null, 'addresses past the file end are empty cells');
    });

    test('rendered component shows the real bytes, not a repeated first byte', () => {
        const html = componentHtml();
        assert.ok(html.includes('>01<'), 'byte 01 present');
        assert.ok(html.includes('>04<'), 'byte 04 present');
        assert.ok(html.includes('>··<'), 'empty cells after the data');
    });

    test('a gap creates its own windows aligned to 16', () => {
        const windows = windowsFor([seg(0x1000, [1, 2])], [seg(0x1010, [5])]);
        assert.strictEqual(windows.length, 2);
        assert.strictEqual(windows[0].baseAddress, 0x1000);
        assert.strictEqual(windows[1].baseAddress, 0x1010);
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

    test('rows are absolutely positioned at (rowOffset + index) x row height', () => {
        const html = componentHtml({ rowOffset: 40 });
        assert.ok(html.includes('style="top:880px"'), 'row 40 at 40*22px');
    });

    test('match addresses get the match class', () => {
        const html = componentHtml({ matchSet: new Set([0x1003]) });
        assert.strictEqual((html.match(/class="data-cell bn match"/g) ?? []).length, 1);
    });

    test('a side with a parse error is flagged panel-error', () => {
        const html = componentHtml({ error: 'parse error' });
        assert.ok(html.includes('side panel-error'), 'affected side carries the error flag');
    });

    test('label is optional: present when given, omitted when empty', () => {
        assert.ok(componentHtml({}, 'a.hex').includes('class="panel-label"'));
        assert.ok(!componentHtml({}, '').includes('class="panel-label"'));
    });

    test('changed/added/removed all render as the single bd status', () => {
        const windows = windowsFor([seg(0x1000, [1, 2, 3, 4])], [seg(0x1000, [1, 9, 3, 4])]);
        const html = renderHexViewComponentHtml('a', {
            label: 'f.hex',
            rows: windows.map(toRow),
            rowOffset: 0,
            searchRowIndex: -1,
            matchSet: new Set(),
            error: null,
            totalHeight: 22,
        });
        assert.ok(html.includes('data-cell bd'), 'differing byte renders as bd');
        assert.ok(!html.includes('data-cell added'), 'no separate added class');
        assert.ok(!html.includes('data-cell removed'), 'no separate removed class');
    });

    test('identical files render an identical summary', () => {
        const meta = buildDiffMeta(parse([seg(0x1000, [1])]), parse([seg(0x1000, [1])]));
        const html = renderDiffSummaryHtml({ meta, aError: null, bError: null });
        assert.ok(html.includes('Files are identical'));
    });

    test('a diff summary renders nothing (counts live in the toolbar, not the bar)', () => {
        const meta = buildDiffMeta(parse([seg(0x1000, [1])]), parse([seg(0x1000, [2])]));
        assert.strictEqual(renderDiffSummaryHtml({ meta, aError: null, bError: null }), '');
    });
});
