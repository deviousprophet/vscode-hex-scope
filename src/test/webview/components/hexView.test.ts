import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../cssImportHook';

import { byteClass } from '../../../webview/utils';
import {
    HexView,
    type HexViewCallbacks,
} from '../../../webview/components/hexView/hexView';
import {
    renderHexViewHeader,
    renderHexViewHtml,
    type HexViewCell,
    type HexViewRenderInput,
} from '../../../webview/components/hexView/hexViewRender';

let currentDom: JSDOM | null = null;

interface CallLog {
    clicks: Array<{ addr: number; shift: boolean; column: string }>;
    contexts: Array<{ addr: number; x: number; y: number }>;
    selections: Array<{ start: number; end: number }>;
    copies: number;
    hovers: number[];
    columnHovers: number[];
    leaves: number;
    columnLeaves: number;
    windows: number[];
    rows: Array<{ row: number; shift: boolean }>;
    rowDrags: Array<{ start: number; end: number }>;
}

function emptyLog(): CallLog {
    return { clicks: [], contexts: [], selections: [], copies: 0, hovers: [], columnHovers: [], leaves: 0, columnLeaves: 0, windows: [], rows: [], rowDrags: [] };
}

function installDom(): JSDOM {
    const dom = new JSDOM(`<!doctype html><html><body>
        <div id="memory-view" tabindex="0">
            <div id="mem-header"></div>
            <div id="mem-scroll"><div id="mem-rows"></div></div>
        </div>
    </body></html>`, { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as { window: Window; document: Document };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
        value: () => {},
        configurable: true,
    });
    return dom;
}

function cleanupDom(): void {
    if (currentDom) {
        currentDom.window.close();
        currentDom = null;
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
    }
}

function renderGrid(input: HexViewRenderInput): void {
    const header = document.getElementById('mem-header')!;
    const headerHtml = renderHexViewHeader(input.showAscii !== false);
    header.innerHTML = headerHtml;
    const container = document.getElementById('mem-rows')!;
    if (input.compressed) {
        container.style.position = 'relative';
        container.style.height = `${input.containerHeight}px`;
    } else {
        container.style.position = '';
        container.style.height = '';
    }
    container.innerHTML = renderHexViewHtml(input);
}

function installHexView(callbacks: Partial<HexViewCallbacks> = {}): { hex: HexView; log: CallLog } {
    const log = emptyLog();
    const hex = new HexView('#memory-view', {
        onCellClick: (addr, shift, column) => { log.clicks.push({ addr, shift, column }); },
        onCellContext: (addr, x, y) => { log.contexts.push({ addr, x, y }); },
        onSelectionChange: range => { log.selections.push({ start: range.start, end: range.end }); },
        onCopy: () => { log.copies++; },
        onHover: addr => { log.hovers.push(addr); },
        onColumnHover: col => { log.columnHovers.push(col); },
        onLeave: () => { log.leaves++; },
        onColumnLeave: () => { log.columnLeaves++; },
        onVisibleWindowChange: top => { log.windows.push(top); },
        onAddressRowClick: (rowBase, shift) => { log.rows.push({ row: rowBase, shift }); },
        onAddressRowDrag: rows => { log.rowDrags.push({ start: rows.start, end: rows.end }); },
        ...callbacks,
    });
    hex.mount();
    return { hex, log };
}

const ADDR_BASE = 0x1000;

function cellVal(v: number): HexViewCell {
    return {
        hex: v.toString(16).toUpperCase().padStart(2, '0'),
        char: isPrintable(v) ? String.fromCharCode(v) : '',
        cls: byteClass(v),
        charCls: isPrintable(v) ? 'cp' : 'cd',
        val: v,
    };
}

function isPrintable(v: number): boolean {
    return v >= 0x20 && v < 0x7F;
}

function emptyCell(): HexViewCell {
    return { hex: ' ', char: ' ', cls: 'be' };
}

function standardCells(): HexViewCell[] {
    const vals = [0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x41, 0x7F, 0x80, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
    const cells = vals.map(cellVal);
    cells[5] = emptyCell(); // 0x1005 unmapped → be-cell
    return cells;
}

function rowInput(rowBases: number[]): HexViewRenderInput {
    return {
        ...standardInput(),
        rows: rowBases.map(base => ({ address: base, kind: 'data' as const, cells: standardCells() })),
    };
}

function standardInput(overrides: Partial<HexViewRenderInput> = {}): HexViewRenderInput {
    return {
        rows: [{ address: ADDR_BASE, kind: 'data', cells: standardCells() }],
        topSpacer: 0,
        bottomSpacer: 0,
        compressed: false,
        containerHeight: 0,
        windowTop: 0,
        matchSet: new Set(),
        selection: null,
        activeMatch: null,
        showAscii: true,
        ...overrides,
    };
}

function addrSelector(addr: number, kind: 'data-cell' | 'char-cell'): string {
    return `.${kind}[data-addr="${addr.toString(16).toUpperCase().padStart(8, '0')}"]`;
}

function hexCell(addr: number): HTMLElement {
    const el = document.querySelector<HTMLElement>(addrSelector(addr, 'data-cell'));
    assert.ok(el, `missing hex cell ${addr.toString(16)}`);
    return el;
}

function charCell(addr: number): HTMLElement {
    const el = document.querySelector<HTMLElement>(addrSelector(addr, 'char-cell'));
    assert.ok(el, `missing char cell ${addr.toString(16)}`);
    return el;
}

function mouseEvent(type: string, init: MouseEventInit = {}): MouseEvent {
    return new (currentDom!.window as unknown as typeof window).MouseEvent(type, { bubbles: true, ...init });
}

function dispatchOn(target: EventTarget, type: string, init: MouseEventInit = {}): void {
    target.dispatchEvent(mouseEvent(type, init));
}

// ── Header render ─────────────────────────────────────────────────

suite('HexView header render', () => {
    test('renders hidden address gutter, 16 hex cells and Decoded text by default', () => {
        const html = renderHexViewHeader();
        assert.ok(html.includes('<span class="addr-cell">00000000</span>'));
        assert.ok(html.includes('<span class="mem-hdr-decoded">Decoded text</span>'));
        for (let i = 0; i < 16; i++) {
            const col = i.toString(16).toUpperCase().padStart(2, '0');
            assert.ok(html.includes(`data-col="${i}"`), `header cell ${i}`);
            assert.ok(html.includes(`>${col}</span>`), `header glyph ${col}`);
        }
    });

    test('showAscii false omits the Decoded text label but keeps hex header cells', () => {
        const html = renderHexViewHeader(false);
        assert.ok(!html.includes('Decoded text'));
        assert.ok(html.includes('data-col="0"'));
        assert.ok(html.includes('data-col="15"'));
    });

    test('decoded column carries col-decoded class so the separator stays on the ASCII column', () => {
        const header = renderHexViewHeader();
        assert.ok(header.includes('class="cell-group col-decoded"'), 'header decoded group tagged');
        assert.ok(!renderHexViewHeader(false).includes('col-decoded'), 'no decoded group when ascii off');
        const row = renderHexViewHtml(standardInput());
        assert.ok(row.includes('class="cell-group col-decoded"'), 'row char group tagged');
        const hexOnly = renderHexViewHtml(standardInput({ showAscii: false }));
        assert.ok(!hexOnly.includes('col-decoded'), 'hex-only row has no decoded group');
    });
});

// ── Body render ───────────────────────────────────────────────────

suite('HexView body render', () => {
    test('empty rows renders the no-data message', () => {
        const html = renderHexViewHtml({ ...standardInput(), rows: [] });
        assert.ok(html.includes('No data records found.'));
    });

    test('data row keeps parity markup: addr gutter, hex cells, char cells', () => {
        currentDom = installDom();
        try {
            renderGrid(standardInput());
            const row = document.querySelector<HTMLElement>('.data-row');
            assert.ok(row);
            assert.strictEqual(row.dataset.row, '4096', 'data-row carries the decimal base address');
            assert.strictEqual(row.querySelector<HTMLElement>('.addr-cell')?.textContent, '00001000');
            assert.strictEqual(row.querySelectorAll('.data-cell[data-addr]').length, 15, 'one byte unmapped');
            assert.strictEqual(row.querySelectorAll('.char-cell[data-addr]').length, 15);
            const de = hexCell(0x1000);
            assert.strictEqual(de.dataset.col, '0');
            assert.strictEqual(de.dataset.addr, '00001000');
            assert.strictEqual(de.dataset.val, '222');
            assert.ok(de.classList.contains('bh'), '0xDE is a high byte');
            assert.strictEqual(de.textContent, 'DE');
        } finally {
            cleanupDom();
        }
    });

    test('unmapped byte renders be/cd cells without data-addr and with aria-hidden', () => {
        currentDom = installDom();
        try {
            renderGrid(standardInput());
            const be = document.querySelector<HTMLElement>('.data-cell.be');
            assert.ok(be);
            assert.strictEqual(be.dataset.addr, undefined);
            assert.strictEqual(be.getAttribute('aria-hidden'), 'true');
            assert.strictEqual(be.textContent, '  ');
            const cd = document.querySelector<HTMLElement>('.char-cell.cd[data-col="5"]');
            assert.ok(cd, 'empty char cell sits in the same column');
            assert.strictEqual(cd.getAttribute('aria-hidden'), 'true');
            assert.strictEqual(cd.textContent, ' ');
        } finally {
            cleanupDom();
        }
    });

    test('showAscii false renders hex cells only, no char column', () => {
        currentDom = installDom();
        try {
            renderGrid(standardInput({ showAscii: false }));
            assert.strictEqual(document.querySelectorAll('.char-cell').length, 0);
            assert.strictEqual(document.querySelectorAll('.data-cell[data-addr]').length, 15);
        } finally {
            cleanupDom();
        }
    });

    test('gap row renders dots, range and unmapped size', () => {
        const html = renderHexViewHtml(standardInput({
            rows: [{
                address: 0x1010, kind: 'gap',
                cells: [],
                gap: { from: 0x1010, to: 0x101F, bytes: 16 },
            }],
        }));
        assert.ok(html.includes('<span class="gap-dots"></span>'));
        assert.ok(html.includes('<span class="gap-range">0x00001010  0x0000101F</span>'));
        assert.ok(html.includes('<span class="gap-size">16 B unmapped</span>'));
    });

    test('segment banner renders above the row with escaped name and color style', () => {
        const html = renderHexViewHtml(standardInput({
            rows: [{
                address: ADDR_BASE, kind: 'data',
                cells: standardCells(),
                banners: [{ name: 'A<B & C', start: ADDR_BASE, length: 8, color: '#f80' }],
            }],
        }));
        assert.ok(html.includes('class="seg-banner" style="border-color:#f80;background:#f8014;color:#f80"'));
        assert.ok(html.includes('<span class="sb-name">A&lt;B &amp; C</span>'));
        assert.ok(html.includes('<span class="sb-meta">0x00001000  8 B</span>'));
    });

    test('match/amatch/sel compositing applies to hex and char cells, never to be cells', () => {
        currentDom = installDom();
        try {
            renderGrid(standardInput({
                matchSet: new Set([ADDR_BASE, ADDR_BASE + 1, ADDR_BASE + 5]),
                activeMatch: { start: ADDR_BASE, end: ADDR_BASE },
                selection: { start: ADDR_BASE + 1, end: ADDR_BASE + 2 },
            }));
            assert.ok(hexCell(ADDR_BASE).classList.contains('match'));
            assert.ok(hexCell(ADDR_BASE).classList.contains('amatch'));
            assert.ok(charCell(ADDR_BASE).classList.contains('amatch'));
            assert.ok(hexCell(ADDR_BASE + 1).classList.contains('match'));
            assert.ok(hexCell(ADDR_BASE + 1).classList.contains('sel'));
            assert.ok(hexCell(ADDR_BASE + 2).classList.contains('sel'));
            assert.ok(!hexCell(ADDR_BASE + 2).classList.contains('match'));
            // be cell address (ADDR_BASE + 5) is in matchSet but has no data-addr
            const be = document.querySelector<HTMLElement>('.data-cell.be');
            assert.ok(be);
            assert.ok(!be.classList.contains('match'));
        } finally {
            cleanupDom();
        }
    });

    test('compressed mode wraps rows in an absolute window WITHOUT spacers (windowTop positions the slice)', () => {
        const html = renderHexViewHtml(standardInput({
            compressed: true,
            containerHeight: 800,
            windowTop: 42,
            topSpacer: 100,
            bottomSpacer: 200,
        }));
        assert.ok(html.startsWith('<div style="position:absolute;top:42px;left:0;width:max-content;min-width:100%">'));
        assert.ok(!html.includes('height:100px'), 'topSpacer must not be emitted in compressed mode');
        assert.ok(!html.includes('height:200px'), 'bottomSpacer must not be emitted in compressed mode');
        assert.ok(html.includes('data-row'), 'rows render inside the wrapper');
        assert.ok(html.trimEnd().endsWith('</div>'));
    });

    test('uncompressed mode renders spacers in flow without a wrapper', () => {
        const html = renderHexViewHtml(standardInput({ topSpacer: 30, bottomSpacer: 40 }));
        assert.ok(!html.includes('position:absolute'));
        assert.ok(html.includes('<div style="height:30px"></div>'));
        assert.ok(html.includes('<div style="height:40px"></div>'));
    });
});

// ── Interactions ──────────────────────────────────────────────────

suite('HexView interactions', () => {
    teardown(cleanupDom);

    test('click reports addr, shift and hex/char column', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        dispatchOn(hexCell(ADDR_BASE + 1), 'mousedown', { button: 0 });
        dispatchOn(charCell(ADDR_BASE + 2), 'mousedown', { button: 0, shiftKey: true });
        assert.deepStrictEqual(log.clicks, [
            { addr: ADDR_BASE + 1, shift: false, column: 'hex' },
            { addr: ADDR_BASE + 2, shift: true, column: 'char' },
        ]);
    });

    test('mousedown on a mapped cell focuses the grid container', () => {
        currentDom = installDom();
        installHexView();
        renderGrid(standardInput());
        document.body.focus();
        dispatchOn(hexCell(ADDR_BASE), 'mousedown', { button: 0 });
        assert.strictEqual(document.activeElement, document.getElementById('memory-view'), 'grid container focused for keyboard nav');
    });

    test('mousedown on a header column cell is inert (no column selection)', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const headerCell = document.querySelector<HTMLElement>('#mem-header .data-cell[data-col="3"]');
        assert.ok(headerCell, 'header column cell present');
        document.body.focus();
        dispatchOn(headerCell!, 'mousedown', { button: 0, shiftKey: true });
        assert.strictEqual(log.clicks.length, 0);
        assert.strictEqual(log.rows.length, 0);
        assert.deepStrictEqual(log.selections, []);
    });

    test('mousedown on the address gutter cell reports its row', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const addrCell = document.querySelector<HTMLElement>(`.data-row[data-row="${(ADDR_BASE - (ADDR_BASE % 16))}"] .addr-cell`);
        assert.ok(addrCell, 'address gutter cell present');
        dispatchOn(addrCell!, 'mousedown', { button: 0 });
        assert.deepStrictEqual(log.rows, [{ row: ADDR_BASE - (ADDR_BASE % 16), shift: false }]);
    });

    test('dragging down the gutter selects the anchor-to-pointer row range', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(rowInput([0x1000, 0x1010]));
        const from = document.querySelector<HTMLElement>(`.data-row[data-row="4096"] .addr-cell`)!;
        const toRow = document.querySelector<HTMLElement>(`.data-row[data-row="4112"]`)!;
        currentDom!.window.document.elementFromPoint = () => toRow as unknown as Element;
        dispatchOn(from, 'mousedown', { button: 0 });
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 10, clientY: 60 });
        assert.strictEqual(log.rows.length, 1, 'single-row select on press');
        assert.deepStrictEqual(log.rowDrags, [{ start: 0x1000, end: 0x1010 }]);
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 10, clientY: 60 });
        assert.strictEqual(log.rowDrags.length, 1, 'same range not re-reported');
    });

    test('dragging up the gutter normalizes the range via min/max', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(rowInput([0x1000, 0x1010]));
        const from = document.querySelector<HTMLElement>(`.data-row[data-row="4112"] .addr-cell`)!;
        const toRow = document.querySelector<HTMLElement>(`.data-row[data-row="4096"]`)!;
        currentDom!.window.document.elementFromPoint = () => toRow as unknown as Element;
        dispatchOn(from, 'mousedown', { button: 0 });
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 10, clientY: 10 });
        assert.deepStrictEqual(log.rowDrags, [{ start: 0x1000, end: 0x1010 }]);
    });

    test('row drag stops reporting on mouseup', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(rowInput([0x1000, 0x1010]));
        const from = document.querySelector<HTMLElement>(`.data-row[data-row="4096"] .addr-cell`)!;
        const toRow = document.querySelector<HTMLElement>(`.data-row[data-row="4112"]`)!;
        currentDom!.window.document.elementFromPoint = () => toRow as unknown as Element;
        dispatchOn(from, 'mousedown', { button: 0 });
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 10, clientY: 60 });
        assert.strictEqual(log.rowDrags.length, 1);
        dispatchOn(document, 'mouseup');
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 10, clientY: 60 });
        assert.strictEqual(log.rowDrags.length, 1, 'no reports after mouseup');
    });

    test('contextmenu on a mapped cell focuses the grid container', () => {
        currentDom = installDom();
        installHexView();
        renderGrid(standardInput());
        document.body.focus();
        const cell = hexCell(ADDR_BASE);
        cell.dispatchEvent(mouseEvent('contextmenu', { button: 2, clientX: 31, clientY: 47, cancelable: true }));
        assert.strictEqual(document.activeElement, document.getElementById('memory-view'), 'grid container focused after right-click');
    });

    test('mousedown on an empty be cell reports nothing and does not start a drag', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const be = document.querySelector<HTMLElement>('.data-cell.be')!;
        dispatchOn(be, 'mousedown', { button: 0 });
        dispatchOn(be, 'mousemove', { buttons: 1, clientX: 10, clientY: 10 });
        assert.strictEqual(log.clicks.length, 0);
        assert.strictEqual(log.selections.length, 0);
    });

    test('right-click reports context with coordinates and prevents default', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const cell = hexCell(ADDR_BASE);
        const ev = mouseEvent('contextmenu', { button: 2, clientX: 31, clientY: 47, cancelable: true });
        cell.dispatchEvent(ev);
        assert.deepStrictEqual(log.contexts, [{ addr: ADDR_BASE, x: 31, y: 47 }]);
        assert.ok(ev.defaultPrevented);
    });

    test('drag selection reports the anchor-to-pointer range', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const from = hexCell(ADDR_BASE + 2);
        const to = hexCell(ADDR_BASE + 7);
        currentDom!.window.document.elementFromPoint = () => to as unknown as Element;
        dispatchOn(from, 'mousedown', { button: 0 });
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 50, clientY: 50 });
        assert.deepStrictEqual(log.selections, [{ start: ADDR_BASE + 2, end: ADDR_BASE + 7 }]);
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 50, clientY: 50 });
        assert.strictEqual(log.selections.length, 1, 'same range is not re-reported');
    });

    test('drag stops reporting when the button is released', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const from = hexCell(ADDR_BASE);
        currentDom!.window.document.elementFromPoint = () => hexCell(ADDR_BASE + 3) as unknown as Element;
        dispatchOn(from, 'mousedown', { button: 0 });
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 40, clientY: 40 });
        assert.strictEqual(log.selections.length, 1);
        dispatchOn(document, 'mouseup');
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 40, clientY: 40 });
        assert.strictEqual(log.selections.length, 1, 'no reports after mouseup');
    });

    test('Ctrl+C during a drag reports copy once and stops propagation', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const from = hexCell(ADDR_BASE);
        currentDom!.window.document.elementFromPoint = () => hexCell(ADDR_BASE + 2) as unknown as Element;
        dispatchOn(from, 'mousedown', { button: 0 });
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 30, clientY: 30 });
        const ev = new (currentDom!.window as unknown as typeof window).KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
        let stopped = false;
        const originalStop = ev.stopPropagation.bind(ev);
        ev.stopPropagation = () => { stopped = true; originalStop(); };
        document.dispatchEvent(ev);
        assert.strictEqual(log.copies, 1);
        assert.ok(ev.defaultPrevented);
        assert.ok(stopped);
    });

    test('Ctrl+C with no active drag does not report copy', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const ev = new (currentDom!.window as unknown as typeof window).KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true });
        document.dispatchEvent(ev);
        assert.strictEqual(log.copies, 0);
    });

    test('hover reports address and paints column highlight on body + header cells', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        dispatchOn(hexCell(ADDR_BASE + 4), 'mouseover');
        assert.deepStrictEqual(log.hovers, [ADDR_BASE + 4]);
        assert.deepStrictEqual(log.columnHovers, [4]);
        assert.ok(hexCell(ADDR_BASE + 4).classList.contains('col-hi'));
        assert.ok(charCell(ADDR_BASE + 4).classList.contains('col-hi'), 'same column char cell');
        const headerCol = document.querySelector<HTMLElement>(`#mem-header .data-cell[data-col="4"]`);
        assert.ok(headerCol?.classList.contains('col-hi'), 'header cell highlighted');
        dispatchOn(hexCell(ADDR_BASE + 4), 'mouseout', { relatedTarget: null });
        assert.strictEqual(log.columnHovers.length, 1, 'moving to a non-cell clears the column');
        assert.ok(!hexCell(ADDR_BASE + 4).classList.contains('col-hi'));
    });

    test('scroll on the container reports scrollTop via onVisibleWindowChange', () => {
        currentDom = installDom();
        const { log } = installHexView();
        renderGrid(standardInput());
        const scrollEl = document.getElementById('mem-scroll')!;
        scrollEl.scrollTop = 123;
        scrollEl.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.deepStrictEqual(log.windows, [123]);
    });

    test('mount is idempotent — a second mount does not duplicate reports', () => {
        currentDom = installDom();
        const { hex, log } = installHexView();
        hex.mount();
        renderGrid(standardInput());
        dispatchOn(hexCell(ADDR_BASE), 'mousedown', { button: 0 });
        assert.strictEqual(log.clicks.length, 1);
    });
});

// ── Paint methods ─────────────────────────────────────────────────

suite('HexView paint methods', () => {
    teardown(cleanupDom);

    test('paintSelection paints .sel and .row-sel cells; null clears', () => {
        currentDom = installDom();
        const { hex } = installHexView();
        renderGrid(standardInput());
        hex.paintSelection({ start: ADDR_BASE + 1, end: ADDR_BASE + 2 });
        assert.ok(hexCell(ADDR_BASE + 1).classList.contains('sel'));
        assert.ok(charCell(ADDR_BASE + 2).classList.contains('sel'));
        assert.ok(!hexCell(ADDR_BASE).classList.contains('sel'));
        assert.ok(document.querySelector<HTMLElement>('.data-row')?.classList.contains('row-sel'));
        hex.paintSelection(null);
        assert.strictEqual(document.querySelectorAll('.sel').length, 0);
        assert.strictEqual(document.querySelectorAll('.row-sel').length, 0);
    });

    test('paintMatch paints visible match spans and the active amatch', () => {
        currentDom = installDom();
        const { hex } = installHexView();
        renderGrid(standardInput());
        hex.paintMatch([ADDR_BASE, ADDR_BASE + 4], 0, 2);
        assert.ok(hexCell(ADDR_BASE).classList.contains('match'));
        assert.ok(hexCell(ADDR_BASE).classList.contains('amatch'));
        assert.ok(hexCell(ADDR_BASE + 1).classList.contains('match'));
        assert.ok(charCell(ADDR_BASE + 4).classList.contains('match'));
        assert.ok(!charCell(ADDR_BASE + 4).classList.contains('amatch'));
        assert.ok(!hexCell(ADDR_BASE + 2).classList.contains('match'));
        hex.paintMatch([], 0, 1);
        assert.strictEqual(document.querySelectorAll('.match').length, 0);
    });

    test('paintCell previews a nibble edit and restores from data-val on clear', () => {
        currentDom = installDom();
        const { hex } = installHexView();
        renderGrid(standardInput());
        const cell = hexCell(ADDR_BASE);
        hex.paintCell(ADDR_BASE, 'D-');
        assert.ok(cell.classList.contains('editing'));
        assert.strictEqual(cell.textContent, 'D-');
        hex.paintCell(ADDR_BASE, null);
        assert.ok(!cell.classList.contains('editing'));
        assert.strictEqual(cell.textContent, 'DE');
    });

    test('setScrollTop/getScrollTop drive the container; scrollTo reveals a rendered row', () => {
        currentDom = installDom();
        const { hex } = installHexView();
        renderGrid(standardInput());
        hex.setScrollTop(77);
        assert.strictEqual(hex.getScrollTop(), 77);
        hex.scrollTo(ADDR_BASE); // rendered row — no throw (scrollIntoView stubbed)
        hex.scrollTo(0x0BADF00D); // unrendered row — no throw
    });

    test('paint methods are root-scoped: only the instance root is touched', () => {
        currentDom = installDom();
        const { hex } = installHexView();
        renderGrid(standardInput());
        const decoy = document.createElement('div');
        const decoyHtml = '<span class="data-cell" data-addr="00001000">AA</span>';
        decoy.innerHTML = decoyHtml;
        document.body.appendChild(decoy);

        hex.paintSelection({ start: ADDR_BASE, end: ADDR_BASE });
        assert.ok(hexCell(ADDR_BASE).classList.contains('sel'), 'instance paints its own root');
        assert.ok(!decoy.querySelector('.sel'), 'outside-root elements untouched');
    });

    test('paintStructHighlight adds a class per address; clear removes it root-scoped (H1)', () => {
        currentDom = installDom();
        const { hex } = installHexView();
        renderGrid(standardInput());

        hex.paintStructHighlight([ADDR_BASE, ADDR_BASE + 2], 'struct-h');
        assert.ok(hexCell(ADDR_BASE).classList.contains('struct-h'));
        assert.ok(charCell(ADDR_BASE).classList.contains('struct-h'), 'char cell shares the address class');
        assert.ok(hexCell(ADDR_BASE + 2).classList.contains('struct-h'));
        assert.ok(!hexCell(ADDR_BASE + 1).classList.contains('struct-h'));

        const decoy = document.createElement('div');
        const decoyHtml = '<span class="data-cell struct-h" data-addr="00001000">AA</span>';
        decoy.innerHTML = decoyHtml;
        document.body.appendChild(decoy);

        hex.paintClearStructHighlight('struct-h');
        assert.ok(!hexCell(ADDR_BASE).classList.contains('struct-h'));
        assert.ok(!hexCell(ADDR_BASE + 2).classList.contains('struct-h'));
        assert.ok(decoy.querySelector('.struct-h'), 'outside-root elements are untouched by clear');
    });
});
