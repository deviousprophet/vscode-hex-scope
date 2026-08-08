import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../cssImportHook';

import { SearchBar } from '../../../webview/components/searchBar/searchBar';
import { searchKeyFor } from '../../../webview/components/searchBar/searchBarRender';
import type { SearchBarSeedOptions } from '../../../webview/components/searchBar/searchBar';

interface SearchCall {
    query: string;
    mode: string;
    endianness: string;
    trigger: string;
}

interface HarnessCalls {
    search: SearchCall[];
    prev: number;
    next: number;
    clear: number;
}

let currentDom: JSDOM | null = null;

function installDom(markup: string): JSDOM {
    const dom = new JSDOM(markup, { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as { window: Window; document: Document };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    return dom;
}

function cleanupDom(dom: JSDOM): void {
    dom.window.close();
    delete (globalThis as unknown as { window?: Window }).window;
    delete (globalThis as unknown as { document?: Document }).document;
}

function createHarness(seed?: SearchBarSeedOptions): { dom: JSDOM; bar: SearchBar; calls: HarnessCalls } {
    const calls: HarnessCalls = { search: [], prev: 0, next: 0, clear: 0 };
    const bar = new SearchBar(
        {
            onSearch: (query, mode, endianness, trigger) => {
                calls.search.push({ query, mode, endianness, trigger });
            },
            onPrev: () => { calls.prev++; },
            onNext: () => { calls.next++; },
            onClear: () => { calls.clear++; },
        },
        seed,
    );
    const dom = installDom(`<!DOCTYPE html><body>${bar.toHtml()}</body>`);
    currentDom = dom;
    bar.mount();
    return { dom, bar, calls };
}

function click(dom: JSDOM, id: string): void {
    const el = dom.window.document.getElementById(id);
    assert.ok(el, `missing #${id}`);
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

suite('webview SearchBar component', () => {
    teardown(() => {
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('renders mode labels with default mode selected', () => {
        const { dom } = createHarness();
        const select = dom.window.document.getElementById('search-mode') as HTMLSelectElement;
        assert.strictEqual(select.value, 'bytes');
        assert.deepStrictEqual(
            Array.from(select.options).map(o => o.textContent),
            ['Bytes', 'Value', 'ASCII', 'Addr'],
        );
    });

    test('endian pill hidden outside value mode, visible in value mode', () => {
        const bytesDom = createHarness({ mode: 'bytes' }).dom;
        assert.ok((bytesDom.window.document.getElementById('search-endian-toggle') as HTMLElement).hidden);
        cleanupDom(bytesDom);
        currentDom = null;

        const valueDom = createHarness({ mode: 'value' }).dom;
        assert.ok(!(valueDom.window.document.getElementById('search-endian-toggle') as HTMLElement).hidden);
    });

    test('endian pill click updates active endian without re-running search', () => {
        const { dom, calls } = createHarness({ mode: 'value', query: '0x12' });
        click(dom, 'search-btn-be');
        assert.deepStrictEqual(calls.search, [], 'endian change must not trigger a search');
        assert.ok((dom.window.document.getElementById('search-btn-be') as HTMLButtonElement).classList.contains('active'));
        assert.ok(!(dom.window.document.getElementById('search-btn-auto') as HTMLButtonElement).classList.contains('active'));
    });

    test('addr mode shows 0x overlay and strips non-hex input', () => {
        const { dom, calls } = createHarness({ mode: 'addr', query: '1A' });
        const input = dom.window.document.getElementById('search-input') as HTMLInputElement;
        assert.ok(!(dom.window.document.getElementById('search-addr-prefix') as HTMLElement).hidden);
        assert.ok(input.classList.contains('search-addr-mode'));

        input.value = '1G2!F';
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.strictEqual(input.value, '12F');
        assert.strictEqual(calls.search.length, 0, 'typing must not trigger a search');
    });

    test('mode change updates mode without re-running search', () => {
        const { dom, calls } = createHarness({ query: '41' });
        const select = dom.window.document.getElementById('search-mode') as HTMLSelectElement;
        select.value = 'ascii';
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.deepStrictEqual(calls.search, [], 'mode change must not trigger a search');
        assert.strictEqual(select.value, 'ascii');
    });

    test('Enter triggers enter-next; Shift+Enter triggers enter-prev', () => {
        const { dom, calls } = createHarness({ query: 'AB' });
        const input = dom.window.document.getElementById('search-input') as HTMLInputElement;

        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.deepStrictEqual(calls.search, [{ query: 'AB', mode: 'bytes', endianness: 'auto', trigger: 'enter-next' }]);

        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
        assert.deepStrictEqual(calls.search.slice(1), [{ query: 'AB', mode: 'bytes', endianness: 'auto', trigger: 'enter-prev' }]);
    });

    test('run button triggers onSearch with button trigger', () => {
        const { dom, calls } = createHarness({ query: 'DE AD' });
        click(dom, 'btn-search');
        assert.deepStrictEqual(calls.search, [{ query: 'DE AD', mode: 'bytes', endianness: 'auto', trigger: 'button' }]);
    });

    test('prev/next buttons call onPrev/onNext', () => {
        const { dom, calls } = createHarness();
        click(dom, 'btn-prev');
        click(dom, 'btn-next');
        assert.strictEqual(calls.prev, 1);
        assert.strictEqual(calls.next, 1);
    });

    test('Ctrl+F focuses the search input', () => {
        const { dom } = createHarness({ query: 'AB' });
        const input = dom.window.document.getElementById('search-input') as HTMLInputElement;
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
        assert.strictEqual(dom.window.document.activeElement, input);
    });

    test('clear button empties input and calls onClear without searching', () => {
        const { dom, calls } = createHarness({ query: 'AB' });
        click(dom, 'btn-clear-search');
        const input = dom.window.document.getElementById('search-input') as HTMLInputElement;
        assert.strictEqual(input.value, '');
        assert.strictEqual(calls.clear, 1);
        assert.strictEqual(calls.search.length, 0);
    });

    test('setCount renders current+1 / total when query non-empty', () => {
        const { dom, bar } = createHarness({ query: 'AB' });
        const el = dom.window.document.getElementById('match-count') as HTMLElement;
        bar.setCount(5, 2);
        assert.strictEqual(el.textContent, '3 / 5');
    });

    test('setCount renders 0 / 0 when query has no hits', () => {
        const { dom, bar } = createHarness({ query: 'AB' });
        const el = dom.window.document.getElementById('match-count') as HTMLElement;
        bar.setCount(0, -1);
        assert.strictEqual(el.textContent, '0 / 0');
    });

    test('setCount is blank when the query is empty', () => {
        const { dom, bar } = createHarness();
        const el = dom.window.document.getElementById('match-count') as HTMLElement;
        bar.setCount(0, -1);
        assert.strictEqual(el.textContent, '');
    });

    test('setBusy toggles spinner class and aria-hidden', () => {
        const { dom, bar } = createHarness();
        const el = dom.window.document.getElementById('search-progress') as HTMLElement;
        bar.setBusy(true);
        assert.ok(el.classList.contains('active'));
        assert.strictEqual(el.getAttribute('aria-hidden'), 'false');
        bar.setBusy(false);
        assert.ok(!el.classList.contains('active'));
        assert.strictEqual(el.getAttribute('aria-hidden'), 'true');
    });

    test('seed restores mode, endianness and query', () => {
        const { dom } = createHarness({ mode: 'addr', endianness: 'be', query: '1A' });
        const doc = dom.window.document;
        assert.strictEqual((doc.getElementById('search-mode') as HTMLSelectElement).value, 'addr');
        assert.ok((doc.getElementById('search-btn-be') as HTMLButtonElement).classList.contains('active'));
        assert.strictEqual((doc.getElementById('search-input') as HTMLInputElement).value, '1A');
        assert.ok(!(doc.getElementById('search-addr-prefix') as HTMLElement).hidden);
    });

    test('mount is idempotent and toHtml regenerates from internal state', () => {
        const { dom, bar, calls } = createHarness({ query: 'AB' });
        bar.mount(); // second mount must not duplicate listeners
        const input = dom.window.document.getElementById('search-input') as HTMLInputElement;
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.strictEqual(calls.search.length, 1);

        input.value = 'DE AD';
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.ok(bar.toHtml().includes('value="DE AD"'));
    });

    test('Ctrl+Z does not fire any search callback', () => {
        const { dom, calls } = createHarness({ query: 'AB' });
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
        assert.strictEqual(calls.search.length, 0);
        assert.strictEqual(calls.prev + calls.next + calls.clear, 0);
    });

    test('searchKeyFor includes endianness only in value mode', () => {
        assert.strictEqual(searchKeyFor('bytes', 'DE AD', 'be'), searchKeyFor('bytes', 'DE AD', 'le'));
        assert.strictEqual(searchKeyFor('addr', '1A0', 'be'), searchKeyFor('addr', '1A0', 'le'));
        assert.notStrictEqual(searchKeyFor('value', '0x1234', 'be'), searchKeyFor('value', '0x1234', 'le'));
        assert.strictEqual(searchKeyFor('value', '0x1234', 'be'), 'value|be|1234');
    });
});
