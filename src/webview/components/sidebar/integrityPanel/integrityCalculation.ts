// ── Integrity calculation scheduling + async engine ──────────────
// Debounced scheduling, request preparation, and the async
// calculate-and-render pipeline (split out of IntegrityPanel.ts).
// Functions mutate IntegrityCheckState; DOM/UI updates go through the
// injected hooks (readByte + endian + updateCheckCard + syncHighlight +
// onCalculated) so the class stays the single owner of rendering.

import {
    calculateIntegrity,
    collectIntegrityBytesAsync,
    integrityValueToBytes,
    isChecksumAlgorithm,
    parseIntegrityAddress,
    readStoredIntegrityBytes,
    validateIntegrityRange,
    type IntegrityAlgorithm,
    type IntegrityRequest,
    type IntegrityResult,
    type IntegrityStoredField,
} from '../../../../core/integrity';
import { clearIntegrityCheckResult, type IntegrityCheckState } from './integrityCheckModel';

const DEBOUNCE_MS = 250;

type PreparedCheck = { request: IntegrityRequest; storedField?: IntegrityStoredField };

export interface IntegrityCalculationHooks {
    /** Host memory adapter (was this.cb.readByte). */
    readByte: (addr: number) => number | undefined;
    /** Shared byte-order source (was this.endian()). */
    endian: () => 'le' | 'be';
    /** Repaint the check card after a state change (was this.updateCheckCard). */
    updateCheckCard: (check: IntegrityCheckState) => void;
    /** Re-report the range highlight after a result settles (was this.syncHighlight). */
    syncHighlight: () => void;
    /** Auto-fix reaction after a calculated result lands (was this.maybeAutoFix). */
    onCalculated: (check: IntegrityCheckState) => void;
}

function formatByteCount(byteCount: number): string {
    return `${byteCount.toLocaleString()} byte${byteCount === 1 ? '' : 's'}`;
}

export function scheduleIntegrityCalculation(
    check: IntegrityCheckState,
    preserveResult: boolean,
    hooks: IntegrityCalculationHooks,
): void {
    const token = ++check.token;
    cancelPendingCalculation(check);
    if (preserveResult) { check.error = ''; }
    else { clearCheckResult(check); }
    const prepared = prepareIntegrityRequest(check);
    if (!prepared) { hooks.updateCheckCard(check); return; }
    check.calculating = true;
    if (!check.result) { check.meta = `Calculating ${formatByteCount(preparedByteCount(prepared))}…`; }
    hooks.updateCheckCard(check);
    check.timer = window.setTimeout(() => {
        check.timer = null;
        void calculateAndRender(check, token, prepared, hooks);
    }, DEBOUNCE_MS);
}

export function cancelPendingCalculation(check: IntegrityCheckState): void {
    if (check.timer !== null) { window.clearTimeout(check.timer); }
    check.timer = null;
}

function clearCheckResult(check: IntegrityCheckState): void {
    clearIntegrityCheckResult(check);
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

export function integrityOutputByteLength(algorithm: IntegrityAlgorithm): number {
    return { 'crc16-ccitt-false': 2, 'crc32-iso-hdlc': 4, md5: 16, 'sha-1': 20, 'sha-256': 32, 'sha-512': 64 }[algorithm];
}

function overlapByteCount(request: IntegrityRequest, field: IntegrityStoredField): number {
    const start = Math.max(request.startAddress, field.startAddress);
    const end = Math.min(request.endAddress, field.startAddress + field.byteLength - 1);
    return Math.max(0, end - start + 1);
}

function preparedByteCount(prepared: PreparedCheck): number {
    const total = prepared.request.endAddress - prepared.request.startAddress + 1;
    return total - (prepared.storedField ? overlapByteCount(prepared.request, prepared.storedField) : 0);
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

async function calculateAndRender(
    check: IntegrityCheckState,
    token: number,
    prepared: PreparedCheck,
    hooks: IntegrityCalculationHooks,
): Promise<void> {
    const bytes = await collectIntegrityBytesAsync(prepared.request, hooks.readByte, prepared.storedField);
    if (!bytes.ok) { applyCurrentError(check, token, bytes.error, hooks); return; }
    try {
        const result = await calculateIntegrity(prepared.request.algorithm, bytes.value);
        applyCalculatedResultIfCurrent(check, token, result, prepared.storedField, hooks);
    } catch (error) {
        applyCurrentError(check, token, error instanceof Error ? error.message : 'Integrity calculation failed.', hooks);
    }
}

function applyCurrentError(check: IntegrityCheckState, token: number, error: string, hooks: IntegrityCalculationHooks): void {
    if (token !== check.token) { return; }
    check.calculating = false;
    check.error = error;
    hooks.updateCheckCard(check);
    hooks.syncHighlight();
}

function applyCalculatedResultIfCurrent(
    check: IntegrityCheckState,
    token: number,
    result: IntegrityResult,
    storedField: IntegrityStoredField | undefined,
    hooks: IntegrityCalculationHooks,
): void {
    if (token !== check.token) { return; }
    check.result = result;
    check.expectedBytes = integrityValueToBytes(result.value, hooks.endian());
    check.storedBytes = null;
    check.calculating = false;
    check.meta = formatByteCount(result.byteCount);
    if (storedField) {
        const stored = readStoredIntegrityBytes(storedField, hooks.readByte);
        if (!stored.ok) { check.error = stored.error; hooks.updateCheckCard(check); return; }
        check.storedBytes = stored.value;
    }
    hooks.updateCheckCard(check);
    hooks.onCalculated(check);
    hooks.syncHighlight();
}
