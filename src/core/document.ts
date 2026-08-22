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
    const lines = originalRaw.split(/\r?\n/);
    const owners = ownersFor(format, lines, edits);
    const { replacements, safe: lengthSafe } = buildReplacements(lines, owners, edits);
    const asciiSafe = applyReplacements(lines, replacements);
    const safe = lengthSafe && asciiSafe;
    if (!safe) { return { newRaw: lines.join(lineEol(originalRaw)), patches: null }; }
    return { newRaw: lines.join(lineEol(originalRaw)), patches: splicePatches(lines, replacements, lineEol(originalRaw).length) };
}

function lineEol(raw: string): string {
    return raw.includes('\r\n') ? '\r\n' : '\n';
}

function ownersFor(format: HexScopeFormat, lines: string[], edits: Map<number, number>): SplicedLine[] {
    return format === 'srec' ? srecOwnerLines(lines, edits) : intelOwnerLines(lines, edits);
}

/** Rebuild edited record lines; `safe=false` when any rebuilt line would change length. */
function buildReplacements(lines: string[], owners: SplicedLine[], edits: Map<number, number>): { replacements: Map<number, string>; safe: boolean } {
    const replacements = new Map<number, string>();
    let safe = true;
    for (const owner of owners) {
        const full = rebuildLineText(lines, owner, edits);
        if (full === null) { continue; }
        replacements.set(owner.lineIndex, full);
        if (full.length !== lines[owner.lineIndex].length) { safe = false; }
    }
    return { replacements, safe };
}

function rebuildLineText(lines: string[], owner: SplicedLine, edits: Map<number, number>): string | null {
    const rebuilt = rebuiltSpliceLine(owner, edits);
    return rebuilt === null ? null : replaceRecordText(lines[owner.lineIndex], rebuilt);
}

/** Splice replacements in; false when any file byte is non-ASCII (positional unsafe). */
function applyReplacements(lines: string[], replacements: Map<number, string>): boolean {
    let safe = true;
    for (const [i, line] of lines.entries()) {
        if (/[^\x00-\x7F]/.test(line)) { safe = false; }
        const full = replacements.get(i);
        if (full !== undefined) { lines[i] = full; }
    }
    return safe;
}

function splicePatches(lines: string[], replacements: Map<number, string>, eolLen: number): SplicePatch[] {
    const patches: SplicePatch[] = [];
    const encoder = new TextEncoder();
    let byteOffset = 0;
    for (const [i, line] of lines.entries()) {
        const patchText = replacements.get(i);
        if (patchText !== undefined) { patches.push({ offset: byteOffset, bytes: encoder.encode(patchText) }); }
        byteOffset += line.length + eolLen;
    }
    return patches;
}

interface IntelHeader { count: number; addr16: number; type: number }

function intelOwnerLines(lines: string[], edits: Map<number, number>): SplicedLine[] {
    const out: SplicedLine[] = [];
    let upper = 0;
    for (let i = 0; i < lines.length; i++) {
        const step = intelLineStep(lines[i], i, upper, edits);
        if (step.kind === 'upper') { upper = step.value; }
        else if (step.kind === 'owner') { out.push(step.owner); }
    }
    return out;
}

type IntelStep = { kind: 'upper'; value: number } | { kind: 'owner'; owner: SplicedLine } | { kind: 'none' };

function intelLineStep(line: string, lineIndex: number, upper: number, edits: Map<number, number>): IntelStep {
    const header = intelLineHeader(line);
    if (header === null) { return { kind: 'none' }; }
    const upperValue = intelUpperValue(line, header);
    if (upperValue !== null) { return { kind: 'upper', value: upperValue }; }
    const owner = intelDataOwner(line, lineIndex, header, upper, edits);
    return owner !== null ? { kind: 'owner', owner } : { kind: 'none' };
}

function intelLineHeader(line: string): IntelHeader | null {
    const m = /^:([0-9a-fA-F]{2})([0-9a-fA-F]{4})([0-9a-fA-F]{2})/.exec(line);
    if (!m) { return null; }
    return { count: parseInt(m[1], 16), addr16: parseInt(m[2], 16), type: parseInt(m[3], 16) };
}

function intelUpperValue(line: string, header: IntelHeader): number | null {
    if (header.type !== 4 || header.count < 2) { return null; }
    const upperHex = line.slice(9, 13);
    return /^[0-9a-fA-F]{4}$/.test(upperHex) ? parseInt(upperHex, 16) << 16 : null;
}

function intelDataOwner(line: string, lineIndex: number, header: IntelHeader, upper: number, edits: Map<number, number>): SplicedLine | null {
    if (!isDataHeader(header)) { return null; }
    const start = upper | header.addr16;
    if (!hasEditInRange(edits, start, start + header.count - 1)) { return null; }
    const payload = hexToBytes(line.slice(9, 9 + header.count * 2));
    if (payload.length !== header.count) { return null; }
    return { lineIndex, recordType: 0, address: header.addr16, startAddress: start, data: payload };
}

function isDataHeader(header: IntelHeader): boolean {
    return header.type === 0 && header.count > 0;
}

interface SrecHeader { recordType: number; asz: number; dataLen: number }

function srecOwnerLines(lines: string[], edits: Map<number, number>): SplicedLine[] {
    const out: SplicedLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        const header = srecLineHeader(lines[i]);
        if (header === null) { continue; }
        const owner = srecDataOwner(lines[i], i, header, edits);
        if (owner !== null) { out.push(owner); }
    }
    return out;
}

function srecLineHeader(line: string): SrecHeader | null {
    const m = /^S([0-9])([0-9a-fA-F]{2})/.exec(line);
    if (!m) { return null; }
    const recordType = parseInt(m[1], 10);
    if (!srecIsData(recordType)) { return null; }
    const asz = srecAddrWidth(recordType);
    const dataLen = parseInt(m[2], 16) - asz - 1;
    return dataLen > 0 ? { recordType, asz, dataLen } : null;
}

function srecAddrWidth(recordType: number): number {
    return SREC_ADDR_SIZES[recordType] ?? 2;
}

function srecDataOwner(line: string, lineIndex: number, header: SrecHeader, edits: Map<number, number>): SplicedLine | null {
    const addrRaw = line.slice(4, 4 + header.asz * 2);
    if (!/^[0-9a-fA-F]+$/.test(addrRaw)) { return null; }
    const address = parseInt(addrRaw, 16);
    if (!hasEditInRange(edits, address, address + header.dataLen - 1)) { return null; }
    const payload = hexToBytes(line.slice(4 + header.asz * 2, 4 + header.asz * 2 + header.dataLen * 2));
    if (payload.length !== header.dataLen) { return null; }
    return { lineIndex, recordType: header.recordType, address, startAddress: address, data: payload };
}

function rebuiltSpliceLine(owner: SplicedLine, edits: Map<number, number>): string | null {
    const data = owner.data.slice();
    if (!applyEditedBytes(data, edits, owner.startAddress)) { return null; }
    return owner.recordType === 0
        ? buildIntelHexDataRecord(owner.address, data)
        : buildSRecDataRecord(owner.recordType, owner.address, data);
}

function applyEditedBytes(data: number[], edits: Map<number, number>, start: number): boolean {
    let changed = false;
    for (let j = 0; j < data.length; j++) {
        if (edits.has(start + j)) {
            data[j] = edits.get(start + j)!;
            changed = true;
        }
    }
    return changed;
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
