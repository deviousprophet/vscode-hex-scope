// ── Motorola SREC / S-Record Parser ──────────────────────────────
// Parses Motorola SREC files (.srec / .mot / .s19 / .s28 / .s37)
// and returns a ParseResult.
// Shared interfaces live in ./types so neither parser depends on
// the other.

import type { HexRecord, MemorySegment, ParseResult } from './types';

// ── SREC record-type metadata ─────────────────────────────────────

/**
 * Number of address bytes for each SREC record type.
 *   S0, S1, S5, S9 → 2-byte address
 *   S2, S6, S8     → 3-byte address
 *   S3, S7         → 4-byte address
 */
export const SREC_ADDR_SIZES: Record<number, number> = {
    0: 2, 1: 2, 2: 3, 3: 4, 5: 2, 6: 3, 7: 4, 8: 3, 9: 2,
};

/** Returns true for SREC record types that carry data payload (S1, S2, S3). */
export function srecIsData(type: number): boolean {
    return type === 1 || type === 2 || type === 3;
}

// ── Line parser ───────────────────────────────────────────────────

function parseLine(raw: string, lineNumber: number): HexRecord {
    const base: HexRecord = {
        lineNumber,
        raw,
        byteCount: 0,
        address: 0,
        recordType: 0,
        data: new Uint8Array(0),
        checksum: 0,
        checksumValid: false,
        resolvedAddress: 0,
    };

    if (!raw.startsWith('S') || raw.length < 4) {
        return { ...base, error: 'Missing "S" start code or line too short' };
    }

    const typeChar = raw[1];
    if (!/^[0-9]$/.test(typeChar)) {
        return { ...base, error: `Invalid record type character: "${typeChar}"` };
    }
    const recordType = parseInt(typeChar, 10);

    // S4 is reserved and undefined in the SREC standard
    if (recordType === 4) {
        return { ...base, recordType, error: 'Reserved record type: S4' };
    }

    const hex = raw.slice(2); // everything after "Sn"

    if (!/^[0-9A-Fa-f]+$/.test(hex)) {
        return { ...base, recordType, error: 'Non-hex characters in record' };
    }
    if (hex.length < 4) {
        return { ...base, recordType, error: 'Record too short' };
    }

    const byteCount = parseInt(hex.slice(0, 2), 16);
    const asz = SREC_ADDR_SIZES[recordType] ?? 2;

    // byteCount covers: address bytes + data bytes + 1 checksum byte (minimum = asz + 1)
    if (byteCount < asz + 1) {
        return { ...base, recordType, byteCount,
                 error: `Byte count ${byteCount} too small for S${recordType} (minimum ${asz + 1})` };
    }

    // S5-S9 carry no data payload; byte count must be exactly asz+1
    if (recordType >= 5 && byteCount !== asz + 1) {
        return { ...base, recordType, byteCount,
                 error: `S${recordType} must have byte count ${asz + 1}, got ${byteCount}` };
    }

    // Total hex chars: 2 (byteCount field) + byteCount * 2 (all remaining bytes)
    const expectedHexLen = 2 + byteCount * 2;
    if (hex.length !== expectedHexLen) {
        return {
            ...base, recordType, byteCount,
            error: `Expected ${expectedHexLen} hex chars, got ${hex.length}`,
        };
    }

    // ── Parse address ─────────────────────────────────────────────
    let address = 0;
    for (let i = 0; i < asz; i++) {
        address = (address * 256 + parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16));
    }
    address = address >>> 0; // coerce to unsigned 32-bit

    // ── Parse data bytes ──────────────────────────────────────────
    const dataOffset = 2 + asz * 2;
    const dataLen = byteCount - asz - 1; // byteCount − addrBytes − checksumByte
    const data = new Uint8Array(Math.max(0, dataLen));
    for (let i = 0; i < data.length; i++) {
        data[i] = parseInt(hex.slice(dataOffset + i * 2, dataOffset + i * 2 + 2), 16);
    }

    // ── Checksum (last byte) ──────────────────────────────────────
    const checksum = parseInt(hex.slice(hex.length - 2), 16);

    // Validate: one's complement of sum of byteCount + address bytes + data bytes
    let sum = byteCount;
    for (let i = 0; i < asz; i++) {
        sum += (address >>> ((asz - 1 - i) * 8)) & 0xFF;
    }
    for (const b of data) { sum += b; }
    const expectedChecksum = (~sum) & 0xFF;
    const checksumValid = checksum === expectedChecksum;

    return {
        lineNumber,
        raw,
        byteCount,
        address,
        recordType,
        data,
        checksum,
        checksumValid,
        resolvedAddress: srecIsData(recordType) ? address : 0,
    };
}

// ── Segment builder ───────────────────────────────────────────────

function buildSegments(records: HexRecord[]): MemorySegment[] {
    const blocks: { address: number; data: number[] }[] = [];
    let current: { address: number; data: number[] } | null = null;

    for (const rec of records) {
        if (rec.error || !srecIsData(rec.recordType) || !rec.checksumValid) {
            continue;
        }
        if (!current) {
            current = { address: rec.resolvedAddress, data: [] };
            blocks.push(current);
        } else if (rec.resolvedAddress !== current.address + current.data.length) {
            // Address gap — start a new segment
            current = { address: rec.resolvedAddress, data: [] };
            blocks.push(current);
        }
        for (const b of rec.data) { current.data.push(b); }
    }

    return blocks.map(b => ({ startAddress: b.address, data: new Uint8Array(b.data) }));
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Parse a Motorola SREC source string.
 * Returns a {@link ParseResult} with the same shape as {@link parseIntelHex}
 * so the rest of the extension can be format-agnostic.
 */
export function parseSRec(source: string): ParseResult {
    const lines = source.split(/\r?\n/);
    const records: HexRecord[] = [];
    let checksumErrors = 0;
    let malformedLines = 0;
    let startAddress: number | undefined;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (trimmed === '') { continue; }

        const record = parseLine(trimmed, i + 1);
        records.push(record);

        if (record.error) { malformedLines++; continue; }
        if (!record.checksumValid) { checksumErrors++; }

        // S7/S8/S9 carry the execution start address
        if (record.recordType === 7 || record.recordType === 8 || record.recordType === 9) {
            startAddress = record.address;
        }
    }

    const segments = buildSegments(records);
    const totalDataBytes = segments.reduce((s, seg) => s + seg.data.length, 0);

    return { records, segments, totalDataBytes, checksumErrors, malformedLines, startAddress };
}
