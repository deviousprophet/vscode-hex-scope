/// <reference path="./types/hexscope.d.ts" />

/**
 * Address source for a Type Overlay instance.
 *
 * @script address
 *
 * Adapt POINTER_AT to the location that stores the pointer. The script reads a
 * little-endian 32-bit value there and returns it as the instance's base
 * address, so one instance definition follows files whose pointers move.
 *
 * Address scripts are read-only: `hex.write` is denied without a prompt.
 */

const POINTER_AT = 0x08000000;
const POINTER_BYTES = 4;

export function getAddress(api: HexScopeAPI): number {
    const hexAt = `0x${POINTER_AT.toString(16).toUpperCase()}`;
    const raw = api.hex.read(POINTER_AT, POINTER_BYTES);
    if (raw.length < POINTER_BYTES) {
        throw new Error(`No ${POINTER_BYTES}-byte pointer mapped at ${hexAt} — adapt POINTER_AT in this script.`);
    }

    const address = (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0;
    api.output(`Pointer at ${hexAt} → 0x${address.toString(16).toUpperCase().padStart(8, '0')}`);
    return address;
}
