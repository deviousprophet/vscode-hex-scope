// @ts-check
/// <reference path="./types/hexscope.d.ts" />

/**
 * Integrity check source for the Integrity panel.
 *
 * @script integrity
 *
 * The example computes a one-byte additive checksum over the configured check
 * range, skipping the stored-field bytes so the previous checksum never feeds
 * the next one. `getIntegrityValue` returns the bytes that belong in the stored
 * field; `verifyIntegrity` reports whether the document already matches.
 *
 * Adapt DEFAULT_START / DEFAULT_END to a range that suits your firmware. The
 * panel passes its own range in `api.context.selection` (inclusive), and the
 * stored field in `api.context.storedStart` / `storedEnd` when it has one.
 *
 * Integrity scripts are read-only: `hex.write` is denied without a prompt.
 * Keep the adapted range small - the example reads it byte by byte.
 */

const DEFAULT_START = 0x08000000;
const DEFAULT_END = 0x080000ff;

/**
 * @param {HexScopeAPI} api
 * @returns {{ start: number; end: number }}
 */
function checkRange(api) {
    return api.context.selection ?? { start: DEFAULT_START, end: DEFAULT_END };
}

/**
 * `storedEnd` is only known once the stored-field length is; without it nothing
 * is excluded.
 *
 * @param {HexScopeAPI} api
 * @param {number} address
 * @returns {boolean}
 */
function inStoredField(api, address) {
    const { storedStart, storedEnd } = api.context;
    return storedStart !== undefined && storedEnd !== undefined
        && address >= storedStart && address <= storedEnd;
}

/**
 * @param {HexScopeAPI} api
 * @returns {number}
 */
function checksumByte(api) {
    const { start, end } = checkRange(api);
    let sum = 0;
    for (let address = start; address <= end; address++) {
        if (inStoredField(api, address)) { continue; }
        const byte = api.hex.read(address, 1);
        if (byte.length === 0) { break; } // unmapped: stop at the first gap
        sum = (sum + byte[0]) & 0xff;
    }
    return sum;
}

/**
 * @param {HexScopeAPI} api
 * @returns {Uint8Array}
 */
function getIntegrityValue(api) {
    return new Uint8Array([checksumByte(api)]);
}

/**
 * @param {HexScopeAPI} api
 * @returns {boolean}
 */
function verifyIntegrity(api) {
    const sum = checksumByte(api);
    const storedAddress = api.context.storedStart;
    if (storedAddress === undefined) {
        // Display-only check: nothing to compare against, so report the value.
        api.setResult('Checksum', `0x${sum.toString(16).toUpperCase().padStart(2, '0')}`);
        return true;
    }

    const stored = api.hex.read(storedAddress, 1);
    if (stored.length === 0) { return false; }
    const ok = stored[0] === sum;
    api.setResult('Stored', `0x${stored[0].toString(16).toUpperCase().padStart(2, '0')}`);
    api.setResult('Computed', `0x${sum.toString(16).toUpperCase().padStart(2, '0')}`);
    return ok;
}

module.exports = { getIntegrityValue, verifyIntegrity };
