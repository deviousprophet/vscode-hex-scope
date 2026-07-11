// ── Intel HEX Parser ─────────────────────────────────────────────
// Parses Intel HEX files (.hex, .ihx, .ihex) and returns a ParseResult.
// Shared interfaces live in ./types so neither parser depends on
// the other.

import type { HexRecord, MemorySegment, ParseResult } from './types';
import { buildContiguousSegments, buildContiguousSegmentsAsync } from './segments';
import { parseSourceRecords, parseSourceRecordsAsync } from './records';
import { CompactRecordStore, type CompactParseResult, type CompactParserOptions } from './compact';

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
const RECORD_TYPE_NAMES: Record<number, string> = {
    0x00: 'Data',
    0x01: 'End of File',
    0x02: 'Ext Segment Addr',
    0x03: 'Start Segment Addr',
    0x04: 'Ext Linear Addr',
    0x05: 'Start Linear Addr',
};

const REQUIRED_BYTE_COUNT: Partial<Record<number, number>> = {
    0x01: 0,
    0x02: 2,
    0x03: 4,
    0x04: 2,
    0x05: 4,
};

interface IntelHexFields {
    byteCount: number;
    address: number;
    recordType: number;
    data: Uint8Array;
    checksum: number;
    checksumValid: boolean;
}

interface IntelHexAddressState {
    upperAddress: number;
    addressMode: 'linear' | 'segment';
    startAddress?: number;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Parse an Intel HEX source string.
 * Returns a {@link ParseResult} with all records, contiguous memory
 * segments, checksum error count, and optional execution start address.
 */
export function parseIntelHex(source: string): ParseResult {
    const addressState: IntelHexAddressState = {
        upperAddress: 0,
        addressMode: 'linear',
    };

    const { records, checksumErrors, malformedLines } = parseSourceRecords(source, parseLine, record => {
        updateIntelHexAddressState(record, addressState);
    });

    const segments = buildSegments(records);
    const totalDataBytes = segments.reduce((sum, s) => sum + s.data.length, 0);

    return { records, segments, totalDataBytes, checksumErrors, malformedLines, startAddress: addressState.startAddress };
}

export async function parseIntelHexCompact(source: string, options: CompactParserOptions = {}): Promise<CompactParseResult> {
    const addressState: IntelHexAddressState = { upperAddress: 0, addressMode: 'linear' };
    const parsed = await parseSourceRecordsAsync(source, parseLine, record => {
        updateIntelHexAddressState(record, addressState);
    }, options);
    options.onProgress?.({ stage: 'build', completed: 0, total: parsed.records.length });
    const segments = await buildContiguousSegmentsAsync(parsed.records, rec => rec.recordType === RecordType.Data, options);
    const records = await CompactRecordStore.create(parsed.records, parsed.ranges, options);
    const totalDataBytes = segments.reduce((sum, segment) => sum + segment.data.length, 0);
    return {
        records,
        segments,
        totalDataBytes,
        checksumErrors: parsed.checksumErrors,
        malformedLines: parsed.malformedLines,
        startAddress: addressState.startAddress,
    };
}

function updateIntelHexAddressState(record: HexRecord, state: IntelHexAddressState): void {
    INTEL_HEX_ADDRESS_HANDLERS[record.recordType]?.(record, state);
}

const INTEL_HEX_ADDRESS_HANDLERS: Partial<Record<number, (record: HexRecord, state: IntelHexAddressState) => void>> = {
    [RecordType.ExtendedLinearAddress]: setLinearAddressState,
    [RecordType.ExtendedSegmentAddress]: setSegmentAddressState,
    [RecordType.StartLinearAddress]: (record, state) => { state.startAddress = linearStartAddress(record); },
    [RecordType.StartSegmentAddress]: (record, state) => { state.startAddress = segmentStartAddress(record); },
    [RecordType.Data]: (record, state) => { record.resolvedAddress = resolvedIntelHexAddress(record, state); },
};

function setLinearAddressState(record: HexRecord, state: IntelHexAddressState): void {
    state.addressMode = 'linear';
    state.upperAddress = (record.data[0] << 8 | record.data[1]) << 16;
}

function setSegmentAddressState(record: HexRecord, state: IntelHexAddressState): void {
    state.addressMode = 'segment';
    state.upperAddress = (record.data[0] << 8 | record.data[1]) << 4;
}

function linearStartAddress(record: HexRecord): number {
    return (record.data[0] << 24) | (record.data[1] << 16) | (record.data[2] << 8) | record.data[3];
}

function segmentStartAddress(record: HexRecord): number {
    return ((record.data[0] << 8 | record.data[1]) << 4) + (record.data[2] << 8 | record.data[3]);
}

function resolvedIntelHexAddress(record: HexRecord, state: IntelHexAddressState): number {
    return state.addressMode === 'linear'
        ? (state.upperAddress + record.address) >>> 0
        : (state.upperAddress + record.address) & 0xFFFFF;
}

// ── Line parser ───────────────────────────────────────────────────

export function parseIntelHexLine(raw: string, lineNumber: number): HexRecord {
    const base = createBaseRecord(raw, lineNumber);
    const hexResult = parseIntelHexPayload(raw, base);
    if (typeof hexResult !== 'string') { return hexResult; }

    const fields = parseIntelHexFields(hexResult);
    const error = validateIntelHexFields(fields);
    return buildIntelHexRecord(raw, lineNumber, fields, error);
}

const parseLine = parseIntelHexLine;

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

function parseIntelHexPayload(raw: string, base: HexRecord): string | HexRecord {
    if (raw[0] !== ':') {
        return { ...base, error: 'Missing start code ":"' };
    }

    const hex = raw.slice(1);
    return validateIntelHexPayload(hex, base) ?? hex;
}

function validateIntelHexPayload(hex: string, base: HexRecord): HexRecord | null {
    if (!/^[0-9A-Fa-f]+$/.test(hex)) {
        return { ...base, error: 'Non-hex characters in record' };
    }
    if (hex.length < 10) {
        return { ...base, error: 'Record too short' };
    }

    const expectedLength = 10 + parseInt(hex.slice(0, 2), 16) * 2;
    if (hex.length !== expectedLength) {
        return { ...base, error: `Expected ${expectedLength} hex chars, got ${hex.length}` };
    }
    return null;
}

function parseIntelHexFields(hex: string): IntelHexFields {
    const byteCount = parseInt(hex.slice(0, 2), 16);
    const address = parseInt(hex.slice(2, 6), 16);
    const recordType = parseInt(hex.slice(6, 8), 16);
    const data = parseIntelHexData(hex, byteCount);
    const checksum = parseInt(hex.slice(8 + byteCount * 2), 16);
    const checksumValid = checksum === computeIntelHexChecksum(byteCount, address, recordType, data);
    return { byteCount, address, recordType, data, checksum, checksumValid };
}

function parseIntelHexData(hex: string, byteCount: number): Uint8Array {
    const data = new Uint8Array(byteCount);
    for (let i = 0; i < byteCount; i++) {
        data[i] = parseInt(hex.slice(8 + i * 2, 10 + i * 2), 16);
    }
    return data;
}

function computeIntelHexChecksum(byteCount: number, address: number, recordType: number, data: Uint8Array): number {
    let sum = byteCount + ((address >> 8) & 0xFF) + (address & 0xFF) + recordType;
    for (const b of data) { sum += b; }
    return ((~sum + 1) & 0xFF);
}

function validateIntelHexFields(fields: IntelHexFields): string | undefined {
    if (!(fields.recordType in RECORD_TYPE_NAMES)) {
        return `Unknown record type: 0x${fields.recordType.toString(16).toUpperCase().padStart(2, '0')}`;
    }

    const requiredByteCount = REQUIRED_BYTE_COUNT[fields.recordType];
    if (requiredByteCount !== undefined && fields.byteCount !== requiredByteCount) {
        return `${RECORD_TYPE_NAMES[fields.recordType]} must have byte count ${requiredByteCount}, got ${fields.byteCount}`;
    }
    return undefined;
}

function buildIntelHexRecord(
    raw: string,
    lineNumber: number,
    fields: IntelHexFields,
    error?: string,
): HexRecord {
    return {
        lineNumber,
        raw,
        byteCount: fields.byteCount,
        address: fields.address,
        recordType: fields.recordType,
        data: fields.data,
        checksum: fields.checksum,
        checksumValid: fields.checksumValid,
        resolvedAddress: 0,
        ...(error ? { error } : {}),
    };
}

// ── Segment builder ───────────────────────────────────────────────

function buildSegments(records: HexRecord[]): MemorySegment[] {
    return buildContiguousSegments(records, rec => rec.recordType === RecordType.Data);
}
