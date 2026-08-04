import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../css-import-hook';

import { ExternalChange } from '../../../webview/components/ExternalChange/ExternalChange';
import { updateExternalChangeLockState } from '../../../webview/lock';
import type { IncomingFile } from '../../../webview/appModel';

const CONFLICT_ICON = String.fromCodePoint(9888);       // &#9888;  ⚠
const RELOAD_ICON = String.fromCodePoint(128260);       // &#128260;
const ERROR_ICON = '\u274C';                            // ❌

function sampleIncoming(): IncomingFile {
    return { parseResult: {} as IncomingFile['parseResult'], generation: 3, labels: [] };
}

interface Harness {
    dom: JSDOM;
    banner: ExternalChange;
    reloads: IncomingFile[];
}

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

function createHarness(): Harness {
    const dom = installDom(appMarkup());
    currentDom = dom;
    const reloads: IncomingFile[] = [];
    const banner = new ExternalChange();
    return { dom, banner, reloads };
}

function conflictCbHarness(): Harness {
    const dom = installDom(appMarkup());
    currentDom = dom;
    const reloads: IncomingFile[] = [];
    const banner = new ExternalChange();
    return { dom, banner, reloads };
}

function click(dom: JSDOM, id: string): void {
    const el = dom.window.document.getElementById(id);
    assert.ok(el, `missing #${id}`);
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function bannerEl(dom: JSDOM, id: string): HTMLElement {
    const el = dom.window.document.getElementById(id);
    assert.ok(el, `missing #${id}`);
    return el as HTMLElement;
}

suite('webview ExternalChange component', () => {
    teardown(() => {
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('conflict banner renders byte-identical ids/classes/text', () => {
        const dom = installDom(appMarkup());
        currentDom = dom;
        const banner = new ExternalChange();
        banner.showConflict(sampleIncoming(), 3, () => {});

        const el = bannerEl(dom, 'ext-conflict-banner');
        assert.ok(el.classList.contains('ext-conflict-banner'));
        const app = dom.window.document.getElementById('app') as HTMLElement;
        assert.strictEqual(app.firstElementChild, el, 'banner prepended to #app');
        assert.strictEqual(el.querySelector('.ecb-icon')!.textContent, CONFLICT_ICON);
        assert.strictEqual(
            el.querySelector('.ecb-msg')!.textContent,
            'File changed externally. You have 3 unsaved edits. Changes must be reloaded.',
        );
        const btn = el.querySelector('.ecb-btn.ecb-reload') as HTMLButtonElement;
        assert.strictEqual(btn.id, 'ecb-reload');
        assert.strictEqual(btn.textContent, 'Reload & discard my edits');
    });

    test('conflict banner pluralizes single unsaved edit', () => {
        const dom = installDom(appMarkup());
        currentDom = dom;
        const banner = new ExternalChange();
        banner.showConflict(sampleIncoming(), 1, () => {});
        assert.strictEqual(
            bannerEl(dom, 'ext-conflict-banner').querySelector('.ecb-msg')!.textContent,
            'File changed externally. You have 1 unsaved edit. Changes must be reloaded.',
        );
    });

    test('reload banner renders byte-identical ids/classes/text', () => {
        const dom = installDom(appMarkup());
        currentDom = dom;
        const banner = new ExternalChange();
        banner.showReload(sampleIncoming(), () => {});

        const el = bannerEl(dom, 'ext-reload-banner');
        assert.ok(el.classList.contains('ext-reload-banner'));
        const app = dom.window.document.getElementById('app') as HTMLElement;
        assert.strictEqual(app.firstElementChild, el, 'banner prepended to #app');
        assert.strictEqual(el.querySelector('.erb-icon')!.textContent, RELOAD_ICON);
        assert.strictEqual(el.querySelector('.erb-msg')!.textContent, 'File changed externally. Reloading...');
        const btn = el.querySelector('.erb-btn.erb-reload') as HTMLButtonElement;
        assert.strictEqual(btn.id, 'erb-reload');
        assert.strictEqual(btn.textContent, 'Reload');
    });

    test('error banner renders repair action with auto-escaped text', () => {
        const dom = installDom(appMarkup());
        currentDom = dom;
        const banner = new ExternalChange();
        banner.showError(2, 3, true, () => {}, () => {});

        const el = bannerEl(dom, 'ext-error-banner');
        assert.ok(el.classList.contains('ext-error-banner'));
        assert.strictEqual(el.querySelector('.eeb-icon')!.textContent, ERROR_ICON);
        const msg = el.querySelector('.eeb-msg') as HTMLElement;
        assert.strictEqual(msg.childNodes[0].textContent, 'File changed externally and is now invalid: ');
        assert.strictEqual((msg.querySelector('strong') as HTMLElement).textContent, '2 checksum errors and 3 malformed lines');
        const btn = el.querySelector('.eeb-btn.eeb-repair') as HTMLButtonElement;
        assert.strictEqual(btn.id, 'eeb-repair');
        assert.strictEqual(btn.textContent, 'Quick Repair & reload');
        assert.ok(!el.querySelector('#eeb-view-text'));
    });

    test('error banner renders view-text action when repair unavailable', () => {
        const dom = installDom(appMarkup());
        currentDom = dom;
        const banner = new ExternalChange();
        banner.showError(0, 5, false, () => {}, () => {});

        const el = bannerEl(dom, 'ext-error-banner');
        assert.strictEqual(
            (el.querySelector('strong') as HTMLElement).textContent,
            '5 malformed lines',
        );
        const btn = el.querySelector('.eeb-btn.eeb-view-text') as HTMLButtonElement;
        assert.strictEqual(btn.id, 'eeb-view-text');
        assert.strictEqual(btn.textContent, 'View in text editor');
        assert.ok(!el.querySelector('#eeb-repair'));
    });

    test('conflict dismiss removes banner then calls onReload with incoming', () => {
        const { dom, banner, reloads } = conflictCbHarness();
        const incoming = sampleIncoming();
        banner.showConflict(incoming, 2, inc => { reloads.push(inc); });
        click(dom, 'ecb-reload');
        assert.strictEqual(dom.window.document.getElementById('ext-conflict-banner'), null);
        assert.deepStrictEqual(reloads, [incoming]);
    });

    test('reload dismiss removes banner then calls onReload with incoming', () => {
        const { dom, banner, reloads } = conflictCbHarness();
        const incoming = sampleIncoming();
        banner.showReload(incoming, inc => { reloads.push(inc); });
        click(dom, 'erb-reload');
        assert.strictEqual(dom.window.document.getElementById('ext-reload-banner'), null);
        assert.deepStrictEqual(reloads, [incoming]);
    });

    test('error repair click calls onRepair without removing banner', () => {
        const { dom, banner } = createHarness();
        let repairs = 0;
        banner.showError(1, 0, true, () => { repairs++; }, () => {});
        click(dom, 'eeb-repair');
        assert.strictEqual(repairs, 1);
        assert.ok(dom.window.document.getElementById('ext-error-banner'), 'banner kept for host reload flow');
    });

    test('error view-text click calls onViewText without removing banner', () => {
        const { dom, banner } = createHarness();
        let viewTexts = 0;
        banner.showError(0, 1, false, () => {}, () => { viewTexts++; });
        click(dom, 'eeb-view-text');
        assert.strictEqual(viewTexts, 1);
        assert.ok(dom.window.document.getElementById('ext-error-banner'), 'banner kept for host reload flow');
    });

    test('showing a banner replaces its own prior kind', () => {
        const { dom, banner } = createHarness();
        banner.showConflict(sampleIncoming(), 1, () => {});
        const first = bannerEl(dom, 'ext-conflict-banner');
        banner.showConflict(sampleIncoming(), 2, () => {});
        const second = bannerEl(dom, 'ext-conflict-banner');
        assert.notStrictEqual(second, first, 'old conflict banner removed');
        assert.strictEqual(dom.window.document.querySelectorAll('#ext-conflict-banner').length, 1);
        assert.strictEqual(second.querySelector('.ecb-msg')!.textContent, 'File changed externally. You have 2 unsaved edits. Changes must be reloaded.');
    });

    test('showError replaces its own prior kind', () => {
        const { dom, banner } = createHarness();
        banner.showError(1, 1, true, () => {}, () => {});
        const first = bannerEl(dom, 'ext-error-banner');
        banner.showError(3, 3, false, () => {}, () => {});
        const second = bannerEl(dom, 'ext-error-banner');
        assert.notStrictEqual(second, first);
        assert.strictEqual(dom.window.document.querySelectorAll('#ext-error-banner').length, 1);
        assert.ok(second.querySelector('#eeb-view-text'));
    });

    test('clearAll removes all three banners and nothing else', () => {
        const { dom, banner } = createHarness();
        banner.showConflict(sampleIncoming(), 1, () => {});
        banner.showReload(sampleIncoming(), () => {});
        banner.showError(1, 1, true, () => {}, () => {});
        const app = dom.window.document.getElementById('app') as HTMLElement;
        const outside = dom.window.document.getElementById('outside-btn') as HTMLElement;
        assert.ok(app.contains(outside), 'precondition: outside button inside #app too');
        banner.clearAll();
        assert.strictEqual(dom.window.document.getElementById('ext-conflict-banner'), null);
        assert.strictEqual(dom.window.document.getElementById('ext-reload-banner'), null);
        assert.strictEqual(dom.window.document.getElementById('ext-error-banner'), null);
        assert.ok(dom.window.document.getElementById('outside-btn'), 'non-banner content untouched');
    });

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
