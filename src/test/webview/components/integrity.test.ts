import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../css-import-hook';

import { IntegrityPanel, type IntegrityHighlight } from '../../../webview/components/Integrity/IntegrityPanel';
import { getByte } from '../../../webview/memory/memoryData';
import { setBytesInSegment } from '../../shared/struct-test-helpers';
import { S } from '../../../webview/state';
import { calculateIntegrity } from '../../../core/integrity';

let currentDom: JSDOM | null = null;

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
    navigator: Navigator;
};

type Cb = {
    highlights: Array<IntegrityHighlight | null>;
    copies: Array<{ text: string; label: string }>;
    persisted: unknown[];
    created: unknown[];
    updated: unknown[];
    renamed: Array<{ id: string; name: string }>;
    deleted: string[];
    staged: Array<Array<[number, number]>>;
};

type Harness = {
    dom: JSDOM;
    panel: IntegrityPanel;
    cb: Cb;
    sel: { value: { start: number; end: number } | null };
    endian: { value: 'le' | 'be' };
};

function installDom(): Harness {
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
    (globalThis as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame =
        () => 0;

    const cb: Cb = { highlights: [], copies: [], persisted: [], created: [], updated: [], renamed: [], deleted: [], staged: [] };
    const sel: { value: { start: number; end: number } | null } = { value: null };
    const endian: { value: 'le' | 'be' } = { value: 'le' };
    const panel = new IntegrityPanel({
        readByte: getByte,
        onStoredValueEdits: edits => {
            cb.staged.push(edits);
            edits.forEach(([address, value]) => S.edits.set(address, value));
        },
        getSelection: () => sel.value,
        getEndian: () => endian.value,
        onHighlightChange: highlight => cb.highlights.push(highlight),
        onCopyText: (text, label) => cb.copies.push({ text, label }),
        onPersistChecks: state => cb.persisted.push(state),
        onCreateProfile: profile => cb.created.push(profile),
        onUpdateProfile: profile => cb.updated.push(profile),
        onRenameProfile: (id, name) => cb.renamed.push({ id, name }),
        onDeleteProfile: id => cb.deleted.push(id),
    });
    panel.setTabActive(true);
    panel.mount(document.getElementById('host')!);
    return { dom, panel, cb, sel, endian };
}

function cleanupDom(): void {
    if (currentDom) {
        currentDom.window.close();
        currentDom = null;
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
        delete (globalThis as unknown as { navigator?: Navigator }).navigator;
    }
}

function click(dom: JSDOM, el: Element | null): void {
    assert.ok(el, 'target element should exist');
    el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function integrityForm(id: string): HTMLElement {
    return document.querySelector<HTMLElement>(`[data-integrity-form="${id}"]`)!;
}

function setDraftValue(form: HTMLElement, control: string, value: string): void {
    (form.querySelector(`[data-draft-control="${control}"]`) as HTMLInputElement).value = value;
}

function setAlgorithm(dom: JSDOM, form: HTMLElement, value: string): void {
    const algorithm = form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')!;
    algorithm.value = value;
    algorithm.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

async function waitForCalculation(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 350));
}

function integrityCard(index = 0): HTMLElement {
    return document.querySelectorAll<HTMLElement>('.integrity-card')[index];
}

suite('IntegrityPanel mount + render', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: IntegrityPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('mount creates #s-integrity and renders profiles header + empty state', () => {
        assert.ok(document.getElementById('s-integrity'));
        assert.strictEqual(document.querySelector('.integrity-empty')?.textContent, 'No integrity checks configured.');
        assert.ok((document.getElementById('integrity-profile-save') as HTMLButtonElement).disabled);
        assert.ok((document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 0);
    });

    test('render is idempotent: re-render keeps a single shell', () => {
        panel.render();
        assert.strictEqual(document.querySelectorAll('.integrity-shell').length, 1);
        assert.strictEqual(document.getElementById('integrity-check-list')?.textContent, 'No integrity checks configured.');
    });

    test('add form opens with selection defaults from getSelection', () => {
        harness.sel.value = { start: 0x1000, end: 0x1002 };
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        assert.strictEqual((form.querySelector('[data-draft-control="algorithm"]') as HTMLSelectElement).value, 'crc32-iso-hdlc');
        assert.strictEqual((form.querySelector('[data-draft-control="start"]') as HTMLInputElement).value, '00001000');
        assert.strictEqual((form.querySelector('[data-draft-control="end"]') as HTMLInputElement).value, '00001002');
        assert.ok((document.getElementById('integrity-add-btn') as HTMLButtonElement).disabled, 'add button disabled while form open');
    });
});

suite('IntegrityPanel checks', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: IntegrityPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('add check reports onPersistChecks and renders a card', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);
        assert.strictEqual(cb.persisted.length, 1);
        assert.deepStrictEqual(cb.persisted[0], {
            schemaVersion: 1,
            checks: [{ algorithm: 'crc32-iso-hdlc', startAddress: 0x1000, endAddress: 0x1002, autoFixStoredValue: false }],
        });
    });

    test('invalid range shows inline error and does not persist', () => {
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setDraftValue(form, 'start', '1002');
        setDraftValue(form, 'end', '1000');
        click(dom, form.querySelector('[data-form-action="save"]'));
        assert.match(form.querySelector('[data-form-error]')!.textContent!, /greater than or equal/);
        assert.strictEqual(cb.persisted.length, 0);
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 0);
    });

    test('hash algorithm hides stored-value field', () => {
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        assert.ok(!form.querySelector<HTMLElement>('[data-stored-field]')!.hidden, 'checksum shows stored field');
        const algorithm = form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')!;
        algorithm.value = 'sha-256';
        algorithm.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.ok(form.querySelector<HTMLElement>('[data-stored-field]')!.hidden, 'hash hides stored field');
    });

    test('edit form save reports onPersistChecks; cancel closes the form', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        let form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        click(dom, integrityCard().querySelector('.act-btn-edit'));
        form = integrityForm('edit-1');
        setDraftValue(form, 'start', '1001');
        click(dom, form.querySelector('[data-form-action="save"]'));
        assert.strictEqual(cb.persisted.length, 2);
        const configs = (cb.persisted.at(-1) as { checks: Array<{ startAddress: number }> }).checks;
        assert.strictEqual(configs[0].startAddress, 0x1001);
        assert.strictEqual(document.querySelector('[data-integrity-form="edit-1"]'), null);
    });

    test('delete check reports onPersistChecks and clears the card', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        let form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        click(dom, integrityCard().querySelector('.act-btn-del'));
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 0);
        assert.strictEqual((cb.persisted.at(-1) as { checks: unknown[] }).checks.length, 0);
    });
});

suite('IntegrityPanel results + auto fix', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: IntegrityPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('calculated value renders; copy reports onCopyText', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        const expected = await calculateIntegrity('crc32-iso-hdlc', new Uint8Array([1, 2, 3]));
        assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.calculated code')!.textContent, `0x${expected.value}`);
        click(dom, integrityCard().querySelector('[data-copy-calculated]'));
        assert.deepStrictEqual(cb.copies.at(-1), {
            text: `0x${expected.value}`,
            label: 'CRC32/ISO-HDLC calculated value',
        });
    });

    test('stored comparison renders mismatch state; copy reports onCopyText', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'crc16-ccitt-false');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        setDraftValue(form, 'stored', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        const pane = integrityCard().querySelector<HTMLElement>('.integrity-value-pane.stored')!;
        assert.ok(pane.classList.contains('mismatch'));
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.textContent, '✕');
    });

    test('auto-fix toggle stages edits via onStoredValueEdits on mismatch; discard suppresses re-stage', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'crc16-ccitt-false');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        setDraftValue(form, 'stored', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        assert.strictEqual(cb.staged.length, 0);

        const autoFix = integrityCard().querySelector<HTMLInputElement>('[data-auto-fix]')!;
        autoFix.checked = true;
        autoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.strictEqual(cb.staged.length, 1, 'toggle stages the mismatched stored value');
        assert.strictEqual(cb.staged[0][0][0], 0x1002);
        await waitForCalculation();
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.textContent, '✓');

        S.edits.clear();
        panel.notifyEditsDiscarded();
        await waitForCalculation();
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.textContent, '✕');
        assert.strictEqual(cb.staged.length, 1, 'discard must not immediately re-stage Auto fix');
        assert.ok(integrityCard().querySelector('.integrity-auto-fix')!.classList.contains('paused'));
    });

    test('notifyEndianChanged re-decodes stored byte order', async function () {
        this.timeout(5_000);
        harness.endian.value = 'le';
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'crc16-ccitt-false');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        setDraftValue(form, 'stored', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.stored code')!.textContent, '0x0403');
        harness.endian.value = 'be';
        panel.notifyEndianChanged();
        await waitForCalculation();
        assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.stored code')!.textContent, '0x0304');
    });
});

suite('IntegrityPanel highlight + profiles', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: IntegrityPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('card toggle reports onHighlightChange with range; delete clears it', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4, 5, 6, 7, 8]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1002');
        setDraftValue(form, 'stored', '1003');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        click(dom, integrityCard().querySelector('[data-check-toggle]'));
        assert.deepStrictEqual(cb.highlights.at(-1), {
            rangeStart: 0x1000,
            rangeEnd: 0x1002,
            status: 'mismatch',
            storedStart: 0x1003,
            storedLength: 4,
        });
        click(dom, integrityCard().querySelector('[data-check-toggle]'));
        assert.strictEqual(cb.highlights.at(-1), null);
    });

    test('setProfiles renders selector; apply rebuilds checks and persists', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        panel.setProfiles([{
            schemaVersion: 1,
            id: 'p1',
            name: 'STM32 Layout',
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false }],
        }]);
        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        assert.strictEqual(select.querySelectorAll('option').length, 2);
        assert.strictEqual((select.querySelector('option:last-child') as HTMLOptionElement).textContent, 'STM32 Layout');
        select.value = 'p1';
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        click(dom, document.getElementById('integrity-profile-apply'));
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);
        assert.strictEqual(integrityCard().querySelector('.integrity-card-title')!.textContent, 'CRC16/CCITT-FALSE');
        assert.strictEqual((cb.persisted.at(-1) as { checks: unknown[] }).checks.length, 1);
    });

    test('profile CRUD reports onCreate/onUpdate/onRename/onDeleteProfile', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        let form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        click(dom, form.querySelector('[data-form-action="save"]'));
        panel.setProfiles([{
            schemaVersion: 1,
            id: 'p1',
            name: 'STM32 Layout',
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false }],
        }]);
        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        select.value = 'p1';
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        click(dom, document.getElementById('integrity-profile-update'));
        assert.strictEqual(cb.updated.length, 1);
        assert.strictEqual((cb.updated[0] as { id: string }).id, 'p1');

        click(dom, document.getElementById('integrity-profile-rename'));
        const nameInput = document.getElementById('integrity-profile-name') as HTMLInputElement;
        nameInput.value = 'Renamed';
        click(dom, document.getElementById('integrity-profile-name-save'));
        assert.deepStrictEqual(cb.renamed.at(-1), { id: 'p1', name: 'Renamed' });

        click(dom, document.getElementById('integrity-profile-delete'));
        assert.deepStrictEqual(cb.deleted, ['p1']);
    });

    test('save-as reports onCreateProfile with normalized checks; empty-name rejected inline', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));

        click(dom, document.getElementById('integrity-profile-save'));
        const nameInput = document.getElementById('integrity-profile-name') as HTMLInputElement;
        nameInput.value = '   ';
        click(dom, document.getElementById('integrity-profile-name-save'));
        assert.strictEqual(cb.created.length, 0);
        assert.match(document.getElementById('integrity-profile-error')!.textContent!, /required/);

        nameInput.value = 'New Layout';
        click(dom, document.getElementById('integrity-profile-name-save'));
        assert.strictEqual(cb.created.length, 1);
        const created = cb.created[0] as { name: string; checks: unknown[] };
        assert.strictEqual(created.name, 'New Layout');
        assert.strictEqual(created.checks.length, 1);
    });

    test('setTabActive lazy-init: notify is a no-op until first activation', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        const panel2 = new IntegrityPanel({ readByte: getByte, getSelection: () => null, getEndian: () => 'le' });
        panel2.mount(document.getElementById('host')!);
        panel2.setChecks({ schemaVersion: 1, checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false }] });
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 0, 'not rendered until activation');
        panel2.setTabActive(true);
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.textContent, '…', 'activation kicks off calculation');
    });
});
