import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../cssImportHook';

import { DiffView, type DiffPane, type DiffViewCallbacks } from '../../../webview/components/diffView/diffView';
import { renderDiffEmptyHtml, renderDiffViewBodyHtml } from '../../../webview/components/diffView/diffViewRender';
import { renderHexViewHtml, type HexViewCell, type HexViewRenderInput } from '../../../webview/components/hexView/hexViewRender';

let currentDom: JSDOM | null = null;

const ADDR_BASE = 0x2000;

interface CallLog {
    clicks: Array<{ pane: DiffPane; addr: number; shift: boolean; column: string }>;
    selections: Array<{ pane: DiffPane; start: number; end: number }>;
    rows: Array<{ pane: DiffPane; row: number; shift: boolean }>;
    rowDrags: Array<{ pane: DiffPane; start: number; end: number }>;
    windows: Array<{ pane: DiffPane; top: number; left: number }>;
}

function emptyLog(): CallLog {
    return { clicks: [], selections: [], rows: [], rowDrags: [], windows: [] };
}

function installDom(): JSDOM {
    const dom = new JSDOM(`<!doctype html><html><body><div id="app">${renderDiffViewBodyHtml()}</div></body></html>`, {
        url: 'https://hexscope.test/',
    });
    const g = globalThis as unknown as { window: Window; document: Document };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', { value: () => {}, configurable: true });
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

function paneRowsId(pane: DiffPane): string {
    return pane === 'a' ? 'diff-rows-a' : 'diff-rows-b';
}

function paneRows(pane: DiffPane): HTMLElement {
    return document.getElementById(paneRowsId(pane))!;
}

function paneScroll(pane: DiffPane): HTMLElement {
    return document.querySelector<HTMLElement>(`#diff-${pane} .mem-scroll`)!;
}

function cells(count: number): HexViewCell[] {
    return Array.from({ length: count }, (_, i) => ({
        hex: (i + 1).toString(16).toUpperCase().padStart(2, '0'),
        char: '',
        cls: 'bn',
        charCls: 'cd',
        val: i + 1,
    }));
}

function paneInput(overrides: Partial<HexViewRenderInput> = {}): HexViewRenderInput {
    return {
        rows: [{ address: ADDR_BASE, kind: 'data', cells: cells(16) }],
        topSpacer: 0,
        bottomSpacer: 0,
        compressed: false,
        containerHeight: 0,
        windowTop: 0,
        matchSet: new Set(),
        selection: null,
        activeMatch: null,
        showAscii: false,
        ...overrides,
    };
}

function renderPane(pane: DiffPane, input: HexViewRenderInput = paneInput()): void {
    paneRows(pane).innerHTML = renderHexViewHtml(input);
}

function renderBoth(input: HexViewRenderInput = paneInput()): void {
    renderPane('a', input);
    renderPane('b', input);
}

function cell(pane: DiffPane, addr: number): HTMLElement | null {
    const hex = addr.toString(16).toUpperCase().padStart(8, '0');
    return document.querySelector<HTMLElement>(`#${paneRowsId(pane)} .data-cell[data-addr="${hex}"]`);
}

function mouse(type: string, init: MouseEventInit = {}): MouseEvent {
    return new (currentDom!.window as unknown as typeof window).MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

function dispatchOn(target: EventTarget, type: string, init: MouseEventInit = {}): void {
    target.dispatchEvent(mouse(type, init));
}

function dispatchScroll(el: HTMLElement): void {
    el.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
}

function installDiffView(cb: Partial<DiffViewCallbacks> = {}): { view: DiffView; log: CallLog } {
    const log = emptyLog();
    const view = new DiffView({
        onVisibleWindowChange: (pane, top, left) => { log.windows.push({ pane, top, left }); },
        onCellClick: (pane, addr, shift, column) => { log.clicks.push({ pane, addr, shift, column }); },
        onSelectionChange: (pane, range) => { log.selections.push({ pane, start: range.start, end: range.end }); },
        onAddressRowClick: (pane, rowBase, shift) => { log.rows.push({ pane, row: rowBase, shift }); },
        onAddressRowDrag: (pane, rows) => { log.rowDrags.push({ pane, start: rows.start, end: rows.end }); },
        ...cb,
    });
    view.mount();
    return { view, log };
}

// ── Render ────────────────────────────────────────────────────────

suite('DiffView render', () => {
    test('body markup keeps the two-pane shell, ids, and pane order', () => {
        const html = renderDiffViewBodyHtml();
        assert.ok(html.startsWith('<div class="diff-body" id="diff-body">'));
        assert.strictEqual((html.match(/class="diff-side"/g) ?? []).length, 2, 'two panes');
        assert.ok(html.includes('<div class="diff-side-head" id="diff-head-a"></div>'));
        assert.ok(html.includes('<div class="diff-side-head" id="diff-head-b"></div>'));
        assert.ok(html.includes('<div class="diff-grid-root" id="diff-a">'));
        assert.ok(html.includes('<div class="diff-grid-root" id="diff-b">'));
        assert.ok(html.includes('<div class="mem-header" id="diff-header-a"></div>'));
        assert.ok(html.includes('<div class="mem-header" id="diff-header-b"></div>'));
        assert.ok(html.includes('<div class="mem-rows" id="diff-rows-a"></div>'));
        assert.ok(html.includes('<div class="mem-rows" id="diff-rows-b"></div>'));
        assert.ok(html.includes('<div class="diff-split" id="diff-split"></div>'));
        assert.ok(html.indexOf('id="diff-a"') < html.indexOf('id="diff-split"'), 'A before the divider');
        assert.ok(html.indexOf('id="diff-split"') < html.indexOf('id="diff-b"'), 'B after the divider');
        assert.ok(html.trimEnd().endsWith('</div>'));
    });

    test('empty markup escapes the message', () => {
        assert.strictEqual(renderDiffEmptyHtml('No differences'), '<div class="diff-empty">No differences</div>');
        assert.ok(renderDiffEmptyHtml('a<b & c').includes('a&lt;b &amp; c'), 'message escaped');
    });
});

// ── Mount / reset / callbacks ─────────────────────────────────────

suite('DiffView mount and callbacks', () => {
    teardown(cleanupDom);

    test('mount is idempotent — a second mount does not duplicate reports', () => {
        currentDom = installDom();
        const { view, log } = installDiffView();
        view.mount();
        renderBoth();
        dispatchOn(cell('a', ADDR_BASE)!, 'mousedown', { button: 0 });
        assert.strictEqual(log.clicks.length, 1);
    });

    test('reset drops the instances so a later mount re-creates them', () => {
        currentDom = installDom();
        const { view, log } = installDiffView();
        renderBoth();
        view.reset();

        cleanupDom();
        currentDom = installDom();
        view.mount();
        renderBoth();
        dispatchOn(cell('a', ADDR_BASE)!, 'mousedown', { button: 0 });
        assert.strictEqual(log.clicks.length, 1, 'remounted views report again');
    });

    test('cell click reports pane, addr, shift and column', () => {
        currentDom = installDom();
        const { log } = installDiffView();
        renderBoth();
        dispatchOn(cell('a', ADDR_BASE + 1)!, 'mousedown', { button: 0 });
        dispatchOn(cell('b', ADDR_BASE + 2)!, 'mousedown', { button: 0, shiftKey: true });
        assert.deepStrictEqual(log.clicks, [
            { pane: 'a', addr: ADDR_BASE + 1, shift: false, column: 'hex' },
            { pane: 'b', addr: ADDR_BASE + 2, shift: true, column: 'hex' },
        ]);
    });

    test('drag selection reports the pane-qualified anchor-to-pointer range', () => {
        currentDom = installDom();
        const { log } = installDiffView();
        renderBoth();
        const from = cell('b', ADDR_BASE)!;
        const to = cell('b', ADDR_BASE + 3)!;
        currentDom!.window.document.elementFromPoint = () => to as unknown as Element;
        dispatchOn(from, 'mousedown', { button: 0 });
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 20, clientY: 20 });
        assert.deepStrictEqual(log.selections, [{ pane: 'b', start: ADDR_BASE, end: ADDR_BASE + 3 }]);
    });

    test('address-gutter click reports the pane-qualified row', () => {
        currentDom = installDom();
        const { log } = installDiffView();
        renderBoth();
        const addrCell = document.querySelector<HTMLElement>(`#${paneRowsId('a')} .data-row .addr-cell`)!;
        dispatchOn(addrCell, 'mousedown', { button: 0 });
        assert.deepStrictEqual(log.rows, [{ pane: 'a', row: ADDR_BASE, shift: false }]);
    });

    test('address-gutter drag reports the pane-qualified row range', () => {
        currentDom = installDom();
        const { log } = installDiffView();
        renderBoth(paneInput({
            rows: [
                { address: ADDR_BASE, kind: 'data', cells: cells(16) },
                { address: ADDR_BASE + 16, kind: 'data', cells: cells(16) },
            ],
        }));
        const from = document.querySelector<HTMLElement>(`#${paneRowsId('b')} .data-row[data-row="${ADDR_BASE}"] .addr-cell`)!;
        const toRow = document.querySelector<HTMLElement>(`#${paneRowsId('b')} .data-row[data-row="${ADDR_BASE + 16}"]`)!;
        currentDom!.window.document.elementFromPoint = () => toRow as unknown as Element;
        dispatchOn(from, 'mousedown', { button: 0 });
        dispatchOn(document, 'mousemove', { buttons: 1, clientX: 10, clientY: 60 });
        assert.deepStrictEqual(log.rowDrags, [{ pane: 'b', start: ADDR_BASE, end: ADDR_BASE + 16 }]);
    });

    test('scroll reports the pane-qualified window', () => {
        currentDom = installDom();
        const { log } = installDiffView();
        renderBoth();
        const scrollEl = paneScroll('a');
        scrollEl.scrollTop = 123;
        scrollEl.scrollLeft = 40;
        dispatchScroll(scrollEl);
        assert.deepStrictEqual(log.windows, [{ pane: 'a', top: 123, left: 40 }]);
    });

    test('setCallbacks swaps the live handler set', () => {
        currentDom = installDom();
        const { view, log } = installDiffView();
        renderBoth();
        const next = emptyLog();
        view.setCallbacks({ onCellClick: (pane, addr, shift, column) => { next.clicks.push({ pane, addr, shift, column }); } });
        dispatchOn(cell('a', ADDR_BASE)!, 'mousedown', { button: 0 });
        assert.strictEqual(log.clicks.length, 0, 'old handler detached');
        assert.strictEqual(next.clicks.length, 1, 'new handler receives the report');
    });
});

// ── Paint / scroll ────────────────────────────────────────────────

suite('DiffView paint and scroll', () => {
    teardown(cleanupDom);

    test('paintSelection mirrors the range on both panes; null clears', () => {
        currentDom = installDom();
        const { view } = installDiffView();
        renderBoth();
        view.paintSelection({ start: ADDR_BASE + 1, end: ADDR_BASE + 2 });
        assert.ok(cell('a', ADDR_BASE + 1)?.classList.contains('sel'));
        assert.ok(cell('b', ADDR_BASE + 2)?.classList.contains('sel'));
        assert.ok(!cell('a', ADDR_BASE)?.classList.contains('sel'));
        view.paintSelection(null);
        assert.strictEqual(document.querySelectorAll(`#${paneRowsId('a')} .sel`).length, 0);
        assert.strictEqual(document.querySelectorAll(`#${paneRowsId('b')} .sel`).length, 0);
    });

    test('paintMatch mirrors the match span on both panes; empty clears', () => {
        currentDom = installDom();
        const { view } = installDiffView();
        renderBoth();
        view.paintMatch([ADDR_BASE + 2], 0, 2);
        assert.ok(cell('a', ADDR_BASE + 2)?.classList.contains('match'), 'A match painted');
        assert.ok(cell('a', ADDR_BASE + 2)?.classList.contains('amatch'), 'A active match painted');
        assert.ok(cell('a', ADDR_BASE + 3)?.classList.contains('match'), 'A covers the needle span');
        assert.ok(cell('b', ADDR_BASE + 3)?.classList.contains('match'), 'B mirrors the match');
        assert.ok(!cell('a', ADDR_BASE)?.classList.contains('match'), 'unmatched cell untouched');
        view.paintMatch([], -1, 1);
        assert.strictEqual(document.querySelectorAll(`#${paneRowsId('a')} .match`).length, 0, 'A cleared');
        assert.strictEqual(document.querySelectorAll(`#${paneRowsId('b')} .match`).length, 0, 'B cleared');
    });

    test('injectHeaders fills both headers with the hex-only header', () => {
        currentDom = installDom();
        const { view } = installDiffView();
        view.injectHeaders();
        for (const pane of ['a', 'b'] as DiffPane[]) {
            const header = document.querySelector<HTMLElement>(`#diff-header-${pane}`)!;
            assert.ok(header.querySelector('.data-cell[data-col="0"]'), `${pane} header cells injected`);
            assert.ok(header.querySelector('.data-cell[data-col="15"]'), `${pane} last column injected`);
            assert.strictEqual(header.querySelector('.mem-hdr-decoded'), null, `${pane} has no decoded label`);
        }
    });

    test('setScrollTop/getScrollTop and setScrollLeft drive the per-pane container', () => {
        currentDom = installDom();
        const { view } = installDiffView();
        renderBoth();
        view.setScrollTop('a', 77);
        assert.strictEqual(view.getScrollTop('a'), 77);
        assert.strictEqual(view.getScrollTop('b'), 0, 'the other pane is untouched');
        view.setScrollLeft('b', 40);
        assert.strictEqual(paneScroll('b').scrollLeft, 40);
        assert.strictEqual(document.getElementById('diff-header-b')!.scrollLeft, 40, 'programmatic scroll keeps the header aligned');
    });
});
