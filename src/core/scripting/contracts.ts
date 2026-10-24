import type { ScriptEntry, ScriptValue } from './types';

export type ScriptValidation<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_ADDRESS = 0xFFFF_FFFF;

type ValueNormalizer = (value: unknown) => ScriptValidation<ScriptValue>;

/** One normalizer per contract entry; `run` has no value contract and is absent. */
const VALUE_NORMALIZERS: Readonly<Partial<Record<ScriptEntry, ValueNormalizer>>> = {
    getAddress: normalizeAddress,
    getSize: normalizeSize,
    verifyIntegrity: normalizeVerifyResult,
    getIntegrityValue: normalizeBytes,
};

/**
 * Normalize a contract entry's return value at the worker boundary.
 * `run` has no value contract; callers must not pass it here.
 */
export function normalizeScriptValue(entry: ScriptEntry, value: unknown): ScriptValidation<ScriptValue> {
    const normalize = VALUE_NORMALIZERS[entry];
    if (!normalize) {
        return entry === 'run'
            ? { ok: false, error: "The 'run' entry has no value contract." }
            : { ok: false, error: `Unknown script entry: ${String(entry)}` };
    }
    return normalize(value);
}

function contractError(entry: ScriptEntry, reason: string): ScriptValidation<never> {
    return { ok: false, error: `Script entry '${entry}' ${reason}.` };
}

function normalizeVerifyResult(value: unknown): ScriptValidation<boolean> {
    return typeof value === 'boolean'
        ? { ok: true, value }
        : contractError('verifyIntegrity', 'must return a boolean');
}

function normalizeAddress(value: unknown): ScriptValidation<number> {
    if (!isIntegerNumber(value)) {
        return contractError('getAddress', 'must return an integer address');
    }
    return inAddressRange(value)
        ? { ok: true, value }
        : contractError('getAddress', 'returned an address outside 0x00000000-0xFFFFFFFF');
}

function normalizeSize(value: unknown): ScriptValidation<number> {
    if (!isIntegerNumber(value)) {
        return contractError('getSize', 'must return an integer size');
    }
    return value >= 1
        ? { ok: true, value }
        : contractError('getSize', 'must return a size of at least 1');
}

function normalizeBytes(value: unknown): ScriptValidation<number[]> {
    if (!isByteSource(value)) {
        return contractError('getIntegrityValue', 'must return Uint8Array or number[]');
    }
    const problem = byteSourceProblem(value);
    if (problem) {
        return contractError('getIntegrityValue', problem);
    }
    return { ok: true, value: Array.from(value) };
}

function isIntegerNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value);
}

function inAddressRange(value: number): boolean {
    return value >= 0 && value <= MAX_ADDRESS;
}

/** Contract error for the byte source as a whole (emptiness), then for its elements. */
function byteSourceProblem(value: ArrayLike<number>): string | null {
    if (value.length === 0) { return 'returned an empty value'; }
    return byteArrayProblem(value);
}

/** First invalid element's message, or null when every element is a byte. */
function byteArrayProblem(value: ArrayLike<number>): string | null {
    for (let i = 0; i < value.length; i++) {
        const problem = byteProblemAt(value, i);
        if (problem) { return problem; }
    }
    return null;
}

function byteProblemAt(value: ArrayLike<number>, index: number): string | null {
    if (isSparseHole(value, index)) { return 'returned a sparse byte array'; }
    if (!isByte(value[index])) { return 'returned a value that is not a byte'; }
    return null;
}

function isSparseHole(value: ArrayLike<number>, index: number): boolean {
    return Array.isArray(value) && !(index in value);
}

function isByte(value: unknown): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFF;
}

/** Cross-realm safe byte-source check (sandbox constructors differ from the worker's). */
function isByteSource(value: unknown): value is ArrayLike<number> {
    if (Array.isArray(value)) { return true; }
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}
