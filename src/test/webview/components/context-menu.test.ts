import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../css-import-hook';

import {
    ContextMenu,
    renderContextMenuHtml,
    type ContextMenuCallbacks,
    type ContextMenuState,
} from '../../../webview/components/ContextMenu/ContextMenu';
import { contextCommandResult, copyCommandResult } from '../../../webview/contextCommands';

interface Calls {
    commands: string[];
}

let currentDom: JSDOM | null = null;

function installDom(): JSDOM {
    const dom = new JSDOM('<!DOCTYPE html><body><div id="ctx-menu"></div></body>', { url: 'https://hexscope.test/' });
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

    test('hover on a submenu row opens its submenu', () => {
        const { dom } = createHarness();
        const subRow = ctxMenuEl(dom).querySelector<HTMLElement>('.ctx-has-sub[data-sub="copy"]');
        assert.ok(subRow);
        subRow!.dispatchEvent(new dom.window.MouseEvent('mouseenter'));
        const sub = subRow!.querySelector<HTMLElement>('.ctx-submenu');
        assert.ok(sub, 'submenu element present');
        assert.strictEqual(sub!.style.display, 'block');
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

    test('show is a no-op when selection is inactive', () => {
        const { dom, menu } = createHarness();
        menu.hide();
        menu.show(10, 10, baseState({ selectionActive: false }));
        assert.ok(!visible(dom));
    });

    test('mount is idempotent: second mount does not double-fire commands', () => {
        const { dom, menu, calls } = createHarness();
        menu.mount();
        clickRow(dom, 'copy-ascii');
        assert.deepStrictEqual(calls.commands, ['copy-ascii']);
    });

    test('host mapping: copy-hex/ascii/c-array map to existing contextCommandResult formats', () => {
        const bytes = [0xDE, 0xAD, 0xBE, 0xEF];
        assert.deepStrictEqual(copyCommandResult('hex', bytes), {
            type: 'copyText',
            text: 'DE AD BE EF',
            label: '4 bytes as hex',
        });
        assert.deepStrictEqual(copyCommandResult('ascii', bytes), {
            type: 'copyText',
            text: '....',
            label: '4 bytes as ascii',
        });
        assert.deepStrictEqual(copyCommandResult('c-array', bytes), {
            type: 'copyText',
            text: '{0xDE, 0xAD, 0xBE, 0xEF}',
            label: '4 bytes as c-array',
        });
        assert.strictEqual(contextCommandResult('fill-00', bytes, true).type, 'fill');
        assert.strictEqual(contextCommandResult('fill-00', bytes, false).type, 'none');
    });
});
