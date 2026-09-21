import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import './cssImportHook';

import { computeByteDiff } from '../../core/diff';
import type { MemorySegment } from '../../core/parser/types';
import type { DiffSide } from '../../diffProtocol';
import { hydrateDiffSide, renderDiffErrorHtml } from '../../webview/diff/diffModel';
import { mountDiffGrid, resetDiffGrid, scrollToDiff, setDiffData, showDiffError } from '../../webview/diff/diffGrid';
import { renderDiffSummaryHtml, setDiffSummary } from '../../webview/diff/diffSummary';
import { dispatchDiffMessage } from '../../webview/diff/diffMessages';

let currentDom: JSDOM | null = null;

function installDom(): JSDOM {
    const dom = new JSDOM(`<!doctype html><html><body><div id="app">
        <div class="diff-summary" id="diff-summary"></div>
        <div class="diff-body" id="diff-body">
            <div class="diff-side"><div class="diff-grid-root" id="diff-a">
                <div class="mem-header" id="diff-header-a"></div>
                <div class="mem-scroll"><div class="mem-rows" id="diff-rows-a"></div></div>
            </div></div>
            <div class="diff-side"><div class="diff-grid-root" id="diff-b">
                <div class="mem-header" id="diff-header-b"></div>
                <div class="mem-scroll"><div class="mem-rows" id="diff-rows-b"></div></div>
            </div></div>
        </div>
        <div class="diff-error" id="diff-error" hidden></div>
    </div></body></html>`, { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as { window: Window; document: Document; getComputedStyle: typeof getComputedStyle };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', { value: () => {}, configurable: true });
    return dom;
}

function cleanupDom(): void {
    if (currentDom) {
        currentDom.window.close();
        currentDom = null;
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
    }
}

function seg(startAddress: number, bytes: number[]): MemorySegment {
    return { startAddress, data: Uint8Array.from(bytes) };
}

function side(name: string, segments: MemorySegment[]): DiffSide {
    return {
        name,
        format: 'ihex',
        parseResult: {
            recordCount: 1,
            segments: segments.map(item => ({
                startAddress: item.startAddress,
                data: item.data.buffer.slice(item.data.byteOffset, item.data.byteOffset + item.data.byteLength) as ArrayBuffer,
            })),
            totalDataBytes: segments.reduce((sum, item) => sum + item.data.length, 0),
            checksumErrors: 0,
            malformedLines: 0,
            format: 'ihex',
        },
        labels: [],
    };
}

function mount(a: MemorySegment[], b: MemorySegment[]): void {
    const sideA = side('a.hex', a);
    const sideB = side('b.hex', b);
    const diff = computeByteDiff(a, b);
    setDiffData(hydrateDiffSide(sideA), hydrateDiffSide(sideB), diff);
    setDiffSummary(diff);
}

function cell(sideSelector: string, addr: number): HTMLElement | null {
    const hex = addr.toString(16).toUpperCase().padStart(8, '0');
    return document.querySelector<HTMLElement>(`${sideSelector} .data-cell[data-addr="${hex}"]`);
}

function rows(sideSelector: string): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(`${sideSelector} .data-row`)];
}

suite('HexScope Diff webview', () => {
    setup(() => {
        currentDom = installDom();
        resetDiffGrid();
        mountDiffGrid();
    });

    teardown(cleanupDom);

    test('both sides share the union row model and stay address-aligned', () => {
        mount([seg(0x1000, [0x01, 0x02])], [seg(0x1020, [0x03, 0x04])]);
        const aRows = rows('#diff-rows-a');
        const bRows = rows('#diff-rows-b');
        assert.deepStrictEqual(aRows.map(r => r.dataset.row), bRows.map(r => r.dataset.row));
        assert.ok(aRows.length >= 2, 'union rows include both mapped blocks');
        assert.ok(document.querySelector('#diff-rows-a .gap-row'), 'gap row between the two blocks');
    });

    test('hides decoded text columns and header label on both sides', () => {
        mount([seg(0x1000, [0x41])], [seg(0x1000, [0x41])]);
        for (const side of ['#diff-a', '#diff-b']) {
            assert.strictEqual(document.querySelector(`${side} .mem-hdr-decoded`), null, `${side} header has no "Decoded text" label`);
            assert.strictEqual(document.querySelector(`${side} .col-decoded`), null, `${side} has no decoded column`);
            assert.strictEqual(document.querySelector(`${side} .char-cell`), null, `${side} has no char cells`);
        }
    });

    test('a changed byte is highlighted on both sides', () => {
        mount([seg(0x3000, [0x11, 0x22])], [seg(0x3000, [0x11, 0x99])]);
        const a = cell('#diff-rows-a', 0x3001);
        const b = cell('#diff-rows-b', 0x3001);
        assert.ok(a?.classList.contains('diff-chg'), 'A changed byte marked');
        assert.ok(b?.classList.contains('diff-chg'), 'B changed byte marked');
        assert.ok(!cell('#diff-rows-a', 0x3000)?.classList.contains('diff-chg'), 'equal byte not marked');
    });

    test('a byte range present only in B is added on B and empty on A', () => {
        mount([seg(0x1000, [0x01])], [seg(0x1000, [0x01]), seg(0x1010, [0xAA, 0xBB])]);
        assert.strictEqual(cell('#diff-rows-a', 0x1010), null, 'A has no cell where it is unmapped');
        const added = cell('#diff-rows-b', 0x1010);
        assert.ok(added?.classList.contains('diff-add'), 'B added byte marked');
        assert.ok(cell('#diff-rows-b', 0x1011)?.classList.contains('diff-add'), 'second added byte marked');
    });

    test('a byte range present only in A is removed on A and empty on B', () => {
        mount([seg(0x2000, [0xAA, 0xBB])], []);
        assert.ok(cell('#diff-rows-a', 0x2000)?.classList.contains('diff-del'), 'A removed byte marked');
        assert.strictEqual(cell('#diff-rows-b', 0x2000), null, 'B has no cell where it is unmapped');
    });

    test('summary bar reports changed/added/removed counts', () => {
        mount([seg(0x4000, [0x01, 0x02]), seg(0x4100, [0x01])], [seg(0x4000, [0x01, 0xFF])]);
        const html = renderDiffSummaryHtml({ summary: { changed: 1, added: 0, removed: 1 }, runs: [] });
        assert.ok(html.includes('1 changed'));
        assert.ok(html.includes('0 added'));
        assert.ok(html.includes('1 removed'));
        assert.ok(document.getElementById('diff-prev'), 'prev control rendered');
        assert.ok(document.getElementById('diff-next'), 'next control rendered');
    });

    test('navigation scrolls both grids to the run and paints the range', () => {
        mount([seg(0x5000, [0x01])], [seg(0x5000, [0x02])]);
        scrollToDiff({ start: 0x5000, end: 0x5000 });
        assert.ok(cell('#diff-rows-a', 0x5000)?.classList.contains('sel'), 'A run range selected');
        assert.ok(cell('#diff-rows-b', 0x5000)?.classList.contains('sel'), 'B run range selected');
    });

    test('vertical and horizontal scroll stay synced between the two grids', () => {
        mount([seg(0x1000, [0x01, 0x02])], [seg(0x1000, [0x01, 0x02])]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const scrollB = document.querySelector<HTMLElement>('#diff-b .mem-scroll')!;
        scrollA.scrollTop = 200;
        scrollA.scrollLeft = 40;
        scrollA.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.strictEqual(scrollB.scrollTop, 200, 'B follows A vertically');
        assert.strictEqual(scrollB.scrollLeft, 40, 'B follows A horizontally');
        assert.strictEqual(document.querySelector<HTMLElement>('#diff-header-b')!.scrollLeft, 40, 'B header stays aligned');
        scrollB.scrollTop = 320;
        scrollB.scrollLeft = 12;
        scrollB.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.strictEqual(scrollA.scrollTop, 320, 'A follows B vertically');
        assert.strictEqual(scrollA.scrollLeft, 12, 'A follows B horizontally');
    });

    test('next/previous walk the runs in address order and stop at the ends', () => {
        mount([seg(0x6000, [0x01]), seg(0x7000, [0x02])], [seg(0x6000, [0x09]), seg(0x7000, [0x08])]);
        const prev = document.getElementById('diff-prev') as HTMLButtonElement;
        const next = document.getElementById('diff-next') as HTMLButtonElement;
        assert.ok(prev.disabled, 'prev disabled at the start');
        assert.ok(!next.disabled, 'next enabled with runs available');
        next.click();
        assert.ok(cell('#diff-rows-a', 0x6000)?.classList.contains('sel'), 'first run framed on A');
        assert.ok(cell('#diff-rows-b', 0x6000)?.classList.contains('sel'), 'first run framed on B');
        next.click();
        assert.ok(cell('#diff-rows-a', 0x7000)?.classList.contains('sel'), 'second run framed');
        assert.ok(next.disabled, 'next disabled at the last run');
        prev.click();
        assert.ok(cell('#diff-rows-a', 0x6000)?.classList.contains('sel'), 'prev steps back');
        assert.ok(prev.disabled, 'prev disabled again at the first run');
    });

    test('error state replaces the grid body with a message card', () => {
        showDiffError('read failed');
        const errorEl = document.getElementById('diff-error')!;
        assert.strictEqual(errorEl.hidden, false);
        assert.ok(errorEl.textContent?.includes('read failed'));
        assert.strictEqual(document.getElementById('diff-body')!.hidden, true);
        assert.ok(renderDiffErrorHtml('x<y').includes('x&lt;y'), 'error text escaped');
    });

    test('the diff dispatcher ignores unknown messages and routes known ones', () => {
        let init = 0;
        let error = 0;
        const handlers = { diffInit: () => { init++; }, diffError: () => { error++; } };
        assert.strictEqual(dispatchDiffMessage({ type: 'nope' }, handlers), false);
        assert.strictEqual(dispatchDiffMessage(null, handlers), false);
        assert.strictEqual(dispatchDiffMessage({ type: 'diffError', message: 'x' }, handlers), true);
        assert.strictEqual(dispatchDiffMessage({ type: 'diffInit', a: {}, b: {}, diff: {} }, handlers), true);
        assert.strictEqual(error, 1);
        assert.strictEqual(init, 1);
    });
});
