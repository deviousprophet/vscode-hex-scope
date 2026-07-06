import { computeSRecChecksum, SREC_ADDR_SIZES, srecIsData } from './parser/srecParser';
import type { HexRecord, ParseResult } from './parser/types';

type ParsedRecord = ParseResult['records'][number];

export type HexScopeFormat = 'ihex' | 'srec';

export function detectFormatFromParts(ext: string, raw: string): HexScopeFormat {
    if (['srec', 'mot', 's19', 's28', 's37'].includes(ext)) { return 'srec'; }
    const firstLine = raw.trimStart().slice(0, 4);
    if (/^S[0-9]/i.test(firstLine)) { return 'srec'; }
    return 'ihex';
}

export function serializeIntelHex(originalRaw: string, parseResult: ParseResult, edits: Map<number, number>): string {
    return serializeEditedRecords(
        originalRaw,
        parseResult,
        edits,
        rec => rec.recordType === 0,
        (rec, data) => buildIntelHexDataRecord(rec.address, data),
    );
}

export function serializeSRec(originalRaw: string, parseResult: ParseResult, edits: Map<number, number>): string {
    return serializeEditedRecords(
        originalRaw,
        parseResult,
        edits,
        rec => srecIsData(rec.recordType),
        (rec, data) => buildSRecDataRecord(rec.recordType, rec.resolvedAddress, data),
    );
}

function serializeEditedRecords(
    originalRaw: string,
    parseResult: ParseResult,
    edits: Map<number, number>,
    canEditRecord: (rec: ParsedRecord) => boolean,
    rebuildRecord: (rec: ParsedRecord, data: number[]) => string,
): string {
    if (edits.size === 0) { return originalRaw; }

    const eol = originalRaw.includes('\r\n') ? '\r\n' : '\n';
    const lines = originalRaw.split(/\r?\n/);
    for (const rec of parseResult.records) {
        applySerializedRecordEdit(lines, rec, edits, canEditRecord, rebuildRecord);
    }
    return lines.join(eol);
}

function applySerializedRecordEdit(
    lines: string[],
    rec: ParsedRecord,
    edits: Map<number, number>,
    canEditRecord: (rec: ParsedRecord) => boolean,
    rebuildRecord: (rec: ParsedRecord, data: number[]) => string,
): void {
    const rebuiltRecord = editedRecordText(rec, edits, canEditRecord, rebuildRecord);
    if (rebuiltRecord) { lines[rec.lineNumber - 1] = replaceRecordText(lines[rec.lineNumber - 1], rebuiltRecord); }
}

function editedRecordText(
    rec: ParsedRecord,
    edits: Map<number, number>,
    canEditRecord: (rec: ParsedRecord) => boolean,
    rebuildRecord: (rec: ParsedRecord, data: number[]) => string,
): string | null {
    if (rec.error || !canEditRecord(rec)) { return null; }
    const edited = applyRecordEdits(rec, edits);
    return edited ? rebuildRecord(rec, edited) : null;
}

function replaceRecordText(originalLine: string | undefined, rebuiltRecord: string): string {
    const match = originalLine?.match(/^(\s*)\S+(\s*)$/);
    return match ? `${match[1]}${rebuiltRecord}${match[2]}` : rebuiltRecord;
}

function applyRecordEdits(rec: ParsedRecord, edits: Map<number, number>): number[] | null {
    const data = Array.from(rec.data);
    let changed = false;
    for (let i = 0; i < data.length; i++) {
        const addr = rec.resolvedAddress + i;
        if (edits.has(addr)) {
            data[i] = edits.get(addr)!;
            changed = true;
        }
    }
    return changed ? data : null;
}

function buildIntelHexDataRecord(addr16: number, data: number[]): string {
    const bc = data.length;
    const ah = (addr16 >> 8) & 0xFF;
    const al = addr16 & 0xFF;
    let sum = bc + ah + al;
    for (const b of data) { sum += b; }
    const chk = ((~sum + 1) & 0xFF);
    const body =
        bc.toString(16).toUpperCase().padStart(2, '0') +
        addr16.toString(16).toUpperCase().padStart(4, '0') +
        '00' +
        data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('') +
        chk.toString(16).toUpperCase().padStart(2, '0');
    return ':' + body;
}

export function buildSRecDataRecord(type: number, address: number, data: number[]): string {
    const asz = SREC_ADDR_SIZES[type] ?? 2;
    const byteCount = asz + data.length + 1;
    const chk = computeSRecChecksum(byteCount, address, asz, data);
    const bcHex = byteCount.toString(16).toUpperCase().padStart(2, '0');
    const addrHex = address.toString(16).toUpperCase().padStart(asz * 2, '0');
    const dataHex = data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    const chkHex = chk.toString(16).toUpperCase().padStart(2, '0');
    return `S${type}${bcHex}${addrHex}${dataHex}${chkHex}`;
}

function shouldRepairRecordChecksum(rec: ParsedRecord): boolean {
    return !rec.error && !rec.checksumValid;
}

function repairedChecksumLine(line: string, rec: ParsedRecord): string {
    const correctChk = computeCorrectChecksum(rec);
    return line.slice(0, -2) + correctChk.toString(16).toUpperCase().padStart(2, '0');
}

function repairChecksumLine(lines: string[], rec: ParsedRecord): void {
    if (!shouldRepairRecordChecksum(rec)) { return; }
    const line = lines[rec.lineNumber - 1];
    if (!line) { return; }
    lines[rec.lineNumber - 1] = repairedChecksumLine(line, rec);
}

export function repairChecksums(raw: string, parseResult: ParseResult): string {
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    for (const rec of parseResult.records) {
        repairChecksumLine(lines, rec);
    }
    return lines.join(eol);
}

function srecAddressByteCount(recordType: number): number {
    const aszMap: Record<number, number> = { 0: 2, 1: 2, 2: 3, 3: 4, 5: 2, 6: 3, 7: 4, 8: 3, 9: 2 };
    return aszMap[recordType] ?? 2;
}

function sumRecordData(data: ArrayLike<number>): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) { sum += data[i]; }
    return sum;
}

function sumAddressBytes(address: number, byteCount: number): number {
    let sum = 0;
    for (let i = byteCount - 1; i >= 0; i--) { sum += (address >>> (i * 8)) & 0xFF; }
    return sum;
}

function computeCorrectSRecChecksum(rec: HexRecord): number {
    const sum = rec.byteCount + sumAddressBytes(rec.address, srecAddressByteCount(rec.recordType)) + sumRecordData(rec.data);
    return (~sum) & 0xFF;
}

function computeCorrectIntelHexChecksum(rec: HexRecord): number {
    const addressSum = ((rec.address >> 8) & 0xFF) + (rec.address & 0xFF);
    const sum = rec.byteCount + addressSum + rec.recordType + sumRecordData(rec.data);
    return (~sum + 1) & 0xFF;
}

function computeCorrectChecksum(rec: HexRecord): number {
    return rec.raw.startsWith('S') ? computeCorrectSRecChecksum(rec) : computeCorrectIntelHexChecksum(rec);
}
