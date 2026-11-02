import { computeSRecChecksum, SREC_ADDR_SIZES, srecIsData } from './parser/srecParser';
import type { HexRecord, ParseResult } from './parser/types';
import { workBudgetRuntime, yieldWhenDue, type WorkBudgetOptions } from './workBudget';

type ParsedRecord = ParseResult['records'][number];

export type HexScopeTextFormat = 'ihex' | 'srec';
export type HexScopeFormat = HexScopeTextFormat | 'bin';

/** Defense-in-depth message when a raw image reaches the record-parsing worker. */
export const RAW_BINARY_WORKER_ERROR = 'Raw binary files do not use the editor parse worker.';

/** True for the record-based text formats (Intel HEX / Motorola SREC). */
export function isTextFormat(format: HexScopeFormat): format is HexScopeTextFormat {
    return format !== 'bin';
}

/** True when the extension names a raw binary image (case-insensitive). */
export function isRawBinaryExtension(ext: string): boolean {
    return ext.toLowerCase() === 'bin';
}

export function detectFormatFromParts(ext: string, raw: string): HexScopeFormat {
    // A `.bin` file is raw bytes; never content-sniff it as HEX/SREC.
    if (isRawBinaryExtension(ext)) { return 'bin'; }
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
    return buildIntelHexRecord(0, addr16, data);
}

function buildIntelHexRecord(recordType: number, address: number, data: number[]): string {
    const bc = data.length;
    const ah = (address >> 8) & 0xFF;
    const al = address & 0xFF;
    let sum = bc + ah + al + recordType;
    for (const b of data) { sum += b; }
    const chk = ((~sum + 1) & 0xFF);
    const body =
        bc.toString(16).toUpperCase().padStart(2, '0') +
        address.toString(16).toUpperCase().padStart(4, '0') +
        recordType.toString(16).toUpperCase().padStart(2, '0') +
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

// ── Structural document rebuild ─────────────────────────────────────────────
// Length-changing saves cannot use the line-splice fast path: every data record
// after an insert/delete moves. Rebuild the data records from the edited
// segments while preserving non-data records (headers, execution start
// addresses, unknown/malformed lines) and the original EOL style.

interface RebuildSegment {
    startAddress: number;
    data: ArrayLike<number>;
}

interface LineLayout {
    eol: string;
    trailingNewline: boolean;
    lines: string[];
}

function lineLayout(raw: string): LineLayout {
    const trailingNewline = /\r?\n$/.test(raw);
    const lines = raw === '' ? [] : raw.split(/\r?\n/);
    if (trailingNewline) { lines.pop(); }
    return { eol: raw.includes('\r\n') ? '\r\n' : '\n', trailingNewline, lines };
}

function joinLayout(layout: LineLayout, lines: string[]): string {
    const text = lines.join(layout.eol);
    return layout.trailingNewline ? `${text}${layout.eol}` : text;
}

/** Rebuild an IHEX/SREC document from edited segments (structural save). */
export function rebuildTextDocument(
    originalRaw: string,
    segments: ReadonlyArray<RebuildSegment>,
    format: HexScopeTextFormat,
): string {
    const layout = lineLayout(originalRaw);
    return format === 'srec'
        ? rebuildSRec(layout, segments)
        : rebuildIntelHex(layout, segments);
}

function rebuildIntelHex(layout: LineLayout, segments: ReadonlyArray<RebuildSegment>): string {
    const scan = scanIntelHex(layout.lines);
    const dataLines = buildIntelHexDataLines(segments, dominantLength(scan.dataLengths));
    return joinLayout(layout, [...scan.preservedBefore, ...dataLines, ...scan.preservedAfter, INTEL_EOF]);
}

interface IntelScan {
    dataLengths: number[];
    preservedBefore: string[];
    preservedAfter: string[];
}

function scanIntelHex(lines: string[]): IntelScan {
    const scan: IntelScan = { dataLengths: [], preservedBefore: [], preservedAfter: [] };
    let firstData = -1;
    for (let i = 0; i < lines.length; i++) {
        firstData = scanIntelHexLine(lines, i, firstData, scan);
    }
    return scan;
}

function scanIntelHexLine(lines: string[], index: number, firstData: number, scan: IntelScan): number {
    const header = intelLineHeader(lines[index]);
    if (header === null) {
        pushPreserved(lines[index], index, firstData, scan.preservedBefore, scan.preservedAfter);
        return firstData;
    }
    return handleIntelHeader(lines[index], index, header, firstData, scan);
}

function handleIntelHeader(
    line: string,
    index: number,
    header: { count: number; addr16: number; type: number },
    firstData: number,
    scan: IntelScan,
): number {
    if (header.type === 0) {
        scan.dataLengths.push(header.count);
        return firstDataOr(index, firstData);
    }
    if (header.type === 1) { return firstData; }
    if (isIntelExtendedAddress(header.type)) { return firstData; }
    pushPreserved(line, index, firstData, scan.preservedBefore, scan.preservedAfter);
    return firstData;
}

function isIntelExtendedAddress(type: number): boolean {
    return type === 2 || type === 4;
}

function firstDataOr(index: number, firstData: number): number {
    return firstData < 0 ? index : firstData;
}

const INTEL_EOF = ':00000001FF';

function pushPreserved(
    line: string,
    index: number,
    firstData: number,
    before: string[],
    after: string[],
): void {
    if (firstData < 0 || index < firstData) { before.push(line); }
    else { after.push(line); }
}

function dominantLength(lengths: readonly number[]): number {
    return bestLength(countLengths(lengths));
}

function countLengths(lengths: readonly number[]): Map<number, number> {
    const counts = new Map<number, number>();
    for (const length of lengths) { counts.set(length, (counts.get(length) ?? 0) + 1); }
    return counts;
}

function bestLength(counts: ReadonlyMap<number, number>): number {
    let best = 16;
    let bestCount = -1;
    for (const [length, count] of counts) {
        if (!isUsableLength(length)) { continue; }
        if (count <= bestCount) { continue; }
        best = length;
        bestCount = count;
    }
    return best;
}

function isUsableLength(length: number): boolean {
    return length > 0 && length <= 255;
}

interface IntelEmitState {
    upper: number;
}

function buildIntelHexDataLines(segments: ReadonlyArray<RebuildSegment>, chunkSize: number): string[] {
    const lines: string[] = [];
    const state: IntelEmitState = { upper: 0 };
    for (const segment of sortedSegments(segments)) {
        appendIntelHexSegment(lines, segment, chunkSize, state);
    }
    return lines;
}

function appendIntelHexSegment(
    lines: string[],
    segment: RebuildSegment,
    chunkSize: number,
    state: IntelEmitState,
): void {
    const data = Array.from(segment.data);
    let offset = 0;
    while (offset < data.length) {
        offset = appendIntelHexChunk(lines, segment, data, offset, chunkSize, state);
    }
}

function appendIntelHexChunk(
    lines: string[],
    segment: RebuildSegment,
    data: number[],
    offset: number,
    chunkSize: number,
    state: IntelEmitState,
): number {
    const address = segment.startAddress + offset;
    if (address < 0 || address > 0xFFFFFFFF) { return data.length; }
    appendIntelUpperRecord(lines, state, address);
    // A data record never crosses the 64 KiB window its address field encodes.
    const size = Math.min(chunkSize, 0x10000 - (address & 0xFFFF), data.length - offset);
    lines.push(buildIntelHexDataRecord(address & 0xFFFF, data.slice(offset, offset + size)));
    return offset + size;
}

function appendIntelUpperRecord(lines: string[], state: IntelEmitState, address: number): void {
    const upper = Math.floor(address / 0x10000);
    if (upper === state.upper) { return; }
    state.upper = upper;
    lines.push(buildIntelHexRecord(4, 0, [(upper >> 8) & 0xFF, upper & 0xFF]));
}

function rebuildSRec(layout: LineLayout, segments: ReadonlyArray<RebuildSegment>): string {
    const scan = scanSRec(layout.lines);
    const dataType = srecDataType(segments, scan.dataTypes, scan.terminationAddress);
    const dataLines = buildSRecDataLines(segments, dataType, dominantLength(scan.dataLengths));
    const countLines = scan.hadCount ? [srecCountRecord(dataLines.length)] : [];
    const termination = buildSRecDataRecord(terminationType(dataType), scan.terminationAddress ?? 0, []);
    return joinLayout(layout, [...scan.preservedBefore, ...dataLines, ...scan.preservedAfter, ...countLines, termination]);
}

interface SrecScan {
    dataTypes: number[];
    dataLengths: number[];
    preservedBefore: string[];
    preservedAfter: string[];
    hadCount: boolean;
    terminationAddress: number | undefined;
}

function scanSRec(lines: string[]): SrecScan {
    const scan: SrecScan = {
        dataTypes: [],
        dataLengths: [],
        preservedBefore: [],
        preservedAfter: [],
        hadCount: false,
        terminationAddress: undefined,
    };
    let firstData = -1;
    for (let i = 0; i < lines.length; i++) {
        firstData = scanSRecLine(lines, i, firstData, scan);
    }
    return scan;
}

function scanSRecLine(lines: string[], index: number, firstData: number, scan: SrecScan): number {
    const header = srecRebuildHeader(lines[index]);
    if (header === null) {
        pushPreserved(lines[index], index, firstData, scan.preservedBefore, scan.preservedAfter);
        return firstData;
    }
    return handleSRecHeader(lines[index], index, header, firstData, scan);
}

function handleSRecHeader(
    line: string,
    index: number,
    header: SrecRebuildHeader,
    firstData: number,
    scan: SrecScan,
): number {
    if (isSRecData(header.recordType)) {
        scan.dataTypes.push(header.recordType);
        scan.dataLengths.push(header.dataLength);
        return firstDataOr(index, firstData);
    }
    if (isSRecCount(header.recordType)) { scan.hadCount = true; return firstData; }
    if (isSRecTermination(header.recordType)) { scan.terminationAddress = header.address; return firstData; }
    pushPreserved(line, index, firstData, scan.preservedBefore, scan.preservedAfter);
    return firstData;
}

function isSRecData(recordType: number): boolean {
    return recordType >= 1 && recordType <= 3;
}

function isSRecCount(recordType: number): boolean {
    return recordType === 5 || recordType === 6;
}

function isSRecTermination(recordType: number): boolean {
    return recordType >= 7 && recordType <= 9;
}

/** S1→S9 (16-bit), S2→S8 (24-bit), S3→S7 (32-bit). */
function terminationType(dataType: number): number {
    return dataType === 1 ? 9 : dataType === 2 ? 8 : 7;
}

interface SrecRebuildHeader {
    recordType: number;
    address: number;
    dataLength: number;
}

function srecRebuildHeader(line: string): SrecRebuildHeader | null {
    const match = /^S([0-9])([0-9a-fA-F]{2})/.exec(line);
    if (!match) { return null; }
    return srecHeaderFromMatch(line, match);
}

function srecHeaderFromMatch(line: string, match: RegExpExecArray): SrecRebuildHeader | null {
    const recordType = parseInt(match[1], 10);
    const asz = SREC_ADDR_SIZES[recordType] ?? 2;
    const dataLength = parseInt(match[2], 16) - asz - 1;
    if (dataLength < 0) { return null; }
    return { recordType, address: srecAddressFromLine(line, asz), dataLength };
}

function srecAddressFromLine(line: string, asz: number): number {
    const text = line.slice(4, 4 + asz * 2);
    return /^[0-9a-fA-F]+$/.test(text) ? parseInt(text, 16) : 0;
}

function srecDataType(
    segments: ReadonlyArray<RebuildSegment>,
    originalTypes: readonly number[],
    terminationAddress: number | undefined,
): number {
    const maxAddress = sortedSegments(segments)
        .reduce((max, segment) => Math.max(max, segment.startAddress + segment.data.length - 1), terminationAddress ?? -1);
    const required = maxAddress <= 0xFFFF ? 1 : maxAddress <= 0xFFFFFF ? 2 : 3;
    const original = originalTypes.reduce((max, type) => Math.max(max, type), 1);
    return Math.max(original, required);
}

function buildSRecDataLines(
    segments: ReadonlyArray<RebuildSegment>,
    dataType: number,
    chunkSize: number,
): string[] {
    const lines: string[] = [];
    for (const segment of sortedSegments(segments)) {
        appendSRecSegment(lines, segment, dataType, chunkSize);
    }
    return lines;
}

function appendSRecSegment(
    lines: string[],
    segment: RebuildSegment,
    dataType: number,
    chunkSize: number,
): void {
    const data = Array.from(segment.data);
    for (let offset = 0; offset < data.length; offset += chunkSize) {
        appendSRecChunk(lines, segment, data, offset, dataType, chunkSize);
    }
}

function appendSRecChunk(
    lines: string[],
    segment: RebuildSegment,
    data: number[],
    offset: number,
    dataType: number,
    chunkSize: number,
): void {
    const address = segment.startAddress + offset;
    if (address < 0 || address > 0xFFFFFFFF) { return; }
    lines.push(buildSRecDataRecord(dataType, address, data.slice(offset, offset + chunkSize)));
}

function srecCountRecord(count: number): string {
    return count <= 0xFFFF
        ? buildSRecDataRecord(5, count, [])
        : buildSRecDataRecord(6, count, []);
}

function sortedSegments(segments: ReadonlyArray<RebuildSegment>): RebuildSegment[] {
    return segments
        .filter(segment => segment.data.length > 0)
        .slice()
        .sort((a, b) => a.startAddress - b.startAddress);
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
