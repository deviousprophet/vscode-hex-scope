import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import './cssImportHook';

import { computeByteDiff } from '../../core/diff';
import { SearchEngine, type SearchHandlers } from '../../core/search';
import type { MemorySegment } from '../../core/parser/types';
import type { DiffSide, DiffWebviewToProvider } from '../../diffProtocol';
import { hydrateDiffSide, renderDiffErrorHtml, renderSideHeadHtml } from '../../webview/diff/diffModel';
import { applyDiffProgress, copySelectionText, flushDiffRender, getViewMode, mountDiffGrid, resetDiffGrid, scrollToDiff, setDiffData, setSearchMatches, setViewMode, showDiffError } from '../../webview/diff/diffGrid';
import { renderDiffSummaryHtml, setDiffSummary } from '../../webview/diff/diffSummary';
import { resetDiffSearch } from '../../webview/diff/diffSearch';
import { dispatchDiffMessage, type DiffExternalChangeErrorMessage, type DiffExternalChangeMessage, type DiffProgressMessage } from '../../webview/diff/diffMessages';
import { createDiffExternalChangeBanner } from '../../webview/diff/diffExternalChange';

let currentDom: JSDOM | null = null;

function installDom(): JSDOM {
    const dom = new JSDOM(`<!doctype html><html><body><div id="app">
        <div class="loading-shell" id="diff-loading">
            <div class="loading-card"><div class="loading-text">Reading…</div>
            <div class="loading-bar"><div class="loading-bar-fill" id="diff-loading-fill"></div></div></div>
        </div>
        <div class="diff-root" id="diff-root">
        <div class="diff-summary" id="diff-summary"></div>
        <div class="diff-body" id="diff-body">
            <div class="diff-side"><div class="diff-grid-root" id="diff-a">
                <div class="mem-header" id="diff-header-a"></div>
                <div class="mem-scroll"><div class="mem-rows" id="diff-rows-a"></div></div>
            </div></div>
            <div class="diff-split" id="diff-split"></div>
            <div class="diff-side"><div class="diff-grid-root" id="diff-b">
                <div class="mem-header" id="diff-header-b"></div>
                <div class="mem-scroll"><div class="mem-rows" id="diff-rows-b"></div></div>
            </div></div>
        </div>
        <div class="diff-error" id="diff-error" hidden></div>
        </div>
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

function side(name: string, segments: MemorySegment[], path = `/files/${name}`): DiffSide {
    return {
        name,
        path,
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

function diffInitMessage(a: MemorySegment[] = [seg(0x1000, [0x01])], b: MemorySegment[] = [seg(0x1000, [0x02])]): unknown {
    return {
        type: 'diffInit',
        generation: 1,
        a: side('a.hex', a),
        b: side('b.hex', b),
        diff: computeByteDiff(a, b),
    };
}

function externalChangeMessage(a: MemorySegment[], b: MemorySegment[]): DiffExternalChangeMessage {
    return {
        type: 'diffExternalChange',
        generation: 7,
        a: side('a.hex', a),
        b: side('b.hex', b),
        diff: computeByteDiff(a, b),
    };
}

function externalChangeErrorMessage(sideKey: 'a' | 'b', canQuickRepair: boolean): DiffExternalChangeErrorMessage {
    return {
        type: 'diffExternalChangeError',
        generation: 8,
        side: sideKey,
        checksumErrors: canQuickRepair ? 2 : 0,
        malformedLines: canQuickRepair ? 0 : 3,
        canQuickRepair,
    };
}

function cell(sideSelector: string, addr: number): HTMLElement | null {
    const hex = addr.toString(16).toUpperCase().padStart(8, '0');
    return document.querySelector<HTMLElement>(`${sideSelector} .data-cell[data-addr="${hex}"]`);
}

function rows(sideSelector: string): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(`${sideSelector} .data-row`)];
}

function mouse(type: string, init: MouseEventInit = {}): MouseEvent {
    const win = currentDom!.window as unknown as typeof window;
    return new win.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

function clickCell(sideSelector: string, addr: number, shift = false): void {
    cell(sideSelector, addr)!.dispatchEvent(mouse('mousedown', { button: 0, shiftKey: shift }));
    document.dispatchEvent(mouse('mouseup', { button: 0 }));
}

function clickButton(id: string): void {
    (document.getElementById(id) as HTMLButtonElement).click();
}

function typeInto(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('input', { bubbles: true }));
}

function pressEnter(shift = false): void {
    const input = document.getElementById('search-input') as HTMLInputElement;
    input.dispatchEvent(new (currentDom!.window as unknown as typeof window).KeyboardEvent('keydown', {
        key: 'Enter', shiftKey: shift, bubbles: true, cancelable: true,
    }));
}

function selectMode(mode: string): void {
    const select = document.getElementById('search-mode') as HTMLSelectElement;
    select.value = mode;
    select.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('change', { bubbles: true }));
}

function matchCount(): string {
    return document.getElementById('match-count')!.textContent ?? '';
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function dispatchScroll(el: HTMLElement): void {
    el.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
}

function scrollB(): HTMLElement {
    return document.querySelector<HTMLElement>('#diff-b .mem-scroll')!;
}

/** Earlier suites may leave a synchronous rAF stub; the diff host falls back to a deferred
 *  setTimeout when rAF is absent, which keeps the scroll-coalescing test deterministic. */
function clearAnimationFrameStubs(): void {
    delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    delete (globalThis as unknown as { cancelAnimationFrame?: unknown }).cancelAnimationFrame;
}

interface RafController {
    /** Run every currently queued frame callback once (a poll frame may queue the next). */
    step(): void;
    pending(): number;
}

let rafController: RafController | null = null;

/** Controllable rAF so the poll's per-frame work is deterministic in jsdom. */
function installRafController(): RafController {
    const queue = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const g = globalThis as unknown as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
    g.requestAnimationFrame = (cb: FrameRequestCallback): number => {
        const id = nextId++;
        queue.set(id, cb);
        return id;
    };
    g.cancelAnimationFrame = (id: number): void => { queue.delete(id); };
    rafController = {
        step: () => {
            const callbacks = [...queue.values()];
            queue.clear();
            callbacks.forEach(cb => cb(0));
        },
        pending: () => queue.size,
    };
    return rafController;
}

function runScrollFrames(count = 4): void {
    for (let i = 0; i < count; i++) { rafController?.step(); }
}

/** Count innerHTML assignments on one element (render-probe seam for the scroll coalescing test). */
function countInnerHtmlWrites(el: HTMLElement): { count: number } {
    const counter = { count: 0 };
    const win = currentDom!.window as unknown as typeof window;
    const descriptor = Object.getOwnPropertyDescriptor(win.Element.prototype, 'innerHTML') as PropertyDescriptor;
    Object.defineProperty(el, 'innerHTML', {
        configurable: true,
        get: () => descriptor.get!.call(el) as string,
        set: (value: string) => {
            counter.count++;
            descriptor.set!.call(el, value);
        },
    });
    return counter;
}

/** Count assignments to one inline style property (write-if-changed probe). */
function countStyleWrites(el: HTMLElement, prop: string): { count: number } {
    const counter = { count: 0 };
    const style = new Proxy(el.style, {
        set: (target, key, value) => {
            if (key === prop) { counter.count++; }
            return Reflect.set(target, key, value);
        },
    });
    Object.defineProperty(el, 'style', { configurable: true, get: () => style });
    return counter;
}

suite('HexScope Diff webview', () => {
    setup(() => {
        currentDom = installDom();
        clearAnimationFrameStubs();
        rafController = null;
        resetDiffGrid();
        resetDiffSearch();
        mountDiffGrid();
    });

    teardown(() => {
        clearAnimationFrameStubs();
        cleanupDom();
    });

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
        for (const sideSelector of ['#diff-a', '#diff-b']) {
            assert.strictEqual(document.querySelector(`${sideSelector} .mem-hdr-decoded`), null, `${sideSelector} header has no "Decoded text" label`);
            assert.strictEqual(document.querySelector(`${sideSelector} .col-decoded`), null, `${sideSelector} has no decoded column`);
            assert.strictEqual(document.querySelector(`${sideSelector} .char-cell`), null, `${sideSelector} has no char cells`);
        }
    });

    test('both panes render their own address column with a divider between them', () => {
        mount([seg(0x1000, [0x01])], [seg(0x1000, [0x01])]);
        for (const sideSelector of ['#diff-rows-a', '#diff-rows-b']) {
            const addr = document.querySelector<HTMLElement>(`${sideSelector} .data-row .addr-cell`);
            assert.ok(addr?.textContent?.includes('1000'), `${sideSelector} renders addresses`);
        }
        assert.ok(document.getElementById('diff-split'), 'pane divider present');
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

    test('summary bar reports the computed counts and the exact icon action controls', () => {
        mount([seg(0x4000, [0x01, 0x02]), seg(0x4100, [0x01])], [seg(0x4000, [0x01, 0xFF])]);
        const text = document.getElementById('diff-summary')!.textContent ?? '';
        assert.ok(text.includes('1 changed'), `changed count in "${text}"`);
        assert.ok(text.includes('0 added'), `added count in "${text}"`);
        assert.ok(text.includes('1 removed'), `removed count in "${text}"`);
        const actions = [...document.querySelectorAll<HTMLButtonElement>('#diff-summary .diff-action')];
        assert.deepStrictEqual(actions.map(button => button.id), [
            'diff-show-all', 'diff-show-diff', 'diff-prev', 'diff-next', 'diff-swap', 'diff-sync',
        ]);
        assert.deepStrictEqual(
            actions.map(button => button.querySelector('.diff-action-glyph')?.textContent),
            ['≡', '≠', '▲', '▼', '⇄', '⇅'],
            'each action keeps its Unicode glyph',
        );
        assert.deepStrictEqual(
            actions.map(button => button.querySelector('.diff-action-text')?.textContent),
            ['Show all', 'Show diff', 'Prev diff', 'Next diff', 'Swap sides', 'Sync scroll'],
            'each action shows a visible text label',
        );
        assert.ok(
            actions.every(button => button.querySelector('.diff-action-glyph')?.getAttribute('aria-hidden') === 'true'),
            'the decorative glyph is hidden from assistive tech',
        );
        for (const button of actions) {
            assert.ok((button.getAttribute('title') ?? '').length > 0, `${button.id} carries a tooltip`);
            assert.strictEqual(button.getAttribute('aria-label'), button.getAttribute('title'), `${button.id} label matches its tooltip`);
        }
        assert.strictEqual(document.getElementById('diff-prev')!.getAttribute('title'), 'Previous difference');
        assert.strictEqual(document.getElementById('diff-next')!.getAttribute('aria-label'), 'Next difference');
        assert.strictEqual(document.getElementById('diff-swap')!.getAttribute('title'), 'Swap sides');
        assert.strictEqual(document.getElementById('diff-sync')!.getAttribute('aria-label'), 'Sync scroll');
        assert.ok(document.getElementById('diff-show-all')!.classList.contains('active'), 'Show all is the default mode');
        assert.ok(document.getElementById('diff-sync')!.classList.contains('active'), 'Sync scroll starts on');
        assert.ok(renderDiffSummaryHtml({ summary: { changed: 0, added: 0, removed: 0 }, runs: [] }).includes('0 changed'));
    });

    test('the toolbar is two rows: actions left/center/right, stat centered below', () => {
        mount([seg(0x4000, [0x01])], [seg(0x4000, [0x02])]);
        const toolbarRows = [...document.querySelectorAll<HTMLElement>('#diff-summary .diff-tb-row')];
        assert.strictEqual(toolbarRows.length, 2, 'two toolbar rows');
        const [rowOne, rowTwo] = toolbarRows;
        assert.deepStrictEqual(
            [...rowOne.querySelectorAll('.diff-tb-left .diff-action')].map(b => b.id),
            ['diff-show-all', 'diff-show-diff', 'diff-prev', 'diff-next'],
            'row 1 left holds the mode toggle then prev/next',
        );
        assert.strictEqual(rowOne.querySelector('.diff-tb-center .diff-action')?.id, 'diff-swap', 'swap sits on the split');
        assert.ok(rowOne.querySelector('.diff-tb-right #diff-search #search-input'), 'search bar sits in row 1 right');
        assert.strictEqual(rowOne.querySelector('.diff-stat'), null, 'row 1 carries no diff stat');
        assert.strictEqual(rowTwo.querySelector('.diff-tb-left .diff-action')?.id, 'diff-sync', 'sync sits in row 2 left');
        assert.ok(rowTwo.querySelector('.diff-tb-center.diff-stat'), 'diff stat is centered on row 2');
        assert.ok(rowTwo.querySelector('.diff-stat')!.textContent!.includes('1 changed'), 'row 2 stat carries the counts');
    });

    test('navigation scrolls both grids to the run and paints the range', () => {
        mount([seg(0x5000, [0x01])], [seg(0x5000, [0x02])]);
        scrollToDiff({ start: 0x5000, end: 0x5000 });
        assert.ok(cell('#diff-rows-a', 0x5000)?.classList.contains('sel'), 'A run range selected');
        assert.ok(cell('#diff-rows-b', 0x5000)?.classList.contains('sel'), 'B run range selected');
    });

    test('vertical and horizontal scroll stay synced between the two grids', () => {
        installRafController();
        mount([seg(0x1000, [0x01, 0x02])], [seg(0x1000, [0x01, 0x02])]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const scrollB = document.querySelector<HTMLElement>('#diff-b .mem-scroll')!;
        scrollA.scrollTop = 200;
        scrollA.scrollLeft = 40;
        scrollA.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.strictEqual(scrollB.scrollLeft, 40, 'B follows A horizontally on the event');
        assert.strictEqual(document.querySelector<HTMLElement>('#diff-header-b')!.scrollLeft, 40, 'B header stays aligned');
        runScrollFrames();
        assert.strictEqual(scrollB.scrollTop, 200, 'B follows A vertically once the frame settles');
        scrollB.scrollTop = 320;
        scrollB.scrollLeft = 12;
        scrollB.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.strictEqual(scrollA.scrollLeft, 12, 'A follows B horizontally on the event');
        runScrollFrames();
        assert.strictEqual(scrollA.scrollTop, 320, 'A follows B vertically once the frame settles');
        flushDiffRender();
    });

    test('the poll tracks the driver per frame and settles without leftover state', () => {
        document.documentElement.style.setProperty('--vscode-editor-font-size', '20px');
        installRafController();
        const wide = seg(0x1000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const rowsB = document.getElementById('diff-rows-b')!;
        const writes = countInnerHtmlWrites(rowsB);

        scrollA.scrollTop = 10;
        dispatchScroll(scrollA);
        assert.strictEqual(rafController!.pending(), 1, 'a scroll event starts one poll frame');
        rafController!.step();
        assert.strictEqual(rowsB.style.transform, 'translateY(-10px)', 'a sub-row frame shifts the follower visually');
        assert.strictEqual(scrollB().scrollTop, 0, 'a tracking frame does not write the follower scrollTop');
        assert.strictEqual(writes.count, 0, 'a tracking frame does not rebuild rows');
        assert.strictEqual(rafController!.pending(), 1, 'the poll keeps running while the position changes');

        rafController!.step();
        assert.strictEqual(rafController!.pending(), 0, 'the poll stops after the position settles');
        assert.strictEqual(scrollB().scrollTop, 10, 'settling reconciles the real follower scrollTop');
        assert.strictEqual(rowsB.style.transform, '', 'settling drops the tracking transform');
        runScrollFrames(3);
        assert.strictEqual(rafController!.pending(), 0, 'no idle background polling after settle');
    });

    test('a slice-change frame reconciles real positions and redraws', () => {
        document.documentElement.style.setProperty('--vscode-editor-font-size', '20px');
        installRafController();
        const wide = seg(0x1000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const rowsB = document.getElementById('diff-rows-b')!;
        const writes = countInnerHtmlWrites(rowsB);

        scrollA.scrollTop = 400;
        dispatchScroll(scrollA);
        rafController!.step();
        assert.strictEqual(scrollB().scrollTop, 400, 'a slice change writes the follower real scrollTop');
        assert.strictEqual(rowsB.style.transform, '', 'the reconciled frame carries no transform');
        assert.strictEqual(writes.count, 1, 'the slice change rebuilds the follower rows once');
    });

    test('repeated gestures never leave a residual transform or drift the follower', () => {
        document.documentElement.style.setProperty('--vscode-editor-font-size', '20px');
        installRafController();
        const wide = seg(0x1000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const rowsB = document.getElementById('diff-rows-b')!;

        for (const top of [10, 60, 130, 220]) {
            scrollA.scrollTop = top;
            dispatchScroll(scrollA);
            rafController!.step();
        }
        runScrollFrames(3);
        assert.strictEqual(rowsB.style.transform, '', 'the transform is cleared once the scroll settles');
        assert.ok(Math.abs(scrollB().scrollTop - scrollA.scrollTop) < 0.001, 'the follower lands exactly on the driver position');
        assert.strictEqual(rafController!.pending(), 0, 'the poll is not left running');
    });

    test('a one-shot navigation after a tracking frame is never double-offset', () => {
        document.documentElement.style.setProperty('--vscode-editor-font-size', '20px');
        installRafController();
        const wide = seg(0x1000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const rowsB = document.getElementById('diff-rows-b')!;

        scrollA.scrollTop = 10;
        dispatchScroll(scrollA);
        rafController!.step();
        assert.strictEqual(rowsB.style.transform, 'translateY(-10px)', 'a residual transform is active');

        scrollToDiff({ start: 0x1000 + 20 * 16, end: 0x1000 + 20 * 16 });
        assert.strictEqual(rowsB.style.transform, '', 'the one-shot scroll clears the residual delta');
        assert.strictEqual(scrollB().scrollTop, scrollA.scrollTop, 'both panes land on the real position');
    });

    test('scroll re-renders coalesce to one frame and skip an unchanged slice', () => {
        const wide = seg(0x1000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const rowsA = document.getElementById('diff-rows-a')!;
        const writes = countInnerHtmlWrites(rowsA);

        scrollA.scrollTop = 200;
        dispatchScroll(scrollA);
        scrollA.scrollTop = 400;
        dispatchScroll(scrollA);
        assert.strictEqual(writes.count, 0, 'scroll renders are deferred off the event');
        flushDiffRender();
        assert.strictEqual(writes.count, 1, 'two scroll events coalesce into one frame render');

        dispatchScroll(scrollA);
        flushDiffRender();
        assert.strictEqual(writes.count, 1, 'an unchanged slice is not rebuilt');
    });

    test('compressed scroll frames reposition the wrapper without rebuilding rows', () => {
        document.documentElement.style.setProperty('--vscode-editor-font-size', '5000px');
        const big = seg(0x1000, Array.from({ length: 3001 * 16 }, (_, i) => i & 0xff));
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        Object.defineProperty(scrollA, 'clientHeight', { value: 600, configurable: true });
        mount([big], [big]);
        const rowsA = document.getElementById('diff-rows-a')!;
        const writes = countInnerHtmlWrites(rowsA);

        scrollA.scrollTop = 4_000_000;
        dispatchScroll(scrollA);
        flushDiffRender();
        assert.strictEqual(rowsA.style.position, 'relative', 'a union past the physical cap compresses the pane');
        const wrapper = rowsA.firstElementChild as HTMLElement;
        const firstTop = parseFloat(wrapper.style.top);

        scrollA.scrollTop = 4_002_000;
        dispatchScroll(scrollA);
        flushDiffRender();
        const secondTop = parseFloat(wrapper.style.top);
        assert.strictEqual(writes.count, 1, 'the unchanged visible slice still skips the row rebuild');
        assert.ok(secondTop < firstTop, 'the compressed wrapper tracks the new scrollTop');
        assert.ok(secondTop >= 0, 'the repositioned wrapper stays inside the physical container');

        const topWrites = countStyleWrites(wrapper, 'top');
        dispatchScroll(scrollA);
        flushDiffRender();
        assert.strictEqual(writes.count, 1, 'a frame with an unchanged slice and position rebuilds nothing');
        assert.strictEqual(topWrites.count, 0, 'an unchanged wrapper top is not rewritten');
    });

    test('diff pane overscan scales with the container height', () => {
        document.documentElement.style.setProperty('--vscode-editor-font-size', '20px');
        const rowHeight = 32;
        const viewportHeight = 600;
        const viewportRows = Math.ceil(viewportHeight / rowHeight);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        Object.defineProperty(scrollA, 'clientHeight', { value: viewportHeight, configurable: true });
        const wide = seg(0x1000, Array.from({ length: 3200 }, (_, i) => i & 0xff));
        mount([wide], [wide]);

        scrollA.scrollTop = 1600;
        dispatchScroll(scrollA);
        flushDiffRender();
        const lastVisibleRow = Math.ceil((1600 + viewportHeight) / rowHeight) - 1;
        const rendered = rows('#diff-rows-a');
        const lastRenderedRow = (Number(rendered[rendered.length - 1].dataset.row) - 0x1000) / 16;
        assert.ok(lastRenderedRow - lastVisibleRow >= viewportRows, 'overscan buffers at least a viewport of rows past the visible range');
    });

    test('turning Sync scroll off lets the panes scroll independently', () => {
        const raf = installRafController();
        mount([seg(0x1000, [0x01, 0x02])], [seg(0x1000, [0x01, 0x02])]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const scrollB = document.querySelector<HTMLElement>('#diff-b .mem-scroll')!;
        clickButton('diff-sync');
        scrollA.scrollTop = 240;
        scrollA.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.strictEqual(scrollB.scrollTop, 0, 'follower stays put while sync is off');
        assert.strictEqual(raf.pending(), 1, 'sync off queues one coalesced render frame');
        raf.step();
        assert.strictEqual(raf.pending(), 0, 'sync off never starts a self-rescheduling poll');
        clickButton('diff-sync');
        scrollA.scrollTop = 300;
        scrollA.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.strictEqual(scrollB.scrollTop, 240, 'the follower real position waits for the frame');
        flushDiffRender();
        assert.strictEqual(scrollB.scrollTop, 300, 'follower resumes when sync is back on');
    });

    test('with Sync scroll off each pane keeps its own rendered rows', () => {
        const tall = seg(0x1000, Array.from({ length: 2048 }, (_, i) => i & 0xff));
        mount([tall], [tall]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        clickButton('diff-sync');
        scrollA.scrollTop = 1200;
        dispatchScroll(scrollA);
        flushDiffRender();

        const aRows = rows('#diff-rows-a');
        const bRows = rows('#diff-rows-b');
        assert.ok(aRows.length > 0, 'the driver renders its own rows');
        assert.ok(bRows.length > 0, 'the follower stays populated with its own rows');
        assert.strictEqual(scrollB().scrollTop, 0, 'the follower does not move while sync is off');
        assert.notStrictEqual(aRows[0].dataset.row, bRows[0].dataset.row, 'panes render different slices');
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

    test('the loading card hands over to the grids on init and to the error card on failure', () => {
        const loading = document.getElementById('diff-loading')!;
        const root = document.getElementById('diff-root')!;
        assert.strictEqual(loading.hidden, false, 'loading card shows while the host reads and parses');

        showDiffError('read failed');
        assert.strictEqual(loading.hidden, true, 'failure collapses the loading card');
        assert.strictEqual(root.hidden, false, 'failure shows the error surface');

        mount([seg(0x1000, [0x01])], [seg(0x1000, [0x01])]);
        assert.strictEqual(loading.hidden, true, 'init collapses the loading card');
        assert.strictEqual(root.hidden, false, 'init shows the grid surface');
        assert.strictEqual(document.getElementById('diff-error')!.hidden, true, 'init clears a stale error card');
        assert.strictEqual(document.getElementById('diff-body')!.hidden, false, 'init restores the grid body');
    });

    test('click selects the same address range on both panes and copy uses the source pane', () => {
        mount([seg(0x3000, [0x11, 0x22])], [seg(0x3000, [0x99, 0x88])]);
        clickCell('#diff-rows-a', 0x3000);
        assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('sel'), 'A cell selected');
        assert.ok(cell('#diff-rows-b', 0x3000)?.classList.contains('sel'), 'B mirrors the selection');
        assert.deepStrictEqual(copySelectionText(), { text: '11', label: '1 byte' }, 'copy reads the A pane bytes');
        clickCell('#diff-rows-b', 0x3001);
        assert.deepStrictEqual(copySelectionText(), { text: '88', label: '1 byte' }, 'copy follows the source pane');
    });

    test('shift-click extends the selection and copy spans the range', () => {
        mount([seg(0x3000, [0x11, 0x22, 0x33])], [seg(0x3000, [0x11, 0x22, 0x33])]);
        clickCell('#diff-rows-a', 0x3000);
        clickCell('#diff-rows-a', 0x3002, true);
        assert.ok(cell('#diff-rows-a', 0x3002)?.classList.contains('sel'), 'extended to the second address');
        assert.deepStrictEqual(copySelectionText()?.text, '11 22 33');
    });

    test('a search selection on a B-only address copies that pane\u2019s bytes', () => {
        mount([seg(0x3000, [0x11])], [seg(0x3000, [0x11]), seg(0x4000, [0xDE, 0xAD])]);
        scrollToDiff({ start: 0x4000, end: 0x4001 }, { selection: true });
        assert.ok(cell('#diff-rows-b', 0x4000)?.classList.contains('sel'), 'B paints the mirrored selection');
        assert.deepStrictEqual(
            copySelectionText(),
            { text: 'DE AD', label: '2 bytes' },
            'copy reads B, the pane that maps the match',
        );
    });

    test('a match on a hidden row in Show diff mode selects without scrolling', () => {
        mount([seg(0x3000, [0x01, 0x02]), seg(0x4000, [0xDE, 0xAD])], [seg(0x3000, [0x01, 0xFF]), seg(0x4000, [0xDE, 0xAD])]);
        clickButton('diff-show-diff');
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        scrollToDiff({ start: 0x4000, end: 0x4001 }, { selection: true });
        assert.strictEqual(scrollA.scrollTop, 0, 'A does not scroll to a hidden row');
        assert.strictEqual(scrollB().scrollTop, 0, 'B does not scroll to a hidden row');
        assert.deepStrictEqual(
            copySelectionText(),
            { text: 'DE AD', label: '2 bytes' },
            'the hidden match still sets a copyable selection',
        );
    });

    test('address-gutter click selects the whole row', () => {
        mount([seg(0x3000, [0x11, 0x22])], [seg(0x3000, [0x11, 0x22])]);
        const addrCell = document.querySelector<HTMLElement>('#diff-rows-a .data-row .addr-cell')!;
        addrCell.dispatchEvent(mouse('mousedown', { button: 0 }));
        document.dispatchEvent(mouse('mouseup', { button: 0 }));
        assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('sel'), 'first byte of the row selected');
        assert.ok(cell('#diff-rows-b', 0x3000)?.classList.contains('sel'), 'mirrored on B');
    });

    test('dragging in one pane mirrors the range and Ctrl+C still reaches the host handler', () => {
        mount([seg(0x3000, [0x11, 0x22, 0x33, 0x44])], [seg(0x3000, [0x11, 0x22, 0x33, 0x44])]);
        const endCell = cell('#diff-rows-b', 0x3003)!;
        currentDom!.window.document.elementFromPoint = () => endCell as unknown as Element;
        cell('#diff-rows-b', 0x3001)!.dispatchEvent(mouse('mousedown', { button: 0 }));
        document.dispatchEvent(mouse('mousemove', { buttons: 1, clientX: 40, clientY: 40 }));
        assert.strictEqual(copySelectionText()?.text, '22 33 44', 'copy reads the dragged source-pane range');
        assert.ok(cell('#diff-rows-a', 0x3002)?.classList.contains('sel'), 'B drag mirrored onto A');
        let hostCopy = false;
        const host = (e: KeyboardEvent): void => { hostCopy = (e.ctrlKey || e.metaKey) && e.key === 'c'; };
        document.addEventListener('keydown', host);
        const press = new (currentDom!.window as unknown as typeof window).KeyboardEvent('keydown', {
            key: 'c', ctrlKey: true, bubbles: true, cancelable: true,
        });
        endCell.dispatchEvent(press);
        document.removeEventListener('keydown', host);
        assert.ok(press.defaultPrevented, 'grid claims the drag copy shortcut');
        assert.ok(hostCopy, 'component stopPropagation does not block the host document copy listener');
        document.dispatchEvent(mouse('mouseup', { button: 0 }));
    });

    test('Show diff hides identical and gap rows; Show all restores them', () => {
        mount([seg(0x1000, [0x01, 0x02]), seg(0x1020, [0x03])], [seg(0x1000, [0x01, 0x02]), seg(0x1020, [0x09])]);
        clickButton('diff-show-diff');
        const filtered = rows('#diff-rows-a');
        assert.strictEqual(filtered.length, 1, 'only the differing row remains');
        assert.strictEqual(filtered[0].dataset.row, String(0x1020));
        assert.strictEqual(document.querySelector('#diff-rows-a .gap-row'), null, 'gap rows hidden in diff mode');
        clickButton('diff-show-all');
        assert.ok(rows('#diff-rows-a').length >= 2, 'Show all restores the full row model');
    });

    test('Show diff separates non-contiguous diff rows with a bare line in both panes', () => {
        mount([seg(0x1000, [0x01]), seg(0x1040, [0x11])], [seg(0x1000, [0x02]), seg(0x1040, [0x12])]);
        clickButton('diff-show-diff');
        const sequence = (sideSelector: string): string[] =>
            [...document.querySelectorAll<HTMLElement>(`${sideSelector} > *`)]
                .map(el => el.classList.contains('gap-line') ? 'gap-line' : el.dataset.row ?? '');
        assert.deepStrictEqual(sequence('#diff-rows-a'), ['4096', 'gap-line', '4160']);
        assert.deepStrictEqual(sequence('#diff-rows-b'), ['4096', 'gap-line', '4160'], 'separator sits at the same position in both panes');
        const line = document.querySelector<HTMLElement>('#diff-rows-a .gap-line')!;
        assert.strictEqual(line.textContent, '', 'no text on the separator');
        assert.strictEqual(line.getAttribute('aria-hidden'), 'true');
        assert.strictEqual(line.getAttribute('tabindex'), null, 'separator is not focusable');
    });

    test('Show diff adds no separator between contiguous diff rows', () => {
        mount([seg(0x1000, Array(32).fill(0x01))], [seg(0x1000, Array(32).fill(0x02))]);
        clickButton('diff-show-diff');
        assert.strictEqual(rows('#diff-rows-a').length, 2, 'both contiguous rows are diffs');
        assert.strictEqual(document.querySelector('#diff-rows-a .gap-line'), null, 'contiguous rows need no separator');
    });

    test('Show diff adds no separator around a single diff row', () => {
        mount([seg(0x1000, [0x01])], [seg(0x1000, [0x02])]);
        clickButton('diff-show-diff');
        assert.strictEqual(document.querySelector('#diff-rows-a .gap-line'), null, 'a single diff row has no separator');
    });

    test('Show all keeps the labelled gap row and no separator line', () => {
        mount([seg(0x1000, [0x01]), seg(0x1040, [0x11])], [seg(0x1000, [0x02]), seg(0x1040, [0x12])]);
        const gap = document.querySelector<HTMLElement>('#diff-rows-a .gap-row');
        assert.ok(gap?.textContent?.includes('unmapped'), 'aggregate mode keeps the gap text');
        assert.strictEqual(document.querySelector('#diff-rows-a .gap-line'), null, 'no separator line in Show all');
    });

    test('Show diff on an identical pair reports No differences', () => {
        mount([seg(0x1000, [0x01])], [seg(0x1000, [0x01])]);
        clickButton('diff-show-diff');
        assert.strictEqual(document.querySelector('#diff-rows-a .diff-empty')?.textContent, 'No differences');
        assert.strictEqual(document.querySelector('#diff-rows-b .diff-empty')?.textContent, 'No differences');
    });

    test('Swap sides flips pane order, colors, and counts', () => {
        mount([seg(0x1000, [0x01])], [seg(0x1000, [0x01]), seg(0x1010, [0xAA])]);
        assert.ok(cell('#diff-rows-b', 0x1010)?.classList.contains('diff-add'), 'added on B before swap');
        assert.strictEqual(cell('#diff-rows-a', 0x1010), null, 'empty on A before swap');
        clickButton('diff-swap');
        assert.ok(cell('#diff-rows-a', 0x1010)?.classList.contains('diff-del'), 'added becomes removed on A after swap');
        assert.strictEqual(cell('#diff-rows-b', 0x1010), null, 'old A is empty on B after swap');
        assert.ok(document.getElementById('diff-summary')!.textContent?.includes('1 removed'), 'counts recomputed');
    });

    test('the search bar is always visible and matches highlight in both grids', () => {
        mount([seg(0x3000, [0x11])], [seg(0x3000, [0x11])]);
        assert.strictEqual(document.getElementById('diff-find'), null, 'no Find button exists');
        assert.ok(document.getElementById('search-input'), 'search input injected on boot');
        assert.ok(document.getElementById('diff-search')!.querySelector('#search-box'), 'search box mounted in the toolbar');
        setSearchMatches([0x3000], 0, 1);
        assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('match'), 'A match painted');
        assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('amatch'), 'A active match painted');
        assert.ok(cell('#diff-rows-b', 0x3000)?.classList.contains('match'), 'B match painted');
    });

    test('Ctrl+F focuses the always-visible search input', () => {
        mount([seg(0x3000, [0x11])], [seg(0x3000, [0x11])]);
        const input = document.getElementById('search-input') as HTMLInputElement;
        const press = new (currentDom!.window as unknown as typeof window).KeyboardEvent('keydown', {
            key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
        });
        document.dispatchEvent(press);
        assert.ok(press.defaultPrevented, 'SearchBar claims Ctrl+F');
        assert.strictEqual(document.activeElement, input, 'search input focused');
    });

    test('one query searches both panes, unions the addresses, and next walks them', async () => {
        mount([seg(0x3000, [0xDE, 0xAD])], [seg(0x3000, [0xDE, 0xAD]), seg(0x4000, [0xDE, 0xAD])]);
        typeInto(document.getElementById('search-input') as HTMLInputElement, 'DE AD');
        clickButton('btn-search');
        await wait(500);
        assert.strictEqual(document.getElementById('match-count')!.textContent, '1 / 2', 'both panes searched, 0x3000 deduped');
        assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('amatch'), 'A holds the first active match');
        assert.ok(cell('#diff-rows-a', 0x3001)?.classList.contains('match'), 'A highlights the full needle span');
        assert.ok(cell('#diff-rows-b', 0x3001)?.classList.contains('match'), 'B highlights the full needle span');
        assert.ok(cell('#diff-rows-b', 0x4000)?.classList.contains('match'), 'B-only address matched in the same query');
        assert.ok(!cell('#diff-rows-b', 0x4000)?.classList.contains('amatch'), 'only one match is active at a time');
        clickButton('btn-next');
        assert.ok(cell('#diff-rows-b', 0x4000)?.classList.contains('amatch'), 'next walks to the second address');
        assert.ok(cell('#diff-rows-b', 0x4001)?.classList.contains('amatch'), 'active match covers the needle span');
        assert.ok(!cell('#diff-rows-a', 0x3000)?.classList.contains('amatch'), 'previous active match cleared');
        assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('match'), 'previous match stays highlighted');
    });

    test('diff stylesheet keeps the hidden-state guards, the 3px splitter, and no hidden address column', () => {
        const css = fs.readFileSync(path.resolve(__dirname, '../../../src/webview/diff/diff.css'), 'utf8') +
            fs.readFileSync(path.resolve(__dirname, '../../../src/webview/components/diffView/diffView.css'), 'utf8');
        assert.ok(/\.diff-body\[hidden\][^{]*\{[^}]*display:\s*none/.test(css), 'hidden body collapses instead of splitting the viewport');
        assert.ok(/\.diff-error\[hidden\][^{]*\{[^}]*display:\s*none/.test(css), 'hidden error collapses');
        assert.ok(/\.diff-split\s*\{[^}]*flex:\s*0 0 3px/.test(css), 'splitter is a static 3px divider');
        assert.ok(/\.diff-split:hover\s*\{/.test(css), 'splitter brightens on hover');
        assert.ok(!css.includes('.diff-hide-addr'), 'both panes keep their own address gutter');
        assert.ok(/\.diff-root\[hidden\][^{]*\{[^}]*display:\s*none/.test(css), 'diff root collapses while the loading card shows');
        assert.ok(/\.diff-tb-row\s*\{[^}]*grid-template-columns:\s*1fr auto 1fr/.test(css), 'toolbar rows keep the left/center/right slots');
        assert.ok(/\.diff-action\s*\{[^}]*height:\s*26px/.test(css), 'action buttons keep a comfortable 26px height');
        assert.ok(!/\.diff-action\s*\{[^}]*width:\s*26px/.test(css), 'action buttons size to their icon + text');
        assert.ok(/\.diff-action-glyph\s*\{/.test(css), 'the glyph span is styled');
        assert.ok(/\.diff-action-text\s*\{/.test(css), 'the visible text span is styled');
        assert.ok(!/codicon|@font-face/.test(css), 'action bar stays Unicode-only (no icon font)');
        assert.ok(!css.includes('.loading-bar-fill.det'), 'the determinate loading bar override is gone (parity with the hex view)');
        const baseCss = fs.readFileSync(path.resolve(__dirname, '../../../src/webview/styles/base.css'), 'utf8');
        assert.ok(/\.loading-shell\[hidden\][^{]*\{[^}]*display:\s*none/.test(baseCss), 'loading card collapses when hidden');
        assert.ok(/\.fmt-pill\s*\{/.test(baseCss), 'shared format pill utility');
    });

    test('side heads render the name plus the shared format pill and no separator', () => {
        const html = renderSideHeadHtml('firmware.hex', 'srec');
        assert.ok(html.includes('fmt-pill'), 'uses the shared pill class');
        assert.ok(html.includes('>SREC<'), 'format label rendered');
        assert.ok(!html.includes('·'), 'no separator between name and format');
        assert.ok(html.startsWith('firmware.hex '), 'name precedes the pill');
        assert.ok(renderSideHeadHtml('a<b.hex', 'ihex').includes('a&lt;b.hex'), 'label escaped');
        const css = fs.readFileSync(path.resolve(__dirname, '../../../src/webview/styles/base.css'), 'utf8');
        assert.ok(/\.fmt-pill\s*\{/.test(css), '.fmt-pill lives in base.css');
    });

    test('diffProgress updates the loading card and routes through the dispatcher', () => {
        const loading = document.getElementById('diff-loading')!;
        let stage = '';
        const handlers = {
            diffInit: () => { /* noop */ },
            diffError: () => { /* noop */ },
            diffProgress: (message: DiffProgressMessage) => { stage = message.stage; },
            diffExternalChange: () => { /* noop */ },
            diffExternalChangeError: () => { /* noop */ },
        };
        assert.strictEqual(dispatchDiffMessage({ type: 'diffProgress', stage: 'parse', completed: 1, total: 2 }, handlers), true);
        assert.strictEqual(stage, 'parse');
        assert.strictEqual(dispatchDiffMessage({ type: 'diffProgress', stage: 'nope', completed: 1, total: 2 }, handlers), false);
        assert.strictEqual(dispatchDiffMessage({ type: 'diffProgress', stage: 'diff', completed: 'x', total: 1 }, handlers), false);

        const fill = document.getElementById('diff-loading-fill') as HTMLElement;
        applyDiffProgress({ type: 'diffProgress', stage: 'read', completed: 1, total: 4 });
        assert.strictEqual(loading.querySelector('.loading-text')!.textContent, 'Loading read 25%…');
        applyDiffProgress({ type: 'diffProgress', stage: 'parse', completed: 1, total: 2 });
        assert.strictEqual(loading.querySelector('.loading-text')!.textContent, 'Loading parse 50%…');
        assert.strictEqual(fill.style.width, '', 'the bar is indeterminate — never width-driven');
        assert.strictEqual(fill.classList.contains('det'), false, 'the determinate variant class is gone');
        applyDiffProgress({ type: 'diffProgress', stage: 'diff', completed: 0, total: 0 });
        assert.strictEqual(loading.querySelector('.loading-text')!.textContent, 'Loading diff…', 'a zero total drops the percent');
        assert.strictEqual(fill.style.width, '', 'a zero total never drives the bar width');
    });

    test('the diff dispatcher ignores unknown messages and routes known ones', () => {
        let init = 0;
        let error = 0;
        let progress = 0;
        const handlers = {
            diffInit: () => { init++; },
            diffError: () => { error++; },
            diffProgress: () => { progress++; },
            diffExternalChange: () => { /* noop */ },
            diffExternalChangeError: () => { /* noop */ },
        };
        assert.strictEqual(dispatchDiffMessage({ type: 'nope' }, handlers), false);
        assert.strictEqual(dispatchDiffMessage(null, handlers), false);
        assert.strictEqual(dispatchDiffMessage({ type: 'diffError', message: 'x' }, handlers), true);
        assert.strictEqual(dispatchDiffMessage(diffInitMessage(), handlers), true);
        assert.strictEqual(dispatchDiffMessage({ type: 'diffProgress', stage: 'read', completed: 1, total: 2 }, handlers), true);
        assert.strictEqual(error, 1);
        assert.strictEqual(init, 1);
        assert.strictEqual(progress, 1);
    });

    test('a malformed diffInit is rejected without throwing or running the handler', () => {
        let init = 0;
        const handlers = {
            diffInit: () => { init++; },
            diffError: () => { /* noop */ },
            diffProgress: () => { /* noop */ },
            diffExternalChange: () => { /* noop */ },
            diffExternalChangeError: () => { /* noop */ },
        };
        const validA = side('a.hex', [seg(0x1000, [0x01])]);
        const validB = side('b.hex', [seg(0x1000, [0x02])]);
        const validDiff = computeByteDiff([seg(0x1000, [0x01])], [seg(0x1000, [0x02])]);
        const malformed: unknown[] = [
            { type: 'diffInit' },
            { type: 'diffInit', a: {}, b: {}, diff: {} },
            { type: 'diffInit', a: validA, b: validB, diff: { runs: [{ start: 0, end: 1, kind: 'nope' }] } },
            { type: 'diffInit', a: validA, b: validB, diff: { runs: [{ start: 'x', end: 1, kind: 'changed' }] } },
            { type: 'diffInit', a: { ...validA, parseResult: { recordCount: 'x', segments: [] } }, b: validB, diff: validDiff },
            { type: 'diffInit', a: validA, b: { ...validB, labels: 'x' }, diff: validDiff },
            { type: 'diffInit', a: validA, b: validB, diff: { runs: 'x' } },
        ];
        for (const message of malformed) {
            assert.strictEqual(dispatchDiffMessage(message, handlers), false, `rejected ${JSON.stringify(message)}`);
        }
        assert.strictEqual(init, 0, 'no handler runs for a malformed diffInit');
        assert.strictEqual(dispatchDiffMessage(diffInitMessage(), handlers), true, 'a structurally valid init still dispatches');
        assert.strictEqual(init, 1);
    });

    test('repeat Enter navigates the completed query instead of re-running it', async () => {
        mount([seg(0x3000, [0xDE, 0xAD]), seg(0x4000, [0xDE, 0xAD])], []);
        const original = SearchEngine.prototype.search;
        let calls = 0;
        SearchEngine.prototype.search = function (req, handlers): void {
            calls++;
            original.call(this, req, handlers);
        };
        try {
            typeInto(document.getElementById('search-input') as HTMLInputElement, 'DE AD');
            clickButton('btn-search');
            await wait(500);
            assert.strictEqual(calls, 1, 'the run button starts one search');
            assert.strictEqual(matchCount(), '1 / 2');
            pressEnter();
            assert.strictEqual(matchCount(), '2 / 2', 'Enter advances the active match');
            assert.strictEqual(calls, 1, 'an unchanged completed query is not re-run');
            pressEnter(true);
            assert.strictEqual(matchCount(), '1 / 2', 'Shift+Enter walks back');
            assert.strictEqual(calls, 1, 'Shift+Enter on the completed query is navigation only');
        } finally {
            SearchEngine.prototype.search = original;
        }
    });

    test('next/prev wrap around the match list at both ends', async () => {
        mount([seg(0x3000, [0xDE, 0xAD]), seg(0x4000, [0xDE, 0xAD])], []);
        typeInto(document.getElementById('search-input') as HTMLInputElement, 'DE AD');
        clickButton('btn-search');
        await wait(500);
        assert.strictEqual(matchCount(), '1 / 2');
        clickButton('btn-next');
        assert.strictEqual(matchCount(), '2 / 2');
        clickButton('btn-next');
        assert.strictEqual(matchCount(), '1 / 2', 'next wraps past the last match');
        clickButton('btn-prev');
        assert.strictEqual(matchCount(), '2 / 2', 'prev wraps before the first match');
    });

    test('a same-key UI change keeps matches and a diverged one drops them', async () => {
        mount([seg(0x3000, [0xDE, 0xAD])], []);
        typeInto(document.getElementById('search-input') as HTMLInputElement, 'DE AD');
        clickButton('btn-search');
        await wait(500);
        assert.strictEqual(matchCount(), '1 / 1');
        clickButton('search-btn-be');
        assert.strictEqual(matchCount(), '1 / 1', 'endianness is n/a for bytes, so the key is unchanged');
        selectMode('ascii');
        assert.strictEqual(matchCount(), '0 / 0', 'a diverged query drops the stale matches');
    });

    test('a streamed batch paints, counts, and jumps to the first match', () => {
        mount([seg(0x3000, [0xDE, 0xAD])], []);
        const original = SearchEngine.prototype.search;
        const captured: { handlers: SearchHandlers | null; calls: number } = { handlers: null, calls: 0 };
        SearchEngine.prototype.search = function (_req, nextHandlers): void {
            captured.calls++;
            captured.handlers = nextHandlers;
        };
        try {
            typeInto(document.getElementById('search-input') as HTMLInputElement, 'DE AD');
            clickButton('btn-search');
            assert.ok(captured.handlers !== null, 'the diff host requested a search');
            clickButton('btn-search');
            assert.strictEqual(captured.calls, 1, 'a Run click on the in-flight search is a no-op (hex parity)');
            captured.handlers.onProgressUpdate?.([0x3000], 50);
            assert.strictEqual(matchCount(), '1 / 1', 'streamed matches are counted');
            assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('amatch'), 'streamed match highlighted');
            assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('sel'), 'the first streamed batch selects the match');
        } finally {
            SearchEngine.prototype.search = original;
        }
    });

    test('the first streamed search batch jumps with one render per pane', () => {
        const wide = seg(0x3000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const writesA = countInnerHtmlWrites(document.getElementById('diff-rows-a')!);
        const writesB = countInnerHtmlWrites(document.getElementById('diff-rows-b')!);
        const original = SearchEngine.prototype.search;
        const captured: { handlers: SearchHandlers | null } = { handlers: null };
        SearchEngine.prototype.search = function (_req, nextHandlers): void { captured.handlers = nextHandlers; };
        try {
            typeInto(document.getElementById('search-input') as HTMLInputElement, 'FF');
            clickButton('btn-search');
            captured.handlers!.onProgressUpdate?.([0x3000], 10);
            assert.strictEqual(writesA.count, 1, 'the first batch jumps with one render on A');
            assert.strictEqual(writesB.count, 1, 'the first batch jumps with one render on B');
            assert.strictEqual(matchCount(), '1 / 1');
        } finally {
            SearchEngine.prototype.search = original;
        }
    });

    test('later streamed search batches repaint without rebuilding rows', () => {
        const wide = seg(0x3000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const writesA = countInnerHtmlWrites(document.getElementById('diff-rows-a')!);
        const writesB = countInnerHtmlWrites(document.getElementById('diff-rows-b')!);
        const original = SearchEngine.prototype.search;
        const captured: { handlers: SearchHandlers | null } = { handlers: null };
        SearchEngine.prototype.search = function (_req, nextHandlers): void { captured.handlers = nextHandlers; };
        try {
            typeInto(document.getElementById('search-input') as HTMLInputElement, 'FF');
            clickButton('btn-search');
            captured.handlers!.onProgressUpdate?.([0x3000], 10);
            captured.handlers!.onProgressUpdate?.([0x3000, 0x3010], 20);
            captured.handlers!.onProgressUpdate?.([0x3000, 0x3020], 30);
            assert.strictEqual(writesA.count, 1, 'later batches rebuild no rows on A');
            assert.strictEqual(writesB.count, 1, 'later batches rebuild no rows on B');
            assert.strictEqual(matchCount(), '1 / 2', 'the streamed count follows the deduped addresses');
            assert.ok(cell('#diff-rows-a', 0x3020)!.classList.contains('match'), 'a later batch still paints its visible match');
            captured.handlers!.onComplete([0x3000, 0x3010]);
            assert.strictEqual(matchCount(), '1 / 2', 'the completed count is correct');
        } finally {
            SearchEngine.prototype.search = original;
        }
    });

    test('a redraw after a streamed batch repaints matches from the declarative state', () => {
        mount([seg(0x3000, [0x10, 0x11, 0x12, 0x13])], [seg(0x3000, [0x10, 0x99, 0x12, 0x13])]);
        setSearchMatches([0x3000], 0, 1);
        assert.ok(cell('#diff-rows-a', 0x3000)!.classList.contains('match'), 'the batch painted incrementally');
        setViewMode('diff');
        assert.ok(cell('#diff-rows-a', 0x3000)!.classList.contains('match'), 'the redraw repaints from matchSet');
        assert.ok(cell('#diff-rows-a', 0x3000)!.classList.contains('amatch'), 'the active match survives the redraw');
        assert.ok(cell('#diff-rows-b', 0x3000)!.classList.contains('amatch'), 'B repaints from the same state');
    });

    test('a search jump renders once per pane at the destination with no deferred redraw', () => {
        installRafController();
        const wide = seg(0x3000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const writesA = countInnerHtmlWrites(document.getElementById('diff-rows-a')!);
        const writesB = countInnerHtmlWrites(document.getElementById('diff-rows-b')!);
        const original = SearchEngine.prototype.search;
        const captured: { handlers: SearchHandlers | null } = { handlers: null };
        SearchEngine.prototype.search = function (_req, nextHandlers): void { captured.handlers = nextHandlers; };
        try {
            typeInto(document.getElementById('search-input') as HTMLInputElement, 'FF');
            clickButton('btn-search');
            const dest = 0x3000 + 20 * 16;
            captured.handlers!.onProgressUpdate?.([dest], 50);
            assert.strictEqual(writesA.count, 1, 'exactly one render on A');
            assert.strictEqual(writesB.count, 1, 'exactly one render on B');
            assert.strictEqual(rafController!.pending(), 0, 'no deferred render is queued by the jump');
            assert.ok(cell('#diff-rows-a', dest)!.classList.contains('amatch'), 'A lands on the destination match');
            assert.ok(cell('#diff-rows-a', dest)!.classList.contains('sel'), 'A lands on the destination selection');
            assert.ok(cell('#diff-rows-b', dest)!.classList.contains('amatch'), 'B mirrors both');
            dispatchScroll(document.querySelector<HTMLElement>('#diff-a .mem-scroll')!);
            assert.strictEqual(rafController!.pending(), 0, 'the programmatic scroll event schedules nothing');
            assert.strictEqual(writesA.count, 1, 'the suppressed event does not rebuild rows');
        } finally {
            SearchEngine.prototype.search = original;
        }
    });

    test('a genuine user scroll after a suppressed jump still starts the poll', () => {
        installRafController();
        const wide = seg(0x3000, Array.from({ length: 512 }, (_, i) => i & 0xff));
        mount([wide], [wide]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        scrollToDiff({ start: 0x3000 + 20 * 16, end: 0x3000 + 20 * 16 });
        dispatchScroll(scrollA);
        assert.strictEqual(rafController!.pending(), 0, 'the programmatic event is suppressed');
        scrollA.scrollTop = scrollA.scrollTop + 64;
        dispatchScroll(scrollA);
        assert.strictEqual(rafController!.pending(), 1, 'a mismatched position is treated as a real scroll');
    });

    test('the match count survives a toolbar re-render', async () => {
        const a = [seg(0x3000, [0xDE, 0xAD])];
        const b: MemorySegment[] = [];
        mount(a, b);
        typeInto(document.getElementById('search-input') as HTMLInputElement, 'DE AD');
        clickButton('btn-search');
        await wait(500);
        assert.strictEqual(matchCount(), '1 / 1');
        setDiffSummary(computeByteDiff(a, b));
        assert.strictEqual(matchCount(), '1 / 1', 'the count is re-pushed after the bar is re-injected');
        assert.strictEqual((document.getElementById('search-input') as HTMLInputElement).value, 'DE AD', 'the query is preserved');
    });

    test('the reload messages route through the dispatcher and reject malformed shapes', () => {
        let changes = 0;
        let errors = 0;
        const handlers = {
            diffInit: () => { /* noop */ },
            diffError: () => { /* noop */ },
            diffProgress: () => { /* noop */ },
            diffExternalChange: () => { changes++; },
            diffExternalChangeError: () => { errors++; },
        };
        assert.strictEqual(dispatchDiffMessage(externalChangeMessage([seg(0x1000, [0x01])], [seg(0x1000, [0x02])]), handlers), true);
        assert.strictEqual(dispatchDiffMessage(externalChangeErrorMessage('a', true), handlers), true);
        assert.strictEqual(changes, 1);
        assert.strictEqual(errors, 1);

        const malformed: unknown[] = [
            { type: 'diffExternalChange' },
            { type: 'diffExternalChange', generation: 1, a: {}, b: {}, diff: { runs: [] } },
            { type: 'diffExternalChangeError' },
            { type: 'diffExternalChangeError', generation: 1, side: 'c', checksumErrors: 1, malformedLines: 0, canQuickRepair: true },
            { type: 'diffExternalChangeError', generation: 1, side: 'a', checksumErrors: 'x', malformedLines: 0, canQuickRepair: true },
        ];
        for (const message of malformed) {
            assert.strictEqual(dispatchDiffMessage(message, handlers), false, `rejected ${JSON.stringify(message)}`);
        }
        assert.strictEqual(changes, 1, 'no handler ran for a malformed change');
        assert.strictEqual(errors, 1, 'no handler ran for a malformed error');
    });

    test('an external change shows the reused reload banner; accept applies the pair and acknowledges', () => {
        mount([seg(0x1000, [0x01])], [seg(0x1000, [0x01])]);
        const posts: DiffWebviewToProvider[] = [];
        const banner = createDiffExternalChangeBanner(message => { posts.push(message); });

        banner.applyChange(externalChangeMessage([seg(0x1000, [0x01])], [seg(0x1000, [0x02])]));
        const reload = document.getElementById('ext-reload-banner');
        assert.ok(reload, 'the hex-view reload banner is reused');
        assert.strictEqual(reload!.parentElement?.id, 'app', 'banner sits at the top of #app');
        assert.strictEqual(document.querySelector('#ext-reload-banner .erb-msg')!.textContent, 'File changed externally. Reloading...');

        clickButton('erb-reload');
        assert.strictEqual(document.getElementById('ext-reload-banner'), null, 'banner removed on accept');
        assert.deepStrictEqual(posts, [{ type: 'reloadAccepted' }]);
        assert.ok(cell('#diff-rows-b', 0x1000)?.classList.contains('diff-chg'), 'the grid reflects the new bytes');
        assert.ok(document.querySelector('#diff-summary .diff-stat')!.textContent!.includes('1 changed'), 'the summary follows the new diff');
    });

    test('a reload keeps view mode and scroll, and resets selection + search', () => {
        const bytes = Array.from({ length: 40 * 16 }, (_, i) => i & 0xFF);
        const a = [seg(0x1000, bytes)];
        const b = [seg(0x1000, bytes.map((value, i) => (i % 16 === 0 ? value ^ 0xFF : value)))];
        mount(a, b);
        for (const pane of ['#diff-a', '#diff-b']) {
            Object.defineProperty(document.querySelector(`${pane} .mem-scroll`)!, 'clientHeight', { value: 100, configurable: true });
        }
        setViewMode('diff');
        setSearchMatches([0x1200], 0, 1);
        scrollToDiff({ start: 0x1200, end: 0x1200 });
        flushDiffRender();
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const before = scrollA.scrollTop;
        assert.ok(before > 0, `pane A scrolled (${before})`);
        assert.ok(document.querySelector('#diff-rows-a .amatch'), 'search match painted before the reload');

        const posts: DiffWebviewToProvider[] = [];
        const banner = createDiffExternalChangeBanner(message => { posts.push(message); });
        const nextB = [seg(0x1000, bytes.map((value, i) => (i % 16 === 0 ? value ^ 0x11 : value)))];
        banner.applyChange(externalChangeMessage(a, nextB));
        clickButton('erb-reload');

        assert.strictEqual(getViewMode(), 'diff', 'view mode survives the reload');
        assert.ok(Math.abs(document.querySelector<HTMLElement>('#diff-a .mem-scroll')!.scrollTop - before) < 0.001, 'the scroll anchor survives');
        assert.strictEqual(document.querySelector('#diff-rows-a .sel'), null, 'selection reset');
        assert.strictEqual(document.querySelector('#diff-rows-a .amatch'), null, 'search matches reset');
        assert.strictEqual(matchCount(), '', 'search count reset with a fresh empty query');
        assert.strictEqual((document.getElementById('search-input') as HTMLInputElement).value, '', 'the stale query is cleared');
    });

    test('the error banner posts repair / view-text actions for a broken side', () => {
        const posts: DiffWebviewToProvider[] = [];
        const banner = createDiffExternalChangeBanner(message => { posts.push(message); });

        banner.applyError(externalChangeErrorMessage('b', true));
        assert.ok(document.getElementById('ext-error-banner'), 'the reused error banner is shown');
        assert.strictEqual(document.querySelector('#ext-error-banner strong')!.textContent, '2 checksum errors');
        clickButton('eeb-repair');
        assert.deepStrictEqual(posts, [{ type: 'repairAndReload' }]);
        assert.ok(document.getElementById('ext-error-banner'), 'banner stays until the host reload flow clears it');

        banner.applyError(externalChangeErrorMessage('a', false));
        clickButton('eeb-view-text');
        assert.deepStrictEqual(posts, [{ type: 'repairAndReload' }, { type: 'viewInNormalEditor' }]);
    });

    test('a fresh reload clears the stale error banner and a broken side clears the stale reload banner', () => {
        const banner = createDiffExternalChangeBanner(() => { /* noop */ });

        banner.applyError(externalChangeErrorMessage('a', true));
        assert.ok(document.getElementById('ext-error-banner'));
        banner.applyChange(externalChangeMessage([seg(0x1000, [0x01])], [seg(0x1000, [0x02])]));
        assert.strictEqual(document.getElementById('ext-error-banner'), null, 'the repaired reload drops the stale error banner');
        assert.ok(document.getElementById('ext-reload-banner'));

        banner.applyError(externalChangeErrorMessage('b', false));
        assert.strictEqual(document.getElementById('ext-reload-banner'), null, 'a broken side supersedes a pending reload banner');
        assert.ok(document.getElementById('ext-error-banner'));
    });
});
