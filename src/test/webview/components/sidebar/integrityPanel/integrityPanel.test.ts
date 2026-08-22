import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../../../cssImportHook';

import { IntegrityPanel, type IntegrityHighlight } from '../../../../../webview/components/sidebar/integrityPanel/integrityPanel';
import { getByte } from '../../../../../webview/memory/memoryData';
import { setBytesInSegment } from '../../../../shared/structTestHelpers';
import { S } from '../../../../../webview/state';
import { calculateIntegrity, integrityValueToBytes } from '../../../../../core/integrity';

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

    test('fresh check without a result renders Not configured status', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        panel.setChecks({ schemaVersion: 1, checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false }] });
        panel.render();
        const status = integrityCard().querySelector<HTMLElement>('[data-check-status]')!;
        assert.strictEqual(status.title, 'Not configured');
        assert.strictEqual(status.textContent, '–');
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

    test('hex-selection change refills add form start + end when start focused', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        const startEl = form.querySelector<HTMLInputElement>('[data-draft-control="start"]')!;
        const endEl = form.querySelector<HTMLInputElement>('[data-draft-control="end"]')!;
        harness.sel.value = { start: 0x2000, end: 0x2004 };
        panel.notifySelectionChanged();
        assert.strictEqual(startEl.value, '00002000');
        assert.strictEqual(endEl.value, '00002004');
    });

    test('hex-selection change fills end only when the end field is focused', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        const startEl = form.querySelector<HTMLInputElement>('[data-draft-control="start"]')!;
        const endEl = form.querySelector<HTMLInputElement>('[data-draft-control="end"]')!;
        startEl.value = '1000';
        endEl.dispatchEvent(new dom.window.Event('focus'));
        harness.sel.value = { start: 0x3000, end: 0x3008 };
        panel.notifySelectionChanged();
        assert.strictEqual(startEl.value, '1000', 'start untouched when end focused');
        assert.strictEqual(endEl.value, '00003008');
    });

    test('hex-selection change with no selection leaves the form untouched', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        const startEl = form.querySelector<HTMLInputElement>('[data-draft-control="start"]')!;
        harness.sel.value = { start: 0x4000, end: 0x4004 };
        panel.notifySelectionChanged();
        harness.sel.value = null;
        panel.notifySelectionChanged();
        assert.strictEqual(startEl.value, '00004000', 'deselect keeps prior fill');
    });

    test('no profiles renders a disabled select; header shows the Profile label', () => {
        panel.setProfiles([]);
        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        assert.strictEqual(select.disabled, true, 'no profiles → select disabled');
        assert.strictEqual(select.querySelectorAll('option').length, 0);
        const label = document.querySelector<HTMLElement>('.integrity-profile-label');
        assert.ok(label, 'Profile header label present');
        assert.strictEqual(label!.textContent, 'Profile');
        assert.strictEqual(document.getElementById('integrity-profile-apply'), null, 'Apply menu item removed');
        assert.match(document.querySelector<HTMLElement>('.integrity-profile-empty')!.textContent!, /Save as/);
        const saveBtn = document.getElementById('integrity-profile-save') as HTMLButtonElement;
        assert.ok(saveBtn, 'Save as… visible next to the ⋮ menu');
    });

    test('cancelling the apply confirm reverts the dropdown to the prior profile', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        const profile = (end: number) => ({
            schemaVersion: 1,
            id: `p${end}`,
            name: `Profile ${end}`,
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: end, autoFixStoredValue: false }],
        });
        panel.setProfiles([profile(0x1001), profile(0x1003)]);
        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        assert.strictEqual(select.value, 'p4097', 'preselect-first picks the first profile');
        panel.checks = [panel.newCheck({ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1002, autoFixStoredValue: false })];
        panel.render();
        const liveSelect = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        liveSelect.value = 'p4099';
        liveSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.ok(document.querySelector('#del-confirm-pop .dcp-no'), 'confirm shown for conflicting apply');
        click(dom, document.querySelector('#del-confirm-pop .dcp-no'));
        assert.strictEqual(liveSelect.value, 'p4097', 'dropdown reverted on cancel');
        assert.strictEqual(cb.persisted.length, 0, 'cancel never persists');
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
        const expectedBytes = integrityValueToBytes((await calculateIntegrity('crc16-ccitt-false', new Uint8Array([1, 2]))).value, 'le');
        assert.deepStrictEqual(cb.staged[0], Array.from(expectedBytes, (byte, offset): [number, number] => [0x1002 + offset, byte]));
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

    test('status circle carries calculating class while pending and clears on result', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        const status = integrityCard().querySelector<HTMLElement>('[data-check-status]')!;
        assert.ok(status.classList.contains('calculating'), 'spinner class while pending');
        assert.strictEqual(status.textContent, '…');
        await waitForCalculation();
        assert.ok(!status.classList.contains('calculating'), 'spinner clears on result');
        assert.strictEqual(status.textContent, '∑');
    });

    test('card status shows mismatch; Fix all clears it', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'crc16-ccitt-false');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        setDraftValue(form, 'stored', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        const headerBadge = document.querySelector<HTMLElement>('#s-integrity .sb-badge')!;
        assert.ok(headerBadge.hidden, 'no header badge');
        await waitForCalculation();
        const status = document.querySelector<HTMLElement>('.integrity-card-status')!;
        assert.strictEqual(status.getAttribute('aria-label'), 'Mismatch');
        click(dom, document.getElementById('integrity-fix-all'));
        assert.strictEqual(document.querySelector<HTMLElement>('.integrity-card-status')!.getAttribute('aria-label'), 'Match');
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

    test('setProfiles renders selector; selecting a profile auto-applies and persists', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        panel.setProfiles([{
            schemaVersion: 1,
            id: 'p1',
            name: 'STM32 Layout',
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false }],
        }]);
        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        assert.strictEqual(select.querySelectorAll('option').length, 1, 'no placeholder option');
        assert.strictEqual((select.querySelector('option:last-child') as HTMLOptionElement).textContent, 'STM32 Layout');
        select.value = 'p1';
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1, 'select change auto-applies');
        assert.strictEqual(integrityCard().querySelector('.integrity-card-title')!.textContent, 'CRC16/CCITT-FALSE');
        assert.strictEqual((cb.persisted.at(-1) as { checks: unknown[] }).checks.length, 1);
        assert.strictEqual(select.disabled, false);
    });

    test('profile CRUD reports onCreate/onUpdate/onRename/onDeleteProfile', async () => {
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
        assert.strictEqual(cb.deleted.length, 0, 'delete waits for the inline confirm');
        const confirmYes = document.querySelector('#del-confirm-pop .dcp-yes');
        assert.ok(confirmYes, 'confirm popover shown');
        click(dom, confirmYes as HTMLElement);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepStrictEqual(cb.deleted, ['p1']);
    });

    test('apply with an open check draft asks for confirmation before replacing checks', async () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        panel.setProfiles([{
            schemaVersion: 1,
            id: 'p1',
            name: 'STM32 Layout',
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false }],
        }]);
        click(dom, document.getElementById('integrity-add-btn')); // opens the add-check form (unsaved draft)

        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        select.value = 'p1';
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.strictEqual(cb.persisted.length, 0, 'no persist before the apply confirm');
        const confirmYes = document.querySelector('#del-confirm-pop .dcp-yes');
        assert.ok(confirmYes, 'apply confirm popover shown');
        click(dom, confirmYes as HTMLElement);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.ok(cb.persisted.length >= 1, 'persisted after confirming apply');
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);
    });

    test('apply over configured checks asks for confirmation when they differ from the profile', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        const check = panel.newCheck({ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1002, autoFixStoredValue: false });
        panel.checks = [check];
        panel.setProfiles([{
            schemaVersion: 1,
            id: 'p1',
            name: 'STM32 Layout',
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false }],
        }]);
        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        select.value = 'p1';
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        select.value = 'p1';
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.strictEqual(cb.persisted.length, 0, 'no persist before the apply confirm');
        const confirmYes = document.querySelector('#del-confirm-pop .dcp-yes');
        assert.ok(confirmYes, 'apply confirm popover shown when current checks differ from the profile');
        click(dom, confirmYes as HTMLElement);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.ok(cb.persisted.length >= 1, 'persisted after confirming apply');
        const persisted = cb.persisted.at(-1) as { checks: Array<{ endAddress: number }> } | undefined;
        assert.ok(persisted, 'apply persisted checks');
        assert.strictEqual(persisted!.checks[0].endAddress, 0x1001, 'profile checks win after confirm');
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

    test('mismatch shows on the mismatching card, not a header badge', async function () {
        this.timeout(5_000);
        S.edits.clear(); // Fix all in earlier tests stages edits; this test needs raw bytes.
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        click(dom, document.getElementById('integrity-add-btn'));
        let form = integrityForm('add');
        setAlgorithm(dom, form, 'crc16-ccitt-false');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        setDraftValue(form, 'stored', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        click(dom, document.getElementById('integrity-add-btn'));
        form = integrityForm('add');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        const headerBadge = document.querySelector<HTMLElement>('#s-integrity .sb-badge')!;
        assert.ok(headerBadge.hidden, 'no header badge');
        const statuses = [...document.querySelectorAll<HTMLElement>('.integrity-card-status')];
        assert.strictEqual(statuses.length, 2);
        assert.ok(statuses.some(s => s.getAttribute('aria-label') === 'Mismatch'));
    });

    test('profile menu opens from ⋮; Escape closes; rename runs through the menu', async () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4]);
        panel.setProfiles([{
            schemaVersion: 1,
            id: 'p1',
            name: 'STM32 Layout',
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false }],
        }]);
        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        select.value = 'p1';
        select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        const menuBtn = document.getElementById('integrity-profile-menu-btn') as HTMLButtonElement;
        const pop = document.getElementById('integrity-profile-menu-pop') as HTMLElement;
        assert.ok(pop.hidden, 'menu closed by default');
        click(dom, menuBtn);
        assert.ok(!pop.hidden, 'menu opens on ⋮ click');
        assert.strictEqual(menuBtn.getAttribute('aria-expanded'), 'true');
        click(dom, menuBtn);
        assert.ok(pop.hidden, 'menu closes on second ⋮ click');
        click(dom, menuBtn);
        click(dom, document.getElementById('integrity-profile-rename'));
        assert.ok(pop.hidden, 'menu closes after item action');
        const nameInput = document.getElementById('integrity-profile-name') as HTMLInputElement;
        assert.strictEqual(nameInput.value, 'STM32 Layout', 'rename form prefilled via menu');
        nameInput.value = 'Renamed';
        click(dom, document.getElementById('integrity-profile-name-save'));
        assert.deepStrictEqual(cb.renamed.at(-1), { id: 'p1', name: 'Renamed' });
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
