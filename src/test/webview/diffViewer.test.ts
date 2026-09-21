import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import './cssImportHook';

import { computeByteDiff } from '../../core/diff';
import type { MemorySegment } from '../../core/parser/types';
import type { DiffSide } from '../../diffProtocol';
import { hydrateDiffSide, renderDiffErrorHtml } from '../../webview/diff/diffModel';
import { copySelectionText, mountDiffGrid, resetDiffGrid, scrollToDiff, setDiffData, setSearchMatches, showDiffError } from '../../webview/diff/diffGrid';
import { renderDiffSummaryHtml, setDiffSummary } from '../../webview/diff/diffSummary';
import { isFindVisible, resetDiffSearch } from '../../webview/diff/diffSearch';
import { dispatchDiffMessage } from '../../webview/diff/diffMessages';

let currentDom: JSDOM | null = null;

function installDom(): JSDOM {
    const dom = new JSDOM(`<!doctype html><html><body><div id="app">
        <div class="diff-summary" id="diff-summary"></div>
        <div class="diff-find" id="diff-search"></div>
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

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('HexScope Diff webview', () => {
    setup(() => {
        currentDom = installDom();
        resetDiffGrid();
        resetDiffSearch();
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

    test('summary bar reports the computed counts and the exact action controls', () => {
        mount([seg(0x4000, [0x01, 0x02]), seg(0x4100, [0x01])], [seg(0x4000, [0x01, 0xFF])]);
        const text = document.getElementById('diff-summary')!.textContent ?? '';
        assert.ok(text.includes('1 changed'), `changed count in "${text}"`);
        assert.ok(text.includes('0 added'), `added count in "${text}"`);
        assert.ok(text.includes('1 removed'), `removed count in "${text}"`);
        const labels = [...document.querySelectorAll('#diff-summary button')].map(button => button.textContent);
        assert.deepStrictEqual(labels, [
            'Prev diff', 'Next diff', 'Show all', 'Show diff', 'Swap sides', 'Find', 'Sync scroll',
        ]);
        assert.ok(document.getElementById('diff-sync')!.classList.contains('active'), 'Sync scroll starts on');
        assert.ok(renderDiffSummaryHtml({ summary: { changed: 0, added: 0, removed: 0 }, runs: [] }).includes('0 changed'));
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

    test('turning Sync scroll off lets the panes scroll independently', () => {
        mount([seg(0x1000, [0x01, 0x02])], [seg(0x1000, [0x01, 0x02])]);
        const scrollA = document.querySelector<HTMLElement>('#diff-a .mem-scroll')!;
        const scrollB = document.querySelector<HTMLElement>('#diff-b .mem-scroll')!;
        clickButton('diff-sync');
        scrollA.scrollTop = 240;
        scrollA.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.strictEqual(scrollB.scrollTop, 0, 'follower stays put while sync is off');
        clickButton('diff-sync');
        scrollA.scrollTop = 300;
        scrollA.dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('scroll', { bubbles: true }));
        assert.strictEqual(scrollB.scrollTop, 300, 'follower resumes when sync is back on');
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

    test('Find reveals the search bar and matches highlight in both grids', () => {
        mount([seg(0x3000, [0x11])], [seg(0x3000, [0x11])]);
        clickButton('diff-find');
        assert.ok(isFindVisible(), 'find bar visible');
        assert.ok(document.getElementById('search-input'), 'search input injected');
        assert.ok(document.getElementById('diff-search')!.classList.contains('open'));
        setSearchMatches([0x3000], 0, 1);
        assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('match'), 'A match painted');
        assert.ok(cell('#diff-rows-a', 0x3000)?.classList.contains('amatch'), 'A active match painted');
        assert.ok(cell('#diff-rows-b', 0x3000)?.classList.contains('match'), 'B match painted');
    });

    test('one query searches both panes, unions the addresses, and next walks them', async () => {
        mount([seg(0x3000, [0xDE, 0xAD])], [seg(0x3000, [0xDE, 0xAD]), seg(0x4000, [0xDE, 0xAD])]);
        clickButton('diff-find');
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
        const css = fs.readFileSync(path.resolve(__dirname, '../../../src/webview/diff/diff.css'), 'utf8');
        assert.ok(/\.diff-body\[hidden\][^{]*\{[^}]*display:\s*none/.test(css), 'hidden body collapses instead of splitting the viewport');
        assert.ok(/\.diff-error\[hidden\][^{]*\{[^}]*display:\s*none/.test(css), 'hidden error collapses');
        assert.ok(/\.diff-split\s*\{[^}]*flex:\s*0 0 3px/.test(css), 'splitter is a static 3px divider');
        assert.ok(/\.diff-split:hover\s*\{/.test(css), 'splitter brightens on hover');
        assert.ok(!css.includes('.diff-hide-addr'), 'both panes keep their own address gutter');
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
