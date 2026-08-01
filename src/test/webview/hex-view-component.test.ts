// jsdom-driven tests for HexViewComponent interaction (hover, selection, column).

import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import { computeDiff } from '../../core/diff';
import type { CompactParseResult } from '../../core/parser/compact';
import { groupVisualRows } from '../../webview/diff/diffViewModel';
import { HexViewComponent, renderHexViewComponentHtml } from '../../webview/diff/hexViewComponent';

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

let dom: JSDOM;

function setupDom(): void {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
    const g = globalThis as unknown as Record<string, unknown>;
    g.document = dom.window.document;
    g.window = dom.window;
    g.Node = dom.window.Node;
    g.Element = dom.window.Element;
    g.HTMLElement = dom.window.HTMLElement;
    g.MouseEvent = dom.window.MouseEvent;
    g.Event = dom.window.Event;
}

function mountComponent(side: 'a' | 'b' = 'a'): HexViewComponent {
    const a = parse([seg(0x1000, [1, 2, 3, 4])]);
    const b = parse([seg(0x1000, [1, 2, 3, 4])]);
    const d = computeDiff(a, b);
    const rows = groupVisualRows(d.rows);
    dom.window.document.body.innerHTML = renderHexViewComponentHtml(side, {
        label: 'file.hex',
        rows,
        searchRowIndex: -1,
        matchSet: new Set(),
        error: null,
        visibleRange: [0, 1],
        totalHeight: 22,
    });
    const comp = new HexViewComponent(side);
    comp.mount();
    return comp;
}

function cellAt(addr: number): HTMLElement {
    const el = dom.window.document.querySelector<HTMLElement>(`.data-cell[data-addr="${addr.toString(16).toUpperCase().padStart(8, '0')}"]`);
    assert.ok(el, `cell at 0x${addr.toString(16)} should exist`);
    return el!;
}

function hcellAt(col: number): HTMLElement {
    const el = dom.window.document.querySelectorAll<HTMLElement>('.diff-header .hcell')[col];
    assert.ok(el, `hcell ${col} should exist`);
    return el!;
}

function cellsInColumn(col: number): HTMLElement[] {
    return Array.from(dom.window.document.querySelectorAll<HTMLElement>('.data-cell[data-addr]'))
        .filter(el => (parseInt(el.dataset.addr ?? '', 16) & 0xF) === col);
}

suite('hex view component interaction', () => {
    test('header column hover highlights that column and fires onColumnHover', () => {
        setupDom();
        const comp = mountComponent();
        let hovered = -1;
        comp.setCallbacks({ onColumnHover: c => { hovered = c; }, onColumnLeave: () => { hovered = -1; } });

        hcellAt(3).dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
        assert.strictEqual(hovered, 3, 'onColumnHover should report the hovered offset');
        cellsInColumn(3).forEach(el => {
            assert.ok(el.classList.contains('col-hi'), 'column cells carry col-hi');
        });

        hcellAt(3).dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true }));
        assert.strictEqual(hovered, -1, 'onColumnLeave clears the hovered offset');
        cellsInColumn(3).forEach(el => {
            assert.ok(!el.classList.contains('col-hi'), 'col-hi removed on leave');
        });
    });

    test('cell hover fires onHover, highlights its column, clears on leave', () => {
        setupDom();
        const comp = mountComponent();
        let hovered = -1;
        let column = -1;
        comp.setCallbacks({
            onHover: a => { hovered = a; },
            onLeave: () => { hovered = -1; },
            onColumnHover: c => { column = c; },
            onColumnLeave: () => { column = -1; },
        });

        cellAt(0x1003).dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
        assert.strictEqual(hovered, 0x1003, 'onHover reports the hovered byte address');
        assert.ok(cellAt(0x1003).classList.contains('cell-hover'), 'hovered cell carries cell-hover');
        assert.strictEqual(column, 3, 'byte hover highlights its column (single-view parity)');
        cellsInColumn(3).forEach(el => {
            assert.ok(el.classList.contains('col-hi'), 'column cells carry col-hi');
        });

        // Leaving the whole component clears hover + column.
        const body = dom.window.document.body;
        cellAt(0x1003).dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: body }));
        assert.strictEqual(hovered, -1, 'onLeave after leaving the component');
        assert.strictEqual(column, -1, 'onColumnLeave after leaving the component');
        cellsInColumn(3).forEach(el => {
            assert.ok(!el.classList.contains('col-hi'), 'col-hi removed on leave');
        });
    });

    test('mousedown selects a byte and fires onSelectionChange; drag extends', () => {
        setupDom();
        const comp = mountComponent();
        let range: { start: number; end: number } | null = null;
        comp.setCallbacks({ onSelectionChange: r => { range = r; } });

        cellAt(0x1000).dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
        assert.deepStrictEqual(range, { start: 0x1000, end: 0x1000 }, 'single click selects one byte');
        assert.ok(cellAt(0x1000).classList.contains('sel'), 'selected cell carries sel');

        cellAt(0x1003).dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
        assert.deepStrictEqual(range, { start: 0x1000, end: 0x1003 }, 'drag extends the range');
        [0x1000, 0x1001, 0x1002, 0x1003].forEach(a => {
            assert.ok(cellAt(a).classList.contains('sel'), `0x${a.toString(16)} selected`);
        });

        // single-view parity: selected row + selected header columns
        const row = cellAt(0x1000).closest('.diff-row');
        assert.ok(row?.classList.contains('row-sel'), 'selected row carries row-sel');
        [0, 1, 2, 3].forEach(col => {
            const hcell = dom.window.document.querySelector<HTMLElement>(`.diff-header .hcell[data-col="${col}"]`);
            assert.ok(hcell?.classList.contains('sel-col'), `header column ${col} carries sel-col`);
        });
        assert.ok(!(dom.window.document.querySelector<HTMLElement>('.diff-header .hcell[data-col="5"]'))!.classList.contains('sel-col'), 'unselected column not marked');
    });

    test('setMirrorAddr mirrors the byte cell AND its row (cross-panel hover)', () => {
        setupDom();
        const comp = mountComponent();
        comp.setMirrorAddr(0x1003);
        assert.ok(cellAt(0x1003).classList.contains('cell-mirror'), 'mirrored cell carries cell-mirror');
        const row = cellAt(0x1003).closest('.diff-row');
        assert.ok(row?.classList.contains('row-hi'), 'mirrored row carries row-hi');
        comp.setMirrorAddr(-1);
        assert.ok(!cellAt(0x1003).classList.contains('cell-mirror'), 'mirror cell cleared');
        assert.ok(!(cellAt(0x1003).closest('.diff-row'))!.classList.contains('row-hi'), 'mirror row cleared');
    });

    test('match cells render the match class', () => {
        setupDom();
        const a = parse([seg(0x1000, [1, 2, 3, 4])]);
        const b = parse([seg(0x1000, [1, 2, 3, 4])]);
        const d = computeDiff(a, b);
        const html = renderHexViewComponentHtml('a', {
            label: 'f.hex',
            rows: groupVisualRows(d.rows),
            searchRowIndex: -1,
            matchSet: new Set([0x1001, 0x1003]),
            error: null,
            visibleRange: [0, 1],
            totalHeight: 22,
        });
        assert.ok(html.includes('data-cell bn match'), 'match cells carry match');
        assert.ok(!html.includes('amatch'), 'no amatch state');
    });
});
