import {
    formatIntegrityAddress,
    isChecksumAlgorithm,
    parseIntegrityAddress,
    validateIntegrityRange,
    type IntegrityAlgorithm,
    type IntegrityCheckConfig,
    type IntegrityCheckSet,
    type IntegrityResult,
} from '../../../core/integrity';

export interface IntegrityCheckState {
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

export interface IntegrityDraft {
    algorithm: IntegrityAlgorithm;
    startRaw: string;
    endRaw: string;
    storedRaw: string;
}

type IntegrityConfigValidation = { ok: true; value: IntegrityCheckConfig } | { ok: false; error: string };
type IntegrityConfigListValidation = { ok: true; value: IntegrityCheckConfig[] } | { ok: false; error: string };
type IntegrityCheckSetValidation = { ok: true; value: IntegrityCheckSet } | { ok: false; error: string };

export function makeIntegrityCheck(id: number, config?: IntegrityCheckConfig): IntegrityCheckState {
    const draft = config ? draftFromIntegrityConfig(config) : blankIntegrityDraft();
    return {
        id,
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

export function blankIntegrityDraft(): IntegrityDraft {
    return { algorithm: 'crc32-iso-hdlc', startRaw: '', endRaw: '', storedRaw: '' };
}

export function draftFromIntegrityConfig(config: IntegrityCheckConfig): IntegrityDraft {
    return {
        algorithm: config.algorithm,
        startRaw: formatIntegrityAddress(config.startAddress),
        endRaw: formatIntegrityAddress(config.endAddress),
        storedRaw: config.storedAddress === undefined ? '' : formatIntegrityAddress(config.storedAddress),
    };
}

export function applyIntegrityDraft(check: IntegrityCheckState, draft: IntegrityDraft): void {
    check.algorithm = draft.algorithm;
    check.startRaw = draft.startRaw;
    check.endRaw = draft.endRaw;
    check.storedRaw = isChecksumAlgorithm(draft.algorithm) ? draft.storedRaw : '';
    if (!check.storedRaw) { check.autoFixStoredValue = false; }
    clearIntegrityAutoFixSuppression(check);
    clearIntegrityCheckResult(check);
}

export function clearIntegrityCheckResult(check: IntegrityCheckState): void {
    check.result = null;
    check.expectedBytes = null;
    check.storedBytes = null;
    check.error = '';
    check.meta = '';
    check.calculating = false;
}

export function clearIntegrityAutoFixSuppression(check: IntegrityCheckState): void {
    check.suppressAutoFixOnNextResult = false;
    check.suppressedAutoFixMismatch = '';
}

export function integrityCheckConfigFromState(check: IntegrityCheckState): IntegrityConfigValidation {
    const range = validateIntegrityRange(check.startRaw, check.endRaw, check.algorithm);
    if (!range.ok) { return range; }
    if (!hasStoredChecksum(check)) { return { ok: true, value: { ...range.value, autoFixStoredValue: false } }; }
    const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!stored.ok) { return stored; }
    return { ok: true, value: { ...range.value, storedAddress: stored.value, autoFixStoredValue: check.autoFixStoredValue } };
}

export function integrityCheckConfigsFromStates(checks: readonly IntegrityCheckState[]): IntegrityConfigListValidation {
    const configs: IntegrityCheckConfig[] = [];
    for (const check of checks) {
        const config = integrityCheckConfigFromState(check);
        if (!config.ok) { return { ok: false, error: `Check ${configs.length + 1}: ${config.error}` }; }
        configs.push(config.value);
    }
    return { ok: true, value: configs };
}

export function integrityCheckSetFromStates(checks: readonly IntegrityCheckState[]): IntegrityCheckSetValidation {
    const configs = integrityCheckConfigsFromStates(checks);
    if (!configs.ok) { return configs; }
    return { ok: true, value: { schemaVersion: 1, checks: configs.value } };
}

function hasStoredChecksum(check: IntegrityCheckState): boolean {
    return isChecksumAlgorithm(check.algorithm) && !!check.storedRaw;
}
