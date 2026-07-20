// ── Motorola SREC / S-Record Parser ──────────────────────────────
// Parses Motorola SREC files (.srec / .mot / .s19 / .s28 / .s37)
// and returns a ParseResult.
// Shared interfaces live in ./types so neither parser depends on
// the other.

import type { HexRecord, MemorySegment, ParseResult } from './types';
import { buildContiguousSegments, collectSegmentRanges } from './segments';
import { parseSourceRecords, parseSourceRecordsAsync } from './records';
import { createCompactParseResult, type CompactParseResult, type CompactParserOptions } from './compact';

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

export function computeSRecChecksum(byteCount: number, address: number, addressSize: number, data: Iterable<number>): number {
    let sum = byteCount;
    for (let i = 0; i < addressSize; i++) {
        sum += (address >>> ((addressSize - 1 - i) * 8)) & 0xFF;
    }
    for (const b of data) { sum += b; }
    return (~sum) & 0xFF;
}

// ── Line parser ───────────────────────────────────────────────────

interface SRecLayout {
    byteCount: number;
    addressSize: number;
}

interface ParsedSRecLine {
    recordType: number;
    hex: string;
    layout: SRecLayout;
}

export function parseSRecRecordLine(raw: string, lineNumber: number): HexRecord {
    const base = createBaseRecord(raw, lineNumber);
    const parsed = parseSRecLine(raw, base);
    if (!isParsedSRecLine(parsed)) { return parsed; }
    return buildSRecRecord(raw, lineNumber, parsed);
}

const parseLine = parseSRecRecordLine;

function createBaseRecord(raw: string, lineNumber: number): HexRecord {
    return {
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
}

function parseRecordType(raw: string, base: HexRecord): number | HexRecord {
    const typeChar = raw[1];
    const prefixError = validateRecordPrefix(raw, typeChar, base);
    if (prefixError) { return prefixError; }

    const recordType = parseInt(typeChar, 10);
    const reservedError = validateRecordType(recordType, base);
    if (reservedError) { return reservedError; }

    return recordType;
}

function validateRecordPrefix(raw: string, typeChar: string, base: HexRecord): HexRecord | null {
    if (!raw.startsWith('S') || raw.length < 4) {
        return { ...base, error: 'Missing "S" start code or line too short' };
    }

    if (!/^[0-9]$/.test(typeChar)) {
        return { ...base, error: `Invalid record type character: "${typeChar}"` };
    }

    return null;
}

function validateRecordType(recordType: number, base: HexRecord): HexRecord | null {
    return recordType === 4 ? { ...base, recordType, error: 'Reserved record type: S4' } : null;
}

function validateHexPayload(hex: string, recordType: number, base: HexRecord): HexRecord | null {
    if (!/^[0-9A-Fa-f]+$/.test(hex)) {
        return { ...base, recordType, error: 'Non-hex characters in record' };
    }
    if (hex.length < 4) {
        return { ...base, recordType, error: 'Record too short' };
    }
    return null;
}

function parseSRecLayout(hex: string, recordType: number, base: HexRecord): SRecLayout | HexRecord {
    const byteCount = parseInt(hex.slice(0, 2), 16);
    const addressSize = SREC_ADDR_SIZES[recordType] ?? 2;
    const layout = { byteCount, addressSize };

    return validateSRecByteCount(layout, recordType, base)
        ?? validateSRecHexLength(hex, layout, recordType, base)
        ?? layout;
}

function isSRecLayout(result: SRecLayout | HexRecord): result is SRecLayout {
    return 'addressSize' in result;
}

function parseSRecAddress(hex: string, addressSize: number): number {
    let address = 0;
    for (let i = 0; i < addressSize; i++) {
        address = (address * 256 + parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16));
    }
    return address >>> 0;
}

function parseSRecData(hex: string, layout: SRecLayout): Uint8Array {
    const dataOffset = 2 + layout.addressSize * 2;
    const dataLen = layout.byteCount - layout.addressSize - 1;
    const data = new Uint8Array(Math.max(0, dataLen));
    for (let i = 0; i < data.length; i++) {
        data[i] = parseInt(hex.slice(dataOffset + i * 2, dataOffset + i * 2 + 2), 16);
    }
    return data;
}

function parseSRecLine(raw: string, base: HexRecord): ParsedSRecLine | HexRecord {
    const recordTypeResult = parseRecordType(raw, base);
    if (typeof recordTypeResult !== 'number') { return recordTypeResult; }

    const recordType = recordTypeResult;
    const hex = raw.slice(2); // everything after "Sn"
    const hexError = validateHexPayload(hex, recordType, base);
    if (hexError) { return hexError; }

    const layoutResult = parseSRecLayout(hex, recordType, base);
    if (!isSRecLayout(layoutResult)) { return layoutResult; }

    return { recordType, hex, layout: layoutResult };
}

function isParsedSRecLine(result: ParsedSRecLine | HexRecord): result is ParsedSRecLine {
    return 'layout' in result;
}

function validateSRecByteCount(layout: SRecLayout, recordType: number, base: HexRecord): HexRecord | null {
    if (layout.byteCount < layout.addressSize + 1) {
        return { ...base, recordType, byteCount: layout.byteCount,
                 error: `Byte count ${layout.byteCount} too small for S${recordType} (minimum ${layout.addressSize + 1})` };
    }

    if (isInvalidCountRecord(recordType, layout)) {
        return { ...base, recordType, byteCount: layout.byteCount,
                 error: `S${recordType} must have byte count ${layout.addressSize + 1}, got ${layout.byteCount}` };
    }

    return null;
}

function isInvalidCountRecord(recordType: number, layout: SRecLayout): boolean {
    return recordType >= 5 && layout.byteCount !== layout.addressSize + 1;
}

function validateSRecHexLength(
    hex: string,
    layout: SRecLayout,
    recordType: number,
    base: HexRecord,
): HexRecord | null {
    const expectedHexLen = 2 + layout.byteCount * 2;
    if (hex.length === expectedHexLen) { return null; }

    return {
        ...base, recordType, byteCount: layout.byteCount,
        error: `Expected ${expectedHexLen} hex chars, got ${hex.length}`,
    };
}

function buildSRecRecord(raw: string, lineNumber: number, parsed: ParsedSRecLine): HexRecord {
    const address = parseSRecAddress(parsed.hex, parsed.layout.addressSize);
    const data = parseSRecData(parsed.hex, parsed.layout);
    const checksum = parseInt(parsed.hex.slice(parsed.hex.length - 2), 16);
    const expectedChecksum = computeSRecChecksum(parsed.layout.byteCount, address, parsed.layout.addressSize, data);

    return {
        lineNumber,
        raw,
        byteCount: parsed.layout.byteCount,
        address,
        recordType: parsed.recordType,
        data,
        checksum,
        checksumValid: checksum === expectedChecksum,
        resolvedAddress: srecIsData(parsed.recordType) ? address : 0,
    };
}

// ── Segment builder ───────────────────────────────────────────────

function buildSegments(records: HexRecord[]): MemorySegment[] {
    return buildContiguousSegments(records, rec => srecIsData(rec.recordType));
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Parse a Motorola SREC source string.
 * Returns a {@link ParseResult} with the same shape as {@link parseIntelHex}
 * so the rest of the extension can be format-agnostic.
 */
export function parseSRec(source: string): ParseResult {
    let startAddress: number | undefined;

    const { records, checksumErrors, malformedLines } = parseSourceRecords(source, parseLine, record => {
        // S7/S8/S9 carry the execution start address
        if (record.recordType === 7 || record.recordType === 8 || record.recordType === 9) {
            startAddress = record.address;
        }
    });

    const segments = buildSegments(records);
    const totalDataBytes = segments.reduce((s, seg) => s + seg.data.length, 0);

    return { records, segments, totalDataBytes, checksumErrors, malformedLines, startAddress };
}

export async function parseSRecCompact(source: string, options: CompactParserOptions = {}): Promise<CompactParseResult> {
    let startAddress: number | undefined;
    const parsed = await parseSourceRecordsAsync(source, parseLine, record => {
        if (record.recordType === 7 || record.recordType === 8 || record.recordType === 9) {
            startAddress = record.address;
        }
    }, options);
    const segRanges = collectSegmentRanges(parsed.records, rec => srecIsData(rec.recordType));
    options.onProgress?.({ stage: 'build', completed: 0, total: parsed.records.length });
    return createCompactParseResult(parsed, segRanges, options, startAddress, rec => srecIsData(rec.recordType));
}
