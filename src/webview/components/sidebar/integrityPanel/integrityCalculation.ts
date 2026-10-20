// ── Integrity calculation scheduling + async engine ──────────────
// Debounced scheduling, request preparation, and the async
// calculate-and-render pipeline (split out of IntegrityPanel.ts).
// Built-in checks run in the webview; script checks are handed to the
// host through `startScriptRun` and settle through `applyIntegrityScript*`.
// Functions mutate IntegrityCheckState; DOM/UI updates go through the
// injected hooks (readByte + endian + updateCheckCard + syncHighlight +
// onCalculated) so the class stays the single owner of rendering.

import {
    calculateIntegrity,
    collectIntegrityBytesAsync,
    integrityByteOrder,
    integrityScriptName,
    integrityValueToBytes,
    parseIntegrityAddress,
    readStoredIntegrityBytes,
    validateIntegrityAddressRange,
    validateIntegrityRange,
    type IntegrityAlgorithm,
    type IntegrityBuiltinResult,
    type IntegrityRequest,
    type IntegrityScriptResult,
    type IntegrityStoredField,
} from '../../../../core/integrity';
import { clearIntegrityCheckResult, type IntegrityCheckState } from './integrityCheckModel';

const DEBOUNCE_MS = 250;

type PreparedCheck = { request: IntegrityRequest; storedField?: IntegrityStoredField };

/** Host run payload (the panel adds requestId/checkId when posting). */
export interface IntegrityScriptRunPayload {
    scriptPath: string;
    startAddress: number;
    endAddress: number;
    storedAddress?: number;
    storedLength?: number;
    edits: Array<[number, number]>;
    generation: number;
}

/** Validated host response payload for one script check run. */
export interface IntegrityScriptOutcome {
    valid?: boolean;
    valueBytes?: number[];
    byteCount: number;
    scriptName: string;
    warnings?: string[];
}

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
    /** Current pending edits + document generation for a host script run. */
    getPendingEdits?: () => Array<[number, number]>;
    getGeneration?: () => number;
    /** Start one host script run (the panel allocates the request id). */
    startScriptRun?: (check: IntegrityCheckState, payload: IntegrityScriptRunPayload) => void;
}

type PreparedScriptCheck = {
    scriptPath: string;
    scriptName: string;
    startAddress: number;
    endAddress: number;
    storedAddress?: number;
    storedLength?: number;
};

function formatByteCount(byteCount: number): string {
    return `${byteCount.toLocaleString()} byte${byteCount === 1 ? '' : 's'}`;
}

export function scheduleIntegrityCalculation(
    check: IntegrityCheckState,
    preserveResult: boolean,
    hooks: IntegrityCalculationHooks,
): void {
    if (check.kind === 'script') {
        scheduleScriptCheck(check, preserveResult, hooks);
        return;
    }
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
    result: IntegrityBuiltinResult,
    storedField: IntegrityStoredField | undefined,
    hooks: IntegrityCalculationHooks,
): void {
    if (token !== check.token) { return; }
    check.result = result;
    check.expectedBytes = integrityValueToBytes(result.value, integrityByteOrder(check.algorithm, hooks.endian()));
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

// ── Script checks ─────────────────────────────────────────────────

function prepareScriptCheck(check: IntegrityCheckState): PreparedScriptCheck | null {
    if (isUnconfiguredCheck(check)) {
        check.meta = 'Not configured';
        return null;
    }
    const range = validateIntegrityAddressRange(check.startRaw, check.endRaw);
    if (!range.ok) { check.error = range.error; return null; }
    const scriptPath = check.scriptPath.trim();
    if (!scriptPath) { check.error = 'Script path is required.'; return null; }
    let storedAddress: number | undefined;
    if (check.storedRaw) {
        const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
        if (!stored.ok) { check.error = stored.error; return null; }
        storedAddress = stored.value;
    }
    const storedLength = check.storedBytes?.length ?? check.expectedBytes?.length;
    return {
        scriptPath,
        scriptName: integrityScriptName(scriptPath),
        startAddress: range.value.startAddress,
        endAddress: range.value.endAddress,
        storedAddress,
        storedLength,
    };
}

function scheduleScriptCheck(
    check: IntegrityCheckState,
    preserveResult: boolean,
    hooks: IntegrityCalculationHooks,
): void {
    const token = ++check.token;
    cancelPendingCalculation(check);
    check.stale = false;
    if (!preserveResult) { clearCheckResult(check); }
    else { check.error = ''; }
    const prepared = prepareScriptCheck(check);
    if (!prepared) {
        check.calculating = false;
        hooks.updateCheckCard(check);
        hooks.syncHighlight();
        return;
    }
    check.calculating = true;
    check.meta = `Running ${prepared.scriptName}…`;
    hooks.updateCheckCard(check);
    if (!hooks.startScriptRun) {
        applyScriptError(check, token, 'Script execution is unavailable.', hooks);
        return;
    }
    hooks.startScriptRun(check, {
        scriptPath: prepared.scriptPath,
        startAddress: prepared.startAddress,
        endAddress: prepared.endAddress,
        ...(prepared.storedAddress === undefined ? {} : { storedAddress: prepared.storedAddress }),
        ...(prepared.storedLength === undefined ? {} : { storedLength: prepared.storedLength }),
        edits: hooks.getPendingEdits?.() ?? [],
        generation: hooks.getGeneration?.() ?? 0,
    });
}

/** Apply a host script failure; stale tokens/requests are ignored. */
export function applyIntegrityScriptError(
    check: IntegrityCheckState,
    token: number,
    error: string,
    hooks: IntegrityCalculationHooks,
): void {
    if (token !== check.token) { return; }
    applyScriptError(check, token, error, hooks);
}

function applyScriptError(
    check: IntegrityCheckState,
    token: number,
    error: string,
    hooks: IntegrityCalculationHooks,
): void {
    if (token !== check.token) { return; }
    check.calculating = false;
    check.stale = false;
    check.result = null;
    check.expectedBytes = null;
    check.storedBytes = null;
    check.error = error;
    hooks.updateCheckCard(check);
    hooks.syncHighlight();
}

/** Apply a host script result (value and/or verify), then read the stored field. */
export function applyIntegrityScriptResult(
    check: IntegrityCheckState,
    token: number,
    outcome: IntegrityScriptOutcome,
    hooks: IntegrityCalculationHooks,
): void {
    if (token !== check.token) { return; }
    const valueBytes = normalizeScriptBytes(outcome.valueBytes);
    if (outcome.valueBytes !== undefined && !valueBytes) {
        applyScriptError(check, token, 'Script returned an invalid value.', hooks);
        return;
    }
    const result: IntegrityScriptResult = {
        kind: 'script',
        valid: typeof outcome.valid === 'boolean' ? outcome.valid : undefined,
        valueBytes: valueBytes ?? undefined,
        byteCount: Number.isSafeInteger(outcome.byteCount) && outcome.byteCount >= 0 ? outcome.byteCount : 0,
        scriptName: typeof outcome.scriptName === 'string' ? outcome.scriptName : check.scriptPath,
    };
    check.result = result;
    check.expectedBytes = valueBytes ? Uint8Array.from(valueBytes) : null;
    check.storedBytes = null;
    check.calculating = false;
    check.stale = false;
    check.error = '';
    const warnings = Array.isArray(outcome.warnings) ? outcome.warnings.filter(w => typeof w === 'string') : [];
    check.meta = resultMeta(result, warnings);
    readScriptStoredBytes(check, hooks);
    if (check.error) { hooks.updateCheckCard(check); hooks.syncHighlight(); return; }
    hooks.updateCheckCard(check);
    hooks.onCalculated(check);
    hooks.syncHighlight();
}

function resultMeta(result: IntegrityScriptResult, warnings: readonly string[]): string {
    const base = formatByteCount(result.byteCount);
    return warnings.length > 0 ? `${base} · ${warnings.join(' · ')}` : base;
}

function normalizeScriptBytes(value: unknown): Uint8Array | null {
    if (!Array.isArray(value)) { return null; }
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
        const byte = value[i];
        if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 0xFF) { return null; }
        bytes[i] = byte;
    }
    return bytes;
}

function readScriptStoredBytes(check: IntegrityCheckState, hooks: IntegrityCalculationHooks): void {
    const bytes = check.expectedBytes;
    if (!bytes || !check.storedRaw) { return; }
    const address = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!address.ok) { check.error = address.error; return; }
    const stored = readStoredIntegrityBytes(
        { startAddress: address.value, byteLength: bytes.length },
        hooks.readByte,
    );
    if (!stored.ok) { check.error = stored.error; return; }
    check.storedBytes = stored.value;
}
