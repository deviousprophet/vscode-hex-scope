// jsdom-driven tests for the generalized HexViewComponent interaction
// (hover, drag-selection reporting, column hover, copy) + render-input
// painting (selection, match) and the host-agnostic row model (gap/banner/
// showChar). Selection is painted from the render input; the component only
// reports user changes via onSelectionChange.

import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import {
    HexViewComponent,
    renderHexViewComponentHtml,
    type HexViewCell,
    type HexViewRange,
    type HexViewRenderInput,
    type HexViewRow,
} from '../../../webview/ui-components/hex-view/hexViewComponent';

/** One data row with BPR-aligned cells; null bytes become empty (`be`) cells. */
function dataRow(address: number, bytes: Array<number | null>): HexViewRow {
    return {
        address,
        kind: 'data',
        cells: bytes.map<HexViewCell>(b => b === null
            ? { hex: '··', char: ' ', cls: 'be' }
            : { hex: b.toString(16).toUpperCase().padStart(2, '0'), char: String.fromCharCode(b), cls: 'bn' }),
    };
}

function input(rows: readonly HexViewRow[], overrides: Partial<HexViewRenderInput> = {}): HexViewRenderInput {
    return {
        label: 'file.hex',
        rows,
        rowOffset: 0,
        searchRowIndex: -1,
        matchSet: new Set<number>(),
        error: null,
        totalHeight: 22,
        ...overrides,
    };
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
    const rows = [dataRow(0x1000, [1, 2, 3, 4, null])];
    dom.window.document.body.innerHTML = renderHexViewComponentHtml(side, input(rows));
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

    test('mousedown reports onSelectionChange; drag extends; no internal sel paint', () => {
        setupDom();
        const comp = mountComponent();
        let range: HexViewRange | null = null;
        comp.setCallbacks({ onSelectionChange: r => { range = r; } });

        cellAt(0x1000).dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
        assert.deepStrictEqual(range, { start: 0x1000, end: 0x1000 }, 'single click reports one byte');

        cellAt(0x1003).dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
        assert.deepStrictEqual(range, { start: 0x1000, end: 0x1003 }, 'drag extends the reported range');

        // The component never paints selection itself: the host rerenders with
        // the range in the render input (Q7).
        assert.ok(!cellAt(0x1000).classList.contains('sel'), 'no internal sel paint after drag');
    });

    test('mousedown on an empty cell does not start a selection', () => {
        setupDom();
        const comp = mountComponent();
        let fired = false;
        comp.setCallbacks({ onSelectionChange: () => { fired = true; } });

        cellAt(0x1004).dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
        assert.strictEqual(fired, false, 'empty cell cannot start a selection');
        assert.ok(!cellAt(0x1004).classList.contains('sel'), 'empty cell never carries sel');
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
        const html = renderHexViewComponentHtml('a', input(
            [dataRow(0x1000, [1, 2, 3, 4])],
            { matchSet: new Set([0x1001, 0x1003]) },
        ));
        assert.ok(html.includes('data-cell bn match'), 'match cells carry match');
        assert.ok(!html.includes('amatch'), 'no amatch state');
    });

    test('Ctrl+C with a selection fires onCopy; guarded against text inputs', () => {
        setupDom();
        const comp = mountComponent();
        let copied: { start: number; end: number } | null = null;
        comp.setCallbacks({ onCopy: r => { copied = r; } });

        cellAt(0x1000).dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));

        const input = dom.window.document.createElement('input');
        dom.window.document.body.appendChild(input);
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
            key: 'c', ctrlKey: true, bubbles: true,
        }));
        assert.strictEqual(copied, null, 'Ctrl+C inside a text input is not hijacked');

        dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
            key: 'c', ctrlKey: true, bubbles: true,
        }));
        assert.deepStrictEqual(copied, { start: 0x1000, end: 0x1000 }, 'Ctrl+C emits the held selection');
    });
});

suite('hex view component render input', () => {
    test('selection paints sel/row-sel/sel-col cells from the render input', () => {
        setupDom();
        const html = renderHexViewComponentHtml('a', input(
            [dataRow(0x1000, [1, 2, 3, 4])],
            { selection: { start: 0x1000, end: 0x1002 } },
        ));
        assert.strictEqual((html.match(/data-cell bn sel/g) ?? []).length, 3, 'selected cells carry sel');
        assert.ok(html.includes('diff-row row-sel'), 'selected row carries row-sel');
        assert.strictEqual((html.match(/hcell sel-col/g) ?? []).length, 3, 'header columns 0..2 carry sel-col');
        assert.ok(!html.includes('data-addr="00001003" class="data-cell bn sel"'), 'out-of-range cell not selected');
    });

    test('no selection input paints no selection classes', () => {
        setupDom();
        const html = renderHexViewComponentHtml('a', input([dataRow(0x1000, [1, 2, 3, 4])]));
        assert.ok(!html.includes(' sel'), 'no sel classes without a selection input');
        assert.ok(!html.includes('row-sel'), 'no row-sel without a selection input');
        assert.ok(!html.includes('sel-col'), 'no sel-col without a selection input');
    });

    test('gap rows render the single-view gap-row structure', () => {
        setupDom();
        const gap: HexViewRow = {
            address: 0x1000,
            kind: 'gap',
            cells: [],
            gap: { from: 0x1000, to: 0xFFFF, bytes: 61440 },
        };
        const html = renderHexViewComponentHtml('a', input([gap]));
        assert.ok(html.includes('class="gap-row"'), 'gap row carries gap-row');
        assert.ok(html.includes('class="gap-dots"'), 'gap row renders gap-dots');
        assert.ok(html.includes('class="gap-range"') && html.includes('0x00001000  0x0000FFFF'), 'gap row renders the range');
        assert.ok(html.includes('class="gap-size"') && html.includes('unmapped'), 'gap row renders the size');
    });

    test('banners render above the data row with name + meta', () => {
        setupDom();
        const row = dataRow(0x1000, [1, 2, 3, 4]);
        row.banners = [{ name: 'Code & Data', start: 0x1000, length: 16, color: '#ff6600' }];
        const html = renderHexViewComponentHtml('a', input([row]));
        assert.ok(html.indexOf('class="seg-banner"') < html.indexOf('class="diff-row"'), 'banner precedes its data row');
        assert.ok(html.includes('class="sb-name"') && html.includes('Code &amp; Data'), 'banner name is escaped');
        assert.ok(html.includes('class="sb-meta"') && html.includes('0x00001000'), 'banner meta shows the start address');
    });

    test('showChar renders the decoded-text header and per-byte char cells', () => {
        setupDom();
        const html = renderHexViewComponentHtml('a', input(
            [dataRow(0x1000, [0x41, 0x42])],
            { showChar: true },
        ));
        assert.ok(html.includes('class="hcell hcell-decoded"'), 'decoded-text header label renders');
        assert.ok(html.includes('Decoded text'), 'decoded-text header text');
        assert.ok(html.includes('class="char-cell bn"'), 'char cells render per byte');
        assert.ok(html.includes('>A<') && html.includes('>B<'), 'char cells show the decoded glyphs');
        assert.ok(html.includes('class="side side-char"'), 'char cells live in their own side group');
    });

    test('cells keep host-compatible attributes: data-addr, data-col, data-val', () => {
        setupDom();
        const html = renderHexViewComponentHtml('a', input([dataRow(0x1000, [0xAB, null])]));
        assert.ok(html.includes('data-addr="00001000"'), 'hex cell carries data-addr');
        assert.ok(html.includes('data-col="0"'), 'hex cell carries data-col');
        assert.ok(html.includes('data-val="171"'), 'hex cell carries the decimal data-val (0xAB = 171)');
        assert.ok(html.includes('data-cell be'), 'empty cell renders the be class');
        assert.ok(!html.includes('data-val=') || (html.match(/data-val=/g) ?? []).length === 1, 'empty cells carry no data-val');
    });
});
