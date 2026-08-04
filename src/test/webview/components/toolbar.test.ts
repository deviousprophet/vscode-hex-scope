import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../css-import-hook';

import {
    Toolbar,
    renderToolbarHtml,
    type ToolbarCallbacks,
    type ToolbarView,
} from '../../../webview/components/Toolbar/Toolbar';

interface HarnessCalls {
    viewChanges: ToolbarView[];
    asciiToggles: number;
    editStarts: number;
    saves: number;
    cancels: number;
}

let currentDom: JSDOM | null = null;

function installDom(markup: string): JSDOM {
    const dom = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, { url: 'https://hexscope.test/' });
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

function emptyCalls(): HarnessCalls {
    return { viewChanges: [], asciiToggles: 0, editStarts: 0, saves: 0, cancels: 0 };
}

function createHarness(): { dom: JSDOM; bar: Toolbar; calls: HarnessCalls } {
    const calls = emptyCalls();
    const cb: ToolbarCallbacks = {
        onViewChange: v => { calls.viewChanges.push(v); },
        onAsciiToggle: () => { calls.asciiToggles++; },
        onEditStart: () => { calls.editStarts++; },
        onSave: () => { calls.saves++; },
        onCancel: () => { calls.cancels++; },
    };
    const bar = new Toolbar(cb);
    const dom = installDom(bar.toHtml('<div id="search-box"></div>'));
    currentDom = dom;
    bar.mount();
    return { dom, bar, calls };
}

function click(dom: JSDOM, id: string): void {
    const el = dom.window.document.getElementById(id);
    assert.ok(el, `missing #${id}`);
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function displayOf(dom: JSDOM, id: string): string {
    return (dom.window.document.getElementById(id) as HTMLElement).style.display;
}

function saveDisabled(dom: JSDOM): boolean {
    return (dom.window.document.getElementById('btn-save') as HTMLButtonElement).disabled;
}

suite('webview Toolbar component', () => {
    teardown(() => {
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('renders toolbar chrome with ids/classes matching pre-refactor', () => {
        const { dom } = createHarness();
        const doc = dom.window.document;
        assert.ok(doc.getElementById('toolbar'));
        assert.ok(doc.getElementById('btn-mem'));
        assert.ok(doc.getElementById('btn-rec'));
        assert.ok(doc.getElementById('btn-ascii-toggle')?.classList.contains('tb-ascii-btn'));
        assert.ok(doc.getElementById('btn-edit-mode')?.classList.contains('tb-edit-btn'));
        assert.ok(doc.getElementById('edit-mode-group'));
        assert.ok(doc.querySelector('#edit-mode-group .tb-editing-pill'));
        assert.ok(doc.querySelector('.view-tabs'));
        assert.ok(doc.querySelector('.tb-sep'));
        assert.ok(doc.getElementById('btn-save')?.classList.contains('tb-save-btn'));
        assert.ok(doc.getElementById('btn-cancel')?.classList.contains('tb-cancel-btn'));
        assert.strictEqual((doc.getElementById('btn-mem') as HTMLElement).className, 'active');
        assert.strictEqual((doc.getElementById('btn-rec') as HTMLElement).className, '');
    });

    test('default memory/non-editing state: edit button visible, group hidden, save disabled', () => {
        const { dom } = createHarness();
        assert.strictEqual(displayOf(dom, 'btn-edit-mode'), '');
        assert.strictEqual(displayOf(dom, 'edit-mode-group'), 'none');
        assert.ok(saveDisabled(dom));
        assert.strictEqual((dom.window.document.getElementById('edit-dirty-count') as HTMLElement).textContent, '');
    });

    test('SearchBar slot is embedded in toolbar markup', () => {
        const { dom } = createHarness();
        assert.ok(dom.window.document.getElementById('search-box'));
        const toolbar = dom.window.document.getElementById('toolbar') as HTMLElement;
        assert.ok(toolbar.contains(dom.window.document.getElementById('search-box')));
    });

    test('renderToolbarHtml reflects view/ascii/edit/dirty state', () => {
        const html = renderToolbarHtml('<div id="search-box"></div>', {
            view: 'record',
            ascii: true,
            editMode: true,
            dirtyCount: 3,
        });
        assert.ok(html.includes('id="btn-rec" class="active"'));
        assert.ok(!html.includes('id="btn-mem" class="active"'));
        assert.ok(html.includes('id="edit-dirty-count">3 unsaved bytes</span>'));
        assert.ok(html.includes('id="btn-save" class="tb-save-btn" title="Save edits to file">'));
        assert.ok(html.includes('style="display:none"'));
    });

    test('view tab clicks report onViewChange with the target view', () => {
        const { dom, calls } = createHarness();
        click(dom, 'btn-rec');
        click(dom, 'btn-mem');
        assert.deepStrictEqual(calls.viewChanges, ['record', 'memory']);
    });

    test('ASCII toggle reports onAsciiToggle', () => {
        const { dom, calls } = createHarness();
        click(dom, 'btn-ascii-toggle');
        assert.strictEqual(calls.asciiToggles, 1);
    });

    test('edit/save/cancel buttons report their callbacks', () => {
        const { dom, bar, calls } = createHarness();
        bar.setEditMode(true);
        click(dom, 'btn-edit-mode');
        click(dom, 'btn-save');
        click(dom, 'btn-cancel');
        assert.strictEqual(calls.editStarts, 1);
        assert.strictEqual(calls.saves, 1);
        assert.strictEqual(calls.cancels, 1);
    });

    test('setView toggles active tab and memory-gates ascii/edit controls', () => {
        const { dom, bar } = createHarness();
        bar.setEditMode(true);
        bar.setView('record');
        assert.strictEqual((dom.window.document.getElementById('btn-rec') as HTMLElement).className, 'active');
        assert.strictEqual((dom.window.document.getElementById('btn-mem') as HTMLElement).className, '');
        assert.strictEqual(displayOf(dom, 'btn-ascii-toggle'), 'none');
        assert.strictEqual(displayOf(dom, 'btn-edit-mode'), 'none');
        assert.strictEqual(displayOf(dom, 'edit-mode-group'), 'none');

        bar.setView('memory');
        assert.strictEqual((dom.window.document.getElementById('btn-mem') as HTMLElement).className, 'active');
        assert.strictEqual(displayOf(dom, 'btn-ascii-toggle'), '');
        assert.strictEqual(displayOf(dom, 'btn-edit-mode'), 'none');
        assert.strictEqual(displayOf(dom, 'edit-mode-group'), '');
    });

    test('setEditMode swaps edit entry button and EDITING group within memory view', () => {
        const { dom, bar } = createHarness();
        assert.strictEqual(displayOf(dom, 'btn-edit-mode'), '');
        assert.strictEqual(displayOf(dom, 'edit-mode-group'), 'none');
        bar.setEditMode(true);
        assert.strictEqual(displayOf(dom, 'btn-edit-mode'), 'none');
        assert.strictEqual(displayOf(dom, 'edit-mode-group'), '');
        bar.setEditMode(false);
        assert.strictEqual(displayOf(dom, 'btn-edit-mode'), '');
        assert.strictEqual(displayOf(dom, 'edit-mode-group'), 'none');
    });

    test('setAscii toggles the ASCII active class', () => {
        const { dom, bar } = createHarness();
        assert.ok(!(dom.window.document.getElementById('btn-ascii-toggle') as HTMLElement).classList.contains('active'));
        bar.setAscii(true);
        assert.ok((dom.window.document.getElementById('btn-ascii-toggle') as HTMLElement).classList.contains('active'));
        bar.setAscii(false);
        assert.ok(!(dom.window.document.getElementById('btn-ascii-toggle') as HTMLElement).classList.contains('active'));
    });

    test('ASCII active class survives memory - record - memory re-entry', () => {
        const { dom, bar } = createHarness();
        bar.setView('memory');
        bar.setAscii(true);
        assert.ok((dom.window.document.getElementById('btn-ascii-toggle') as HTMLElement).classList.contains('active'));
        bar.setView('record');
        assert.ok(!(dom.window.document.getElementById('btn-ascii-toggle') as HTMLElement).classList.contains('active'), 'hidden tab, not active');
        bar.setView('memory');
        assert.ok((dom.window.document.getElementById('btn-ascii-toggle') as HTMLElement).classList.contains('active'), 're-entry restores ASCII active state');
    });

    test('setDirty renders count text and disables Save only when count is 0', () => {
        const { dom, bar } = createHarness();
        bar.setDirty(1);
        assert.strictEqual((dom.window.document.getElementById('edit-dirty-count') as HTMLElement).textContent, '1 unsaved byte');
        assert.ok(!saveDisabled(dom));
        bar.setDirty(4);
        assert.strictEqual((dom.window.document.getElementById('edit-dirty-count') as HTMLElement).textContent, '4 unsaved bytes');
        assert.ok(!saveDisabled(dom));
        bar.setDirty(0);
        assert.strictEqual((dom.window.document.getElementById('edit-dirty-count') as HTMLElement).textContent, '');
        assert.ok(saveDisabled(dom));
    });

    test('mount is idempotent: second mount does not duplicate listeners', () => {
        const { dom, bar, calls } = createHarness();
        bar.mount();
        click(dom, 'btn-rec');
        click(dom, 'btn-ascii-toggle');
        assert.deepStrictEqual(calls.viewChanges, ['record']);
        assert.strictEqual(calls.asciiToggles, 1);
    });

    test('setCallbacks rewires reports', () => {
        const { dom, bar } = createHarness();
        const later: HarnessCalls = emptyCalls();
        bar.setCallbacks({ onViewChange: v => { later.viewChanges.push(v); } });
        click(dom, 'btn-mem');
        assert.deepStrictEqual(later.viewChanges, ['memory']);
    });

    test('toHtml regenerates from current internal state', () => {
        const { bar } = createHarness();
        bar.setDirty(2);
        bar.setEditMode(true);
        assert.ok(bar.toHtml('<div id="search-box"></div>').includes('2 unsaved bytes'));
        assert.ok(bar.toHtml('<div id="search-box"></div>').includes('id="btn-edit-mode" class="tb-edit-btn" title="Enter edit mode" style="display:none"'));
    });
});
