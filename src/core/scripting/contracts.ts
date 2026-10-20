import type { ScriptEntry, ScriptValue } from './types';

export type ScriptValidation<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_ADDRESS = 0xFFFF_FFFF;

/**
 * Normalize a contract entry's return value at the worker boundary.
 * `run` has no value contract; callers must not pass it here.
 */
export function normalizeScriptValue(entry: ScriptEntry, value: unknown): ScriptValidation<ScriptValue> {
    switch (entry) {
        case 'getAddress':
            return normalizeAddress(value);
        case 'getSize':
            return normalizeSize(value);
        case 'verifyIntegrity':
            return typeof value === 'boolean'
                ? { ok: true, value }
                : contractError(entry, 'must return a boolean');
        case 'getIntegrityValue':
            return normalizeBytes(value);
        case 'run':
            return { ok: false, error: "The 'run' entry has no value contract." };
        default:
            return { ok: false, error: `Unknown script entry: ${String(entry)}` };
    }
}

function contractError(entry: ScriptEntry, reason: string): ScriptValidation<never> {    return { ok: false, error: `Script entry '${entry}' ${reason}.` };
}

function normalizeAddress(value: unknown): ScriptValidation<number> {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return contractError('getAddress', 'must return an integer address');
    }
    if (value < 0 || value > MAX_ADDRESS) {
        return contractError('getAddress', 'returned an address outside 0x00000000-0xFFFFFFFF');
    }
    return { ok: true, value };
}

function normalizeSize(value: unknown): ScriptValidation<number> {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return contractError('getSize', 'must return an integer size');
    }
    if (value < 1) {
        return contractError('getSize', 'must return a size of at least 1');
    }
    return { ok: true, value };
}

function normalizeBytes(value: unknown): ScriptValidation<number[]> {
    if (!isByteSource(value)) {
        return contractError('getIntegrityValue', 'must return Uint8Array or number[]');
    }
    const bytes: number[] = [];
    for (let i = 0; i < value.length; i++) {
        if (Array.isArray(value) && !(i in value)) {
            return contractError('getIntegrityValue', 'returned a sparse byte array');
        }
        const byte = value[i];
        if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 0xFF) {
            return contractError('getIntegrityValue', 'returned a value that is not a byte');
        }
        bytes.push(byte);
    }
    if (bytes.length === 0) {
        return contractError('getIntegrityValue', 'returned an empty value');
    }
    return { ok: true, value: bytes };
}

/** Cross-realm safe byte-source check (sandbox constructors differ from the worker's). */
function isByteSource(value: unknown): value is ArrayLike<number> {
    if (Array.isArray(value)) { return true; }
    return Object.prototype.toString.call(value) === '[object Uint8Array]';
}
