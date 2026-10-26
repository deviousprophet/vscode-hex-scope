import { CompactRecordStore, type CompactParseResult } from './compact';
import type { MemorySegment } from './types';

/** Default base address for a raw image with no stored profile value. */
export const DEFAULT_BIN_BASE_ADDRESS = 0;

const MAX_ADDRESS = 0xFFFF_FFFF;
/** One past the highest 32-bit address; `base + size` must not exceed this. */
const ADDRESS_SPACE = 0x1_0000_0000;
const HEX_ADDRESS = /^(?:0[xX])?([0-9a-fA-F]{1,8})$/;

export type BaseAddressValidation =
    | { ok: true; value: number }
    | { ok: false; error: string };

export interface BinEditApplication {
    applied: Array<[number, number]>;
    previous: Array<[number, number]>;
}

/** True for a 32-bit unsigned integer address (0 .. 0xFFFFFFFF). */
export function isValidBinBaseAddress(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= 0
        && value <= MAX_ADDRESS;
}

/** True when `[baseAddress, baseAddress + byteLength)` stays inside the 32-bit address space. */
export function binAddressRangeFits(baseAddress: number, byteLength: number): boolean {
    if (!isValidBinBaseAddress(baseAddress)) { return false; }
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) { return false; }
    return baseAddress + byteLength <= ADDRESS_SPACE;
}

/**
 * Parse the base-address prompt text: optional `0x`/`0X`, 1-8 hex digits,
 * case-insensitive. Rejects signs, separators, decimal-only text, and a range
 * that overflows the 32-bit address space for this image size.
 */
export function parseBinBaseAddress(input: string, byteLength: number): BaseAddressValidation {
    const text = input.trim();
    if (!text) { return { ok: false, error: 'Enter a base address.' }; }
    const match = HEX_ADDRESS.exec(text);
    if (!match) { return { ok: false, error: 'Use hexadecimal digits only (0x00000000–0xFFFFFFFF).' }; }
    const value = parseInt(match[1], 16);
    if (!binAddressRangeFits(value, byteLength)) {
        return {
            ok: false,
            error: `${formatBinBaseAddress(value)} + ${byteLength} bytes exceeds the 32-bit address space.`,
        };
    }
    return { ok: true, value };
}

/** Inline validation message for a base-address input; null when valid. */
export function validateBinBaseAddressInput(input: string, byteLength: number): string | null {
    const parsed = parseBinBaseAddress(input, byteLength);
    return parsed.ok ? null : parsed.error;
}

/** Display/prefill form: `0x` plus eight uppercase hex digits. */
export function formatBinBaseAddress(value: number): string {
    return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * Whole-file raw image as one contiguous segment anchored at `baseAddress`.
 * No records, no checksums, no execution start address; the input bytes are
 * kept by identity (no copy).
 */
export function createBinParseResult(bytes: Uint8Array, baseAddress: number): CompactParseResult {
    const segments: MemorySegment[] = bytes.length > 0
        ? [{ startAddress: baseAddress, data: bytes }]
        : [];
    return {
        records: CompactRecordStore.fromSerialized([], 0),
        segments,
        totalDataBytes: bytes.length,
        checksumErrors: 0,
        malformedLines: 0,
        baseAddress,
    };
}

/**
 * Apply staged byte edits to the single raw-binary segment. Only mapped,
 * integer byte values change; prior bytes are recorded so a failed write can
 * restore the in-memory buffer. The segment length never changes.
 */
export function applyBinEdits(segment: MemorySegment, edits: ReadonlyMap<number, number>): BinEditApplication {
    const applied: Array<[number, number]> = [];
    const previous: Array<[number, number]> = [];
    for (const [address, value] of edits) {
        if (!isMappedByteEdit(segment, address, value)) { continue; }
        const offset = address - segment.startAddress;
        previous.push([address, segment.data[offset]]);
        segment.data[offset] = value;
        applied.push([address, value]);
    }
    return { applied, previous };
}

function isMappedByteEdit(segment: MemorySegment, address: number, value: number): boolean {
    const offset = address - segment.startAddress;
    return isByteValue(value) && isMappedOffset(offset, segment.data.length);
}

function isByteValue(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 0xFF;
}

function isMappedOffset(offset: number, length: number): boolean {
    return Number.isInteger(offset) && offset >= 0 && offset < length;
}

/** Restore the prior bytes recorded by {@link applyBinEdits}. */
export function revertBinEdits(segment: MemorySegment, previous: ReadonlyArray<[number, number]>): void {
    for (const [address, value] of previous) {
        const offset = address - segment.startAddress;
        if (offset >= 0 && offset < segment.data.length) { segment.data[offset] = value; }
    }
}
