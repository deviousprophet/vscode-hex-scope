import { vscode } from './api';
import { getByte } from './data';
import {
    calculateIntegrity,
    collectIntegrityBytes,
    formatIntegrityAddress,
    integrityBytesEqual,
    integrityBytesToHex,
    integrityValueToBytes,
    normalizeIntegrityProfiles,
    parseIntegrityAddress,
    readStoredIntegrityBytes,
    type IntegrityAlgorithm,
    type IntegrityByteOrder,
    type IntegrityCheckConfig,
    type IntegrityProfile,
    type IntegrityRequest,
    type IntegrityResult,
    type IntegrityStoredField,
    validateIntegrityRange,
} from './integrity';
import { S } from './state';
import { esc } from './utils';

const DEBOUNCE_MS = 250;
const ALGORITHM_LABELS: ReadonlyArray<readonly [IntegrityAlgorithm, string]> = [
    ['crc16-ccitt-false', 'CRC16/CCITT-FALSE'],
    ['crc32-iso-hdlc', 'CRC32/ISO-HDLC'],
    ['md5', 'MD5'],
    ['sha-1', 'SHA-1'],
    ['sha-256', 'SHA-256'],
    ['sha-512', 'SHA-512'],
];

interface IntegrityCheckState {
    id: number;
    algorithm: IntegrityAlgorithm;
    startRaw: string;
    endRaw: string;
    storedRaw: string;
    byteOrder: IntegrityByteOrder;
    result: IntegrityResult | null;
    expectedBytes: Uint8Array | null;
    storedBytes: Uint8Array | null;
    timer: number | null;
    token: number;
}

type PreparedCheck = { request: IntegrityRequest; storedField?: IntegrityStoredField };
type IntegrityEditHandler = (edits: Array<[number, number]>) => void;

let nextCheckId = 1;
let editHandler: IntegrityEditHandler = () => {};
let profiles: IntegrityProfile[] = [];
let selectedProfileId = '';
let profileError = '';

const integrityState = {
    initialized: false,
    checks: [newCheck()],
};

function newCheck(config?: IntegrityCheckConfig): IntegrityCheckState {
    const persisted = config ? persistedCheckState(config) : blankCheckState();
    return {
        id: nextCheckId++,
        ...persisted,
        result: null,
        expectedBytes: null,
        storedBytes: null,
        timer: null,
        token: 0,
    };
}

function blankCheckState(): Pick<IntegrityCheckState, 'algorithm' | 'startRaw' | 'endRaw' | 'storedRaw' | 'byteOrder'> {
    return { algorithm: 'crc32-iso-hdlc', startRaw: '', endRaw: '', storedRaw: '', byteOrder: 'be' };
}

function persistedCheckState(config: IntegrityCheckConfig): Pick<IntegrityCheckState, 'algorithm' | 'startRaw' | 'endRaw' | 'storedRaw' | 'byteOrder'> {
    return {
        algorithm: config.algorithm,
        startRaw: formatIntegrityAddress(config.startAddress),
        endRaw: formatIntegrityAddress(config.endAddress),
        storedRaw: formatOptionalAddress(config.storedAddress),
        byteOrder: config.byteOrder,
    };
}

function formatOptionalAddress(address: number | undefined): string {
    return address === undefined ? '' : formatIntegrityAddress(address);
}

export function setIntegrityEditHandler(handler: IntegrityEditHandler): void {
    editHandler = handler;
}

export function setIntegrityProfiles(value: unknown, error = ''): void {
    profiles = normalizeIntegrityProfiles(value);
    profileError = error;
    if (selectedProfileId && !profiles.some(profile => profile.id === selectedProfileId)) {
        selectedProfileId = '';
    }
    if (document.getElementById('s-integrity')) { renderIntegrity(); }
}

export function renderIntegrity(): void {
    const panel = document.getElementById('s-integrity');
    if (!panel) { return; }
    panel.innerHTML = `
        <div class="integrity-shell">
            <div class="integrity-title">Integrity Checks</div>
            <div class="integrity-help">Calculate and verify multiple inclusive mapped memory ranges.</div>
            ${profileLibraryHtml()}
            <div id="integrity-check-list">
                ${integrityState.checks.map((check, index) => checkHtml(check, index)).join('')}
            </div>
            <button id="integrity-add-check" class="integrity-add" type="button">+ Add check</button>
        </div>`;
    wireProfileControls();
    integrityState.checks.forEach((check, index) => wireCheckControls(check, index));
    document.getElementById('integrity-add-check')?.addEventListener('click', () => {
        integrityState.checks.push(newCheck());
        renderIntegrity();
    });
    if (integrityState.initialized) { integrityState.checks.forEach(scheduleIntegrityCalculation); }
}

function profileLibraryHtml(): string {
    const options = profiles.map(profile =>
        `<option value="${esc(profile.id)}"${profile.id === selectedProfileId ? ' selected' : ''}>${esc(profile.name)}</option>`
    ).join('');
    return `
        <div class="integrity-profiles">
            <label class="integrity-field">
                <span>Profile</span>
                <select id="integrity-profile-select">
                    <option value="">Select a saved profile…</option>${options}
                </select>
            </label>
            <div class="integrity-profile-actions">
                <button id="integrity-profile-apply" type="button">Apply</button>
                <button id="integrity-profile-save" type="button">Save as</button>
                <button id="integrity-profile-update" type="button">Update</button>
                <button id="integrity-profile-rename" type="button">Rename</button>
                <button id="integrity-profile-delete" type="button">Delete</button>
            </div>
            <div id="integrity-profile-error" class="integrity-error" role="alert">${esc(profileError)}</div>
        </div>`;
}

function checkHtml(check: IntegrityCheckState, index: number): string {
    const suffix = checkControlSuffix(check, index);
    const algorithmOptions = algorithmOptionsHtml(check.algorithm);
    const byteOrderOptions = byteOrderOptionsHtml(check.byteOrder);
    return `
        <section class="integrity-check" data-check-id="${check.id}">
            <div class="integrity-check-header">
                <span>Check ${index + 1}</span>
                <div class="integrity-check-actions">
                    <button data-check-action="up" title="Move up"${disabledAttr(index === 0)}>↑</button>
                    <button data-check-action="down" title="Move down"${disabledAttr(index === integrityState.checks.length - 1)}>↓</button>
                    <button data-check-action="remove" title="Remove"${disabledAttr(integrityState.checks.length === 1)}>×</button>
                </div>
            </div>
            <label class="integrity-field"><span>Algorithm</span>
                <select id="integrity-algorithm${suffix}" data-control="algorithm">
                    ${algorithmOptions}
                </select>
            </label>
            <div class="integrity-address-grid">
                <label class="integrity-field"><span>Start address</span>
                    <input id="integrity-start${suffix}" data-control="start" type="text" spellcheck="false"
                        placeholder="0x08000000" value="${esc(check.startRaw)}">
                </label>
                <label class="integrity-field"><span>End address <small>(inclusive)</small></span>
                    <input id="integrity-end${suffix}" data-control="end" type="text" spellcheck="false"
                        placeholder="0x080000FF" value="${esc(check.endRaw)}">
                </label>
            </div>
            <div class="integrity-address-grid stored">
                <label class="integrity-field"><span>Stored value address <small>(optional)</small></span>
                    <input id="integrity-stored${suffix}" data-control="stored" type="text" spellcheck="false"
                        placeholder="0x08000100" value="${esc(check.storedRaw)}">
                </label>
                <label class="integrity-field"><span>Stored byte order</span>
                    <select id="integrity-byte-order${suffix}" data-control="byte-order">
                        ${byteOrderOptions}
                    </select>
                </label>
            </div>
            <div id="integrity-meta${suffix}" data-output="meta" class="integrity-meta"></div>
            <div id="integrity-error${suffix}" data-output="error" class="integrity-error" role="alert"></div>
            <div id="integrity-result${suffix}" data-output="result" class="integrity-result" hidden></div>
        </section>`;
}

function checkControlSuffix(check: IntegrityCheckState, index: number): string {
    return index === 0 ? '' : `-${check.id}`;
}

function disabledAttr(disabled: boolean): string {
    return disabled ? ' disabled' : '';
}

function algorithmOptionsHtml(selected: IntegrityAlgorithm): string {
    return ALGORITHM_LABELS.map(([value, label]) =>
        `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
}

function byteOrderOptionsHtml(selected: IntegrityByteOrder): string {
    return `<option value="be"${selected === 'be' ? ' selected' : ''}>Big-endian</option>` +
        `<option value="le"${selected === 'le' ? ' selected' : ''}>Little-endian</option>`;
}

export function activateIntegrity(): void {
    if (integrityState.initialized) { return; }
    integrityState.initialized = true;
    prefillFirstCheckFromSelection();
    renderIntegrity();
}

function prefillFirstCheckFromSelection(): void {
    const first = integrityState.checks[0];
    if (first.startRaw || first.endRaw) { return; }
    const selection = selectedIntegrityRange();
    if (!selection) { return; }
    first.startRaw = formatIntegrityAddress(selection.start);
    first.endRaw = formatIntegrityAddress(selection.end);
}

function selectedIntegrityRange(): { start: number; end: number } | null {
    if (S.selStart === null) { return null; }
    if (S.selEnd === null) { return null; }
    return { start: S.selStart, end: S.selEnd };
}

export function notifyIntegrityBytesChanged(): void {
    if (integrityState.initialized) { integrityState.checks.forEach(scheduleIntegrityCalculation); }
}

function wireCheckControls(check: IntegrityCheckState, index: number): void {
    const card = cardFor(check);
    if (!card) { return; }
    const algorithm = card.querySelector<HTMLSelectElement>('[data-control="algorithm"]')!;
    const start = card.querySelector<HTMLInputElement>('[data-control="start"]')!;
    const end = card.querySelector<HTMLInputElement>('[data-control="end"]')!;
    const stored = card.querySelector<HTMLInputElement>('[data-control="stored"]')!;
    const byteOrder = card.querySelector<HTMLSelectElement>('[data-control="byte-order"]')!;
    algorithm.addEventListener('change', () => { check.algorithm = algorithm.value as IntegrityAlgorithm; scheduleIntegrityCalculation(check); });
    start.addEventListener('input', () => { check.startRaw = start.value; scheduleIntegrityCalculation(check); });
    end.addEventListener('input', () => { check.endRaw = end.value; scheduleIntegrityCalculation(check); });
    stored.addEventListener('input', () => { check.storedRaw = stored.value; scheduleIntegrityCalculation(check); });
    byteOrder.addEventListener('change', () => { check.byteOrder = byteOrder.value as IntegrityByteOrder; scheduleIntegrityCalculation(check); });
    card.querySelector('[data-check-action="up"]')?.addEventListener('click', () => moveCheck(index, -1));
    card.querySelector('[data-check-action="down"]')?.addEventListener('click', () => moveCheck(index, 1));
    card.querySelector('[data-check-action="remove"]')?.addEventListener('click', () => removeCheck(index));
}

function moveCheck(index: number, direction: number): void {
    const target = index + direction;
    if (target < 0 || target >= integrityState.checks.length) { return; }
    [integrityState.checks[index], integrityState.checks[target]] =
        [integrityState.checks[target], integrityState.checks[index]];
    renderIntegrity();
}

function removeCheck(index: number): void {
    if (integrityState.checks.length === 1) { return; }
    cancelPendingCalculation(integrityState.checks[index]);
    integrityState.checks.splice(index, 1);
    renderIntegrity();
}

function scheduleIntegrityCalculation(check: IntegrityCheckState): void {
    const token = ++check.token;
    cancelPendingCalculation(check);
    clearResult(check);
    const prepared = prepareIntegrityRequest(check);
    if (!prepared) { return; }
    check.timer = window.setTimeout(() => {
        check.timer = null;
        void calculateAndRender(check, token, prepared);
    }, DEBOUNCE_MS);
}

function cancelPendingCalculation(check: IntegrityCheckState): void {
    if (check.timer !== null) { window.clearTimeout(check.timer); }
    check.timer = null;
}

function prepareIntegrityRequest(check: IntegrityCheckState): PreparedCheck | null {
    if (isBlankIntegrityRange(check)) {
        showMeta(check, 'Enter a start and end address.');
        showError(check, '');
        return null;
    }
    const validation = validateIntegrityRange(check.startRaw, check.endRaw, check.algorithm);
    if (!validation.ok) { showMeta(check, ''); showError(check, validation.error); return null; }
    const stored = parseStoredField(check);
    if (!stored.ok) { showMeta(check, ''); showError(check, stored.error); return null; }
    showPreparedMeta(check, validation.value, stored.value);
    showError(check, '');
    return { request: validation.value, storedField: stored.value };
}

function isBlankIntegrityRange(check: IntegrityCheckState): boolean {
    return check.startRaw.trim() === '' && check.endRaw.trim() === '';
}

function parseStoredField(check: IntegrityCheckState): { ok: true; value?: IntegrityStoredField } | { ok: false; error: string } {
    if (check.storedRaw.trim() === '') { return { ok: true, value: undefined }; }
    const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!stored.ok) { return stored; }
    return { ok: true, value: { startAddress: stored.value, byteLength: integrityOutputByteLength(check.algorithm) } };
}

function showPreparedMeta(check: IntegrityCheckState, request: IntegrityRequest, storedField?: IntegrityStoredField): void {
    const excluded = storedField ? overlapByteCount(request, storedField) : 0;
    const byteCount = request.endAddress - request.startAddress + 1 - excluded;
    showMeta(check, `${formatByteCount(byteCount)}${excludedBytesLabel(excluded)}`);
}

function excludedBytesLabel(excluded: number): string {
    if (excluded === 0) { return ''; }
    return ` · ${excluded} stored byte${excluded === 1 ? '' : 's'} excluded`;
}

function integrityOutputByteLength(algorithm: IntegrityAlgorithm): number {
    return { 'crc16-ccitt-false': 2, 'crc32-iso-hdlc': 4, md5: 16, 'sha-1': 20, 'sha-256': 32, 'sha-512': 64 }[algorithm];
}

function overlapByteCount(request: IntegrityRequest, field: IntegrityStoredField): number {
    const start = Math.max(request.startAddress, field.startAddress);
    const end = Math.min(request.endAddress, field.startAddress + field.byteLength - 1);
    return Math.max(0, end - start + 1);
}

async function calculateAndRender(check: IntegrityCheckState, token: number, prepared: PreparedCheck): Promise<void> {
    const readByte = (address: number) => S.edits.get(address) ?? getByte(address);
    const bytes = collectIntegrityBytes(prepared.request, readByte, prepared.storedField);
    if (!bytes.ok) { showCurrentError(check, token, bytes.error); return; }
    showMeta(check, `Calculating ${formatByteCount(bytes.value.length)}…`);
    try {
        const result = await calculateIntegrity(prepared.request.algorithm, bytes.value);
        renderCalculatedIfCurrent(check, token, result, prepared.storedField, readByte);
    } catch (error) {
        showCurrentError(check, token, calculationErrorMessage(error));
    }
}

function renderCalculatedIfCurrent(
    check: IntegrityCheckState,
    token: number,
    result: IntegrityResult,
    storedField: IntegrityStoredField | undefined,
    readByte: (address: number) => number | undefined,
): void {
    if (token !== check.token) { return; }
    const storedError = applyCalculatedResult(check, result, storedField, readByte);
    if (storedError) { showError(check, storedError); return; }
    showMeta(check, formatByteCount(result.byteCount));
    showResult(check, storedField);
}

function showCurrentError(check: IntegrityCheckState, token: number, message: string): void {
    if (token === check.token) { showError(check, message); }
}

function calculationErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Integrity calculation failed.';
}

function applyCalculatedResult(
    check: IntegrityCheckState,
    result: IntegrityResult,
    storedField: IntegrityStoredField | undefined,
    readByte: (address: number) => number | undefined,
): string | null {
    check.result = result;
    check.expectedBytes = integrityValueToBytes(result.value, check.byteOrder);
    check.storedBytes = null;
    if (!storedField) { return null; }
    const stored = readStoredIntegrityBytes(storedField, readByte);
    if (!stored.ok) { return stored.error; }
    check.storedBytes = stored.value;
    return null;
}

function showResult(check: IntegrityCheckState, storedField?: IntegrityStoredField): void {
    const context = integrityResultContext(check);
    if (!context) { return; }
    const { result, calculated, expected } = context;
    const matches = check.storedBytes ? integrityBytesEqual(expected, check.storedBytes) : null;
    const suffix = resultControlSuffix(check);
    result.innerHTML = `
        ${comparisonStatusHtml(matches)}
        <div class="integrity-result-label">Calculated</div>
        <code id="integrity-value${suffix}" data-output="calculated">${esc(calculated.value)}</code>
        ${storedValueHtml(check.storedBytes)}
        <div class="integrity-result-actions">
            <button id="integrity-copy${suffix}" data-result-action="copy" type="button">Copy</button>
            ${updateStoredButtonHtml(matches, storedField)}
        </div>`;
    result.hidden = false;
    result.querySelector('[data-result-action="copy"]')?.addEventListener('click', () => copyIntegrityResult(check));
    result.querySelector('[data-result-action="update"]')?.addEventListener('click', () => updateStoredValue(check, storedField!));
}

function integrityResultContext(check: IntegrityCheckState): {
    result: HTMLElement;
    calculated: IntegrityResult;
    expected: Uint8Array;
} | null {
    const result = cardFor(check)?.querySelector<HTMLElement>('[data-output="result"]');
    if (!result) { return null; }
    if (!check.result) { return null; }
    if (!check.expectedBytes) { return null; }
    return { result, calculated: check.result, expected: check.expectedBytes };
}

function resultControlSuffix(check: IntegrityCheckState): string {
    return check === integrityState.checks[0] ? '' : `-${check.id}`;
}

function comparisonStatusHtml(matches: boolean | null): string {
    if (matches === null) { return ''; }
    const state = matches ? 'match' : 'mismatch';
    const label = matches ? 'Match' : 'Mismatch';
    return `<div class="integrity-status ${state}">${label}</div>`;
}

function storedValueHtml(bytes: Uint8Array | null): string {
    if (!bytes) { return ''; }
    return `<div class="integrity-result-label stored-label">Stored</div><code>${integrityBytesToHex(bytes)}</code>`;
}

function updateStoredButtonHtml(matches: boolean | null, field?: IntegrityStoredField): string {
    if (matches !== false) { return ''; }
    return field ? '<button data-result-action="update" type="button">Update stored value</button>' : '';
}

function updateStoredValue(check: IntegrityCheckState, field: IntegrityStoredField): void {
    if (!check.expectedBytes) { return; }
    editHandler(Array.from(check.expectedBytes, (byte, offset) => [field.startAddress + offset, byte]));
}

function copyIntegrityResult(check: IntegrityCheckState): void {
    if (!check.result) { return; }
    vscode.postMessage({
        type: 'copyText',
        text: check.result.value,
        label: ALGORITHM_LABELS.find(([value]) => value === check.result?.algorithm)?.[1] ?? 'integrity value',
    });
}

function clearResult(check: IntegrityCheckState): void {
    check.result = null;
    check.expectedBytes = null;
    check.storedBytes = null;
    const result = cardFor(check)?.querySelector<HTMLElement>('[data-output="result"]');
    if (result) { result.hidden = true; result.textContent = ''; }
}

function cardFor(check: IntegrityCheckState): HTMLElement | null {
    return document.querySelector<HTMLElement>(`.integrity-check[data-check-id="${check.id}"]`);
}

function showMeta(check: IntegrityCheckState, message: string): void {
    const meta = cardFor(check)?.querySelector<HTMLElement>('[data-output="meta"]');
    if (meta) { meta.textContent = message; }
}

function showError(check: IntegrityCheckState, message: string): void {
    const error = cardFor(check)?.querySelector<HTMLElement>('[data-output="error"]');
    if (error) { error.textContent = message; }
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
    updateProfileButtonState();
}

function updateProfileButtonState(): void {
    const disabled = !selectedProfileId;
    ['apply', 'update', 'rename', 'delete'].forEach(action => {
        const button = document.getElementById(`integrity-profile-${action}`) as HTMLButtonElement | null;
        if (button) { button.disabled = disabled; }
    });
}

function activeConfigs(): IntegrityCheckConfig[] | null {
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
    const stored = parseOptionalStoredAddress(check.storedRaw);
    if (!stored.ok) { return stored; }
    return { ok: true, value: { ...range.value, ...storedAddressProperty(stored.value), byteOrder: check.byteOrder } };
}

function parseOptionalStoredAddress(raw: string): { ok: true; value?: number } | { ok: false; error: string } {
    if (!raw.trim()) { return { ok: true, value: undefined }; }
    return parseIntegrityAddress(raw, 'Stored value');
}

function storedAddressProperty(value: number | undefined): { storedAddress?: number } {
    return value === undefined ? {} : { storedAddress: value };
}

function applySelectedProfile(): void {
    const profile = profiles.find(item => item.id === selectedProfileId);
    if (!profile) { return; }
    integrityState.checks.forEach(cancelPendingCalculation);
    integrityState.checks = profile.checks.map(newCheck);
    renderIntegrity();
}

function saveProfileAs(): void {
    const checks = activeConfigs();
    if (!checks) { return; }
    const name = window.prompt('Profile name')?.trim();
    if (!name) { return; }
    if (profileNameExists(name)) { setProfileError(`A profile named “${name}” already exists.`); return; }
    const id = `integrity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    selectedProfileId = id;
    vscode.postMessage({ type: 'createIntegrityProfile', profile: { schemaVersion: 1, id, name, checks } });
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
    const name = promptedProfileName(current.name);
    if (!name) { return; }
    if (profileNameExists(name, current.id)) { setProfileError(`A profile named “${name}” already exists.`); return; }
    vscode.postMessage({ type: 'renameIntegrityProfile', id: current.id, name });
}

function promptedProfileName(currentName: string): string | null {
    const name = window.prompt('Rename profile', currentName)?.trim();
    if (!name) { return null; }
    return name === currentName ? null : name;
}

function deleteSelectedProfile(): void {
    const current = profiles.find(profile => profile.id === selectedProfileId);
    if (!current || !window.confirm(`Delete integrity profile “${current.name}”?`)) { return; }
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
