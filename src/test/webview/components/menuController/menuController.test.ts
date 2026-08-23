import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../../cssImportHook';

import {
    menuController,
    renderMenuHtml,
    type MenuState,
} from '../../../../webview/components/menuController/menuController';
import { positionMenu, wireMenuSubmenus } from '../../../../webview/utils';

interface Calls {
    commands: string[];
}

let currentDom: JSDOM | null = null;

function installDom(body = '<button id="trigger">T</button>'): JSDOM {
    const dom = new JSDOM(`<!DOCTYPE html><body>${body}</body>`, { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as { window: Window; document: Document };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    return dom;
}

function cleanupDom(dom: JSDOM): void {
    const g = globalThis as unknown as { window?: Window; document?: Document };
    dom.window.close();
    delete g.window;
    delete g.document;
}

function emptyCalls(): Calls {
    return { commands: [] };
}

function baseState(partial: Partial<MenuState> = {}): MenuState {
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

function createHarness(partial: Partial<MenuState> = {}): { dom: JSDOM; calls: Calls } {
    const calls = emptyCalls();
    const dom = installDom();
    currentDom = dom;
    menuController.show(10, 10, { innerHTML: renderMenuHtml(baseState(partial)), emit: cmd => { calls.commands.push(cmd); } });
    // Right-click flow: pointerdown lands on the open menu → mouse modality
    // (listeners attach on show, so the pointerdown must come after).
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    return { dom, calls };
}

function menuEl(dom: JSDOM): HTMLElement {
    const el = dom.window.document.getElementById('menu') as HTMLElement;
    assert.ok(el, 'missing #menu');
    return el;
}

function row(dom: JSDOM, cmd: string): HTMLElement | null {
    return menuEl(dom).querySelector<HTMLElement>(`.menu-item[data-cmd="${cmd}"]`);
}

function clickRow(dom: JSDOM, cmd: string): void {
    const r = row(dom, cmd);
    assert.ok(r, `missing row [data-cmd=${cmd}]`);
    r!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function visible(dom: JSDOM): boolean {
    return menuEl(dom).style.display !== 'none';
}

suite('webview MenuController component (hex menu)', () => {
    teardown(() => {
        menuController.hide();
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('renders reworked multi-byte layout with direct + submenu + interaction rows', () => {
        const html = renderMenuHtml(baseState());
        assert.ok(html.includes('4 bytes selected'));
        assert.ok(html.includes('data-cmd="copy-hex"'));
        assert.ok(html.includes('data-cmd="copy-ascii"'));
        assert.ok(html.includes('data-cmd="copy-c-array"'));
        assert.ok(html.includes('data-sub="copy"'));
        assert.ok(html.includes('data-sub="analyze"'));
        assert.ok(html.includes('data-cmd="go-address"'));
        assert.ok(html.includes('data-cmd="select-all"'));
        assert.ok(html.includes('data-cmd="select-segment"'));
        assert.ok(!html.includes('data-sub="fill"'), 'patch hidden outside edit mode');
    });

    test('copy-as submenu holds remaining formats, not the direct ones', () => {
        const html = renderMenuHtml(baseState());
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
        const html = renderMenuHtml(baseState({ len: 1, bytes: [0x42], goAddress: null }));
        assert.ok(html.includes('1 byte selected'));
        assert.ok(html.includes('data-cmd="copy-hex"'));
        assert.ok(html.includes('data-cmd="copy-ascii"'));
        assert.ok(html.includes('data-cmd="dec"'));
        assert.ok(html.includes('data-cmd="binary"'));
        assert.ok(!html.includes('data-cmd="copy-c-array"'));
        assert.ok(!html.includes('data-sub="analyze"'));
        assert.ok(!html.includes('data-cmd="go-address"'));
        assert.ok(html.includes('data-cmd="select-all"'));
    });

    test('single-byte Copy ASCII is gated on printable bytes (regression C2)', () => {
        const printable = renderMenuHtml(baseState({ len: 1, bytes: [0x42], goAddress: null }));
        assert.ok(printable.includes('data-cmd="copy-ascii"'));
        assert.ok(printable.includes("'B'"));
        const nonPrintable = renderMenuHtml(baseState({ len: 1, bytes: [0x00], goAddress: null }));
        assert.ok(!nonPrintable.includes('data-cmd="copy-ascii"'), 'non-printable byte hides Copy ASCII');
    });

    test('edit mode renders patch/fill submenu with custom input and editing badge', () => {
        const html = renderMenuHtml(baseState({ editMode: true }));
        assert.ok(html.includes('data-sub="fill"'));
        assert.ok(html.includes('menu-fill-input'));
        assert.ok(html.includes('menu-fill-apply'));
        assert.ok(html.includes('Editing'));
    });

    test('go-address preview shows target and endian badge', () => {
        const html = renderMenuHtml(baseState());
        assert.ok(html.includes('0xEFBEADDE'));
        assert.ok(html.includes('LE'));
    });

    test('go-address preview honors system endian (BE)', () => {
        const html = renderMenuHtml(baseState({ endian: 'be', goAddress: { address: 0xDEADBEEF, valid: true } }));
        assert.ok(html.includes('0xDEADBEEF'));
        assert.ok(html.includes('BE'));
    });

    test('invalid go-address renders disabled row', () => {
        const html = renderMenuHtml(baseState({ goAddress: { address: 0xEFBEADDE, valid: false } }));
        assert.ok(html.includes('class="menu-item menu-go-row menu-disabled" data-cmd="go-address"'));
    });

    test('no go-address row when len !== 4', () => {
        const html = renderMenuHtml(baseState({ len: 2, bytes: [0xDE, 0xAD], goAddress: null }));
        assert.ok(!html.includes('data-cmd="go-address"'));
    });

    test('show renders into #menu; direct row click fires emit and hides', () => {
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
        const html = renderMenuHtml(baseState());
        assert.ok(html.includes('role="menuitem"'));
        assert.ok(html.includes('tabindex="-1"'));
        assert.ok(html.includes('role="separator"'));
    });

    test('arrow keys move focus through rows and Enter runs the focused command', () => {
        const { dom, calls } = createHarness();
        const first = menuEl(dom).querySelector<HTMLElement>('.menu-item[data-cmd]')!;
        assert.strictEqual(document.activeElement, first, 'show focuses the first enabled row');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        const second = menuEl(dom).querySelectorAll<HTMLElement>('.menu-item[data-cmd]')[1];
        assert.strictEqual(document.activeElement, second, 'ArrowDown moves focus to the next row');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
        assert.deepStrictEqual(calls.commands, [second.dataset.cmd], 'Enter runs the focused row command');
        assert.ok(!visible(dom), 'menu hides after the command');
    });

    test('arrow keys skip disabled rows', () => {
        const { dom } = createHarness({ goAddress: { address: 0xEFBEADDE, valid: false } });
        const goRow = menuEl(dom).querySelector<HTMLElement>('.menu-item[data-cmd="go-address"]')!;
        assert.ok(goRow.classList.contains('menu-disabled'));
        for (let i = 0; i < 12; i++) {
            dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
            const active = document.activeElement as HTMLElement;
            assert.notStrictEqual(active.dataset.cmd, 'go-address', 'focus never lands on a disabled row');
        }
    });

    test('hover on a submenu row opens its submenu', () => {
        const { dom } = createHarness();
        const subRow = menuEl(dom).querySelector<HTMLElement>('.menu-has-sub[data-sub="copy"]');
        assert.ok(subRow);
        subRow!.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        const sub = subRow!.querySelector<HTMLElement>('.menu-submenu');
        assert.ok(sub, 'submenu element present');
        assert.strictEqual(sub!.style.display, 'block');
    });

    test('Enter on a submenu row opens it and focuses the first item inside', () => {
        const { dom } = createHarness();
        const subRow = menuEl(dom).querySelector<HTMLElement>('.menu-has-sub[data-sub="copy"]')!;
        subRow.focus();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
        const sub = subRow.querySelector<HTMLElement>('.menu-submenu')!;
        assert.strictEqual(sub.style.display, 'block', 'Enter opens the submenu');
        const first = sub.querySelector<HTMLElement>('.menu-item:not(.menu-disabled)')!;
        assert.strictEqual(document.activeElement, first, 'focus moves to the first enabled submenu item');
    });

    test('ArrowRight on a submenu row opens it and focuses the first item inside', () => {
        const { dom } = createHarness();
        const subRow = menuEl(dom).querySelector<HTMLElement>('.menu-has-sub[data-sub="copy"]')!;
        subRow.focus();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const sub = subRow.querySelector<HTMLElement>('.menu-submenu')!;
        assert.strictEqual(sub.style.display, 'block', 'ArrowRight opens the submenu');
        const first = sub.querySelector<HTMLElement>('.menu-item:not(.menu-disabled)')!;
        assert.strictEqual(document.activeElement, first, 'focus moves to the first enabled submenu item');
    });

    test('ArrowLeft closes the open submenu and returns focus to the parent row', () => {
        const { dom } = createHarness();
        const subRow = menuEl(dom).querySelector<HTMLElement>('.menu-has-sub[data-sub="copy"]')!;
        subRow.focus();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const sub = subRow.querySelector<HTMLElement>('.menu-submenu')!;
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        assert.strictEqual(sub.style.display, 'none');
        assert.strictEqual(document.activeElement, subRow, 'focus returns to the parent row');
    });

    test('ArrowUp/Down navigate only within the open submenu and wrap inside it', () => {
        const { dom } = createHarness();
        const subRow = menuEl(dom).querySelector<HTMLElement>('.menu-has-sub[data-sub="copy"]')!;
        subRow.focus();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const sub = subRow.querySelector<HTMLElement>('.menu-submenu')!;
        const items = sub.querySelectorAll<HTMLElement>('.menu-item:not(.menu-disabled)');
        assert.ok(items.length > 2, 'copy-as submenu has several items');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        assert.strictEqual(document.activeElement, items[1], 'ArrowDown moves to the next submenu item');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' }));
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' }));
        assert.strictEqual(document.activeElement, items[items.length - 1], 'ArrowUp wraps to the last submenu item');
        assert.strictEqual(document.activeElement!.closest('.menu-submenu'), sub, 'navigation never leaves the submenu');
    });

    test('ArrowUp/Down from parent rows never enter a collapsed submenu scope', () => {
        const { dom } = createHarness();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        const active = document.activeElement as HTMLElement;
        assert.ok(!active.closest('.menu-submenu'), 'parent navigation stays in the parent menu');
        assert.strictEqual(active.closest('.menu-has-sub'), null, 'never lands on the submenu trigger row');
    });

    test('Escape closes the open submenu first, then the menu on the second press', () => {
        const { dom } = createHarness();
        const subRow = menuEl(dom).querySelector<HTMLElement>('.menu-has-sub[data-sub="copy"]')!;
        subRow.focus();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const sub = subRow.querySelector<HTMLElement>('.menu-submenu')!;
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.strictEqual(sub.style.display, 'none', 'first Escape closes the submenu');
        assert.strictEqual(document.activeElement, subRow, 'focus returns to the parent row');
        assert.ok(visible(dom), 'menu stays open after the first Escape');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.ok(!visible(dom), 'second Escape hides the menu');
    });

    test('custom fill: valid Enter applies fill command and hides', () => {
        const { dom, calls } = createHarness({ editMode: true });
        const input = menuEl(dom).querySelector<HTMLInputElement>('.menu-fill-input');
        assert.ok(input);
        input!.value = 'FF';
        input!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.deepStrictEqual(calls.commands, ['fill-FF']);
        assert.ok(!visible(dom));
    });

    test('custom fill: invalid input toggles menu-fill-invalid and stays open', () => {
        const { dom, calls } = createHarness({ editMode: true });
        const input = menuEl(dom).querySelector<HTMLInputElement>('.menu-fill-input');
        input!.value = 'GG';
        input!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.ok(input!.classList.contains('menu-fill-invalid'));
        assert.deepStrictEqual(calls.commands, []);
        assert.ok(visible(dom));
    });

    test('custom fill: Escape dismisses the menu even with text in the input', () => {
        const { dom } = createHarness({ editMode: true });
        const input = menuEl(dom).querySelector<HTMLInputElement>('.menu-fill-input')!;
        input.value = 'FF';
        input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.ok(!visible(dom));
    });

    test('hide restores focus to the element focused before the menu opened', () => {
        const { dom } = createHarness();
        const trigger = dom.window.document.getElementById('trigger') as HTMLElement;
        menuController.hide();
        trigger.focus();
        menuController.show(10, 10, { innerHTML: renderMenuHtml(baseState()) });
        assert.notStrictEqual(dom.window.document.activeElement, trigger, 'menu row holds focus while open');
        menuController.hide();
        assert.strictEqual(dom.window.document.activeElement, trigger, 'focus returns to the trigger on hide');
    });

    test('re-mounts never stack listeners: re-show does not double-fire commands', () => {
        const { dom, calls } = createHarness();
        const emit = (cmd: string) => { calls.commands.push(cmd); };
        menuController.show(10, 10, { innerHTML: renderMenuHtml(baseState()), emit });
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
        const inside = menuEl(dom).querySelector<HTMLElement>('.menu-item[data-cmd]')!;
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

    test('window blur closes without restoring focus (snapshot gone)', () => {
        const { dom } = createHarness();
        const trigger = dom.window.document.getElementById('trigger') as HTMLElement;
        trigger.focus();
        menuController.show(10, 10, { innerHTML: renderMenuHtml(baseState()) });
        const rowFocused = document.activeElement as HTMLElement;
        dom.window.dispatchEvent(new dom.window.Event('blur'));
        assert.ok(!visible(dom));
        assert.strictEqual(document.activeElement, rowFocused, 'no focus restore on window blur');
    });

    test('mouse-open menu has no menu-kb highlight; a keydown reveals it', () => {
        const { dom } = createHarness();
        assert.ok(!menuEl(dom).classList.contains('menu-kb'), 'mouse-open: keyboard highlight hidden');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        assert.ok(menuEl(dom).classList.contains('menu-kb'), 'first keydown reveals keyboard highlight');
        dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
        assert.ok(!menuEl(dom).classList.contains('menu-kb'), 'pointerdown hides it again');
    });

    test('keyboard-open menu shows the menu-kb highlight immediately', () => {
        const { dom } = createHarness();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));
        menuController.show(10, 10, { innerHTML: renderMenuHtml(baseState()) });
        assert.ok(menuEl(dom).classList.contains('menu-kb'));
    });

    test('capture-phase interception: nav keys never reach host bubble listeners while open', () => {
        const { dom } = createHarness();
        let bubbleSaw = false;
        dom.window.document.addEventListener('keydown', () => { bubbleSaw = true; });
        const ev = new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        dom.window.document.dispatchEvent(ev);
        assert.ok(ev.defaultPrevented, 'nav key consumed');
        assert.ok(!bubbleSaw, 'host bubble handlers never see the key');
    });
});

suite('webview menu positioning (utils.positionMenu)', () => {
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
        const el = dom.window.document.createElement('div');
        el.id = 'menu';
        el.className = 'menu';
        el.innerHTML = '<div class="menu-item menu-has-sub" data-sub="copy">Copy as\u2026</div>';
        dom.window.document.body.appendChild(el);
        return el;
    }

    test('clamps to the bottom-right with an 8px gutter', () => {
        const el = menuEl();
        setViewport(currentDom!, 800, 600);
        stubMetrics(el, 300, 200);
        positionMenu(el, 1000, 500);
        assert.strictEqual(el.style.left, '492px');
        assert.strictEqual(el.style.top, '392px');
    });

    test('keeps a non-negative 8px gutter when the menu is larger than the viewport', () => {
        const el = menuEl();
        setViewport(currentDom!, 300, 300);
        stubMetrics(el, 400, 400);
        positionMenu(el, 1000, 1000);
        assert.strictEqual(el.style.left, '8px');
        assert.strictEqual(el.style.top, '8px');
    });

    test('adds menu-scroll only when the menu is taller than the viewport gutter', () => {
        const el = menuEl();
        setViewport(currentDom!, 800, 300);
        stubMetrics(el, 200, 280);
        positionMenu(el, 10, 10);
        assert.ok(!el.classList.contains('menu-scroll'));
        stubMetrics(el, 200, 292);
        positionMenu(el, 10, 10);
        assert.ok(el.classList.contains('menu-scroll'));
    });
});

suite('webview submenu flip (utils.wireMenuSubmenus)', () => {
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
        const el = dom.window.document.createElement('div');
        el.id = 'menu';
        el.className = 'menu';
        el.innerHTML = '<div class="menu-item menu-has-sub" data-sub="copy">Copy as\u2026<div class="menu-submenu"><div class="menu-item" data-cmd="hex-raw">Hex</div></div></div>';
        dom.window.document.body.appendChild(el);
        const row = el.querySelector<HTMLElement>('.menu-has-sub')!;
        const sub = el.querySelector<HTMLElement>('.menu-submenu')!;
        wireMenuSubmenus(el);
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

    test('submenu taller than the viewport gets menu-scroll', () => {
        const { dom, row, sub } = harness();
        setViewport(dom, 800, 600);
        stubRect(row, 100, 100);
        stubMetrics(sub, 220, 700);
        row.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        assert.ok(sub.classList.contains('menu-scroll'));
    });
});

suite('webview attached popover (MenuController.attach + show el)', () => {
    teardown(() => {
        menuController.hide();
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    interface PopHarness {
        dom: JSDOM;
        btn: HTMLButtonElement;
        pop: HTMLElement;
        item: HTMLButtonElement;
        closes: { count: number };
    }

    function popupHarness(addButton = true): PopHarness {
        const body = addButton
            ? '<button id="btn">open</button><div id="pop" hidden><button class="item">A</button></div><button id="outside">X</button>'
            : '<div id="pop" hidden><button class="item">A</button></div><button id="outside">X</button>';
        const dom = installDom(body);
        currentDom = dom;
        const btn = dom.window.document.getElementById('btn') as HTMLButtonElement | null;
        const pop = dom.window.document.getElementById('pop') as HTMLElement;
        const item = pop.querySelector<HTMLButtonElement>('.item')!;
        const closes = { count: 0 };
        const populatedBtn = btn ?? undefined;
        menuController.attach(pop);
        populatedBtn?.focus();
        menuController.show(0, 0, {
            el: pop,
            anchor: populatedBtn,
            focusFirst: '.item',
            onClose: () => { closes.count += 1; },
        });
        dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
        return { dom, btn: populatedBtn as HTMLButtonElement, pop, item, closes };
    }

    function focusoutFrom(dom: JSDOM, from: HTMLElement, related: Node | null): void {
        from.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: related }));
    }

    test('show opens: hidden=false, aria-expanded, first item focused', () => {
        const { dom, btn, pop, item } = popupHarness();
        assert.ok(!pop.hidden, 'popup visible after show');
        assert.strictEqual(btn.getAttribute('aria-expanded'), 'true', 'anchor aria-expanded synced');
        assert.strictEqual(dom.window.document.activeElement, item, 'first selectable item focused');
    });

    test('Escape closes the popup and restores focus to the pre-open element', () => {
        const { dom, btn, pop, closes } = popupHarness();
        const outside = dom.window.document.getElementById('outside') as HTMLButtonElement;
        outside.focus();
        assert.strictEqual(dom.window.document.activeElement, outside, 'focus sits outside the popup');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.ok(pop.hidden, 'Escape closes even with focus outside the popup');
        assert.strictEqual(closes.count, 1, 'onClose fired exactly once');
        assert.strictEqual(dom.window.document.activeElement, outside, 'focus returns to the pre-open snapshot');
    });

    test('click inside the popup keeps it open (non-command item)', () => {
        const { dom, pop, item } = popupHarness();
        item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.ok(!pop.hidden, 'inside click keeps popup open');
    });

    test('click outside the popup closes it', () => {
        const { dom, pop, closes } = popupHarness();
        const outside = dom.window.document.getElementById('outside')!;
        outside.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.ok(pop.hidden, 'outside click closes');
        assert.strictEqual(closes.count, 1, 'onClose fired exactly once');
    });

    test('focus moving outside the popup closes it and restores anchor focus', () => {
        const { dom, btn, pop, item, closes } = popupHarness();
        focusoutFrom(dom, item, dom.window.document.getElementById('outside'));
        assert.ok(pop.hidden, 'focusout to outside closes on Tab/Shift-Tab');
        assert.strictEqual(closes.count, 1, 'onClose fired exactly once');
        assert.strictEqual(dom.window.document.activeElement, btn, 'focus restored to pre-open anchor');
    });

    test('focus moving to nowhere (relatedTarget null) closes the popup', () => {
        const { dom, pop, item } = popupHarness();
        focusoutFrom(dom, item, null);
        assert.ok(pop.hidden, 'focusout with no related target closes (leaving document)');
    });

    test('focus moving inside the popup keeps it open', () => {
        const { dom, pop, item } = popupHarness();
        const sibling = dom.window.document.createElement('button');
        pop.appendChild(sibling);
        focusoutFrom(dom, item, sibling);
        assert.ok(!pop.hidden, 'intra-popup focus move keeps popup open');
    });

    test('window blur closes the popup without restoring focus', () => {
        const { dom, pop, item, closes } = popupHarness();
        dom.window.dispatchEvent(new dom.window.Event('blur'));
        assert.ok(pop.hidden, 'window blur closes (VS Code chrome / alt-tab)');
        assert.strictEqual(closes.count, 1, 'onClose fired exactly once');
        assert.strictEqual(dom.window.document.activeElement, item, 'no focus restore on window blur');
    });

    test('unanchored popup: focusout closes, no restore crash', () => {
        const { dom, pop, item } = popupHarness(false);
        assert.ok(!pop.hidden, 'unanchored popup opens');
        focusoutFrom(dom, item, dom.window.document.getElementById('outside'));
        assert.ok(pop.hidden, 'unanchored focusout closes');
    });

    test('close hidden popup fires onClose once and re-open works', () => {
        const { dom, pop, closes } = popupHarness();
        menuController.close(pop);
        menuController.close(pop);
        assert.strictEqual(closes.count, 1, 'second close is a no-op for onClose');
        menuController.show(0, 0, { el: pop, focusFirst: '.item' });
        assert.ok(!pop.hidden, 'reopens after explicit close');
        menuController.close(pop);
        assert.strictEqual(closes.count, 2, 'second open-close cycle fires onClose again');
    });

    test('Enter/Space on a native button item is left to native activation', () => {
        const { dom, item } = popupHarness();
        item.focus();
        const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        dom.window.document.dispatchEvent(enter);
        assert.ok(!enter.defaultPrevented, 'Enter on a non-command button not consumed');
        const space = new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        dom.window.document.dispatchEvent(space);
        assert.ok(!space.defaultPrevented, 'Space on a non-command button not consumed');
    });
});

suite('webview MenuController cross-menu invariants', () => {
    teardown(() => {
        menuController.hide();
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('opening a dynamic menu closes an open attached popover (one menu at a time)', () => {
        const dom = installDom(
            '<button id="btn">open</button><div id="pop" hidden><button class="item">A</button></div>',
        );
        currentDom = dom;
        const pop = dom.window.document.getElementById('pop') as HTMLElement;
        menuController.attach(pop);
        menuController.show(0, 0, { el: pop, focusFirst: '.item' });
        assert.ok(!pop.hidden, 'popover open first');
        menuController.show(10, 10, { innerHTML: renderMenuHtml(baseState()) });
        assert.ok(pop.hidden, 'new menu closes the popover');
        assert.ok(visible(dom), 'hex menu open');
    });

    test('opening an attached popover closes an open dynamic menu', () => {
        const dom = installDom(
            '<button id="btn">open</button><div id="pop" hidden><button class="item">A</button></div>',
        );
        currentDom = dom;
        const pop = dom.window.document.getElementById('pop') as HTMLElement;
        menuController.attach(pop);
        menuController.show(10, 10, { innerHTML: renderMenuHtml(baseState()) });
        assert.ok(visible(dom), 'hex menu open first');
        menuController.show(0, 0, { el: pop, focusFirst: '.item' });
        assert.ok(!visible(dom), 'popover closes the hex menu');
        assert.ok(!pop.hidden, 'popover open');
    });

    test('two-step Escape on a struct-style submenu menu (second press closes)', () => {
        const dom = installDom();
        currentDom = dom;
        const calls = emptyCalls();
        const inner = [
            '<div class="menu-item" data-cmd="copy-hex" role="menuitem" tabindex="-1"><span class="menu-label">Copy value</span></div>',
            '<div class="menu-sep" role="separator"></div>',
            '<div class="menu-item menu-has-sub" data-sub="disp" role="menuitem" tabindex="-1"><span class="menu-label">View as</span>',
            '<div class="menu-submenu"><div class="menu-item menu-disabled">unused</div><div class="menu-item" data-cmd="disp-hex" role="menuitem" tabindex="-1"><span class="menu-label">Hex</span></div></div>',
            '</div>',
        ].join('');
        menuController.show(10, 10, { innerHTML: inner, emit: cmd => { calls.commands.push(cmd); } });
        const subRow = menuEl(dom).querySelector<HTMLElement>('.menu-has-sub[data-sub="disp"]')!;
        subRow.focus();
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
        const sub = subRow.querySelector<HTMLElement>('.menu-submenu')!;
        const hexItem = sub.querySelector<HTMLElement>('.menu-item[data-cmd="disp-hex"]')!;
        assert.strictEqual(document.activeElement, hexItem, 'ArrowRight opens struct submenu + focuses item');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.strictEqual(sub.style.display, 'none', 'first Escape closes submenu');
        assert.strictEqual(document.activeElement, subRow, 'focus back on parent row');
        assert.ok(visible(dom), 'menu still open');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.ok(!visible(dom), 'second Escape closes menu');
        assert.deepStrictEqual(calls.commands, [], 'no command emitted on escape');
    });

    test('keyboard nav skips disabled items in an attached popover and wraps', () => {
        const dom = installDom(
            '<button id="btn">open</button><div id="pop" hidden>' +
            '<button class="integrity-profile-menu-item" role="menuitem" disabled>No</button>' +
            '<button class="integrity-profile-menu-item" role="menuitem" id="a">A</button>' +
            '<button class="integrity-profile-menu-item" role="menuitem">B</button>' +
            '</div>',
        );
        currentDom = dom;
        const pop = dom.window.document.getElementById('pop') as HTMLElement;
        menuController.attach(pop);
        menuController.show(0, 0, {
            el: pop,
            focusFirst: '.integrity-profile-menu-item:not(:disabled)',
        });
        const first = pop.querySelector<HTMLButtonElement>('#a')!;
        assert.strictEqual(document.activeElement, first, 'first enabled item focused on open');
dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        const second = pop.querySelectorAll<HTMLButtonElement>('.integrity-profile-menu-item:not(:disabled)')[1];
        assert.strictEqual(document.activeElement, second, 'ArrowDown skips the disabled item');
        dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        assert.strictEqual(document.activeElement, first, 'ArrowDown wraps inside the popover');
    });
});