import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../../../cssImportHook';

import { IntegrityPanel, type IntegrityHighlight, type IntegrityScriptRunRequest } from '../../../../../webview/components/sidebar/integrityPanel/integrityPanel';
import { getByte } from '../../../../../webview/memory/memoryData';
import { setBytesInSegment } from '../../../overlayStateHelpers';
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
    staged: Array<Array<[number, number]>>;
    scriptRequests: IntegrityScriptRunRequest[];
    openedScripts: string[];
    createdScripts: string[];
    openedFolders: number;
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

    const cb: Cb = { highlights: [], copies: [], persisted: [], staged: [], scriptRequests: [], openedScripts: [], createdScripts: [], openedFolders: 0 };
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
        onScriptCheckRequest: request => cb.scriptRequests.push(request),
        onOpenScript: scriptPath => cb.openedScripts.push(scriptPath),
        onCreateScript: role => cb.createdScripts.push(role),
        onOpenScriptsFolder: () => { cb.openedFolders++; },
        getPendingEdits: () => Array.from(S.edits.entries()),
        getGeneration: () => 1,
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

    test('mount creates #s-integrity and renders the empty state', () => {
        assert.ok(document.getElementById('s-integrity'));
        assert.strictEqual(document.querySelector('.integrity-empty')?.textContent, 'No integrity checks configured.');
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
            checks: [{ kind: 'builtin', algorithm: 'crc32-iso-hdlc', startAddress: 0x1000, endAddress: 0x1002, autoFixStoredValue: false }],
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

    test('hash algorithm keeps stored-value field visible', () => {
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        const storedField = form.querySelector<HTMLElement>('[data-stored-field]')!;
        assert.ok(!storedField.hidden, 'checksum shows stored field');
        const algorithm = form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')!;
        algorithm.value = 'sha-256';
        algorithm.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.ok(!storedField.hidden, 'hash shows stored field');
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

    test('SHA-1 stored values compare and Fix all writes the full digest', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4, ...Array(20).fill(0)]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'sha-1');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1017');
        setDraftValue(form, 'stored', '1004');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        assert.ok(integrityCard().querySelector('.integrity-value-pane.stored')!.classList.contains('mismatch'));
        click(dom, document.getElementById('integrity-fix-all'));
        const expected = integrityValueToBytes((await calculateIntegrity('sha-1', new Uint8Array([1, 2, 3, 4]))).value, 'be');
        assert.deepStrictEqual(cb.staged[0], Array.from(expected, (byte, offset): [number, number] => [0x1004 + offset, byte]));
        assert.strictEqual(cb.staged[0].length, 20);
    });

    test('correct hash digest compares in natural byte order under endian=LE', async function () {
        this.timeout(5_000);
        harness.endian.value = 'le';
        S.edits.clear();
        const digest = (await calculateIntegrity('sha-256', new Uint8Array([1, 2, 3, 4]))).value;
        const digestBytes = integrityValueToBytes(digest, 'be');
        setBytesInSegment(0x1000, [1, 2, 3, 4, ...digestBytes]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'sha-256');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1003');
        setDraftValue(form, 'stored', '1004');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Match');
        assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.stored code')!.textContent, `0x${digest}`);
        assert.strictEqual(cb.staged.length, 0, 'a correct digest must not stage an auto fix');
        const autoFix = integrityCard().querySelector<HTMLInputElement>('[data-auto-fix]')!;
        autoFix.checked = true;
        autoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.strictEqual(cb.staged.length, 0, 'enabling Auto fix on a match must not stage edits');
    });

    test('wrong stored hash mismatches and Auto fix stages natural-order digest bytes', async function () {
        this.timeout(5_000);
        harness.endian.value = 'le';
        S.edits.clear();
        const digest = (await calculateIntegrity('sha-256', new Uint8Array([1, 2, 3, 4]))).value;
        const digestBytes = integrityValueToBytes(digest, 'be');
        setBytesInSegment(0x1000, [1, 2, 3, 4, ...Array(32).fill(0)]);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'sha-256');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1003');
        setDraftValue(form, 'stored', '1004');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        assert.ok(integrityCard().querySelector('.integrity-value-pane.stored')!.classList.contains('mismatch'));
        const autoFix = integrityCard().querySelector<HTMLInputElement>('[data-auto-fix]')!;
        autoFix.checked = true;
        autoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.deepStrictEqual(
            cb.staged[0],
            Array.from(digestBytes, (byte, offset): [number, number] => [0x1004 + offset, byte]),
            'Auto fix writes the digest in natural order (not endian-reversed)',
        );
    });

    test('stored pane endian tag is checksum-only', async function () {
        this.timeout(5_000);
        harness.endian.value = 'le';
        S.edits.clear();
        const digest = (await calculateIntegrity('sha-256', new Uint8Array([1, 2, 3, 4]))).value;
        setBytesInSegment(0x1000, [1, 2, 3, 4, ...integrityValueToBytes(digest, 'be')]);
        click(dom, document.getElementById('integrity-add-btn'));
        let form = integrityForm('add');
        setAlgorithm(dom, form, 'crc16-ccitt-false');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        setDraftValue(form, 'stored', '1002');
        click(dom, form.querySelector('[data-form-action="save"]'));
        await waitForCalculation();
        assert.strictEqual(
            integrityCard(0).querySelector('.integrity-value-pane.stored .integrity-value-hdr span')!.textContent,
            'Stored (LE)',
            'checksum stored pane keeps the endian tag',
        );
        click(dom, document.getElementById('integrity-add-btn'));
        form = integrityForm('add');
        setAlgorithm(dom, form, 'sha-256');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1003');
        setDraftValue(form, 'stored', '1004');
        click(dom, form.querySelector('[data-form-action="save"]'));
        assert.strictEqual(
            integrityCard(1).querySelector('.integrity-value-pane.stored .integrity-value-hdr span')!.textContent,
            'Stored',
            'pending hash stored pane has no endian tag',
        );
        await waitForCalculation();
        assert.strictEqual(
            integrityCard(1).querySelector('.integrity-value-pane.stored .integrity-value-hdr span')!.textContent,
            'Stored',
            'calculated hash stored pane has no endian tag',
        );
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

suite('IntegrityPanel highlight + activation', () => {
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

suite('IntegrityPanel script checks', () => {
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
        S.edits.clear();
    });

    teardown(cleanupDom);

    function loadScriptCheck(overrides: Record<string, unknown> = {}): IntegrityScriptRunRequest {
        panel.setChecks({
            schemaVersion: 1,
            checks: [{
                kind: 'script',
                scriptPath: '.hexscope/scripts/verify.js',
                startAddress: 0x1000,
                endAddress: 0x1001,
                storedAddress: 0x1002,
                autoFixStoredValue: false,
                ...overrides,
            }],
        });
        panel.notifyDocumentOpened();
        return cb.scriptRequests.at(-1)!;
    }

    function settle(
        request: IntegrityScriptRunRequest,
        result?: { valid?: boolean; valueBytes?: number[]; byteCount: number; scriptName: string; warnings?: string[] },
        error?: string,
    ): void {
        panel.acceptScriptResult({
            requestId: request.requestId,
            checkId: request.checkId,
            generation: 1,
            result,
            error,
        });
    }

    test('value-only script compares stored bytes and auto-fixes verbatim', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        const request = loadScriptCheck();
        assert.deepStrictEqual(
            {
                scriptPath: request.scriptPath,
                startAddress: request.startAddress,
                endAddress: request.endAddress,
                storedAddress: request.storedAddress,
                edits: request.edits,
                generation: request.generation,
            },
            {
                scriptPath: '.hexscope/scripts/verify.js',
                startAddress: 0x1000,
                endAddress: 0x1001,
                storedAddress: 0x1002,
                edits: [],
                generation: 1,
            },
        );
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.textContent, '…');

        settle(request, { valueBytes: [0xAA, 0xBB], byteCount: 2, scriptName: 'verify.js' });
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Mismatch');
        assert.strictEqual(
            integrityCard().querySelector('.integrity-value-pane.stored .integrity-value-hdr span')!.textContent,
            'Stored',
            'script stored pane has no endian tag',
        );
        assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.calculated code')!.textContent, '0xAABB');
        assert.strictEqual(integrityCard().querySelector('.integrity-value-hdr span')!.textContent, 'Value');

        const autoFix = integrityCard().querySelector<HTMLInputElement>('[data-auto-fix]')!;
        autoFix.checked = true;
        autoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.deepStrictEqual(cb.staged.at(-1), [[0x1002, 0xAA], [0x1003, 0xBB]]);
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Match');
    });

    test('script range + stored highlight uses the value length', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        const request = loadScriptCheck();
        settle(request, { valueBytes: [0xAA, 0xBB], byteCount: 2, scriptName: 'verify.js' });
        click(dom, integrityCard().querySelector('[data-check-toggle]'));
        assert.deepStrictEqual(cb.highlights.at(-1), {
            rangeStart: 0x1000,
            rangeEnd: 0x1001,
            status: 'mismatch',
            storedStart: 0x1002,
            storedLength: 2,
        });
    });

    test('verify-only script reports pass/fail with no auto-fix', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        const request = loadScriptCheck({ storedAddress: undefined });
        settle(request, { valid: true, byteCount: 2, scriptName: 'verify.js' });
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Verified');
        assert.strictEqual(integrityCard().querySelector('[data-auto-fix]'), null, 'verify-only offers no auto fix');
        assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.calculated code')!.textContent, 'PASS');

        click(dom, integrityCard().querySelector('[data-script-refresh]'));
        const refreshed = cb.scriptRequests.at(-1)!;
        assert.notStrictEqual(refreshed.requestId, request.requestId, 'refresh starts a new run');
        settle(refreshed, { valid: false, byteCount: 2, scriptName: 'verify.js' });
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Failed');
        assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.calculated code')!.textContent, 'FAIL');
    });

    test('both exports: verify decides the status and value bytes drive Fix all', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        const request = loadScriptCheck();
        settle(request, { valid: false, valueBytes: [0xAA, 0xBB], byteCount: 2, scriptName: 'verify.js' });
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Failed');
        assert.ok(!(document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);
        click(dom, document.getElementById('integrity-fix-all'));
        assert.deepStrictEqual(cb.staged.at(-1), [[0x1002, 0xAA], [0x1003, 0xBB]]);

        click(dom, integrityCard().querySelector('[data-script-refresh]'));
        const refreshed = cb.scriptRequests.at(-1)!;
        settle(refreshed, { valid: true, valueBytes: [0xCC, 0xDD], byteCount: 2, scriptName: 'verify.js' });
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Verified');
        assert.ok((document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled, 'a verified check contributes no fix');
    });

    test('byte change marks a settled script result stale; refresh re-runs it', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        const request = loadScriptCheck();
        settle(request, { valueBytes: [0xAA, 0xBB], byteCount: 2, scriptName: 'verify.js' });
        panel.notifyBytesChanged();
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Stale');
        assert.match(integrityCard().querySelector('.integrity-stale-note')!.textContent!, /Stale — refresh/);
        assert.ok((document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled, 'stale results never fix');
        click(dom, integrityCard().querySelector('[data-script-refresh]'));
        assert.strictEqual(cb.scriptRequests.length, 2);
        assert.ok(!integrityCard().querySelector('.integrity-stale-note'), 'refresh clears the stale marker');
    });

    test('a stale generation response is discarded and re-requested', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        const request = loadScriptCheck();
        panel.acceptScriptResult({
            requestId: request.requestId,
            checkId: request.checkId,
            generation: 99,
            result: { valueBytes: [0xAA, 0xBB], byteCount: 2, scriptName: 'verify.js' },
        });
        assert.strictEqual(cb.scriptRequests.length, 2, 'mismatched generation re-runs the check');
        assert.notStrictEqual(cb.scriptRequests[1].requestId, request.requestId);
    });

    test('unknown request ids are ignored', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        loadScriptCheck();
        panel.acceptScriptResult({
            requestId: 999,
            checkId: 1,
            generation: 1,
            result: { valid: true, byteCount: 2, scriptName: 'verify.js' },
        });
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.textContent, '…');
    });

    test('a script failure shows a row-level error and keeps the check configured', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        const request = loadScriptCheck();
        settle(request, undefined, 'Script not found: .hexscope/scripts/verify.js');
        assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Error');
        assert.match(integrityCard().textContent!, /Script not found/);
        assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);
    });

    test('open-script action reports the configured script path', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        loadScriptCheck();
        click(dom, integrityCard().querySelector('[data-script-open]'));
        assert.deepStrictEqual(cb.openedScripts, ['.hexscope/scripts/verify.js']);
    });

    test('script request carries pending edits', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        S.edits.set(0x1000, 0xFF);
        const request = loadScriptCheck();
        assert.deepStrictEqual(request.edits, [[0x1000, 0xFF]]);
    });

    test('stored length from a previous value result feeds the next request context', () => {
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0]);
        const request = loadScriptCheck();
        settle(request, { valueBytes: [0xAA, 0xBB], byteCount: 2, scriptName: 'verify.js' });
        click(dom, integrityCard().querySelector('[data-script-refresh]'));
        assert.strictEqual(cb.scriptRequests.at(-1)!.storedLength, 2);
    });

    test('add form switches to the script picker and persists the relative path', () => {
        panel.setAvailableScripts([
            { name: 'verify.js', relativePath: '.hexscope/scripts/verify.js', roles: ['integrity'] },
            { name: 'other.js', relativePath: '.hexscope/scripts/other.js', roles: ['address'] },
        ], true);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        const scriptField = form.querySelector<HTMLElement>('[data-script-field]')!;
        assert.ok(scriptField.hidden, 'script field starts hidden');
        setAlgorithm(dom, form, 'script');
        assert.ok(!scriptField.hidden, 'script kind reveals the picker');
        const picker = form.querySelector<HTMLSelectElement>('[data-draft-control="script-pick"]')!;
        assert.deepStrictEqual(
            [...picker.options].map(option => option.value),
            ['', '.hexscope/scripts/verify.js'],
            'only scripts tagged @script integrity are listed',
        );
        picker.value = '.hexscope/scripts/verify.js';
        picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        click(dom, form.querySelector('[data-form-action="save"]'));
        assert.deepStrictEqual((cb.persisted.at(-1) as { checks: unknown[] }).checks[0], {
            kind: 'script',
            scriptPath: '.hexscope/scripts/verify.js',
            startAddress: 0x1000,
            endAddress: 0x1001,
            autoFixStoredValue: false,
        });
    });

    test('script kind without a path shows an inline error and does not persist', () => {
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'script');
        setDraftValue(form, 'start', '1000');
        setDraftValue(form, 'end', '1001');
        click(dom, form.querySelector('[data-form-action="save"]'));
        assert.match(form.querySelector('[data-form-error]')!.textContent!, /Script path is required/);
        assert.strictEqual(cb.persisted.length, 0);
    });

    test('an empty script picker offers Create and Open scripts folder instead of a dead option', () => {
        panel.setAvailableScripts([], true);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'script');

        const picker = form.querySelector<HTMLSelectElement>('[data-draft-control="script-pick"]')!;
        assert.ok([...picker.options].every(option => option.disabled), 'the placeholder is not selectable');
        const create = form.querySelector<HTMLElement>('[data-create-script]')!;
        const openFolder = form.querySelector<HTMLElement>('[data-open-scripts-folder]')!;
        assert.ok(create, 'empty picker exposes the create action');
        assert.strictEqual(create.dataset.createScript, 'integrity');
        assert.strictEqual(create.textContent?.trim(), 'Create integrity script');
        assert.strictEqual(openFolder.textContent?.trim(), 'Open scripts folder');
        assert.match(form.querySelector('.integrity-script-hint')!.textContent!, /Create one/);

        cb.createdScripts = [];
        click(dom, create);
        assert.deepStrictEqual(cb.createdScripts, ['integrity']);
        cb.openedFolders = 0;
        click(dom, openFolder);
        assert.strictEqual(cb.openedFolders, 1);
    });

    test('the empty-picker actions disappear once a matching script exists', () => {
        panel.setAvailableScripts([
            { name: 'verify.js', relativePath: '.hexscope/scripts/verify.js', roles: ['integrity'] },
        ], true);
        click(dom, document.getElementById('integrity-add-btn'));
        const form = integrityForm('add');
        setAlgorithm(dom, form, 'script');
        assert.strictEqual(form.querySelector('[data-create-script]'), null);
        assert.strictEqual(form.querySelector('[data-open-scripts-folder]'), null);
        const picker = form.querySelector<HTMLSelectElement>('[data-draft-control="script-pick"]')!;
        assert.deepStrictEqual([...picker.options].map(option => option.value), ['', '.hexscope/scripts/verify.js']);
    });

    test('Fix all merges a script fix with a built-in fix', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0, 0, 0]);
        panel.setChecks({
            schemaVersion: 1,
            checks: [
                {
                    kind: 'builtin', algorithm: 'crc16-ccitt-false',
                    startAddress: 0x1000, endAddress: 0x1001, storedAddress: 0x1002, autoFixStoredValue: false,
                },
                {
                    kind: 'script', scriptPath: '.hexscope/scripts/verify.js',
                    startAddress: 0x1000, endAddress: 0x1001, storedAddress: 0x1004, autoFixStoredValue: false,
                },
            ],
        });
        panel.notifyDocumentOpened();
        const request = cb.scriptRequests.at(-1)!;
        settle(request, { valueBytes: [0xAA, 0xBB], byteCount: 2, scriptName: 'verify.js' });
        await waitForCalculation();
        click(dom, document.getElementById('integrity-fix-all'));
        const staged = cb.staged.at(-1)!;
        assert.deepStrictEqual(staged.filter(([address]) => address < 0x1004).length, 2, 'built-in fix bytes staged');
        assert.deepStrictEqual(staged.filter(([address]) => address >= 0x1004), [[0x1004, 0xAA], [0x1005, 0xBB]]);
    });

    test('Fix all refuses conflicting script and built-in values atomically', async function () {
        this.timeout(5_000);
        setBytesInSegment(0x1000, [1, 2, 3, 4, 0, 0, 0, 0]);
        panel.setChecks({
            schemaVersion: 1,
            checks: [
                {
                    kind: 'builtin', algorithm: 'crc16-ccitt-false',
                    startAddress: 0x1000, endAddress: 0x1001, storedAddress: 0x1002, autoFixStoredValue: false,
                },
                {
                    kind: 'script', scriptPath: '.hexscope/scripts/verify.js',
                    startAddress: 0x1000, endAddress: 0x1001, storedAddress: 0x1002, autoFixStoredValue: false,
                },
            ],
        });
        panel.notifyDocumentOpened();
        const request = cb.scriptRequests.at(-1)!;
        settle(request, { valueBytes: [0xAA, 0xBB], byteCount: 2, scriptName: 'verify.js' });
        await waitForCalculation();
        const stagedBefore = cb.staged.length;
        click(dom, document.getElementById('integrity-fix-all'));
        assert.strictEqual(cb.staged.length, stagedBefore, 'a conflict applies no edits');
        assert.match(document.getElementById('integrity-action-error')!.textContent!, /Fix all conflict at 0x00001002/);
    });
});