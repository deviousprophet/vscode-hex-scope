import * as assert from 'assert';
import { JSDOM } from 'jsdom';

import { updateExternalChangeLockState } from '../../webview/lock';

let currentDom: JSDOM | null = null;

function installDom(markup: string): JSDOM {
    const dom = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as {
        window: Window;
        document: Document;
        HTMLButtonElement: typeof HTMLButtonElement;
        HTMLInputElement: typeof HTMLInputElement;
    };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    // jsdom elements must match the `instanceof` checks in lock.ts.
    g.HTMLButtonElement = dom.window.HTMLButtonElement;
    g.HTMLInputElement = dom.window.HTMLInputElement;
    return dom;
}

function cleanupDom(dom: JSDOM): void {
    dom.window.close();
    delete (globalThis as unknown as { window?: Window }).window;
    delete (globalThis as unknown as { document?: Document }).document;
    delete (globalThis as unknown as { HTMLButtonElement?: unknown }).HTMLButtonElement;
    delete (globalThis as unknown as { HTMLInputElement?: unknown }).HTMLInputElement;
}

function appMarkup(): string {
    return `
        <div id="app">
            <div id="toolbar"><button id="tb-btn">Toolbar</button><input id="tb-input"></div>
            <div id="main-area"><button id="ma-btn">Main</button></div>
            <button id="outside-btn">Outside</button>
        </div>`;
}

function assertLockedDisabled(el: HTMLElement, label: string): void {
    assert.ok(el instanceof HTMLButtonElement || el instanceof HTMLInputElement, `${label} is interactive`);
    assert.ok((el as HTMLButtonElement).disabled, `${label} disabled while locked`);
    assert.strictEqual(el.getAttribute('data-was-enabled'), 'true', `${label} marked`);
}

function assertLockedUntouched(el: HTMLElement, label: string): void {
    assert.ok(!(el as HTMLButtonElement).disabled, `${label} not disabled`);
    assert.strictEqual(el.getAttribute('data-was-enabled'), null, `${label} unmarked`);
}

function assertUnlockedRestored(el: HTMLElement, label: string): void {
    assert.ok(!(el as HTMLButtonElement).disabled, `${label} re-enabled`);
    assert.strictEqual(el.getAttribute('data-was-enabled'), null, `${label} mark cleared`);
}

suite('webview external-change lock state', () => {
    teardown(() => {
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('lock disables interactive elements and unlock restores them', () => {
        const dom = installDom(appMarkup());
        currentDom = dom;
        const doc = dom.window.document;
        const app = doc.getElementById('app') as HTMLElement;
        const maBtn = doc.getElementById('ma-btn') as HTMLButtonElement;
        const tbBtn = doc.getElementById('tb-btn') as HTMLButtonElement;
        const tbInput = doc.getElementById('tb-input') as HTMLInputElement;
        const outside = doc.getElementById('outside-btn') as HTMLButtonElement;

        updateExternalChangeLockState(true);
        assert.ok(app.classList.contains('locked-due-to-external-change'));
        assertLockedDisabled(maBtn, 'main-area button');
        assertLockedDisabled(tbBtn, 'toolbar button');
        assertLockedDisabled(tbInput, 'toolbar input');
        assertLockedUntouched(outside, 'outside root button');

        updateExternalChangeLockState(false);
        assert.ok(!app.classList.contains('locked-due-to-external-change'));
        assertUnlockedRestored(maBtn, 'main-area button');
        assertUnlockedRestored(tbBtn, 'toolbar button');
        assertUnlockedRestored(tbInput, 'toolbar input');
        assertUnlockedRestored(outside, 'outside root button');
    });

    test('lock ignores missing app root', () => {
        const dom = installDom('<div id="other"></div>');
        currentDom = dom;
        assert.doesNotThrow(() => updateExternalChangeLockState(true));
    });
});
