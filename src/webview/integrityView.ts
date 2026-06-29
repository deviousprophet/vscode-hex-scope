import { vscode } from './api';
import { getByte } from './data';
import {
    calculateIntegrity,
    collectIntegrityBytes,
    formatIntegrityAddress,
    integrityBytesEqual,
    integrityBytesToHex,
    integrityBytesToValueHex,
    integrityValueToBytes,
    isChecksumAlgorithm,
    mergeIntegrityEdits,
    normalizeIntegrityCheckSet,
    normalizeIntegrityProfiles,
    parseIntegrityAddress,
    readStoredIntegrityBytes,
    type IntegrityAlgorithm,
    type IntegrityCheckConfig,
    type IntegrityCheckSet,
    type IntegrityProfile,
    type IntegrityRequest,
    type IntegrityResult,
    type IntegrityStoredField,
    validateIntegrityRange,
} from '../core/integrity';
import { S } from './state';
import { rerender } from './render';
import { actionBtnsHtml, esc, formatHexHtml } from './utils';

const DEBOUNCE_MS = 250;
const ALGORITHM_LABELS: ReadonlyArray<readonly [IntegrityAlgorithm, string]> = [
    ['crc16-ccitt-false', 'CRC16/CCITT-FALSE'],
    ['crc32-iso-hdlc', 'CRC32/ISO-HDLC'],
    ['md5', 'MD5'],
    ['sha-1', 'SHA-1'],
    ['sha-256', 'SHA-256'],
    ['sha-512', 'SHA-512'],
];
const EMPTY_INTEGRITY_CHECK_SET: IntegrityCheckSet = { schemaVersion: 1, checks: [] };
const INTEGRITY_STATUS_SYMBOLS: Record<string, string> = {
    Match: '✓', Mismatch: '✕', Calculated: '∑', Calculating: '…', Error: '!', 'Not configured': '?',
};

interface IntegrityCheckState {
    id: number;
    algorithm: IntegrityAlgorithm;
    startRaw: string;
    endRaw: string;
    storedRaw: string;
    autoFixStoredValue: boolean;
    result: IntegrityResult | null;
    expectedBytes: Uint8Array | null;
    storedBytes: Uint8Array | null;
    error: string;
    meta: string;
    calculating: boolean;
    suppressAutoFixOnNextResult: boolean;
    suppressedAutoFixMismatch: string;
    timer: number | null;
    token: number;
}

interface IntegrityDraft {
    algorithm: IntegrityAlgorithm;
    startRaw: string;
    endRaw: string;
    storedRaw: string;
}

type PreparedCheck = { request: IntegrityRequest; storedField?: IntegrityStoredField };
type IntegrityEditHandler = (edits: Array<[number, number]>) => void;
type DraftValidation = { ok: true; value: IntegrityDraft } | { ok: false; error: string };
type StoredDraftValidation = { ok: true; value: string } | { ok: false; error: string };

let nextCheckId = 1;
let editHandler: IntegrityEditHandler = () => {};
let profiles: IntegrityProfile[] = [];
let selectedProfileId = '';
let profileError = '';
let actionError = '';
let profileNameMode: 'create' | 'rename' | null = null;
let addCheckDraft: IntegrityDraft | null = null;
let editingCheckId: number | null = null;
let highlightedCheckId: number | null = null;

const integrityState = {
    initialized: false,
    checks: [] as IntegrityCheckState[],
};

function newCheck(config?: IntegrityCheckConfig): IntegrityCheckState {
    const draft = config ? draftFromConfig(config) : blankDraft();
    return {
        id: nextCheckId++,
        ...draft,
        autoFixStoredValue: config?.autoFixStoredValue ?? false,
        result: null,
        expectedBytes: null,
        storedBytes: null,
        error: '',
        meta: '',
        calculating: false,
        suppressAutoFixOnNextResult: false,
        suppressedAutoFixMismatch: '',
        timer: null,
        token: 0,
    };
}

function blankDraft(): IntegrityDraft {
    return { algorithm: 'crc32-iso-hdlc', startRaw: '', endRaw: '', storedRaw: '' };
}

function addDraft(): IntegrityDraft {
    const draft = blankDraft();
    if (S.selStart !== null) { draft.startRaw = formatIntegrityAddress(S.selStart); }
    if (S.selEnd !== null) { draft.endRaw = formatIntegrityAddress(S.selEnd); }
    return draft;
}

function draftFromConfig(config: IntegrityCheckConfig): IntegrityDraft {
    return {
        algorithm: config.algorithm,
        startRaw: formatIntegrityAddress(config.startAddress),
        endRaw: formatIntegrityAddress(config.endAddress),
        storedRaw: config.storedAddress === undefined ? '' : formatIntegrityAddress(config.storedAddress),
    };
}

export function setIntegrityEditHandler(handler: IntegrityEditHandler): void {
    editHandler = handler;
}

export function setIntegrityProfiles(value: unknown, error = ''): void {
    const payload = integrityInitPayload(value);
    profiles = normalizeIntegrityProfiles(integrityProfileValues(payload, value));
    restoreIntegrityChecks(payload);
    profileError = error;
    clearMissingSelectedProfile();
    refreshProfilesIfRendered();
}

function integrityProfileValues(payload: ReturnType<typeof integrityInitPayload>, fallback: unknown): unknown {
    return payload ? payload.profiles : fallback;
}

function restoreIntegrityChecks(payload: ReturnType<typeof integrityInitPayload>): void {
    if (payload) { setIntegrityChecks(payload.activeChecks); }
}

function clearMissingSelectedProfile(): void {
    if (!selectedProfileId) { return; }
    if (!profiles.some(profile => profile.id === selectedProfileId)) { selectedProfileId = ''; }
}

function refreshProfilesIfRendered(): void {
    if (document.getElementById('s-integrity')) { refreshProfileLibrary(); }
}

function integrityInitPayload(value: unknown): { profiles: unknown; activeChecks: unknown } | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { return null; }
    const payload = value as { profiles?: unknown; activeChecks?: unknown };
    return { profiles: payload.profiles, activeChecks: payload.activeChecks };
}

export function setIntegrityChecks(value: unknown): void {
    const saved = normalizedIntegrityCheckSet(value);
    cancelIntegrityCalculations();
    integrityState.checks = saved.checks.map(newCheck);
    addCheckDraft = null;
    editingCheckId = null;
    highlightedCheckId = null;
    clearIntegrityHighlight();
}

function normalizedIntegrityCheckSet(value: unknown): IntegrityCheckSet {
    return normalizeIntegrityCheckSet(value) ?? EMPTY_INTEGRITY_CHECK_SET;
}

function cancelIntegrityCalculations(): void {
    integrityState.checks.forEach(cancelPendingCalculation);
}

function refreshProfileLibrary(): void {
    const current = document.querySelector<HTMLElement>('.integrity-profiles');
    if (!current) { renderIntegrity(); return; }
    current.outerHTML = profileLibraryHtml();
    wireProfileControls();
}

export function renderIntegrity(): void {
    const panel = document.getElementById('s-integrity');
    if (!panel) { return; }
    panel.innerHTML = integrityShellHtml();
    wireRenderedIntegrity(panel);
}

function integrityShellHtml(): string {
    return `
        <div class="integrity-shell">
            <div class="si-hdr-row integrity-hdr-row">
                <span class="sb-hdr" style="margin:0">Integrity Checks ${integrityBadgeHtml()}</span>
                <button id="integrity-fix-all" class="struct-btn struct-btn-apply" type="button"${fixAllDisabledAttr()}>Fix all</button>
                <button id="integrity-add-btn" class="si-add-btn"${addCheckDisabledAttr()}>＋ Add</button>
            </div>
            <div id="integrity-action-error" class="integrity-error" role="alert">${esc(actionError)}</div>
            ${profileLibraryHtml()}
            ${addCheckFormHtml()}
            <div id="integrity-check-list">${checkCardsHtml()}</div>
        </div>`;
}

function fixAllDisabledAttr(): string {
    return hasFixableMismatches() ? '' : ' disabled';
}

function addCheckDisabledAttr(): string {
    return addCheckDraft ? ' disabled' : '';
}

function wireRenderedIntegrity(panel: HTMLElement): void {
    wireHeaderControls();
    wireProfileControls();
    if (addCheckDraft) { wireCheckForm('add'); }
    wireCheckCards(panel);
    integrityState.checks.forEach(updateCheckCard);
}

function integrityBadgeHtml(): string {
    return integrityState.checks.length > 0 ? `<span class="sb-badge">${integrityState.checks.length}</span>` : '';
}

function addCheckFormHtml(): string {
    return addCheckDraft ? checkFormHtml('add', addCheckDraft) : '';
}

function checkCardsHtml(): string {
    if (integrityState.checks.length === 0) {
        return '<div class="sb-empty integrity-empty">No integrity checks configured.</div>';
    }
    return integrityState.checks.map(checkCardHtml).join('');
}

function profileLibraryHtml(): string {
    const options = profiles.map(profile =>
        `<option value="${esc(profile.id)}"${profile.id === selectedProfileId ? ' selected' : ''}>${esc(profile.name)}</option>`
    ).join('');
    return `
        <div class="integrity-profiles">
            <select id="integrity-profile-select" class="struct-sel" title="Saved integrity profile">
                <option value="">Saved profiles…</option>${options}
            </select>
            <div class="integrity-profile-actions">
                <button id="integrity-profile-apply" class="struct-btn struct-btn-apply" type="button">Apply</button>
                <button id="integrity-profile-save" class="struct-btn struct-btn-secondary" type="button">Save as</button>
                <button id="integrity-profile-update" class="si-icon-btn" title="Update profile" type="button">↻</button>
                <button id="integrity-profile-rename" class="si-icon-btn" title="Rename profile" type="button">✎</button>
                <button id="integrity-profile-delete" class="si-icon-btn" title="Delete profile" type="button">🗑︎</button>
            </div>
            ${profileNameFormHtml()}
            <div id="integrity-profile-error" class="integrity-error" role="alert">${esc(profileError)}</div>
        </div>`;
}

function profileNameFormHtml(): string {
    if (!profileNameMode) { return ''; }
    return `<div class="integrity-profile-name-form">
        <input id="integrity-profile-name" class="struct-addr-inp" type="text" maxlength="80"
            value="${esc(profileNameValue())}" placeholder="Profile name" autocomplete="off" spellcheck="false">
        <button id="integrity-profile-name-save" class="struct-btn struct-btn-apply" type="button">${profileNameAction()}</button>
        <button id="integrity-profile-name-cancel" class="struct-btn struct-btn-cancel" type="button">Cancel</button>
    </div>`;
}

function profileNameValue(): string {
    if (profileNameMode !== 'rename') { return ''; }
    return profiles.find(profile => profile.id === selectedProfileId)?.name ?? '';
}

function profileNameAction(): string {
    return profileNameMode === 'rename' ? 'Rename' : 'Save';
}

function checkCardHtml(check: IntegrityCheckState): string {
    return `
        <div class="${checkCardClass(check.id)}" data-check-id="${check.id}">
            <div class="si-card-hdr" data-check-toggle>
                <span class="integrity-card-status" data-check-status></span>
                <div class="integrity-card-info">
                    <div class="integrity-card-title">${esc(algorithmLabel(check.algorithm))}</div>
                    <div class="integrity-card-meta">${esc(checkRangeSummary(check))}</div>
                </div>
                ${actionBtnsHtml(`data-check-id="${check.id}"`, `data-check-id="${check.id}"`)}
            </div>
            ${checkCardBodyHtml(check)}
        </div>`;
}

function checkCardClass(id: number): string {
    const selected = highlightedCheckId === id ? ' integrity-card-selected' : '';
    return `si-card integrity-card si-expanded${selected}`;
}

function autoFixToggleHtml(check: IntegrityCheckState): string {
    const checked = check.autoFixStoredValue ? ' checked' : '';
    const paused = isAutoFixSuppressed(check);
    const title = paused
        ? 'Auto fix paused for this discarded mismatch. Toggle off and on or use Fix all to re-apply.'
        : 'Automatically stage mismatched stored values';
    return `<label class="integrity-auto-fix${paused ? ' paused' : ''}" title="${title}">
        <input type="checkbox" data-auto-fix data-check-id="${check.id}"${checked}>
        <span class="integrity-auto-fix-label">Auto fix</span>
        <span class="integrity-auto-fix-track" aria-hidden="true"><span class="integrity-auto-fix-knob"></span></span>
    </label>`;
}

function isMismatchedCheck(check: IntegrityCheckState): boolean {
    return !check.calculating && hasComparableStoredValue(check) &&
        !integrityBytesEqual(check.expectedBytes, check.storedBytes);
}

function checkCardBodyHtml(check: IntegrityCheckState): string {
    if (editingCheckId === check.id) { return checkFormHtml(`edit-${check.id}`, draftFromCheck(check)); }
    return '<div class="integrity-card-body" data-check-body></div>';
}

function checkFormHtml(formId: string, draft: IntegrityDraft): string {
    const presentation = checkFormPresentation(formId);
    return `
        <div class="integrity-check-form ${presentation.formClass}" data-integrity-form="${formId}">
            <div class="sa-form-hdr ${presentation.headerClass}">${presentation.title}</div>
            <label class="integrity-form-field"><span>Algorithm</span>
                <select data-draft-control="algorithm" class="struct-sel">${algorithmOptionsHtml(draft.algorithm)}</select>
            </label>
            <div class="integrity-form-grid">
                ${addressInputHtml('Start address', 'start', draft.startRaw, '08000000')}
                ${addressInputHtml('End address (inclusive)', 'end', draft.endRaw, '080000FF')}
            </div>
            <div data-stored-field${isChecksumAlgorithm(draft.algorithm) ? '' : ' hidden'}>
                ${addressInputHtml('Stored value address (optional)', 'stored', draft.storedRaw, '08000100')}
            </div>
            <div class="integrity-form-error" data-form-error></div>
            <div class="sa-row sa-btn-row">
                <button class="struct-btn struct-btn-apply" data-form-action="save">${presentation.saveLabel}</button>
                <button class="struct-btn struct-btn-cancel" data-form-action="cancel">Cancel</button>
            </div>
        </div>`;
}

function checkFormPresentation(formId: string): {
    formClass: string;
    headerClass: string;
    title: string;
    saveLabel: string;
} {
    if (formId === 'add') {
        return { formClass: 'integrity-add-form', headerClass: 'sa-form-hdr-new', title: '＋ New Check', saveLabel: 'Add' };
    }
    return { formClass: 'integrity-edit-form', headerClass: 'sa-form-hdr-edit', title: '✎ Edit Check', saveLabel: 'Save' };
}

function addressInputHtml(label: string, control: string, value: string, placeholder: string): string {
    return `
        <label class="integrity-form-field"><span>${label}</span>
            <div class="integrity-address-input"><span class="struct-addr-pfx">0x</span>
                <input data-draft-control="${control}" class="struct-addr-inp" type="text" maxlength="8"
                    placeholder="${placeholder}" value="${esc(stripHexPrefix(value))}" autocomplete="off" spellcheck="false">
            </div>
        </label>`;
}

function algorithmOptionsHtml(selected: IntegrityAlgorithm): string {
    return ALGORITHM_LABELS.map(([value, label]) =>
        `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
}

function stripHexPrefix(value: string): string {
    return value.replace(/^0x/i, '');
}

function draftFromCheck(check: IntegrityCheckState): IntegrityDraft {
    return { algorithm: check.algorithm, startRaw: check.startRaw, endRaw: check.endRaw, storedRaw: check.storedRaw };
}

function algorithmLabel(algorithm: IntegrityAlgorithm): string {
    return ALGORITHM_LABELS.find(([value]) => value === algorithm)?.[1] ?? algorithm;
}

function checkRangeSummary(check: IntegrityCheckState): string {
    const range = check.startRaw && check.endRaw ? `${check.startRaw}–${check.endRaw}` : 'Not configured';
    return check.storedRaw ? `${range} · stored ${check.storedRaw}` : range;
}

export function activateIntegrity(): void {
    if (integrityState.initialized) { return; }
    integrityState.initialized = true;
    renderIntegrity();
    integrityState.checks.forEach(check => scheduleIntegrityCalculation(check));
}

function selectedIntegrityRange(): { start: number; end: number } | null {
    if (S.selStart === null) { return null; }
    if (S.selEnd === null) { return null; }
    return { start: S.selStart, end: S.selEnd };
}

export function notifyIntegrityBytesChanged(): void {
    if (integrityState.initialized) {
        integrityState.checks.forEach(check => scheduleIntegrityCalculation(check, true));
    }
}

export function notifyIntegrityEditsDiscarded(): void {
    if (!integrityState.initialized) { return; }
    for (const check of integrityState.checks) {
        check.suppressAutoFixOnNextResult = check.autoFixStoredValue && !!check.storedRaw;
        scheduleIntegrityCalculation(check, true);
    }
}

function wireHeaderControls(): void {
    document.getElementById('integrity-fix-all')?.addEventListener('click', fixAllMismatches);
    document.getElementById('integrity-add-btn')?.addEventListener('click', () => {
        addCheckDraft = addDraft();
        editingCheckId = null;
        renderIntegrity();
        document.querySelector<HTMLInputElement>('[data-integrity-form="add"] [data-draft-control="start"]')?.focus();
    });
}

export function notifyIntegrityEndianChanged(): void {
    integrityState.checks.forEach(clearAutoFixSuppression);
    renderIntegrity();
    integrityState.checks.forEach(check => scheduleIntegrityCalculation(check, true));
}

function wireCheckCards(panel: HTMLElement): void {
    panel.querySelectorAll<HTMLElement>('[data-check-toggle]').forEach(header => {
        header.addEventListener('click', event => {
            if ((event.target as HTMLElement).closest('.act-btn, .integrity-auto-fix')) { return; }
            const card = header.closest<HTMLElement>('[data-check-id]');
            if (!card || editingCheckId === Number(card.dataset.checkId)) { return; }
            toggleHighlightedCheck(Number(card.dataset.checkId));
        });
    });
    panel.addEventListener('change', event => {
        const toggle = (event.target as HTMLElement).closest<HTMLInputElement>('[data-auto-fix]');
        if (toggle) { setAutoFix(Number(toggle.dataset.checkId), toggle.checked); }
    });
    panel.querySelectorAll<HTMLElement>('.integrity-card .act-btn-edit').forEach(button => {
        button.addEventListener('click', () => editCheck(Number(button.dataset.checkId)));
    });
    panel.querySelectorAll<HTMLElement>('.integrity-card .act-btn-del').forEach(button => {
        button.addEventListener('click', () => deleteCheck(Number(button.dataset.checkId)));
    });
    panel.addEventListener('click', copyCalculatedValue);
    if (editingCheckId !== null) { wireCheckForm(`edit-${editingCheckId}`); }
}

function copyCalculatedValue(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-copy-calculated]');
    if (!button) { return; }
    const check = integrityState.checks.find(item => item.id === Number(button.dataset.checkId));
    if (!check?.result) { return; }
    const display = calculatedDisplay(check.result);
    vscode.postMessage({
        type: 'copyText',
        text: `0x${display.value}`,
        label: `${algorithmLabel(check.algorithm)} calculated value`,
    });
}

function toggleHighlightedCheck(id: number): void {
    if (highlightedCheckId === id) { clearHighlightedCheck(); }
    else { highlightedCheckId = id; }
    renderIntegrity();
    syncIntegrityHighlight();
}

function editCheck(id: number): void {
    addCheckDraft = null;
    editingCheckId = id;
    renderIntegrity();
}

function deleteCheck(id: number): void {
    const check = integrityState.checks.find(item => item.id === id);
    if (check) { cancelPendingCalculation(check); }
    integrityState.checks = integrityState.checks.filter(item => item.id !== id);
    if (editingCheckId === id) { editingCheckId = null; }
    if (highlightedCheckId === id) { clearHighlightedCheck(); }
    persistIntegrityChecks();
    renderIntegrity();
}

function setAutoFix(id: number, enabled: boolean): void {
    const check = integrityState.checks.find(item => item.id === id);
    if (!check) { return; }
    applyAutoFixSetting(check, enabled);
}

function applyAutoFixSetting(check: IntegrityCheckState, enabled: boolean): void {
    if (!isChecksumAlgorithm(check.algorithm) || !check.storedRaw) { return; }
    clearAutoFixSuppression(check);
    check.autoFixStoredValue = enabled;
    persistIntegrityChecks();
    fixEnabledMismatch(check, enabled);
}

function fixEnabledMismatch(check: IntegrityCheckState, enabled: boolean): void {
    if (!enabled) { return; }
    if (isMismatchedCheck(check)) { updateStoredValue(check); }
}

type FixableIntegrityCheck = {
    check: IntegrityCheckState;
    update: { address: number; expected: Uint8Array };
};

function fixableIntegrityChecks(): FixableIntegrityCheck[] {
    const fixable: FixableIntegrityCheck[] = [];
    for (const check of integrityState.checks) {
        if (!isMismatchedCheck(check)) { continue; }
        const update = storedValueUpdate(check);
        if (update) { fixable.push({ check, update }); }
    }
    return fixable;
}

function hasFixableMismatches(): boolean {
    return integrityState.checks.some(isMismatchedCheck);
}

function fixAllMismatches(): void {
    const fixable = fixableIntegrityChecks();
    const edits = mergeIntegrityEdits(fixable.map(fixableCheckEdits));
    if (!edits.ok) { setActionError(edits.error); return; }
    if (edits.value.length === 0) { return; }
    setActionError('');
    fixable.forEach(item => clearAutoFixSuppression(item.check));
    editHandler(edits.value);
    for (const item of fixable) {
        item.check.storedBytes = Uint8Array.from(item.update.expected);
        updateCheckCard(item.check);
    }
    syncIntegrityHighlight();
}

function fixableCheckEdits(item: FixableIntegrityCheck): Array<[number, number]> {
    return Array.from(item.update.expected, (value, offset) => [item.update.address + offset, value]);
}

function setActionError(message: string): void {
    actionError = message;
    const error = document.getElementById('integrity-action-error');
    if (error) { error.textContent = message; }
}

function wireCheckForm(formId: string): void {
    const form = document.querySelector<HTMLElement>(`[data-integrity-form="${formId}"]`);
    if (!form) { return; }
    form.querySelector('[data-form-action="save"]')?.addEventListener('click', () => saveCheckForm(formId, form));
    form.querySelector('[data-form-action="cancel"]')?.addEventListener('click', () => cancelCheckForm(formId));
    form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')?.addEventListener('change', event => {
        updateStoredFieldVisibility(form, (event.target as HTMLSelectElement).value as IntegrityAlgorithm);
    });
}

function updateStoredFieldVisibility(form: HTMLElement, algorithm: IntegrityAlgorithm): void {
    const field = form.querySelector<HTMLElement>('[data-stored-field]');
    if (field) { field.hidden = !isChecksumAlgorithm(algorithm); }
}

function saveCheckForm(formId: string, form: HTMLElement): void {
    const draft = readDraft(form);
    if (!draft.ok) { showFormError(form, draft.error); return; }
    if (formId === 'add') { saveNewCheck(draft.value); return; }
    saveEditedCheck(Number(formId.replace('edit-', '')), draft.value);
}

function readDraft(form: HTMLElement): DraftValidation {
    const algorithm = form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')!.value as IntegrityAlgorithm;
    const startRaw = form.querySelector<HTMLInputElement>('[data-draft-control="start"]')!.value;
    const endRaw = form.querySelector<HTMLInputElement>('[data-draft-control="end"]')!.value;
    const range = validateIntegrityRange(startRaw, endRaw, algorithm);
    if (!range.ok) { return range; }
    const stored = readStoredDraft(form, algorithm);
    if (!stored.ok) { return stored; }
    return {
        ok: true,
        value: {
            algorithm,
            startRaw: formatIntegrityAddress(range.value.startAddress),
            endRaw: formatIntegrityAddress(range.value.endAddress),
            storedRaw: stored.value,
        },
    };
}

function readStoredDraft(form: HTMLElement, algorithm: IntegrityAlgorithm): StoredDraftValidation {
    if (!isChecksumAlgorithm(algorithm)) { return { ok: true, value: '' }; }
    const raw = form.querySelector<HTMLInputElement>('[data-draft-control="stored"]')!.value;
    if (!raw.trim()) { return { ok: true, value: '' }; }
    const parsed = parseIntegrityAddress(raw, 'Stored value');
    if (!parsed.ok) { return parsed; }
    return { ok: true, value: formatIntegrityAddress(parsed.value) };
}

function showFormError(form: HTMLElement, message: string): void {
    const error = form.querySelector<HTMLElement>('[data-form-error]');
    if (error) { error.textContent = message; }
}

function saveNewCheck(draft: IntegrityDraft): void {
    const check = newCheck();
    applyDraft(check, draft);
    integrityState.checks.push(check);
    addCheckDraft = null;
    persistIntegrityChecks();
    renderIntegrity();
    scheduleIntegrityCalculation(check);
}

function saveEditedCheck(id: number, draft: IntegrityDraft): void {
    const check = integrityState.checks.find(item => item.id === id);
    if (!check) { return; }
    applyDraft(check, draft);
    if (!check.storedRaw) { check.autoFixStoredValue = false; }
    editingCheckId = null;
    persistIntegrityChecks();
    renderIntegrity();
    syncIntegrityHighlight();
    scheduleIntegrityCalculation(check);
}

function applyDraft(check: IntegrityCheckState, draft: IntegrityDraft): void {
    check.algorithm = draft.algorithm;
    check.startRaw = draft.startRaw;
    check.endRaw = draft.endRaw;
    check.storedRaw = isChecksumAlgorithm(draft.algorithm) ? draft.storedRaw : '';
    if (!check.storedRaw) { check.autoFixStoredValue = false; }
    clearAutoFixSuppression(check);
    clearCheckResult(check);
}

function cancelCheckForm(formId: string): void {
    if (formId === 'add') { addCheckDraft = null; }
    else {
        editingCheckId = null;
    }
    renderIntegrity();
}

function scheduleIntegrityCalculation(check: IntegrityCheckState, preserveResult = false): void {
    const token = ++check.token;
    cancelPendingCalculation(check);
    if (preserveResult) { check.error = ''; }
    else { clearCheckResult(check); }
    const prepared = prepareIntegrityRequest(check);
    if (!prepared) { updateCheckCard(check); return; }
    check.calculating = true;
    if (!check.result) { check.meta = `Calculating ${formatByteCount(preparedByteCount(prepared))}…`; }
    updateCheckCard(check);
    check.timer = window.setTimeout(() => {
        check.timer = null;
        void calculateAndRender(check, token, prepared);
    }, DEBOUNCE_MS);
}

function cancelPendingCalculation(check: IntegrityCheckState): void {
    if (check.timer !== null) { window.clearTimeout(check.timer); }
    check.timer = null;
}

function clearCheckResult(check: IntegrityCheckState): void {
    check.result = null;
    check.expectedBytes = null;
    check.storedBytes = null;
    check.error = '';
    check.meta = '';
    check.calculating = false;
}

function prepareIntegrityRequest(check: IntegrityCheckState): PreparedCheck | null {
    if (isUnconfiguredCheck(check)) {
        check.meta = 'Not configured';
        return null;
    }
    const range = validateIntegrityRange(check.startRaw, check.endRaw, check.algorithm);
    if (!range.ok) { check.error = range.error; return null; }
    const stored = parseStoredField(check);
    if (!stored.ok) { check.error = stored.error; return null; }
    return { request: range.value, storedField: stored.value };
}

function isUnconfiguredCheck(check: IntegrityCheckState): boolean {
    return !check.startRaw && !check.endRaw;
}

function parseStoredField(check: IntegrityCheckState): { ok: true; value?: IntegrityStoredField } | { ok: false; error: string } {
    if (!isChecksumAlgorithm(check.algorithm)) { return { ok: true, value: undefined }; }
    if (!check.storedRaw) { return { ok: true, value: undefined }; }
    const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!stored.ok) { return stored; }
    return { ok: true, value: { startAddress: stored.value, byteLength: integrityOutputByteLength(check.algorithm) } };
}

function integrityOutputByteLength(algorithm: IntegrityAlgorithm): number {
    return { 'crc16-ccitt-false': 2, 'crc32-iso-hdlc': 4, md5: 16, 'sha-1': 20, 'sha-256': 32, 'sha-512': 64 }[algorithm];
}

function preparedByteCount(prepared: PreparedCheck): number {
    const total = prepared.request.endAddress - prepared.request.startAddress + 1;
    return total - (prepared.storedField ? overlapByteCount(prepared.request, prepared.storedField) : 0);
}

function overlapByteCount(request: IntegrityRequest, field: IntegrityStoredField): number {
    const start = Math.max(request.startAddress, field.startAddress);
    const end = Math.min(request.endAddress, field.startAddress + field.byteLength - 1);
    return Math.max(0, end - start + 1);
}

async function calculateAndRender(check: IntegrityCheckState, token: number, prepared: PreparedCheck): Promise<void> {
    const readByte = getByte;
    const bytes = collectIntegrityBytes(prepared.request, readByte, prepared.storedField);
    if (!bytes.ok) { applyCurrentError(check, token, bytes.error); return; }
    try {
        const result = await calculateIntegrity(prepared.request.algorithm, bytes.value);
        applyCalculatedResultIfCurrent(check, token, result, prepared.storedField, readByte);
    } catch (error) {
        applyCurrentError(check, token, error instanceof Error ? error.message : 'Integrity calculation failed.');
    }
}

function applyCurrentError(check: IntegrityCheckState, token: number, error: string): void {
    if (token !== check.token) { return; }
    check.calculating = false;
    check.error = error;
    updateCheckCard(check);
    syncIntegrityHighlight();
}

function applyCalculatedResultIfCurrent(
    check: IntegrityCheckState,
    token: number,
    result: IntegrityResult,
    storedField: IntegrityStoredField | undefined,
    readByte: (address: number) => number | undefined,
): void {
    if (token !== check.token) { return; }
    check.result = result;
    check.expectedBytes = integrityValueToBytes(result.value, S.endian);
    check.storedBytes = null;
    check.calculating = false;
    check.meta = formatByteCount(result.byteCount);
    if (storedField) {
        const stored = readStoredIntegrityBytes(storedField, readByte);
        if (!stored.ok) { check.error = stored.error; updateCheckCard(check); return; }
        check.storedBytes = stored.value;
    }
    updateCheckCard(check);
    maybeAutoFix(check);
    syncIntegrityHighlight();
}

function updateCheckCard(check: IntegrityCheckState): void {
    const card = document.querySelector<HTMLElement>(`.integrity-card[data-check-id="${check.id}"]`);
    if (!card) { return; }
    updateCheckCardStatus(card, check);
    updateCheckCardBody(card, check);
    updateFixAllControl();
}

function updateCheckCardStatus(card: HTMLElement, check: IntegrityCheckState): void {
    const status = card.querySelector<HTMLElement>('[data-check-status]');
    if (!status) { return; }
    const label = checkStatusLabel(check);
    status.className = `integrity-card-status ${checkStatusClass(check)}`;
    status.textContent = INTEGRITY_STATUS_SYMBOLS[label] ?? label;
    status.title = label;
    status.setAttribute('aria-label', label);
}

function updateCheckCardBody(card: HTMLElement, check: IntegrityCheckState): void {
    const body = card.querySelector<HTMLElement>('[data-check-body]');
    if (!body) { return; }
    body.innerHTML = resultBodyHtml(check);
}

function updateFixAllControl(): void {
    const button = document.getElementById('integrity-fix-all') as HTMLButtonElement | null;
    if (button) { button.disabled = !hasFixableMismatches(); }
}

function checkStatusLabel(check: IntegrityCheckState): string {
    if (check.error) { return 'Error'; }
    if (check.calculating) { return 'Calculating'; }
    if (check.result) { return completedCheckStatus(check); }
    return completedCheckStatus(check);
}

function completedCheckStatus(check: IntegrityCheckState): string {
    if (!check.result) { return 'Not configured'; }
    if (!hasComparableStoredValue(check)) { return 'Calculated'; }
    return integrityBytesEqual(check.expectedBytes, check.storedBytes) ? 'Match' : 'Mismatch';
}

function hasComparableStoredValue(check: IntegrityCheckState): check is IntegrityCheckState & {
    expectedBytes: Uint8Array;
    storedBytes: Uint8Array;
} {
    return !!check.storedBytes && !!check.expectedBytes;
}

function checkStatusClass(check: IntegrityCheckState): string {
    return checkStatusLabel(check).toLocaleLowerCase().replace(' ', '-');
}

function resultBodyHtml(check: IntegrityCheckState): string {
    if (check.error) { return `<div class="integrity-error">${esc(check.error)}</div>`; }
    if (check.result) { return calculatedResultBodyHtml(check, check.result); }
    if (check.calculating) { return pendingResultBodyHtml(check); }
    return emptyResultBodyHtml(check.meta);
}

function emptyResultBodyHtml(meta: string): string {
    return `<div class="integrity-card-empty">${esc(meta || 'No result yet.')}</div>`;
}

function pendingResultBodyHtml(check: IntegrityCheckState): string {
    const stored = hasStoredChecksum(check) ? pendingStoredResultHtml(check) : '';
    return `
        <div class="integrity-comparison${singleComparisonClass(stored)}">
            <div class="integrity-value-pane calculated pending">
                <div class="integrity-value-hdr">
                    <span>Calculated</span>
                    <button class="integrity-copy-btn" type="button" title="Copy calculated value" aria-label="Copy calculated value" disabled>⧉</button>
                </div>
                <code>${formatHexHtml('0x—')}</code>
            </div>
            ${stored}
        </div>
        <div class="integrity-result-meta">${esc(check.meta)}</div>`;
}

function pendingStoredResultHtml(check: IntegrityCheckState): string {
    return `<div class="integrity-value-pane stored unverified pending">
        <div class="integrity-value-hdr"><span>Stored (${S.endian.toUpperCase()})</span>${autoFixToggleHtml(check)}</div>
        <code>${formatHexHtml('0x—')}</code>
    </div>`;
}

function calculatedResultBodyHtml(check: IntegrityCheckState, result: IntegrityResult): string {
    const stored = storedResultHtml(check);
    const display = calculatedDisplay(result);
    return `
        <div class="integrity-comparison${singleComparisonClass(stored)}">
            <div class="integrity-value-pane calculated">
                <div class="integrity-value-hdr">
                    <span title="${display.title}">${display.label}</span>
                    <button class="integrity-copy-btn" type="button" data-copy-calculated data-check-id="${check.id}" title="Copy calculated value" aria-label="Copy calculated value">⧉</button>
                </div>
                <code title="${display.title}">${formatHexHtml(`0x${display.value}`)}</code>
            </div>
            ${stored}
        </div>
        <div class="integrity-result-meta">${esc(check.meta)}</div>`;
}

function calculatedDisplay(
    result: IntegrityResult,
): { label: string; value: string; title: string } {
    return { label: 'Calculated', value: result.value, title: '' };
}

function hasStoredChecksum(check: IntegrityCheckState): boolean {
    return isChecksumAlgorithm(check.algorithm) && !!check.storedRaw;
}

function singleComparisonClass(storedHtml: string): string {
    return storedHtml ? '' : ' integrity-comparison-single';
}

function storedResultHtml(check: IntegrityCheckState): string {
    if (!isChecksumAlgorithm(check.algorithm) || !check.storedBytes) { return ''; }
    const state = integrityHighlightStatus(check);
    const raw = integrityBytesToHex(check.storedBytes);
    const value = integrityBytesToValueHex(check.storedBytes, S.endian);
    return `<div class="integrity-value-pane stored ${state}">
        <div class="integrity-value-hdr"><span>Stored (${S.endian.toUpperCase()})</span>${autoFixToggleHtml(check)}</div>
        <code title="Raw bytes: 0x${raw}">${formatHexHtml(`0x${value}`)}</code>
    </div>`;
}

function updateStoredValue(check: IntegrityCheckState): void {
    const update = storedValueUpdate(check);
    if (!update) { return; }
    editHandler(Array.from(update.expected, (byte, offset) => [update.address + offset, byte]));
    check.storedBytes = update.expected;
    updateCheckCard(check);
    syncIntegrityHighlight();
}

function maybeAutoFix(check: IntegrityCheckState): void {
    if (!check.autoFixStoredValue) { return; }
    const mismatch = autoFixMismatchKey(check);
    if (!mismatch) { clearAutoFixSuppression(check); return; }
    if (consumeAutoFixSuppression(check, mismatch)) { return; }
    clearAutoFixSuppression(check);
    updateStoredValue(check);
}

function consumeAutoFixSuppression(check: IntegrityCheckState, mismatch: string): boolean {
    if (check.suppressAutoFixOnNextResult) {
        check.suppressAutoFixOnNextResult = false;
        check.suppressedAutoFixMismatch = mismatch;
        updateCheckCard(check);
        return true;
    }
    return check.suppressedAutoFixMismatch === mismatch;
}

function isAutoFixSuppressed(check: IntegrityCheckState): boolean {
    const mismatch = autoFixMismatchKey(check);
    return !!mismatch && check.suppressedAutoFixMismatch === mismatch;
}

function autoFixMismatchKey(check: IntegrityCheckState): string {
    if (!isMismatchedCheck(check) || !check.expectedBytes || !check.storedBytes) { return ''; }
    return [
        check.algorithm,
        check.startRaw,
        check.endRaw,
        check.storedRaw,
        S.endian,
        integrityBytesToHex(check.expectedBytes),
        integrityBytesToHex(check.storedBytes),
    ].join('|');
}

function clearAutoFixSuppression(check: IntegrityCheckState): void {
    check.suppressAutoFixOnNextResult = false;
    check.suppressedAutoFixMismatch = '';
}

function syncIntegrityHighlight(): void {
    const check = integrityState.checks.find(item => item.id === highlightedCheckId);
    if (!check) { clearIntegrityHighlight(); return; }
    const highlight = integrityHighlightForCheck(check);
    if (!highlight) { clearIntegrityHighlight(); return; }
    S.integrityHighlight = highlight;
    rerenderIntegrityMemory();
}

type IntegrityHighlight = NonNullable<typeof S.integrityHighlight>;

function integrityHighlightForCheck(check: IntegrityCheckState): IntegrityHighlight | null {
    const range = validateIntegrityRange(check.startRaw, check.endRaw, check.algorithm);
    if (!range.ok) { return null; }
    const highlight: IntegrityHighlight = {
        rangeStart: range.value.startAddress,
        rangeEnd: range.value.endAddress,
        status: integrityHighlightStatus(check),
    };
    addStoredIntegrityHighlight(highlight, check);
    return highlight;
}

function addStoredIntegrityHighlight(highlight: IntegrityHighlight, check: IntegrityCheckState): void {
    if (!hasStoredChecksum(check)) { return; }
    const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!stored.ok) { return; }
    highlight.storedStart = stored.value;
    highlight.storedLength = integrityOutputByteLength(check.algorithm);
}

function integrityHighlightStatus(check: IntegrityCheckState): 'match' | 'mismatch' | 'unverified' {
    if (!hasComparableStoredValue(check)) { return 'unverified'; }
    return integrityBytesEqual(check.expectedBytes, check.storedBytes) ? 'match' : 'mismatch';
}

function clearHighlightedCheck(): void {
    highlightedCheckId = null;
    clearIntegrityHighlight();
}

function clearIntegrityHighlight(): void {
    S.integrityHighlight = null;
    rerenderIntegrityMemory();
}

function rerenderIntegrityMemory(): void {
    if (S.currentView === 'memory') { rerender.memory(); }
}

function storedValueUpdate(check: IntegrityCheckState): { address: number; expected: Uint8Array } | null {
    if (!check.expectedBytes) { return null; }
    if (!check.storedRaw) { return null; }
    const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!stored.ok) { return null; }
    return { address: stored.value, expected: Uint8Array.from(check.expectedBytes) };
}

function formatByteCount(byteCount: number): string {
    return `${byteCount.toLocaleString()} byte${byteCount === 1 ? '' : 's'}`;
}

function wireProfileControls(): void {
    const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
    select.addEventListener('change', () => {
        selectedProfileId = select.value;
        setProfileError('');
        updateProfileButtonState();
    });
    document.getElementById('integrity-profile-apply')?.addEventListener('click', applySelectedProfile);
    document.getElementById('integrity-profile-save')?.addEventListener('click', saveProfileAs);
    document.getElementById('integrity-profile-update')?.addEventListener('click', updateSelectedProfile);
    document.getElementById('integrity-profile-rename')?.addEventListener('click', renameSelectedProfile);
    document.getElementById('integrity-profile-delete')?.addEventListener('click', deleteSelectedProfile);
    wireProfileNameForm();
    updateProfileButtonState();
}

function wireProfileNameForm(): void {
    const input = document.getElementById('integrity-profile-name') as HTMLInputElement | null;
    if (!input) { return; }
    document.getElementById('integrity-profile-name-save')?.addEventListener('click', submitProfileName);
    document.getElementById('integrity-profile-name-cancel')?.addEventListener('click', closeProfileNameForm);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { submitProfileName(); }
        if (event.key === 'Escape') { closeProfileNameForm(); }
    });
}

function updateProfileButtonState(): void {
    const noProfile = !selectedProfileId;
    ['apply', 'rename', 'delete'].forEach(action => {
        const button = document.getElementById(`integrity-profile-${action}`) as HTMLButtonElement | null;
        if (button) { button.disabled = noProfile; }
    });
    const noChecks = integrityState.checks.length === 0;
    const save = document.getElementById('integrity-profile-save') as HTMLButtonElement | null;
    const update = document.getElementById('integrity-profile-update') as HTMLButtonElement | null;
    if (save) { save.disabled = noChecks; }
    if (update) { update.disabled = noProfile || noChecks; }
}

function activeConfigs(): IntegrityCheckConfig[] | null {
    if (integrityState.checks.length === 0) { setProfileError('Add at least one integrity check.'); return null; }
    const configs: IntegrityCheckConfig[] = [];
    for (const check of integrityState.checks) {
        const config = activeConfig(check);
        if (!config.ok) { setProfileError(`Check ${configs.length + 1}: ${config.error}`); return null; }
        configs.push(config.value);
    }
    return configs;
}

function activeConfig(check: IntegrityCheckState): { ok: true; value: IntegrityCheckConfig } | { ok: false; error: string } {
    const range = validateIntegrityRange(check.startRaw, check.endRaw, check.algorithm);
    if (!range.ok) { return range; }
    if (!hasStoredChecksum(check)) { return { ok: true, value: { ...range.value, autoFixStoredValue: false } }; }
    const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!stored.ok) { return stored; }
    return { ok: true, value: { ...range.value, storedAddress: stored.value, autoFixStoredValue: check.autoFixStoredValue } };
}

function persistIntegrityChecks(): void {
    const checks: IntegrityCheckConfig[] = [];
    for (const check of integrityState.checks) {
        const config = activeConfig(check);
        if (!config.ok) { return; }
        checks.push(config.value);
    }
    vscode.postMessage({
        type: 'saveIntegrityChecks',
        state: { schemaVersion: 1, checks },
    });
}

function applySelectedProfile(): void {
    const profile = profiles.find(item => item.id === selectedProfileId);
    if (!profile) { return; }
    integrityState.checks.forEach(cancelPendingCalculation);
    integrityState.checks = profile.checks.map(newCheck);
    addCheckDraft = null;
    editingCheckId = null;
    clearHighlightedCheck();
    persistIntegrityChecks();
    renderIntegrity();
    integrityState.checks.forEach(check => scheduleIntegrityCalculation(check));
}

function saveProfileAs(): void {
    if (!activeConfigs()) { return; }
    openProfileNameForm('create');
}

function updateSelectedProfile(): void {
    const current = profiles.find(profile => profile.id === selectedProfileId);
    const checks = activeConfigs();
    if (!current || !checks) { return; }
    vscode.postMessage({ type: 'updateIntegrityProfile', profile: { ...current, checks } });
}

function renameSelectedProfile(): void {
    const current = profiles.find(profile => profile.id === selectedProfileId);
    if (!current) { return; }
    openProfileNameForm('rename');
}

function openProfileNameForm(mode: 'create' | 'rename'): void {
    profileNameMode = mode;
    setProfileError('');
    refreshProfileLibrary();
    document.getElementById('integrity-profile-name')?.focus();
}

function closeProfileNameForm(): void {
    profileNameMode = null;
    setProfileError('');
    refreshProfileLibrary();
}

function submitProfileName(): void {
    const input = document.getElementById('integrity-profile-name') as HTMLInputElement | null;
    if (!input) { return; }
    const name = input.value.trim();
    if (!name) { setProfileError('Profile name is required.'); return; }
    submitValidProfileName(name);
}

function submitValidProfileName(name: string): void {
    if (profileNameMode === 'create') { createNamedProfile(name); return; }
    if (profileNameMode === 'rename') { renameProfileTo(name); }
}

function createNamedProfile(name: string): void {
    const checks = activeConfigs();
    if (!checks) { return; }
    if (profileNameExists(name)) { setProfileError(`A profile named “${name}” already exists.`); return; }
    const id = `integrity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    selectedProfileId = id;
    profileNameMode = null;
    vscode.postMessage({ type: 'createIntegrityProfile', profile: { schemaVersion: 1, id, name, checks } });
}

function renameProfileTo(name: string): void {
    const current = profiles.find(profile => profile.id === selectedProfileId);
    if (!current || name === current.name) { closeProfileNameForm(); return; }
    if (profileNameExists(name, current.id)) { setProfileError(`A profile named “${name}” already exists.`); return; }
    profileNameMode = null;
    vscode.postMessage({ type: 'renameIntegrityProfile', id: current.id, name });
}

function deleteSelectedProfile(): void {
    const current = profiles.find(profile => profile.id === selectedProfileId);
    if (!current) { return; }
    vscode.postMessage({ type: 'deleteIntegrityProfile', id: current.id });
}

function profileNameExists(name: string, exceptId = ''): boolean {
    const normalized = name.toLocaleLowerCase();
    return profiles.some(profile => profile.id !== exceptId && profile.name.toLocaleLowerCase() === normalized);
}

function setProfileError(message: string): void {
    profileError = message;
    const error = document.getElementById('integrity-profile-error');
    if (error) { error.textContent = message; }
}
