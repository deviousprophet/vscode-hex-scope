import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../../../cssImportHook';

import { FileProfilesPanel } from '../../../../../webview/components/sidebar/fileProfilesPanel/fileProfilesPanel';
import type { IntegrityProfile } from '../../../../../core/integrity';
import type { FileProfile } from '../../../../../core/workspaceConfigModel';
import type { StructPin } from '../../../../../core/types';

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
    navigator: Navigator;
};

type Cb = {
    selects: Array<string | null>;
    created: Array<{ name: string; integrityProfileId: string | null }>;
    renamed: Array<{ id: string; name: string }>;
    deleted: string[];
    pins: StructPin[];
    endian: 'le' | 'be';
};

function installDom(): { panel: FileProfilesPanel; cb: Cb } {
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as Globalish;
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    Object.defineProperty(globalThis, 'navigator', {
        value: dom.window.navigator,
        configurable: true,
        writable: true,
    });
    (globalThis as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame = () => 0;

    const cb: Cb = { selects: [], created: [], renamed: [], deleted: [], pins: [], endian: 'le' };
    const panel = new FileProfilesPanel({
        onSelect: id => cb.selects.push(id),
        onCreate: (name, integrityProfileId) => cb.created.push({ name, integrityProfileId }),
        onRename: (id, name) => cb.renamed.push({ id, name }),
        onDelete: id => cb.deleted.push(id),
        getPins: () => cb.pins,
        getEndian: () => cb.endian,
    });
    panel.mount(document.getElementById('host')!);
    lastDom = dom;
    return { panel, cb };
}

function profiles(): FileProfile[] {
    return [
        { id: 'p1', name: 'Bootloader', pins: [{ id: 'pin1', structId: 's1', addr: 0x40000, name: 'Header' }], endian: 'be', integrityProfileId: 'crc' },
        { id: 'p2', name: 'App firmware', pins: [], endian: 'le', integrityProfileId: null },
    ];
}

function integrityProfiles(): IntegrityProfile[] {
    return [{ schemaVersion: 1, id: 'crc', name: 'CRC32 over range', checks: [] }];
}

let lastDom: JSDOM | null = null;

suite('FileProfilesPanel', () => {
    setup(() => { installDom(); });
    teardown(() => { lastDom?.window.close(); lastDom = null; });

    test('mount renders empty state with disabled selector', () => {
        const select = document.getElementById('fp-select') as HTMLSelectElement;
        assert.ok(select);
        assert.strictEqual(select.disabled, true, 'no profile list → selector disabled');
        assert.strictEqual(select.options.length, 1, 'only the None option');
        assert.ok(document.querySelector('.sb-empty'), 'empty-state hint rendered');
        assert.ok(document.querySelector('#fp-save-as'), 'Save as button present');
    });

    test('mount is idempotent (re-mount renders once)', () => {
        const panel = new FileProfilesPanel({
            onSelect: () => {},
            onCreate: () => {},
            onRename: () => {},
            onDelete: () => {},
            getPins: () => [],
            getEndian: () => 'le',
        });
        panel.mount(document.getElementById('host')!);
        assert.strictEqual(document.querySelectorAll('.sb-section-head').length, 1);
    });

    test('setProfiles renders the list with active selection + hint', () => {
        const panel = newFileProfilesPanel();
        panel.setProfiles(profiles(), 'p1', integrityProfiles());

        const select = document.getElementById('fp-select') as HTMLSelectElement;
        assert.strictEqual(select.disabled, false);
        assert.strictEqual(select.options.length, 3);
        assert.strictEqual(select.value, 'p1');
        const bootOption = select.querySelector('option[value="p1"]');
        assert.ok(bootOption?.textContent?.includes('Bootloader'));
        const hint = document.querySelector('.fp-hint')?.textContent ?? '';
        assert.ok(hint.includes('1 pins'));
        assert.ok(hint.includes('BE'));
        assert.ok(hint.includes('integrity profile'));
    });

    test('selecting an option reports onSelect with the id and None reports null', () => {
        const panel = newFileProfilesPanel();
        panel.setProfiles(profiles(), null, []);
        const cb = lastCb();
        const select = document.getElementById('fp-select') as HTMLSelectElement;

        select.value = 'p2';
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.deepStrictEqual(cb.selects, ['p2']);

        select.value = '';
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.deepStrictEqual(cb.selects, ['p2', null]);
    });

    test('save-as creates a profile from current session snapshot after validation', () => {
        const panel = newFileProfilesPanel();
        panel.setProfiles(profiles(), null, integrityProfiles());
        const cb = lastCb();
        const saveAs = document.getElementById('fp-save-as') as HTMLButtonElement;
        saveAs.click();

        const input = document.getElementById('fp-name') as HTMLInputElement;
        assert.ok(input, 'name form opened');
        const binding = document.getElementById('fp-binding') as HTMLSelectElement;
        assert.strictEqual(binding.options.length, 2, 'integrity binding options present');
        assert.strictEqual(binding.value, '');

        (document.getElementById('fp-confirm') as HTMLButtonElement).click();
        assert.ok(cb.created.length === 0);
        assert.ok((document.getElementById('fp-error') as HTMLElement).textContent?.includes('required'), 'empty name blocked');

        const retriedInput = document.getElementById('fp-name') as HTMLInputElement;
        const retriedBinding = document.getElementById('fp-binding') as HTMLSelectElement;
        retriedInput.value = 'Shared Boot';
        retriedBinding.value = 'crc';
        (document.getElementById('fp-confirm') as HTMLButtonElement).click();
        assert.deepStrictEqual(cb.created, [{ name: 'Shared Boot', integrityProfileId: 'crc' }]);
    });

    test('rename pre-fills the active name and reports onRename', () => {
        const panel = newFileProfilesPanel();
        panel.setProfiles(profiles(), 'p1', []);
        const cb = lastCb();
        (document.getElementById('fp-rename') as HTMLButtonElement).click();

        const input = document.getElementById('fp-name') as HTMLInputElement;
        assert.strictEqual(input.value, 'Bootloader');
        input.value = 'Boot v2';
        (document.getElementById('fp-confirm') as HTMLButtonElement).click();

        assert.deepStrictEqual(cb.renamed, [{ id: 'p1', name: 'Boot v2' }]);
    });

    test('delete shows the confirm popover and reports onDelete on Yes', () => {
        const panel = newFileProfilesPanel();
        panel.setProfiles(profiles(), 'p1', []);
        const cb = lastCb();
        (document.getElementById('fp-delete') as HTMLButtonElement).click();

        const yes = document.querySelector<HTMLButtonElement>('.dcp-yes');
        assert.ok(yes, 'confirm popover rendered');
        yes!.click();
        assert.deepStrictEqual(cb.deleted, ['p1']);
    });

    test('setError renders the error message', () => {
        newFileProfilesPanel().setError('Profile name is invalid.');
        const error = document.getElementById('fp-error');
        assert.ok(error);
        assert.strictEqual(error?.textContent, 'Profile name is invalid.');
    });
});

let harnessCb: Cb | null = null;

function newFileProfilesPanel(): FileProfilesPanel {
    const cb: Cb = { selects: [], created: [], renamed: [], deleted: [], pins: [], endian: 'le' };
    harnessCb = cb;
    const panel = new FileProfilesPanel({
        onSelect: id => cb.selects.push(id),
        onCreate: (name, integrityProfileId) => cb.created.push({ name, integrityProfileId }),
        onRename: (id, name) => cb.renamed.push({ id, name }),
        onDelete: id => cb.deleted.push(id),
        getPins: () => cb.pins,
        getEndian: () => cb.endian,
    });
    panel.mount(document.getElementById('host')!);
    return panel;
}

function lastCb(): Cb {
    assert.ok(harnessCb, 'harness callback recorded');
    return harnessCb!;
}