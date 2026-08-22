import { computeSRecChecksum, SREC_ADDR_SIZES, srecIsData } from './parser/srecParser';
import type { HexRecord, ParseResult } from './parser/types';
import { workBudgetRuntime, yieldWhenDue, type WorkBudgetOptions } from './workBudget';

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

export function serializeIntelHexAsync(
    originalRaw: string,
    parseResult: ParseResult,
    edits: Map<number, number>,
    options: WorkBudgetOptions = {},
): Promise<string> {
    return serializeEditedRecordsAsync(
        originalRaw,
        parseResult,
        edits,
        rec => rec.recordType === 0,
        (rec, data) => buildIntelHexDataRecord(rec.address, data),
        options,
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

// ── Targeted line splice (no record materialization) ─────────────
// Save path for large files: scan raw lines cheaply (address from the line
// text, no full HexRecord parse/checksum), rebuild only data records whose
// address range overlaps the edited set, splice them back. Everything else is
// byte-identical. The plan exposes per-line byte patches so the host can write
// positionally (only edited ranges hit the disk) instead of rewriting the file.

interface SplicedLine {
    lineIndex: number;
    recordType: number;
    /** Record framing address (16-bit for ihex, full for srec) — used to rebuild the line. */
    address: number;
    /** Absolute start of the record's data — used to match edit keys. */
    startAddress: number;
    data: number[];
}

/** A byte-range rewrite of one record line (byte offset in the file). */
export interface SplicePatch {
    offset: number;
    bytes: Uint8Array;
}

export interface SplicePlan {
    /** Patched full text — what the file must contain after the save. */
    newRaw: string;
    /** Positional patches for the edited lines; null when a full write is required
        (non-ASCII content or a rebuilt line length would change). */
    patches: SplicePatch[] | null;
}

export function spliceEditedLines(originalRaw: string, edits: Map<number, number>, format: HexScopeFormat): string {
    return buildSplicePlan(originalRaw, edits, format).newRaw;
}

export function buildSplicePlan(originalRaw: string, edits: Map<number, number>, format: HexScopeFormat): SplicePlan {
    if (edits.size === 0) { return { newRaw: originalRaw, patches: [] }; }
    const eol = originalRaw.includes('\r\n') ? '\r\n' : '\n';
    const eolLen = eol.length;
    const lines = originalRaw.split(/\r?\n/);
    const owners = format === 'srec' ? srecOwnerLines(lines, edits) : intelOwnerLines(lines, edits);

    const replacements = new Map<number, string>();
    let safe = true;
    for (const owner of owners) {
        const rebuilt = rebuiltSpliceLine(owner, edits);
        if (rebuilt === null) { continue; }
        const full = replaceRecordText(lines[owner.lineIndex], rebuilt);
        replacements.set(owner.lineIndex, full);
        if (full.length !== lines[owner.lineIndex].length) { safe = false; }
    }
    for (const [i, line] of lines.entries()) {
        if (safe && /[^\x00-\x7F]/.test(line)) { safe = false; }
        const full = replacements.get(i);
        if (full !== undefined) { lines[i] = full; }
    }

    if (!safe) { return { newRaw: lines.join(eol), patches: null }; }
    const patches: SplicePatch[] = [];
    const encoder = new TextEncoder();
    let byteOffset = 0;
    for (const [i, line] of lines.entries()) {
        const patchText = replacements.get(i);
        if (patchText !== undefined) { patches.push({ offset: byteOffset, bytes: encoder.encode(patchText) }); }
        byteOffset += line.length + eolLen;
    }
    return { newRaw: lines.join(eol), patches };
}

function intelOwnerLines(lines: string[], edits: Map<number, number>): SplicedLine[] {
    const out: SplicedLine[] = [];
    let upper = 0;
    const re = /^:([0-9a-fA-F]{2})([0-9a-fA-F]{4})([0-9a-fA-F]{2})/;
    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (!m) { continue; }
        const count = parseInt(m[1], 16);
        const addr16 = parseInt(m[2], 16);
        const type = parseInt(m[3], 16);
        if (type === 4 && count >= 2) {
            const upperHex = lines[i].slice(9, 13);
            if (/^[0-9a-fA-F]{4}$/.test(upperHex)) { upper = parseInt(upperHex, 16) << 16; }
            continue;
        }
        if (type !== 0 || count === 0) { continue; }
        const start = upper | addr16;
        if (!hasEditInRange(edits, start, start + count - 1)) { continue; }
        const payload = hexToBytes(lines[i].slice(9, 9 + count * 2));
        if (payload.length === count) { out.push({ lineIndex: i, recordType: 0, address: addr16, startAddress: start, data: payload }); }
    }
    return out;
}

function srecOwnerLines(lines: string[], edits: Map<number, number>): SplicedLine[] {
    const out: SplicedLine[] = [];
    const re = /^S([0-9])([0-9a-fA-F]{2})/;
    for (let i = 0; i < lines.length; i++) {
        const m = re.exec(lines[i]);
        if (!m) { continue; }
        const recordType = parseInt(m[1], 10);
        if (!srecIsData(recordType)) { continue; }
        const byteCount = parseInt(m[2], 16);
        const asz = SREC_ADDR_SIZES[recordType] ?? 2;
        const dataLen = byteCount - asz - 1;
        if (dataLen <= 0) { continue; }
        const addrRaw = lines[i].slice(4, 4 + asz * 2);
        if (!/^[0-9a-fA-F]+$/.test(addrRaw)) { continue; }
        const address = parseInt(addrRaw, 16);
        if (!hasEditInRange(edits, address, address + dataLen - 1)) { continue; }
        const payload = hexToBytes(lines[i].slice(4 + asz * 2, 4 + asz * 2 + dataLen * 2));
        if (payload.length === dataLen) { out.push({ lineIndex: i, recordType, address, startAddress: address, data: payload }); }
    }
    return out;
}

function rebuiltSpliceLine(owner: SplicedLine, edits: Map<number, number>): string | null {
    const data = owner.data.slice();
    let changed = false;
    for (let j = 0; j < data.length; j++) {
        const addr = owner.startAddress + j;
        if (edits.has(addr)) {
            data[j] = edits.get(addr)!;
            changed = true;
        }
    }
    if (!changed) { return null; }
    return owner.recordType === 0
        ? buildIntelHexDataRecord(owner.address, data)
        : buildSRecDataRecord(owner.recordType, owner.address, data);
}

function hasEditInRange(edits: Map<number, number>, start: number, end: number): boolean {
    for (const addr of edits.keys()) {
        if (addr >= start && addr <= end) { return true; }
    }
    return false;
}

function hexToBytes(text: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i + 1 < text.length; i += 2) {
        const byte = parseInt(text.slice(i, i + 2), 16);
        if (!/^[0-9a-fA-F]{2}$/.test(text.slice(i, i + 2))) { return []; }
        bytes.push(byte);
    }
    return bytes;
}

export function serializeSRecAsync(
    originalRaw: string,
    parseResult: ParseResult,
    edits: Map<number, number>,
    options: WorkBudgetOptions = {},
): Promise<string> {
    return serializeEditedRecordsAsync(
        originalRaw,
        parseResult,
        edits,
        rec => srecIsData(rec.recordType),
        (rec, data) => buildSRecDataRecord(rec.recordType, rec.resolvedAddress, data),
        options,
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

async function serializeEditedRecordsAsync(
    originalRaw: string,
    parseResult: ParseResult,
    edits: Map<number, number>,
    canEditRecord: (rec: ParsedRecord) => boolean,
    rebuildRecord: (rec: ParsedRecord, data: number[]) => string,
    options: WorkBudgetOptions,
): Promise<string> {
    if (edits.size === 0) { return originalRaw; }

    const eol = originalRaw.includes('\r\n') ? '\r\n' : '\n';
    const lines = originalRaw.split(/\r?\n/);
    const runtime = workBudgetRuntime(options);
    let deadline = runtime.now() + runtime.budget;
    for (const rec of parseResult.records) {
        applySerializedRecordEdit(lines, rec, edits, canEditRecord, rebuildRecord);
        deadline = await yieldWhenDue(runtime, deadline);
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
