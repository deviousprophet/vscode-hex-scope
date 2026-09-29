/** Struct panel — bit-span / binary rendering helpers.
Extracted verbatim from structPanel.ts (pure move). */
import { bytesToBigUint, fieldByteSize } from '../../../../core/struct/structCodec.js';
import type { DecodedField } from '../../../../core/struct/structCodec.js';
import type { BitFieldAllocation } from '../../../../core/types';

/** Global endian/allocation fallbacks for the binary rendering helpers. */
export interface BitRenderEnv {
    endian: 'le' | 'be';
    bitFieldAllocation: BitFieldAllocation;
}

export function isBitFieldRow(r: DecodedField): boolean {
    return r.isBitField === true && typeof r.bitWidth === 'number';
}

function renderBitSpan(bit: string, idx: number, selected: boolean): string {
    const sel = selected ? ' sel' : '';
    return `<span class="si-bit ${bit === '1' ? 'one' : 'zero'}${sel}" data-bit-idx="${idx}">${bit}</span>`;
}

function renderUnknownBitSpan(bitIdx: number, selected: boolean): string {
    return `<span class="si-bit unknown${selected ? ' sel' : ''}" data-bit-idx="${bitIdx}">?</span>`;
}

function isBitSelected(
    bitIdx: number,
    selectedRange?: { startBit: number; endBit: number } | null,
): boolean {
    return !!selectedRange && bitIdx >= selectedRange.startBit && bitIdx <= selectedRange.endBit;
}

export function byteHexParts(bytesHex: string): string[] {
    return bytesHex.split(' ').map(p => p.trim()).filter(Boolean);
}

export function hasMissingByte(parts: string[]): boolean {
    return parts.length === 0 || parts.some(p => p === '??');
}

export function bytesFromHexParts(parts: string[]): number[] {
    return parts.map(h => parseInt(h, 16));
}

export function makeBitRowKey(byteStart: number, bitStart: number, bitWidth: number): string {
    return `${byteStart}:${bitStart}:${bitWidth}`;
}

export function scalarValKey(byteStart: number): string {
    return `byte:${byteStart}`;
}

export function bitChildValKey(byteStart: number, bitStart: number, bitWidth: number): string {
    return `bit:${makeBitRowKey(byteStart, bitStart, bitWidth)}`;
}

export function bitUnitValKey(byteStart: number): string {
    return `bitunit:${byteStart}`;
}

export function bitRowWidth(row: DecodedField | null | undefined): number {
    return isBitFieldRow(row as DecodedField) ? row?.bitWidth ?? 0 : 0;
}

export function bitUnitUsesFullStorage(rows: DecodedField[]): boolean {
    const first = rows[0];
    if (!first || !isBitFieldRow(first)) { return false; }
    const usedBits = rows.reduce((sum, row) => sum + bitRowWidth(row), 0);
    const storageBits = (first.bitStorageByteSize ?? fieldByteSize(first.type)) * 8;
    return usedBits >= storageBits;
}

export function binaryGroupsLowBitsFirst(bits: string): string[] {
    const groups: string[] = [];
    for (let end = bits.length; end > 0; end -= 4) {
        groups.unshift(bits.slice(Math.max(0, end - 4), end));
    }
    return groups;
}

function renderBinarySpanLines(spans: string[]): string {
    const groups: string[] = [];
    for (let i = 0; i < spans.length; i += 4) {
        groups.push(spans.slice(i, i + 4).join(''));
    }

    const lines: string[] = [];
    for (let i = 0; i < groups.length; i += 4) {
        lines.push(groups.slice(i, i + 4).join(' '));
    }
    return `<span class="si-bin-wrap">${lines.join('<br>')}</span>`;
}

export function binaryBitsForValue(bytes: number[], endian: 'le' | 'be'): string {
    return bytesToBigUint(bytes, endian).toString(2).padStart(bytes.length * 8, '0');
}

export function renderPlainBinaryBits(bits: string): string {
    return renderBinarySpanLines([...bits].map((bit, idx) => renderBitSpan(bit, idx, false)));
}

export function formatPlainBinaryBits(bits: string): string {
    const groups = bits.match(/.{1,4}/g) || [];
    return groups.join(' ');
}

export function singleLineCopyText(text: string): string {
    return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseDatasetInt(value: string | undefined): number | null {
    const parsed = parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveDatasetInt(value: string | undefined): number | null {
    const parsed = parseDatasetInt(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

export function parseBitRowMeta(row: HTMLElement): { byteStart: number; bitStart: number; bitWidth: number } | null {
    const byteStart = parseDatasetInt(row.dataset.byteStart);
    if (byteStart === null) { return null; }
    const bitStart = parseDatasetInt(row.dataset.bitStart);
    if (bitStart === null) { return null; }
    const bitWidth = parsePositiveDatasetInt(row.dataset.bitWidth);
    if (bitWidth === null) { return null; }
    return { byteStart, bitStart, bitWidth };
}

export function applyBitHighlightsInPlace(
    sec: HTMLElement,
    selectedRange: { parentByteStart: number; startBit: number; endBit: number } | null,
    hoveredRange: { parentByteStart: number; startBit: number; endBit: number } | null,
): void {
    sec.querySelectorAll<HTMLElement>('.si-bit.hov').forEach(el => el.classList.remove('hov'));
    sec.querySelectorAll<HTMLElement>('.si-bit.sel').forEach(el => el.classList.remove('sel'));

    const applyRange = (
        range: { parentByteStart: number; startBit: number; endBit: number } | null,
        cls: 'sel' | 'hov',
    ) => {
        if (!range) { return; }
        const parentVal = sec.querySelector<HTMLElement>(
            `.si-arr-grp-hdr.si-bitunit-hdr[data-byte-start="${range.parentByteStart}"] .si-f-val[data-val-type="bin"], ` +
            `.si-arr-grp-hdr.si-bitunit-hdr[data-byte-start="${range.parentByteStart}"] .si-f-val[data-val-type="bin-sliced"], ` +
            `.si-arr-el-hdr.si-bitunit-hdr[data-byte-start="${range.parentByteStart}"] .si-f-val[data-val-type="bin"], ` +
            `.si-arr-el-hdr.si-bitunit-hdr[data-byte-start="${range.parentByteStart}"] .si-f-val[data-val-type="bin-sliced"]`
        );
        if (!parentVal) { return; }
        for (let i = range.startBit; i <= range.endBit; i++) {
            parentVal.querySelector<HTMLElement>(`.si-bit[data-bit-idx="${i}"]`)?.classList.add(cls);
        }
    };

    applyRange(selectedRange, 'sel');
    applyRange(hoveredRange, 'hov');
}

export function renderBinaryFromBitRows(
    env: BitRenderEnv, rows: DecodedField[],
    selectedRange?: { startBit: number; endBit: number } | null,
    endian?: 'le' | 'be',
    alloc?: BitFieldAllocation,
): string {
    const usedWidth = usedBitRowWidth(rows);
    const first = rows[0];
    if (!hasBitRows(first, usedWidth)) {
        return '<span class="si-bin-wrap"></span>';
    }
    const rawParts = byteHexParts(first.bytesHex);
    if (hasBitRowData(first, rawParts)) {
        return renderKnownBitRowBits(env, rawParts, usedWidth, selectedRange, rowEndian(first, endian), rowAlloc(first, alloc));
    }
    return renderUnknownBitRowBits(env, usedWidth, selectedRange, rowAlloc(first, alloc));
}

function usedBitRowWidth(rows: DecodedField[]): number {
    return rows.reduce((sum, r) => sum + Math.max(0, r.bitWidth ?? 0), 0);
}

function hasBitRows(first: DecodedField | undefined, usedWidth: number): boolean {
    return !!first && usedWidth > 0;
}

function rowEndian(first: DecodedField, endian?: 'le' | 'be'): 'le' | 'be' | undefined {
    return endian ?? first.endian;
}

export function rowEndianOrDefault(first: DecodedField, fallback: 'le' | 'be'): 'le' | 'be' {
    return first.endian ?? fallback;
}

function rowAlloc(first: DecodedField, alloc?: BitFieldAllocation): BitFieldAllocation | undefined {
    return alloc ?? first.allocation;
}

export function rowAllocOrDefault(first: DecodedField, fallback: BitFieldAllocation): BitFieldAllocation {
    return first.allocation ?? fallback;
}

function hasBitRowData(first: DecodedField, rawParts: string[]): boolean {
    return first.hasData && !hasMissingByte(rawParts);
}

function renderKnownBitRowBits(env: BitRenderEnv, rawParts: string[], usedWidth: number, selectedRange?: { startBit: number; endBit: number } | null, endian?: 'le' | 'be', alloc?: BitFieldAllocation): string {
    const bits = slicedBitRowBits(env, rawParts, usedWidth, endian, alloc);
    const spans = [...bits].map((bit, displayIdx) => {
        const bitIdx = displayBitIndex(env, displayIdx, usedWidth, alloc);
        return renderBitSpan(bit, bitIdx, isBitSelected(bitIdx, selectedRange));
    });
    return renderBinarySpanLines(spans);
}

function slicedBitRowBits(env: BitRenderEnv, rawParts: string[], usedWidth: number, endian?: 'le' | 'be', alloc?: BitFieldAllocation): string {
    const raw = bytesFromHexParts(rawParts);
    const value = bytesToBigUint(raw, endian ?? env.endian);
    const unitBits = raw.length * 8;
    const mask = (1n << BigInt(usedWidth)) - 1n;
    const slicedValue = (alloc ?? env.bitFieldAllocation) === 'lsb'
        ? value & mask
        : (value >> BigInt(Math.max(0, unitBits - usedWidth))) & mask;
    return slicedValue.toString(2).padStart(usedWidth, '0');
}

function renderUnknownBitRowBits(env: BitRenderEnv, usedWidth: number, selectedRange?: { startBit: number; endBit: number } | null, alloc?: BitFieldAllocation): string {
    const spans = Array.from({ length: usedWidth }, (_, displayIdx) => {
        const bitIdx = displayBitIndex(env, displayIdx, usedWidth, alloc);
        return renderUnknownBitSpan(bitIdx, isBitSelected(bitIdx, selectedRange));
    });
    return renderBinarySpanLines(spans);
}

function displayBitIndex(env: BitRenderEnv, displayIdx: number, usedWidth: number, alloc?: BitFieldAllocation): number {
    return (alloc ?? env.bitFieldAllocation) === 'lsb' ? usedWidth - displayIdx - 1 : displayIdx;
}

export function renderBinaryStorageUnit(
    env: BitRenderEnv, r: DecodedField,
    selectedRange?: { startBit: number; endBit: number } | null,
    endian?: 'le' | 'be',
    alloc?: BitFieldAllocation,
): string {
    const rawParts = byteHexParts(r.bytesHex);
    const allocation = storageAlloc(env, alloc);
    if (hasMissingByte(rawParts)) {
        const byteCount = r.bitStorageByteSize ?? (rawParts.length || 1);
        return renderUnknownStorageBits(byteCount * 8, allocation, selectedRange);
    }

    const bytes = bytesFromHexParts(rawParts);
    return renderKnownStorageBits(storageValueBits(env, bytes, endian), allocation, selectedRange);
}

function storageAlloc(env: BitRenderEnv, alloc?: BitFieldAllocation): BitFieldAllocation {
    return alloc ?? env.bitFieldAllocation;
}

function storageValueBits(env: BitRenderEnv, bytes: number[], endian?: 'le' | 'be'): string {
    return binaryBitsForValue(bytes, endian ?? env.endian);
}

function storageBitIndex(bitCount: number, displayIdx: number, allocation: BitFieldAllocation): number {
    const numericBitIdx = bitCount - displayIdx - 1;
    return allocation === 'lsb' ? numericBitIdx : displayIdx;
}

function renderUnknownStorageBits(
    bitCount: number,
    allocation: BitFieldAllocation,
    selectedRange?: { startBit: number; endBit: number } | null,
): string {
    const spans = Array.from({ length: bitCount }, (_, displayIdx) => {
        const bitIdx = storageBitIndex(bitCount, displayIdx, allocation);
        return renderUnknownBitSpan(bitIdx, isBitSelected(bitIdx, selectedRange));
    });
    return renderBinarySpanLines(spans);
}

function renderKnownStorageBits(
    bits: string,
    allocation: BitFieldAllocation,
    selectedRange?: { startBit: number; endBit: number } | null,
): string {
    const spans = [...bits].map((bit, displayIdx) => {
        const bitIdx = storageBitIndex(bits.length, displayIdx, allocation);
        return renderBitSpan(bit, bitIdx, isBitSelected(bitIdx, selectedRange));
    });
    return renderBinarySpanLines(spans);
}

