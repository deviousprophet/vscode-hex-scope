// ── Intel HEX Parser ─────────────────────────────────────────────
// Parses Intel HEX files (.hex) and returns a ParseResult.
// Shared interfaces live in ./types so neither parser depends on
// the other.

import type { HexRecord, MemorySegment, ParseResult } from './types';
export type { HexRecord, MemorySegment, ParseResult } from './types';

// ── Record-type metadata ──────────────────────────────────────────

/** Numeric constants for Intel HEX record types. */
export const enum RecordType {
    Data                 = 0x00,
    EndOfFile            = 0x01,
    ExtendedSegmentAddress = 0x02,
    StartSegmentAddress  = 0x03,
    ExtendedLinearAddress  = 0x04,
    StartLinearAddress   = 0x05,
}

/** Display names for Intel HEX record types. */
export const RECORD_TYPE_NAMES: Record<number, string> = {
    0x00: 'Data',
    0x01: 'End of File',
    0x02: 'Ext Segment Addr',
    0x03: 'Start Segment Addr',
    0x04: 'Ext Linear Addr',
    0x05: 'Start Linear Addr',
};

// ── Public API ───────────────────────────────────────────────────

/**
 * Parse an Intel HEX source string.
 * Returns a {@link ParseResult} with all records, contiguous memory
 * segments, checksum error count, and optional execution start address.
 */
export function parseIntelHex(source: string): ParseResult {
    const lines = source.split(/\r?\n/);
    const records: HexRecord[] = [];
    let upperAddress = 0; // holds upper 16 bits (type 04) or segment (type 02)
    let addressMode: 'linear' | 'segment' = 'linear';
    let checksumErrors = 0;
    let malformedLines = 0;
    let startAddress: number | undefined;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();

        if (trimmed === '') {
            continue;
        }

        const record = parseLine(trimmed, i + 1);
        records.push(record);

        if (record.error) {
            malformedLines++;
            continue;
        }

        if (!record.checksumValid) {
            checksumErrors++;
        }

        switch (record.recordType) {
            case RecordType.ExtendedLinearAddress:
                addressMode = 'linear';
                upperAddress = (record.data[0] << 8 | record.data[1]) << 16;
                break;
            case RecordType.ExtendedSegmentAddress:
                addressMode = 'segment';
                upperAddress = (record.data[0] << 8 | record.data[1]) << 4;
                break;
            case RecordType.StartLinearAddress:
                startAddress = (record.data[0] << 24) | (record.data[1] << 16) | (record.data[2] << 8) | record.data[3];
                break;
            case RecordType.StartSegmentAddress:
                startAddress = ((record.data[0] << 8 | record.data[1]) << 4) + (record.data[2] << 8 | record.data[3]);
                break;
        }

        if (record.recordType === RecordType.Data) {
            record.resolvedAddress = addressMode === 'linear'
                ? (upperAddress + record.address) >>> 0
                : (upperAddress + record.address) & 0xFFFFF;
        }
    }

    const segments = buildSegments(records);
    const totalDataBytes = segments.reduce((sum, s) => sum + s.data.length, 0);

    return { records, segments, totalDataBytes, checksumErrors, malformedLines, startAddress };
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

    if (raw[0] !== ':') {
        return { ...base, error: 'Missing start code ":"' };
    }

    const hex = raw.slice(1);

    if (!/^[0-9A-Fa-f]+$/.test(hex)) {
        return { ...base, error: 'Non-hex characters in record' };
    }

    if (hex.length < 10) {
        return { ...base, error: 'Record too short' };
    }

    const byteCount = parseInt(hex.slice(0, 2), 16);
    const expectedLength = 10 + byteCount * 2;

    if (hex.length !== expectedLength) {
        return { ...base, error: `Expected ${expectedLength} hex chars, got ${hex.length}` };
    }

    const address = parseInt(hex.slice(2, 6), 16);
    const recordType = parseInt(hex.slice(6, 8), 16);
    const data = new Uint8Array(byteCount);

    for (let i = 0; i < byteCount; i++) {
        data[i] = parseInt(hex.slice(8 + i * 2, 10 + i * 2), 16);
    }

    const checksum = parseInt(hex.slice(8 + byteCount * 2), 16);

    // Validate checksum: two's complement of sum of all bytes
    let sum = byteCount + ((address >> 8) & 0xFF) + (address & 0xFF) + recordType;
    for (const b of data) {sum += b;}
    const expectedChecksum = ((~sum + 1) & 0xFF);
    const checksumValid = checksum === expectedChecksum;

    // Structural validation: unknown record type
    if (!(recordType in RECORD_TYPE_NAMES)) {
        return { lineNumber, raw, byteCount, address, recordType, data, checksum, checksumValid, resolvedAddress: 0,
                 error: `Unknown record type: 0x${recordType.toString(16).toUpperCase().padStart(2, '0')}` };
    }

    // Structural validation: byte count must match the fixed size for non-data record types
    const REQUIRED_BYTE_COUNT: Partial<Record<number, number>> = { 0x01: 0, 0x02: 2, 0x03: 4, 0x04: 2, 0x05: 4 };
    const requiredBC = REQUIRED_BYTE_COUNT[recordType];
    if (requiredBC !== undefined && byteCount !== requiredBC) {
        return { lineNumber, raw, byteCount, address, recordType, data, checksum, checksumValid, resolvedAddress: 0,
                 error: `${RECORD_TYPE_NAMES[recordType]} must have byte count ${requiredBC}, got ${byteCount}` };
    }

    return { lineNumber, raw, byteCount, address, recordType, data, checksum, checksumValid, resolvedAddress: 0 };
}

// ── Segment builder ───────────────────────────────────────────────

function buildSegments(records: HexRecord[]): MemorySegment[] {
    const blocks: { address: number; data: number[] }[] = [];
    let current: { address: number; data: number[] } | null = null;

    for (const rec of records) {
        if (rec.error || rec.recordType !== RecordType.Data || !rec.checksumValid) {
            continue;
        }

        if (!current) {
            current = { address: rec.resolvedAddress, data: [] };
            blocks.push(current);
        } else if (rec.resolvedAddress !== current.address + current.data.length) {
            // Gap — start a new segment
            current = { address: rec.resolvedAddress, data: [] };
            blocks.push(current);
        }

        for (const b of rec.data) {current.data.push(b);}
    }

    return blocks.map(b => ({ startAddress: b.address, data: new Uint8Array(b.data) }));
}
