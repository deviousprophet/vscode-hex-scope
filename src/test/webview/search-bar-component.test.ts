// jsdom-driven tests for SearchBarComponent (spec frontend/search-bar-component.md §4).

import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import { SearchBarComponent } from '../../webview/ui-components/search-bar/searchBarComponent';

let dom: JSDOM;

function setupDom(): void {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
    const g = globalThis as unknown as Record<string, unknown>;
    g.document = dom.window.document;
    g.window = dom.window;
    g.Node = dom.window.Node;
    g.Element = dom.window.Element;
    g.HTMLElement = dom.window.HTMLElement;
    g.HTMLInputElement = dom.window.HTMLInputElement;
    g.HTMLSelectElement = dom.window.HTMLSelectElement;
    g.KeyboardEvent = dom.window.KeyboardEvent;
    g.MouseEvent = dom.window.MouseEvent;
    g.Event = dom.window.Event;
}

function calls(): { search: Array<[string, string, string]>; prev: number; next: number; clear: number } {
    const c = { search: [] as Array<[string, string, string]>, prev: 0, next: 0, clear: 0 };
    return c;
}

function mount(c: ReturnType<typeof calls>): SearchBarComponent {
    const comp = new SearchBarComponent({
        onSearch: (q, mode, endian) => { c.search.push([q, mode, endian]); },
        onPrev: () => { c.prev++; },
        onNext: () => { c.next++; },
        onClear: () => { c.clear++; },
    });
    dom.window.document.body.innerHTML = comp.toHtml();
    comp.mount();
    return comp;
}

function input(): HTMLInputElement {
    return dom.window.document.getElementById('search-input') as HTMLInputElement;
}

function enterOnInput(shift = false): void {
    input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: shift, bubbles: true }));
}

suite('search bar component', () => {
    test('mode select uses single-view labels (Bytes/Value/ASCII/Addr)', () => {
        setupDom();
        mount(calls());
        const opts = Array.from(dom.window.document.querySelectorAll('#search-mode option'))
            .map(o => (o as HTMLOptionElement).textContent);
        assert.deepStrictEqual(opts, ['Bytes', 'Value', 'ASCII', 'Addr']);
    });

    test('endian pill shows only in value mode; clicking re-runs the search', () => {
        setupDom();
        const c = calls();
        mount(c);
        const toggle = dom.window.document.getElementById('search-endian-toggle') as HTMLElement;
        assert.strictEqual(toggle.style.display, 'none', 'pill hidden in bytes mode');

        const mode = dom.window.document.getElementById('search-mode') as HTMLSelectElement;
        mode.value = 'value';
        mode.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.strictEqual(toggle.style.display, 'inline-flex', 'pill visible in value mode');
        assert.strictEqual(c.search.length, 1, 'mode change re-runs');

        input().value = '0x1234';
        dom.window.document.getElementById('search-btn-le')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        const last = c.search[c.search.length - 1];
        assert.deepStrictEqual(last, ['0x1234', 'value', 'le'], 'endian click re-runs with the new endianness');
    });

    test('addr mode shows 0x prefix overlay and strips non-hex input', () => {
        setupDom();
        mount(calls());
        const mode = dom.window.document.getElementById('search-mode') as HTMLSelectElement;
        mode.value = 'addr';
        mode.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const prefix = dom.window.document.getElementById('search-addr-prefix') as HTMLElement;

        input().value = '1A0';
        input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.strictEqual(prefix.style.display, '', 'prefix visible for non-empty addr query');

        input().value = 'zz1G0!';
        input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.strictEqual(input().value, '10', 'non-hex chars stripped');
    });

    test('Enter runs a fresh search; Enter on a completed unchanged query navigates', () => {
        setupDom();
        const c = calls();
        const comp = mount(c);

        input().value = 'DE AD';
        enterOnInput();
        assert.strictEqual(c.search.length, 1, 'first Enter runs the search');

        // Search completes.
        comp.setBusy(false);
        enterOnInput();
        assert.strictEqual(c.search.length, 1, 'unchanged completed query does not re-run');
        assert.strictEqual(c.next, 1, 'Enter navigates next');

        enterOnInput(true);
        assert.strictEqual(c.prev, 1, 'Shift+Enter navigates prev');
        assert.strictEqual(c.search.length, 1, 'still no re-run');

        // Changed query re-runs.
        input().value = 'BE';
        enterOnInput();
        assert.strictEqual(c.search.length, 2, 'changed query runs a fresh search');
    });

    test('Ctrl+F focuses and selects the search input', () => {
        setupDom();
        mount(calls());
        dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
        assert.strictEqual(dom.window.document.activeElement, input(), 'input focused');
    });

    test('clear empties the input and fires onClear', () => {
        setupDom();
        const c = calls();
        mount(c);
        input().value = 'DE';
        dom.window.document.getElementById('btn-clear-search')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(input().value, '', 'input cleared');
        assert.strictEqual(c.clear, 1, 'onClear fired');
    });

    test('setCount renders N / M; empty query stays blank; setBusy toggles the spinner', () => {
        setupDom();
        const comp = mount(calls());
        const count = dom.window.document.getElementById('match-count')!;
        const progress = dom.window.document.getElementById('search-progress')!;

        input().value = 'DE';
        input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        comp.setCount(5, 2);
        assert.strictEqual(count.textContent, '3 / 5');

        input().value = '';
        input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        comp.setCount(5, 0);
        assert.strictEqual(count.textContent, '', 'blank when no query');

        comp.setBusy(true);
        assert.ok(progress.classList.contains('active'), 'spinner on while busy');
        assert.strictEqual(progress.getAttribute('aria-hidden'), 'false');
        comp.setBusy(false);
        assert.ok(!progress.classList.contains('active'), 'spinner off when idle');
    });
});
