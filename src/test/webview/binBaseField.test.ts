// ── Raw-binary base-address field (webview) ──────────────────────
// The profile-bar field is the only editor for a `.bin` base: it validates
// inline, commits on Enter/blur, reverts on Escape/empty, and stays disabled
// while edits are unsaved or an external change is unresolved.

import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import './cssImportHook';

import { S } from '../../webview/state';
import { binBaseField, configureBinBaseField } from '../../webview/binBaseField';
import { BASE_ADDRESS_DIRTY_MESSAGE, BASE_ADDRESS_LOCKED_MESSAGE } from '../../webview/baseAddressChange';
import type { SerializedParseResult } from '../../core/types';
import type { WebviewToProviderMessage } from '../../webviewProtocol';

let currentDom: JSDOM | null = null;
const posts: WebviewToProviderMessage[] = [];

configureBinBaseField(message => { posts.push(message); });

function installDom(): JSDOM {
    const dom = new JSDOM(
        '<!DOCTYPE html><body><div id="profile-bar"><div id="profile-picker"></div></div></body>',
        { url: 'https://hexscope.test/' },
    );
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

function binResult(overrides: Partial<SerializedParseResult> = {}): SerializedParseResult {
    return {
        records: [],
        recordCount: 0,
        segments: [{ startAddress: 0x08000000, data: new Uint8Array(16) }],
        totalDataBytes: 16,
        checksumErrors: 0,
        malformedLines: 0,
        baseAddress: 0x08000000,
        format: 'bin',
        ...overrides,
    };
}

function resetState(): void {
    S.parseResult = null;
    S.editMode = false;
    S.edits.clear();
    S.lockedDueToExternalChange = false;
    posts.length = 0;
}

function mountField(): void {
    binBaseField.mount();
}

function input(): HTMLInputElement {
    return document.getElementById('bin-base-input') as HTMLInputElement;
}

function errorText(): string {
    const error = document.getElementById('bin-base-error') as HTMLElement;
    return error.hidden ? '' : (error.textContent ?? '');
}

function press(key: string): void {
    input().dispatchEvent(new (currentDom!.window as unknown as typeof window).KeyboardEvent('keydown', {
        key, bubbles: true, cancelable: true,
    }));
}

function blurField(): void {
    input().dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('blur'));
}

function type(value: string): void {
    input().value = value;
    input().dispatchEvent(new (currentDom!.window as unknown as typeof window).Event('input', { bubbles: true }));
}

suite('webview raw-binary base field', () => {
    // Some suites dynamically import the composition root, which re-wires the
    // real provider post; re-install the spy before every test.
    setup(() => {
        configureBinBaseField(message => { posts.push(message); });
    });

    teardown(() => {
        resetState();
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('renders only for raw binaries, after the profile picker', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        const bar = document.getElementById('profile-bar')!;
        assert.deepStrictEqual([...bar.children].map(child => child.id), ['profile-picker', 'bin-base-field']);
        assert.strictEqual((document.getElementById('bin-base-field') as HTMLElement).hidden, false);
        assert.strictEqual(input().getAttribute('aria-label'), 'Raw binary base address');
        assert.strictEqual(bar.querySelector('label[for="bin-base-input"]')?.textContent, 'Base');
    });

    test('stays hidden for text formats and when no document is loaded', () => {
        currentDom = installDom();
        S.parseResult = binResult({ format: 'ihex' });
        mountField();
        assert.strictEqual((document.getElementById('bin-base-field') as HTMLElement).hidden, true);

        S.parseResult = binResult();
        binBaseField.render();
        assert.strictEqual((document.getElementById('bin-base-field') as HTMLElement).hidden, false, 'bin shows the field');

        S.parseResult = null;
        binBaseField.render();
        assert.strictEqual((document.getElementById('bin-base-field') as HTMLElement).hidden, true);
    });

    test('shows parseResult.baseAddress as 0x%08X (explicit 0 included)', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        assert.strictEqual(input().value, '0x08000000');

        S.parseResult = binResult({ baseAddress: 0, segments: [{ startAddress: 0, data: new Uint8Array(16) }] });
        binBaseField.render();
        assert.strictEqual(input().value, '0x00000000');

        S.parseResult = binResult({ baseAddress: undefined, segments: [{ startAddress: 0x2000, data: new Uint8Array(4) }] });
        binBaseField.render();
        assert.strictEqual(input().value, '0x00000000', 'absent base falls back to 0, not the segment start');
    });

    test('Enter commits a changed valid value', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        input().focus();

        type('0x08010000');
        press('Enter');

        assert.deepStrictEqual(posts, [{ type: 'setBinBaseAddress', value: 0x08010000 }]);
        assert.strictEqual(input().value, '0x08010000', 'canonicalized in place');
        assert.strictEqual(input().getAttribute('aria-invalid'), null);
    });

    test('blur commits a changed valid value', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        input().focus();

        type('1000');
        blurField();

        assert.deepStrictEqual(posts, [{ type: 'setBinBaseAddress', value: 0x1000 }]);
    });

    test('an unchanged value sends nothing; empty reverts', () => {
        currentDom = installDom();
        S.parseResult = binResult({ baseAddress: 0x08000000 });
        mountField();
        input().focus();

        type('0x08000000');
        press('Enter');
        assert.deepStrictEqual(posts, [], 'unchanged commit is a no-op');

        type('');
        press('Enter');
        assert.strictEqual(input().value, '0x08000000', 'empty reverts');
        assert.deepStrictEqual(posts, []);
    });

    test('Escape reverts without sending', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        input().focus();

        type('0x1234');
        press('Escape');

        assert.strictEqual(input().value, '0x08000000');
        assert.deepStrictEqual(posts, []);
    });

    test('invalid text shows an inline error, marks aria-invalid, and sends nothing', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        input().focus();

        type('not-hex');
        press('Enter');

        assert.deepStrictEqual(posts, []);
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
        assert.match(errorText(), /hexadecimal/i);
    });

    test('overflowing input shows an inline error and sends nothing', () => {
        currentDom = installDom();
        S.parseResult = binResult({ baseAddress: 0xFFFFFFFF, totalDataBytes: 16 });
        mountField();
        input().focus();

        type('0xFFFFFFFF');
        press('Enter');

        assert.deepStrictEqual(posts, [], 'base + size overflows the 32-bit space');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
        assert.match(errorText(), /32-bit/i);
    });

    test('blur with invalid text reverts to the committed value', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        input().focus();

        type('zzz');
        press('Enter');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
        blurField();

        assert.strictEqual(input().value, '0x08000000');
        assert.strictEqual(input().getAttribute('aria-invalid'), null);
        assert.strictEqual(errorText(), '');
        assert.deepStrictEqual(posts, []);
    });

    test('is disabled with the dirty tooltip while edits are unsaved', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        S.editMode = true;
        S.edits.set(0x08000000, 0xFF);
        mountField();

        assert.strictEqual(input().disabled, true);
        assert.strictEqual(input().title, BASE_ADDRESS_DIRTY_MESSAGE);
        assert.strictEqual(binBaseField.focus(), BASE_ADDRESS_DIRTY_MESSAGE, 'focus reports the refusal');
        assert.notStrictEqual(document.activeElement, input(), 'a disabled field is not focused');
    });

    test('is disabled with the lock tooltip while an external change is unresolved', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        S.lockedDueToExternalChange = true;
        mountField();

        assert.strictEqual(input().disabled, true);
        assert.strictEqual(input().title, BASE_ADDRESS_LOCKED_MESSAGE);
        assert.strictEqual(binBaseField.focus(), BASE_ADDRESS_LOCKED_MESSAGE);
    });

    test('re-enables and re-syncs after the dirty/locked state clears', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        S.editMode = true;
        S.edits.set(0x08000000, 0xFF);
        mountField();
        assert.strictEqual(input().disabled, true);

        S.edits.clear();
        S.editMode = false;
        S.parseResult = binResult({ baseAddress: 0x1000 });
        binBaseField.render();

        assert.strictEqual(input().disabled, false);
        assert.strictEqual(input().title, 'Hexadecimal address where byte 0 maps (0x00000000–0xFFFFFFFF)');
        assert.strictEqual(input().value, '0x00001000');
    });

    test('focus selects the current text', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        assert.strictEqual(binBaseField.focus(), null);
        assert.strictEqual(document.activeElement, input());
        assert.strictEqual(input().selectionStart, 0);
        assert.strictEqual(input().selectionEnd, input().value.length);
    });

    test('refuses focus for text formats', () => {
        currentDom = installDom();
        S.parseResult = binResult({ format: 'srec' });
        mountField();

        assert.strictEqual(binBaseField.focus(), 'Base address applies only to raw binary files.');
    });
});
