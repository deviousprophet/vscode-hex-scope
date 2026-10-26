// ── Raw-binary base-address field (webview) ──────────────────────
// The profile-bar field is the only editor for a `.bin` base. Its fixed-prefix
// text box is always visible: disabled in view mode (alongside Edit) and
// enabled in edit mode (alongside Save/Cancel). Save/Enter commits,
// Cancel/Escape reverts and disables the input again, blur does nothing, and
// Edit stays disabled while edits are unsaved or an external change is
// unresolved.

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

    test('renders only for raw binaries, after the profile picker, with an always-visible text box', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        const bar = document.getElementById('profile-bar')!;
        assert.deepStrictEqual([...bar.children].map(child => child.id), ['profile-picker', 'bin-base-field']);
        const host = document.getElementById('bin-base-field') as HTMLElement;
        assert.strictEqual(host.hidden, false);
        assert.strictEqual(bar.querySelector('.base-field-label')?.textContent, 'Base Address');

        const wrap = document.getElementById('bin-base-input-wrap') as HTMLElement;
        assert.ok(wrap, 'the text-box wrapper is always present');
        assert.strictEqual(wrap.hidden, false);
        assert.strictEqual(document.getElementById('bin-base-value'), null, 'no read-only value label');
        const prefix = wrap.querySelector('.base-addr-pfx') as HTMLElement;
        assert.ok(prefix, 'the fixed prefix exists');
        assert.strictEqual(prefix.textContent, '0x');
        assert.strictEqual(prefix.getAttribute('aria-hidden'), 'true');
        assert.strictEqual(prefix.contains(input()), false, 'prefix is outside the input');
        assert.strictEqual(input().getAttribute('maxlength'), '8');
        assert.strictEqual(input().getAttribute('placeholder'), '00000000');

        assert.strictEqual(input().disabled, true, 'view mode disables the text box');
        assert.strictEqual(digits(), '08000000');
        assert.strictEqual(editButton().hidden, false, 'view mode shows Edit');
        assert.strictEqual(editButton().disabled, false);
        assert.strictEqual(saveButton().hidden, true);
        assert.strictEqual(cancelButton().hidden, true);
        assert.strictEqual(isEditing(), false);
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

    test('shows parseResult.baseAddress as eight uppercase digits in the disabled text box (explicit 0 included)', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        assert.strictEqual(input().disabled, true);
        assert.strictEqual(digits(), '08000000');

        S.parseResult = binResult({ baseAddress: 0, segments: [{ startAddress: 0, data: new Uint8Array(16) }] });
        binBaseField.render();
        assert.strictEqual(digits(), '00000000');

        S.parseResult = binResult({ baseAddress: undefined, segments: [{ startAddress: 0x2000, data: new Uint8Array(4) }] });
        binBaseField.render();
        assert.strictEqual(digits(), '00000000', 'absent base falls back to 0, not the segment start');
    });

    test('Edit enables the always-visible input, shows Save/Cancel, and focuses the digits', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        startEditing();

        assert.strictEqual(isEditing(), true);
        assert.strictEqual(input().disabled, false, 'edit mode enables the text box');
        assert.strictEqual(editButton().hidden, true, 'Edit is replaced by Save/Cancel');
        assert.strictEqual(saveButton().hidden, false);
        assert.strictEqual(cancelButton().hidden, false);
        assert.strictEqual(digits(), '08000000', 'the prefix is never part of the value');
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
        assert.strictEqual(input().disabled, true, 'view mode disables the text box again');
        assert.strictEqual(editButton().hidden, false);
        assert.strictEqual(digits(), '08010000', 'the committed value is shown until the host rehydrates');
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
        assert.strictEqual(input().disabled, true);
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
        assert.strictEqual(input().disabled, true);
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
        assert.strictEqual(input().disabled, false, 'the invalid draft keeps the input enabled');
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
        assert.strictEqual(input().disabled, false, 'the invalid draft keeps the input enabled');
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
        assert.strictEqual(input().disabled, true);
        assert.strictEqual(digits(), '08000000');
    });

    test('Cancel reverts without sending, disables the input, and returns to view mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('0x1234');
        click(cancelButton());

        assert.strictEqual(isEditing(), false);
        assert.strictEqual(input().disabled, true);
        assert.strictEqual(digits(), '08000000');
        assert.deepStrictEqual(posts, []);
    });

    test('Escape reverts without sending, disables the input, and returns to view mode', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();
        startEditing();

        type('0x1234');
        press('Escape');

        assert.strictEqual(isEditing(), false);
        assert.strictEqual(input().disabled, true);
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
        assert.strictEqual(input().disabled, false, 'the input stays enabled');
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
        assert.strictEqual(input().disabled, false, 'the invalid draft stays editable');
        assert.strictEqual(input().getAttribute('aria-invalid'), 'true');
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
        assert.strictEqual(input().disabled, false, 'the overflowing draft stays editable');
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
        assert.strictEqual(input().disabled, false, 'the empty draft stays editable');
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
        assert.strictEqual(input().disabled, true);
        assert.strictEqual(digits(), '00001000');
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
        assert.strictEqual(input().disabled, true, 'the text box is disabled while dirty');
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
        assert.strictEqual(input().disabled, true, 'the text box is disabled while locked');
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
        assert.strictEqual(input().disabled, true, 'the input is disabled again');
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
        assert.strictEqual(input().disabled, true);
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
        assert.strictEqual(editButton().title, 'Edit the raw binary base address');
        assert.strictEqual(input().disabled, true, 'view mode keeps the input disabled');
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
        assert.strictEqual(input().disabled, true, 'a fresh mount disables the input');
        assert.strictEqual(digits(), '08000000');
    });

    test('focus enters edit mode and selects only the digits', () => {
        currentDom = installDom();
        S.parseResult = binResult();
        mountField();

        assert.strictEqual(binBaseField.focus(), null);
        assert.strictEqual(isEditing(), true);
        assert.strictEqual(input().disabled, false);
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
        assert.strictEqual(input().disabled, false);
        assert.strictEqual(input().value, '1234', 're-entering edit does not reset the draft');
        assert.deepStrictEqual(posts, []);
    });

    test('refuses focus for text formats', () => {
        currentDom = installDom();
        S.parseResult = binResult({ format: 'srec' });
        mountField();

        assert.strictEqual(binBaseField.focus(), 'Base address applies only to raw binary files.');
        assert.strictEqual(isEditing(), false);
        assert.strictEqual(input().disabled, true);
    });
});
