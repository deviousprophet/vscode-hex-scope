import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../cssImportHook';

import {
    ContextMenu,
    renderContextMenuHtml,
    type ContextMenuCallbacks,
    type ContextMenuState,
} from '../../../webview/components/contextMenu/contextMenu';
import { positionContextMenu, wireHoverSubmenus } from '../../../webview/utils';

interface Calls {
    commands: string[];
}

let currentDom: JSDOM | null = null;

function installDom(): JSDOM {
    const dom = new JSDOM('<!DOCTYPE html><body><button id="trigger">T</button><div id="ctx-menu"></div></body>', { url: 'https://hexscope.test/' });
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

function emptyCalls(): Calls {
    return { commands: [] };
}

function baseState(partial: Partial<ContextMenuState> = {}): ContextMenuState {
    return {
        selectionActive: true,
        len: 4,
        bytes: [0xDE, 0xAD, 0xBE, 0xEF],
        editMode: false,
        endian: 'le',
        goAddress: { address: 0xEFBEADDE, valid: true },
        ...partial,
    };
}

function createHarness(partial: Partial<ContextMenuState> = {}): { dom: JSDOM; menu: ContextMenu; calls: Calls } {
    const calls = emptyCalls();
    const cb: ContextMenuCallbacks = {
        onCommand: cmd => { calls.commands.push(cmd); },
    };
    const menu = new ContextMenu(cb);
    const dom = installDom();
    currentDom = dom;
    menu.mount();
    menu.show(10, 10, baseState(partial));
    return { dom, menu, calls };
}

function ctxMenuEl(dom: JSDOM): HTMLElement {
    const el = dom.window.document.getElementById('ctx-menu') as HTMLElement;
    assert.ok(el, 'missing #ctx-menu');
    return el;
}

function row(dom: JSDOM, cmd: string): HTMLElement | null {
    return ctxMenuEl(dom).querySelector<HTMLElement>(`.ctx-row[data-cmd="${cmd}"]`);
}

function clickRow(dom: JSDOM, cmd: string): void {
    const r = row(dom, cmd);
    assert.ok(r, `missing row [data-cmd=${cmd}]`);
    r!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function visible(dom: JSDOM): boolean {
    return ctxMenuEl(dom).style.display !== 'none';
}

suite('webview ContextMenu component', () => {
    teardown(() => {
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('renders reworked multi-byte layout with direct + submenu + interaction rows', () => {
        const html = renderContextMenuHtml(baseState());
        assert.ok(html.includes('4 bytes selected'));
        assert.ok(html.includes('data-cmd="copy-hex"'));
        assert.ok(html.includes('data-cmd="copy-ascii"'));
        assert.ok(html.includes('data-cmd="copy-c-array"'));
        assert.ok(html.includes('data-sub="copy"'));
        assert.ok(html.includes('data-sub="analyze"'));
        assert.ok(html.includes('data-cmd="go-address"'));
        assert.ok(html.includes('data-cmd="select-all"'));
        assert.ok(html.includes('data-cmd="select-segment"'));
        assert.ok(!html.includes('ctx-label-input'));
        assert.ok(!html.includes('data-sub="fill"'), 'patch hidden outside edit mode');
    });

    test('copy-as submenu holds remaining formats, not the direct ones', () => {
        const html = renderContextMenuHtml(baseState());
        assert.ok(html.includes('data-cmd="hex-raw"'));
        assert.ok(html.includes('data-cmd="binary"'));
        assert.ok(html.includes('data-cmd="dec-array"'));
        assert.ok(html.includes('data-cmd="hex-array"'));
        assert.ok(html.includes('data-cmd="base64"'));
        assert.ok(!html.includes('data-cmd="hex"'));
        assert.ok(!html.includes('data-cmd="ascii"'));
        assert.ok(!html.includes('data-cmd="c-array"'));
    });

    test('single-byte variant: no analyze, no go-address, no c-array; dec/binary copy-as', () => {
        const html = renderContextMenuHtml(baseState({ len: 1, bytes: [0x42], goAddress: null }));
        assert.ok(html.includes('1 byte selected'));
        assert.ok(html.includes('data-cmd="copy-hex"'));
        assert.ok(html.includes('data-cmd="copy-ascii"'));
        assert.ok(html.includes('data-cmd="dec"'));
        assert.ok(html.includes('data-cmd="binary"'));
        assert.ok(!html.includes('data-cmd="copy-c-array"'));
        assert.ok(!html.includes('data-sub="analyze"'));
        assert.ok(!html.includes('data-cmd="go-address"'));
        assert.ok(html.includes('data-cmd="select-all"'));
        assert.ok(!html.includes('ctx-label-input'));
    });

    test('single-byte Copy ASCII is gated on printable bytes (regression C2)', () => {
        const printable = renderContextMenuHtml(baseState({ len: 1, bytes: [0x42], goAddress: null }));
        assert.ok(printable.includes('data-cmd="copy-ascii"'));
        assert.ok(printable.includes("'B'"));
        const nonPrintable = renderContextMenuHtml(baseState({ len: 1, bytes: [0x00], goAddress: null }));
        assert.ok(!nonPrintable.includes('data-cmd="copy-ascii"'), 'non-printable byte hides Copy ASCII');
    });

    test('edit mode renders patch/fill submenu with custom input and editing badge', () => {
        const html = renderContextMenuHtml(baseState({ editMode: true }));
        assert.ok(html.includes('data-sub="fill"'));
        assert.ok(html.includes('ctx-fill-input'));
        assert.ok(html.includes('ctx-fill-apply'));
        assert.ok(html.includes('Editing'));
    });

    test('go-address preview shows target and endian badge', () => {
        const html = renderContextMenuHtml(baseState());
        assert.ok(html.includes('0xEFBEADDE'));
        assert.ok(html.includes('LE'));
    });

    test('go-address preview honors system endian (BE)', () => {
        const html = renderContextMenuHtml(baseState({ endian: 'be', goAddress: { address: 0xDEADBEEF, valid: true } }));
        assert.ok(html.includes('0xDEADBEEF'));
        assert.ok(html.includes('BE'));
    });

    test('invalid go-address renders disabled row', () => {
        const html = renderContextMenuHtml(baseState({ goAddress: { address: 0xEFBEADDE, valid: false } }));
        assert.ok(html.includes('class="ctx-row ctx-go-row ctx-disabled" data-cmd="go-address"'));
    });

    test('no go-address row when len !== 4', () => {
        const html = renderContextMenuHtml(baseState({ len: 2, bytes: [0xDE, 0xAD], goAddress: null }));
        assert.ok(!html.includes('data-cmd="go-address"'));
    });

    test('show renders into #ctx-menu; direct row click fires onCommand and hides', () => {
        const { dom, calls } = createHarness();
        clickRow(dom, 'copy-hex');
        assert.deepStrictEqual(calls.commands, ['copy-hex']);
        assert.ok(!visible(dom));
    });

    test('click on disabled go-address row fires nothing and stays open', () => {
        const { dom, calls } = createHarness({ goAddress: { address: 0xEFBEADDE, valid: false } });
        clickRow(dom, 'go-address');
        assert.deepStrictEqual(calls.commands, []);
        assert.ok(visible(dom));
    });

    test('click outside menu hides it', () => {
        const { dom } = createHarness();
        dom.window.document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.ok(!visible(dom));
    });

    test('Escape hides the menu', () => {
        const { dom } = createHarness();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.ok(!visible(dom));
    });

    test('rows expose menu semantics and keyboard focus', () => {
        const html = renderContextMenuHtml(baseState());
        assert.ok(html.includes('role="menuitem"'));
        assert.ok(html.includes('tabindex="-1"'));
        assert.ok(html.includes('role="separator"'));
    });

    test('arrow keys move focus through rows and Enter runs the focused command', () => {
        const { dom, calls } = createHarness();
        const first = ctxMenuEl(dom).querySelector<HTMLElement>('.ctx-row[data-cmd]')!;
        assert.strictEqual(document.activeElement, first, 'show focuses the first enabled row');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        const second = ctxMenuEl(dom).querySelectorAll<HTMLElement>('.ctx-row[data-cmd]')[1];
        assert.strictEqual(document.activeElement, second, 'ArrowDown moves focus to the next row');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
        assert.deepStrictEqual(calls.commands, [second.dataset.cmd], 'Enter runs the focused row command');
        assert.ok(!visible(dom), 'menu hides after the command');
    });

    test('arrow keys skip disabled rows', () => {
        const { dom } = createHarness({ goAddress: { address: 0xEFBEADDE, valid: false } });
        const goRow = ctxMenuEl(dom).querySelector<HTMLElement>('.ctx-row[data-cmd="go-address"]')!;
        assert.ok(goRow.classList.contains('ctx-disabled'));
        for (let i = 0; i < 12; i++) {
            dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
            const active = document.activeElement as HTMLElement;
            assert.notStrictEqual(active.dataset.cmd, 'go-address', 'focus never lands on a disabled row');
        }
    });

    test('hover on a submenu row opens its submenu', () => {
        const { dom } = createHarness();
        const subRow = ctxMenuEl(dom).querySelector<HTMLElement>('.ctx-has-sub[data-sub="copy"]');
        assert.ok(subRow);
        subRow!.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        const sub = subRow!.querySelector<HTMLElement>('.ctx-submenu');
        assert.ok(sub, 'submenu element present');
        assert.strictEqual(sub!.style.display, 'block');
    });

    test('Enter on a submenu row opens it and focuses the first item inside', () => {
        const { dom } = createHarness();
        const subRow = ctxMenuEl(dom).querySelector<HTMLElement>('.ctx-has-sub[data-sub="copy"]')!;
        subRow.focus();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
        const sub = subRow.querySelector<HTMLElement>('.ctx-submenu')!;
        assert.strictEqual(sub.style.display, 'block', 'Enter opens the submenu');
        const first = sub.querySelector<HTMLElement>('.ctx-row:not(.ctx-disabled)')!;
        assert.strictEqual(document.activeElement, first, 'focus moves to the first enabled submenu item');
    });

    test('custom fill: valid Enter applies fill command and hides', () => {
        const { dom, calls } = createHarness({ editMode: true });
        const input = ctxMenuEl(dom).querySelector<HTMLInputElement>('.ctx-fill-input');
        assert.ok(input);
        input!.value = 'FF';
        input!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.deepStrictEqual(calls.commands, ['fill-FF']);
        assert.ok(!visible(dom));
    });

    test('custom fill: invalid input toggles ctx-fill-invalid and stays open', () => {
        const { dom, calls } = createHarness({ editMode: true });
        const input = ctxMenuEl(dom).querySelector<HTMLInputElement>('.ctx-fill-input');
        input!.value = 'GG';
        input!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.ok(input!.classList.contains('ctx-fill-invalid'));
        assert.deepStrictEqual(calls.commands, []);
        assert.ok(visible(dom));
    });

    test('custom fill: Escape dismisses the menu even with text in the input', () => {
        const { dom } = createHarness({ editMode: true });
        const input = ctxMenuEl(dom).querySelector<HTMLInputElement>('.ctx-fill-input')!;
        input.value = 'FF';
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.ok(!visible(dom));
    });

    test('show is a no-op when selection is inactive', () => {
        const { dom, menu } = createHarness();
        menu.hide();
        menu.show(10, 10, baseState({ selectionActive: false }));
        assert.ok(!visible(dom));
    });

    test('hide restores focus to the element focused before the menu opened', () => {
        const { dom, menu } = createHarness();
        const trigger = dom.window.document.getElementById('trigger') as HTMLElement;
        menu.hide();
        trigger.focus();
        menu.show(10, 10, baseState());
        assert.notStrictEqual(dom.window.document.activeElement, trigger, 'menu row holds focus while open');
        menu.hide();
        assert.strictEqual(dom.window.document.activeElement, trigger, 'focus returns to the trigger on hide');
    });

    test('mount is idempotent: second mount does not double-fire commands', () => {
        const { dom, menu, calls } = createHarness();
        menu.mount();
        clickRow(dom, 'copy-ascii');
        assert.deepStrictEqual(calls.commands, ['copy-ascii']);
    });

    test('focus leaving the menu closes it (Tab / focusable click outside)', () => {
        const { dom } = createHarness();
        (document.activeElement as HTMLElement).dispatchEvent(
            new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: dom.window.document.body }),
        );
        assert.ok(!visible(dom));
    });

    test('focus moving between rows inside the menu keeps it open', () => {
        const { dom } = createHarness();
        const inside = ctxMenuEl(dom).querySelector<HTMLElement>('.ctx-row[data-cmd]')!;
        (document.activeElement as HTMLElement).dispatchEvent(
            new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: inside }),
        );
        assert.ok(visible(dom));
    });

    test('window blur (click outside the webview) closes the menu', () => {
        const { dom } = createHarness();
        dom.window.dispatchEvent(new dom.window.Event('blur'));
        assert.ok(!visible(dom));
    });
});

suite('webview context menu positioning (utils)', () => {
    teardown(() => {
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    function setViewport(dom: JSDOM, w: number, h: number): void {
        const win = dom.window as unknown as { innerWidth: number; innerHeight: number };
        Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
        Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
    }

    function stubMetrics(el: HTMLElement, w: number, h: number): void {
        Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => w });
        Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => h });
    }

    function menuEl(): HTMLElement {
        const dom = installDom();
        currentDom = dom;
        const el = dom.window.document.getElementById('ctx-menu') as HTMLElement;
        el.innerHTML = '<div class="ctx-row ctx-has-sub" data-sub="copy">Copy as\u2026</div>';
        return el;
    }

    test('clamps to the bottom-right with an 8px gutter', () => {
        const el = menuEl();
        setViewport(currentDom!, 800, 600);
        stubMetrics(el, 300, 200);
        positionContextMenu(el, 1000, 500);
        assert.strictEqual(el.style.left, '492px');
        assert.strictEqual(el.style.top, '392px');
    });

    test('keeps a non-negative 8px gutter when the menu is larger than the viewport', () => {
        const el = menuEl();
        setViewport(currentDom!, 300, 300);
        stubMetrics(el, 400, 400);
        positionContextMenu(el, 1000, 1000);
        assert.strictEqual(el.style.left, '8px');
        assert.strictEqual(el.style.top, '8px');
    });

    test('adds ctx-scroll only when the menu is taller than the viewport gutter', () => {
        const el = menuEl();
        setViewport(currentDom!, 800, 300);
        stubMetrics(el, 200, 280);
        positionContextMenu(el, 10, 10);
        assert.ok(!el.classList.contains('ctx-scroll'));
        stubMetrics(el, 200, 292);
        positionContextMenu(el, 10, 10);
        assert.ok(el.classList.contains('ctx-scroll'));
    });
});

suite('webview context submenu flip (utils.wireHoverSubmenus)', () => {
    teardown(() => {
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    function setViewport(dom: JSDOM, w: number, h: number): void {
        const win = dom.window as unknown as { innerWidth: number; innerHeight: number };
        Object.defineProperty(win, 'innerWidth', { value: w, configurable: true });
        Object.defineProperty(win, 'innerHeight', { value: h, configurable: true });
    }

    function stubMetrics(el: HTMLElement, w: number, h: number): void {
        Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => w });
        Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => h });
    }

    function stubRect(row: HTMLElement, top: number, right: number): void {
        row.getBoundingClientRect = () => ({
            top, right, bottom: top + 27, left: 0, width: 200, height: 27, x: 0, y: top, toJSON: () => ({}),
        } as DOMRect);
    }

    function harness(): { dom: JSDOM; row: HTMLElement; sub: HTMLElement } {
        const dom = installDom();
        currentDom = dom;
        const el = dom.window.document.getElementById('ctx-menu') as HTMLElement;
        el.innerHTML = '<div class="ctx-row ctx-has-sub" data-sub="copy">Copy as\u2026<div class="ctx-submenu"><div class="ctx-row" data-cmd="hex-raw">Hex</div></div></div>';
        const row = el.querySelector<HTMLElement>('.ctx-has-sub')!;
        const sub = el.querySelector<HTMLElement>('.ctx-submenu')!;
        wireHoverSubmenus(el);
        return { dom, row, sub };
    }

    test('submenu near the bottom edge flips up', () => {
        const { dom, row, sub } = harness();
        setViewport(dom, 800, 600);
        stubRect(row, 500, 200);
        stubMetrics(sub, 220, 200);
        row.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        assert.strictEqual(sub.style.top, 'auto');
        assert.strictEqual(sub.style.bottom, '-4px');
        assert.strictEqual(sub.style.left, '100%');
        assert.strictEqual(sub.style.right, 'auto');
    });

    test('submenu near the right edge flips left, top-left rows stay put', () => {
        const { dom, row, sub } = harness();
        setViewport(dom, 800, 600);
        stubRect(row, 100, 700);
        stubMetrics(sub, 220, 100);
        row.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        assert.strictEqual(sub.style.left, 'auto');
        assert.strictEqual(sub.style.right, '100%');
        assert.strictEqual(sub.style.top, '-4px');
        assert.strictEqual(sub.style.bottom, 'auto');
    });

    test('submenu taller than the viewport gets ctx-scroll', () => {
        const { dom, row, sub } = harness();
        setViewport(dom, 800, 600);
        stubRect(row, 100, 100);
        stubMetrics(sub, 220, 700);
        row.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        assert.ok(sub.classList.contains('ctx-scroll'));
    });
});
