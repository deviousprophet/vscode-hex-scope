// ── Raw-binary base-address field (webview) ──────────────────────
// The profile-bar field is the only editor for a `.bin` base. View mode shows
// an uppercase label, a read-only `0x%08X` value, and an icon Edit button; the
// bordered address box appears only in edit mode alongside icon Save/Cancel.
// Save/Enter commits, Cancel/Escape reverts to the value label, blur does
// nothing, and Edit stays disabled while edits are unsaved or an external
// change is unresolved.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import './cssImportHook';

import { S } from '../../webview/state';
import { binBaseField, configureBinBaseField } from '../../webview/binBaseField';
import { BASE_ADDRESS_DIRTY_MESSAGE, BASE_ADDRESS_LOCKED_MESSAGE } from '../../webview/baseAddressChange';
import type { SerializedParseResult } from '../../core/types';
import type { WebviewToProviderMessage } from '../../webviewProtocol';

const WEBVIEW_DIR = path.resolve(__dirname, '../../../src/webview');
const BIN_BASE_CSS = path.join(WEBVIEW_DIR, 'binBaseField.css');
const BASE_CSS = path.join(WEBVIEW_DIR, 'styles', 'base.css');
const TOOLBAR_CSS = path.join(WEBVIEW_DIR, 'components', 'toolbar', 'toolbar.css');

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

function inputWrap(): HTMLElement {
    return document.getElementById('bin-base-input-wrap') as HTMLElement;
}

function valueLabel(): HTMLElement {
    return document.getElementById('bin-base-value') as HTMLElement;
}

function editButton(): HTMLButtonElement {
    return document.getElementById('bin-base-edit') as HTMLButtonElement;
}

function saveButton(): HTMLButtonElement {
    return document.getElementById('bin-base-save') as HTMLButtonElement;
}

function cancelButton(): HTMLButtonElement {
    return document.getElementById('bin-base-cancel') as HTMLButtonElement;
}

function digits(): string {
    return input().value;
}

function isEditing(): boolean {
    return saveButton().hidden === false;
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

function paste(text: string): void {
    const event = new (currentDom!.window as unknown as typeof window).Event('paste', {
        bubbles: true, cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    input().dispatchEvent(event);
}

function click(button: HTMLButtonElement): void {
    button.dispatchEvent(new (currentDom!.window as unknown as typeof window).MouseEvent('click', {
        bubbles: true, cancelable: true,
    }));
}

function startEditing(): void {
    click(editButton());
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

    test('renders only for raw binaries, after the profile picker, as a value label + icon Edit', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        const bar = document.getElementById('profile-bar')!;
        assert.deepStrictEqual([...bar.children].map(child => child.id), ['profile-picker', 'bin-base-field']);
        const host = document.getElementById('bin-base-field') as HTMLElement;
        assert.strictEqual(host.hidden, false);
        assert.strictEqual(bar.querySelector('.base-field-label')?.textContent, 'Base Address');

        // View mode: read-only value + icon Edit; the address box is hidden.
        assert.strictEqual(valueLabel().hidden, false);
        assert.strictEqual(valueLabel().textContent, '0x08000000');
        assert.strictEqual(inputWrap().hidden, true, 'the address box is hidden in view mode');
        assert.ok(inputWrap().classList.contains('addr-field'), 'edit mode reuses the shared address-field primitive');
        assert.strictEqual(editButton().hidden, false, 'view mode shows Edit');
        assert.strictEqual(editButton().disabled, false);
        assert.strictEqual(saveButton().hidden, true);
        assert.strictEqual(cancelButton().hidden, true);
        assert.strictEqual(isEditing(), false);
    });

    test('icon actions carry glyphs, tooltips, and accessible labels', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        assert.strictEqual(editButton().textContent, '\u270E', 'pencil glyph, no text label');
        assert.strictEqual(editButton().title, 'Edit base address');
        assert.strictEqual(editButton().getAttribute('aria-label'), 'Edit base address');
        assert.strictEqual(saveButton().textContent, '\u2713', 'check glyph, no text label');
        assert.strictEqual(saveButton().title, 'Save base address');
        assert.strictEqual(saveButton().getAttribute('aria-label'), 'Save base address');
        assert.strictEqual(cancelButton().textContent, '\u2715', 'X glyph, no text label');
        assert.strictEqual(cancelButton().title, 'Cancel base address');
        assert.strictEqual(cancelButton().getAttribute('aria-label'), 'Cancel base address');
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

    test('shows parseResult.baseAddress as 0x + eight uppercase digits in the read-only value (explicit 0 included)', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        assert.strictEqual(inputWrap().hidden, true);
        assert.strictEqual(valueLabel().textContent, '0x08000000');

        S.parseResult = binResult({ baseAddress: 0, segments: [{ startAddress: 0, data: new Uint8Array(16) }] });
        binBaseField.render();
        assert.strictEqual(valueLabel().textContent, '0x00000000');

        S.parseResult = binResult({ baseAddress: undefined, segments: [{ startAddress: 0x2000, data: new Uint8Array(4) }] });
        binBaseField.render();
        assert.strictEqual(valueLabel().textContent, '0x00000000', 'absent base falls back to 0, not the segment start');
    });

    test('Edit reveals the bordered box, hides the value, shows Save/Cancel, and focuses the digits', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        startEditing();

        assert.strictEqual(isEditing(), true);
        assert.strictEqual(inputWrap().hidden, false, 'edit mode reveals the address box');
        assert.strictEqual(valueLabel().hidden, true, 'the read-only value is replaced by the box');
        assert.strictEqual(editButton().hidden, true, 'Edit is replaced by Save/Cancel');
        assert.strictEqual(saveButton().hidden, false);
        assert.strictEqual(cancelButton().hidden, false);
        assert.strictEqual(digits(), '08000000', 'the prefix is never part of the value');
        const prefix = inputWrap().querySelector('.addr-pfx') as HTMLElement;
        assert.ok(prefix, 'the fixed prefix exists');
        assert.strictEqual(prefix.textContent, '0x');
        assert.strictEqual(prefix.getAttribute('aria-hidden'), 'true');
        assert.strictEqual(prefix.contains(input()), false, 'prefix is outside the input');
        assert.ok(input().classList.contains('addr-input'), 'the digits input uses the shared primitive');
        assert.strictEqual(input().getAttribute('maxlength'), '8');
        assert.strictEqual(input().getAttribute('placeholder'), '00000000');
        assert.strictEqual(document.activeElement, input());
        assert.strictEqual(input().selectionStart, 0);
        assert.strictEqual(input().selectionEnd, 8);
    });

    test('Save commits a changed valid value and returns to view mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('0x08010000');
        click(saveButton());

        assert.deepStrictEqual(posts, [{ type: 'setBinBaseAddress', value: 0x08010000 }]);
        assert.strictEqual(isEditing(), false, 'back to view mode');
        assert.strictEqual(inputWrap().hidden, true, 'the box is hidden again in view mode');
        assert.strictEqual(valueLabel().hidden, false);
        assert.strictEqual(valueLabel().textContent, '0x08010000', 'the committed value is shown until the host rehydrates');
        assert.strictEqual(editButton().hidden, false);
        assert.strictEqual(input().getAttribute('aria-invalid'), null);
    });

    test('Enter commits a changed valid value and canonicalizes it to digits', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('0X1234ABCD');
        press('Enter');

        assert.deepStrictEqual(posts, [{ type: 'setBinBaseAddress', value: 0x1234ABCD }]);
        assert.strictEqual(isEditing(), false);
        assert.strictEqual(inputWrap().hidden, true);
        assert.strictEqual(valueLabel().textContent, '0x1234ABCD');
        assert.strictEqual(input().value, '1234ABCD', 'canonicalized in place without the prefix');
    });

    test('a pasted 0x-prefixed value keeps only the digits before maxlength applies', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        paste('0x08010000');
        assert.strictEqual(input().value, '08010000', 'the fixed prefix is not duplicated inside the input');
        press('Enter');

        assert.deepStrictEqual(posts, [{ type: 'setBinBaseAddress', value: 0x08010000 }]);
        assert.strictEqual(inputWrap().hidden, true);
        assert.strictEqual(valueLabel().textContent, '0x08010000');
        assert.strictEqual(digits(), '08010000');
    });

    test('a typed 0x prefix is stripped so it cannot consume digit slots', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('0x');
        assert.strictEqual(input().value, '', 'the fixed prefix never becomes part of the value');
        type('0x08010000');

        assert.strictEqual(input().value, '08010000');
        press('Enter');
        assert.deepStrictEqual(posts, [{ type: 'setBinBaseAddress', value: 0x08010000 }]);
    });

    test('an over-long pasted address stays visible and errors instead of truncating', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        paste('0x108000000');

        assert.strictEqual(input().value, '108000000', 'the digits are not cut into a different address');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
        assert.match(errorText(), /eight hex digits/i);

        click(saveButton());
        assert.deepStrictEqual(posts, []);
        assert.strictEqual(isEditing(), true);
        assert.strictEqual(inputWrap().hidden, false, 'the invalid draft keeps the box visible');
    });

    test('a malformed prefixed paste is not truncated into a valid address', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        paste('0x08010000 (boot)');

        assert.strictEqual(input().value, '08010000 (boot)', 'the whole paste stays visible');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
        assert.match(errorText(), /eight hex digits/i);

        click(saveButton());
        assert.deepStrictEqual(posts, []);
        assert.strictEqual(isEditing(), true);
        assert.strictEqual(inputWrap().hidden, false, 'the invalid draft keeps the box visible');
    });

    test('an unchanged Save sends nothing and returns to view mode', () => {
        currentDom = installDom();
        S.parseResult = binResult({ baseAddress: 0x08000000 });
        mountField();
        startEditing();

        type('0x08000000');
        click(saveButton());

        assert.deepStrictEqual(posts, [], 'unchanged commit is a no-op');
        assert.strictEqual(isEditing(), false);
        assert.strictEqual(inputWrap().hidden, true);
        assert.strictEqual(digits(), '08000000');
    });

    test('Cancel reverts without sending, hides the box, and returns to view mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('0x1234');
        click(cancelButton());

        assert.strictEqual(isEditing(), false);
        assert.strictEqual(inputWrap().hidden, true);
        assert.strictEqual(digits(), '08000000');
        assert.deepStrictEqual(posts, []);
    });

    test('Escape reverts without sending, hides the box, and returns to view mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('0x1234');
        press('Escape');

        assert.strictEqual(isEditing(), false);
        assert.strictEqual(inputWrap().hidden, true);
        assert.strictEqual(digits(), '08000000');
        assert.deepStrictEqual(posts, []);
    });

    test('blur neither commits nor cancels the edit', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('1000');
        blurField();

        assert.deepStrictEqual(posts, [], 'blur never commits');
        assert.strictEqual(isEditing(), true, 'blur keeps the edit open for Save/Cancel');
        assert.strictEqual(inputWrap().hidden, false, 'the box stays visible');
        assert.strictEqual(input().value, '1000', 'the draft survives a blur');
    });

    test('invalid text shows an inline error, marks aria-invalid, and stays in edit mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('not-hex');
        click(saveButton());

        assert.deepStrictEqual(posts, []);
        assert.strictEqual(isEditing(), true);
        assert.strictEqual(inputWrap().hidden, false, 'the invalid draft keeps the box visible');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
        assert.ok(inputWrap().classList.contains('addr-invalid'), 'the shared field carries the error border');
        assert.match(errorText(), /hexadecimal/i);
    });

    test('overflowing input shows an inline error and stays in edit mode', () => {
        currentDom = installDom();
        S.parseResult = binResult({ baseAddress: 0xFFFFFFFF, totalDataBytes: 16 });
        mountField();
        startEditing();

        type('0xFFFFFFFF');
        click(saveButton());

        assert.deepStrictEqual(posts, [], 'base + size overflows the 32-bit space');
        assert.strictEqual(isEditing(), true);
        assert.strictEqual(inputWrap().hidden, false, 'the overflowing draft keeps the box visible');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
        assert.match(errorText(), /32-bit/i);
    });

    test('empty input shows an inline error and stays in edit mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('');
        click(saveButton());

        assert.deepStrictEqual(posts, []);
        assert.strictEqual(isEditing(), true);
        assert.strictEqual(inputWrap().hidden, false, 'the empty draft keeps the box visible');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
        assert.match(errorText(), /enter a base address/i);
    });

    test('a corrected value clears the inline error and commits', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('zzz');
        press('Enter');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');

        type('1000');
        press('Enter');

        assert.deepStrictEqual(posts, [{ type: 'setBinBaseAddress', value: 0x1000 }]);
        assert.strictEqual(isEditing(), false);
        assert.strictEqual(inputWrap().hidden, true);
        assert.strictEqual(valueLabel().textContent, '0x00001000');
        assert.strictEqual(errorText(), '');
    });

    test('is disabled with the dirty tooltip while edits are unsaved', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        S.editMode = true;
        S.edits.set(0x08000000, 0xFF);
        mountField();

        assert.strictEqual(editButton().disabled, true);
        assert.strictEqual(editButton().title, BASE_ADDRESS_DIRTY_MESSAGE);
        assert.strictEqual(inputWrap().hidden, true, 'the box is hidden while dirty');
        assert.strictEqual(binBaseField.beginEdit(), BASE_ADDRESS_DIRTY_MESSAGE, 'the palette path reports the refusal');
        assert.strictEqual(isEditing(), false, 'a guarded field never enters edit mode');
    });

    test('is disabled with the lock tooltip while an external change is unresolved', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        S.lockedDueToExternalChange = true;
        mountField();

        assert.strictEqual(editButton().disabled, true);
        assert.strictEqual(editButton().title, BASE_ADDRESS_LOCKED_MESSAGE);
        assert.strictEqual(inputWrap().hidden, true, 'the box is hidden while locked');
        assert.strictEqual(binBaseField.beginEdit(), BASE_ADDRESS_LOCKED_MESSAGE);
        assert.strictEqual(isEditing(), false);
    });

    test('a document becoming dirty while editing reverts and exits edit mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('1234');
        S.editMode = true;
        S.edits.set(0x08000000, 0xFF);
        binBaseField.render();

        assert.strictEqual(isEditing(), false, 'the draft is dropped');
        assert.strictEqual(inputWrap().hidden, true, 'the draft is dropped and the box hides again');
        assert.strictEqual(digits(), '08000000', 'the committed value is restored');
        assert.strictEqual(editButton().disabled, true);
        assert.strictEqual(editButton().title, BASE_ADDRESS_DIRTY_MESSAGE);
        assert.deepStrictEqual(posts, []);
    });

    test('a document becoming locked while editing reverts and exits edit mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('1234');
        S.lockedDueToExternalChange = true;
        binBaseField.render();

        assert.strictEqual(isEditing(), false);
        assert.strictEqual(inputWrap().hidden, true);
        assert.strictEqual(digits(), '08000000');
        assert.strictEqual(editButton().disabled, true);
        assert.strictEqual(editButton().title, BASE_ADDRESS_LOCKED_MESSAGE);
    });

    test('re-enables and re-syncs after the dirty/locked state clears', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        S.editMode = true;
        S.edits.set(0x08000000, 0xFF);
        mountField();
        assert.strictEqual(editButton().disabled, true);

        S.edits.clear();
        S.editMode = false;
        S.parseResult = binResult({ baseAddress: 0x1000 });
        binBaseField.render();

        assert.strictEqual(editButton().disabled, false);
        assert.strictEqual(editButton().title, 'Edit base address');
        assert.strictEqual(inputWrap().hidden, true, 'view mode keeps the box hidden');
        assert.strictEqual(digits(), '00001000');
    });

    test('a fresh mount starts in view mode with the effective base', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();
        type('1234');

        document.getElementById('bin-base-field')!.remove();
        mountField();

        assert.strictEqual(isEditing(), false, 'full re-render resets to view mode');
        assert.strictEqual(inputWrap().hidden, true, 'a fresh mount starts in view mode');
        assert.strictEqual(digits(), '08000000');
    });

    test('focus enters edit mode and selects only the digits', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        assert.strictEqual(binBaseField.focus(), null);
        assert.strictEqual(isEditing(), true);
        assert.strictEqual(inputWrap().hidden, false);
        assert.strictEqual(document.activeElement, input());
        assert.strictEqual(input().value, '08000000');
        assert.strictEqual(input().value.includes('0x'), false, 'the prefix cannot be selected as part of the value');
        assert.strictEqual(input().selectionStart, 0);
        assert.strictEqual(input().selectionEnd, 8);
    });

    test('the palette command while already editing keeps the current draft', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();
        type('1234');
        blurField();

        assert.strictEqual(binBaseField.focus(), null);
        assert.strictEqual(isEditing(), true);
        assert.strictEqual(inputWrap().hidden, false);
        assert.strictEqual(input().value, '1234', 're-entering edit does not reset the draft');
        assert.deepStrictEqual(posts, []);
    });

    test('refuses focus for text formats', () => {
        currentDom = installDom();
        S.parseResult = binResult({ format: 'srec' });
        mountField();

        assert.strictEqual(binBaseField.focus(), 'Base address applies only to raw binary files.');
        assert.strictEqual(isEditing(), false);
        assert.strictEqual(inputWrap().hidden, true);
    });

    test('styles: value label, uppercase label, shared address field, icon buttons, 2px separators', () => {
        const binCss = fs.readFileSync(BIN_BASE_CSS, 'utf8');
        const baseCss = fs.readFileSync(BASE_CSS, 'utf8');
        const toolbarCss = fs.readFileSync(TOOLBAR_CSS, 'utf8');

        // One shared address-field primitive owns the border/prefix/digits.
        assert.match(baseCss, /\.addr-field\s*\{[^}]*height:\s*22px/s, '.addr-field owns the bordered box');
        assert.match(baseCss, /\.addr-field\s*\{[^}]*align-items:\s*center/s, 'prefix + digits stay vertically centered');
        assert.match(baseCss, /\.addr-field\s*>\s*\.addr-pfx\s*\{/, 'the shared prefix scopes out the overlay legacy rule');
        assert.match(baseCss, /\.addr-input\s*\{[^}]*border:\s*none/s, '.addr-input is the shared borderless digits input');

        // Read-only value label + uppercase label, no title-case override.
        assert.match(binCss, /\.bin-base-field\s*\{[^}]*align-items:\s*center/s, 'label/value/actions center on the row');
        assert.match(binCss, /\.base-value\s*\{[^}]*font-size:\s*11px[^}]*font-weight:\s*700/s, 'value label is mono/bold 11px');
        assert.match(binCss, /\.base-value\s*\{[^}]*line-height:\s*1/s, 'value label rides the 31px row without extra leading');
        assert.doesNotMatch(binCss, /text-transform:\s*none/, 'the base label inherits the uppercase profile-label');
        assert.match(toolbarCss, /\.profile-label\s*\{[^}]*text-transform:\s*uppercase/s);

        // Square icon-only actions on the secondary button tokens.
        assert.match(binCss, /\.base-icon-btn\s*\{[^}]*width:\s*22px[^}]*height:\s*22px/s);
        assert.match(binCss, /\.base-icon-btn\s*\{[^}]*vscode-button-secondaryBackground/s);
        assert.match(binCss, /\.base-icon-btn\[hidden\]\s*\{\s*display:\s*none/s, 'hidden icon actions stay out of the layout');
        assert.match(binCss, /\.base-icon-btn:disabled\s*\{[^}]*vscode-disabledForeground/s);

        // Thicker separator for both profile/Base Address and tabs/ASCII.
        assert.match(toolbarCss, /\.tb-sep\s*\{[^}]*width:\s*2px/s);
    });
});
