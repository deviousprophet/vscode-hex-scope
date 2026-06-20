import { vscode } from './api';
import { getByte } from './data';
import {
    calculateIntegrity,
    collectIntegrityBytes,
    formatIntegrityAddress,
    type IntegrityAlgorithm,
    type IntegrityRequest,
    type IntegrityResult,
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

const integrityState = {
    initialized: false,
    algorithm: 'crc32-iso-hdlc' as IntegrityAlgorithm,
    startRaw: '',
    endRaw: '',
    result: null as IntegrityResult | null,
    timer: null as number | null,
    token: 0,
};

export function renderIntegrity(): void {
    const panel = document.getElementById('s-integrity');
    if (!panel) { return; }
    panel.innerHTML = `
        <div class="integrity-shell">
            <div class="integrity-title">Integrity Checks</div>
            <div class="integrity-help">Calculate over an inclusive mapped memory range.</div>
            <label class="integrity-field">
                <span>Algorithm</span>
                <select id="integrity-algorithm">
                    ${ALGORITHM_LABELS.map(([value, label]) =>
        `<option value="${value}"${value === integrityState.algorithm ? ' selected' : ''}>${label}</option>`).join('')}
                </select>
            </label>
            <label class="integrity-field">
                <span>Start address</span>
                <input id="integrity-start" type="text" inputmode="text" spellcheck="false"
                    placeholder="0x08000000" value="${esc(integrityState.startRaw)}">
            </label>
            <label class="integrity-field">
                <span>End address <small>(inclusive)</small></span>
                <input id="integrity-end" type="text" inputmode="text" spellcheck="false"
                    placeholder="0x080000FF" value="${esc(integrityState.endRaw)}">
            </label>
            <div id="integrity-meta" class="integrity-meta"></div>
            <div id="integrity-error" class="integrity-error" role="alert"></div>
            <div id="integrity-result" class="integrity-result" hidden>
                <div class="integrity-result-label">Result</div>
                <code id="integrity-value"></code>
                <button id="integrity-copy" type="button">Copy</button>
            </div>
        </div>`;
    wireIntegrityControls();
    if (integrityState.initialized) { scheduleIntegrityCalculation(); }
}

export function activateIntegrity(): void {
    if (!integrityState.initialized) {
        integrityState.initialized = true;
        if (S.selStart !== null && S.selEnd !== null) {
            integrityState.startRaw = formatIntegrityAddress(S.selStart);
            integrityState.endRaw = formatIntegrityAddress(S.selEnd);
        }
        renderIntegrity();
    }
}

export function notifyIntegrityBytesChanged(): void {
    if (integrityState.initialized) { scheduleIntegrityCalculation(); }
}

function wireIntegrityControls(): void {
    const algorithm = document.getElementById('integrity-algorithm') as HTMLSelectElement;
    const start = document.getElementById('integrity-start') as HTMLInputElement;
    const end = document.getElementById('integrity-end') as HTMLInputElement;

    algorithm.addEventListener('change', () => {
        integrityState.algorithm = algorithm.value as IntegrityAlgorithm;
        scheduleIntegrityCalculation();
    });
    start.addEventListener('input', () => {
        integrityState.startRaw = start.value;
        scheduleIntegrityCalculation();
    });
    end.addEventListener('input', () => {
        integrityState.endRaw = end.value;
        scheduleIntegrityCalculation();
    });
    document.getElementById('integrity-copy')?.addEventListener('click', copyIntegrityResult);
}

function scheduleIntegrityCalculation(): void {
    const token = ++integrityState.token;
    cancelPendingCalculation();
    clearResult();

    const request = prepareIntegrityRequest();
    if (!request) { return; }
    integrityState.timer = window.setTimeout(() => {
        integrityState.timer = null;
        void calculateAndRender(token, request);
    }, DEBOUNCE_MS);
}

function cancelPendingCalculation(): void {
    if (integrityState.timer !== null) { window.clearTimeout(integrityState.timer); }
    integrityState.timer = null;
}

function prepareIntegrityRequest(): IntegrityRequest | null {
    if (integrityState.startRaw.trim() === '' && integrityState.endRaw.trim() === '') {
        showMeta('Enter a start and end address.');
        showError('');
        return null;
    }

    const validation = validateIntegrityRange(
        integrityState.startRaw,
        integrityState.endRaw,
        integrityState.algorithm,
    );
    if (!validation.ok) {
        showMeta('');
        showError(validation.error);
        return null;
    }

    const byteCount = validation.value.endAddress - validation.value.startAddress + 1;
    showMeta(formatByteCount(byteCount));
    showError('');
    return validation.value;
}

async function calculateAndRender(token: number, request: IntegrityRequest): Promise<void> {
    const bytes = collectBytesOrShowError(token, request);
    if (!bytes) { return; }
    showMeta(`Calculating ${formatByteCount(bytes.length)}…`);
    try {
        const result = await calculateIntegrity(request.algorithm, bytes);
        applyResultIfCurrent(token, result);
    } catch (error) {
        showCalculationErrorIfCurrent(token, error);
    }
}

function collectBytesOrShowError(token: number, request: IntegrityRequest): Uint8Array | null {
    const bytes = collectIntegrityBytes(request, address => S.edits.get(address) ?? getByte(address));
    if (!bytes.ok) {
        if (token === integrityState.token) { showError(bytes.error); }
        return null;
    }
    return bytes.value;
}

function applyResultIfCurrent(token: number, result: IntegrityResult): void {
    if (token !== integrityState.token) { return; }
    integrityState.result = result;
    showMeta(formatByteCount(result.byteCount));
    showResult(result.value);
}

function showCalculationErrorIfCurrent(token: number, error: unknown): void {
    if (token !== integrityState.token) { return; }
    showError(error instanceof Error ? error.message : 'Integrity calculation failed.');
}

function formatByteCount(byteCount: number): string {
    return `${byteCount.toLocaleString()} byte${byteCount === 1 ? '' : 's'}`;
}

function copyIntegrityResult(): void {
    if (!integrityState.result) { return; }
    vscode.postMessage({
        type: 'copyText',
        text: integrityState.result.value,
        label: ALGORITHM_LABELS.find(([value]) => value === integrityState.result?.algorithm)?.[1] ?? 'integrity value',
    });
}

function clearResult(): void {
    integrityState.result = null;
    const result = document.getElementById('integrity-result');
    if (result) { result.hidden = true; }
    const value = document.getElementById('integrity-value');
    if (value) { value.textContent = ''; }
}

function showResult(value: string): void {
    showError('');
    const output = document.getElementById('integrity-value');
    const result = document.getElementById('integrity-result');
    if (output) { output.textContent = value; }
    if (result) { result.hidden = false; }
}

function showMeta(message: string): void {
    const meta = document.getElementById('integrity-meta');
    if (meta) { meta.textContent = message; }
}

function showError(message: string): void {
    const error = document.getElementById('integrity-error');
    if (error) { error.textContent = message; }
}
