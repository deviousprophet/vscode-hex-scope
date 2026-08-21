// ── Inspector markup + pure derivation ─────────────────────────────
// DOM-free HTML builders + pure state derivation for the Inspector
// (address/vals/byte line, multi-byte interpreter, internal Bit View
// block, merged Labels list). No DOM access; all inputs passed in.

import { esc, fmtB, formatDecimal, formatHex } from '../../../utils';
import type { SegmentLabel, SerializedSegment } from '../../../../core/types';
import { LABEL_COLORS, labelItemHtml } from './inspectorLabels';

// ── Inspector (address/vals/multi-byte) ─────────────────────────

export function inspectorSelectionLength(selection: { start: number | null; end: number | null }): number {
    const { start, end } = selection;
    if (start === null) { return 0; }
    return (end !== null && end >= start) ? end - start + 1 : 1;
}

export function singleByteInspectorHtml(val: number): string {
    const hexStr  = `0x${val.toString(16).toUpperCase().padStart(2, '0')}`;
    const binRaw  = val.toString(2).padStart(8, '0');
    const binDisp = `${binRaw.slice(0, 4)} ${binRaw.slice(4)}`;
    const asciiChip = val >= 0x20 && val < 0x7F
        ? `<span class="insp-ascii-chip">'${esc(String.fromCharCode(val))}'</span>`
        : '';
    return (
        `<div class="insp-byte-row">` +
        `<span class="insp-hex-chip" data-copy="${esc(hexStr)}" data-label="hex" title="Click to copy">${hexStr}</span>` +
        `<span class="insp-dec-chip" data-copy="${esc(String(val))}" data-label="decimal" title="Click to copy">${val}</span>` +
        `${asciiChip}` +
        `</div>` +
        `<div class="insp-bin-row" data-copy="${esc(binRaw)}" data-label="binary" title="Click to copy">${binDisp}</div>`
    );
}

/**
 * Merged byte-line readout: first ≤8 bytes shown (truncated selections get a
 * display-only ellipsis — never copied); the copied string is the FULL
 * selection hex, matching the "Click to copy N bytes" tooltip. The count is
 * carried via data-copy-count for the host copy notification; it is not
 * duplicated in the display (the address bar shows it).
 */
function byteLineParts(selBytes: number[], len: number): { display: string; copy: string } {
    const dumpBytes = selBytes.slice(0, 8);
    const dumpStr   = dumpBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    const truncated = len > 8;
    const display   = `${dumpStr}${truncated ? ' …' : ''}`;
    const copy      = selBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    return { display, copy };
}

export function multiByteInspectorHtml(selBytes: number[], len: number): string {
    // Data readout, not a control: plain mono line, no button dressing.
    const { display, copy } = byteLineParts(selBytes, len);
    return (
        `<div class="insp-byte-line" data-copy="${esc(copy)}" data-label="bytes" data-copy-count="${esc(String(len))}" title="Click to copy ${esc(String(len))} bytes">` +
        `${esc(display)}` +
        `</div>`
    );
}

// ── Bit view ─────────────────────────────────────────────────────

export function popcount(v: number): number {
    let n = 0; let x = v >>> 0;
    while (x) { n += x & 1; x >>>= 1; }
    return n;
}

export function bitIndexRowHtml(): string {
    const cells = Array.from({ length: 8 }, (_, i) =>
        `<div class="bit-idx">${7 - i}</div>`
    ).join('');
    return `<div class="bit-row"><div></div>${cells}</div>`;
}

export function byteRowHtml(val: number, label: string | null): string {
    const hexStr = val.toString(16).toUpperCase().padStart(2, '0');
    const cells = Array.from({ length: 8 }, (_, i) => {
        const bit = 7 - i;
        const on  = (val >> bit) & 1;
        return `<div class="bit-v${on ? ' on' : ''}" data-bit="${bit}" title="bit ${bit} = ${on}"></div>`;
    }).join('');
    const lbl = label !== null
        ? `<div class="bit-lbl"><span class="bit-lbl-idx">${esc(label)}</span><span class="bit-hex">0x${hexStr}</span></div>`
        : `<div class="bit-lbl"><span class="bit-hex">0x${hexStr}</span></div>`;
    return `<div class="bit-row">${lbl}${cells}</div>`;
}

export function bitRowsHtml(bytes: number[]): string {
    return bytes.map((b, i) => byteRowHtml(b, `[${i}]`)).join('');
}

export function bitTotalCount(bytes: number[]): number {
    return bytes.reduce((s, b) => s + popcount(b), 0);
}

// ── Multi-byte interpreter ───────────────────────────────────────

type MultiValues = {
    u16: number;
    i16: number;
    u32: number;
    i32: number;
    f32: number;
    u64: bigint;
    i64: bigint;
    f64: number;
};

export function multiWidth(selLen: number): number {
    return selLen <= 2 ? 2 : selLen <= 4 ? 4 : 8;
}

export function readMultiValues(raw: number[], le: boolean): MultiValues {
    const bytesLE = le ? [...raw] : [...raw].reverse();
    const buf8 = new ArrayBuffer(8);
    const dv8 = new DataView(buf8);
    for (let i = 0; i < 8; i++) { dv8.setUint8(i, bytesLE[i] ?? 0); }
    return {
        u16: dv8.getUint16(0, true),
        i16: dv8.getInt16(0, true),
        u32: dv8.getUint32(0, true),
        i32: dv8.getInt32(0, true),
        f32: dv8.getFloat32(0, true),
        u64: dv8.getBigUint64(0, true),
        i64: dv8.getBigInt64(0, true),
        f64: dv8.getFloat64(0, true),
    };
}

function fmtFloat(v: number, sig: number): string {
    if (isNaN(v))     { return 'NaN'; }
    if (!isFinite(v)) { return `${v > 0 ? '+' : ''}${v}`; }
    return v.toExponential(sig - 1);
}

function multiCard(type: string, primary: string, copy: string): string {
    return `<div class="mi-card">` +
        `<span class="mi-type">${type}</span>` +
        `<div class="mi-vals"><span class="mi-dec" data-copy="${esc(copy)}" title="Click to copy">${primary}</span></div>` +
        `</div>`;
}

function multiUnsignedCard(type: string, uVal: number | bigint, hexW: number): string {
    const dec = formatDecimal(uVal);
    const hex = formatHex(uVal, hexW);
    return `<div class="mi-card mi-ucard">` +
        `<span class="mi-type">${type}</span>` +
        `<div class="mi-vals">` +
        `<span class="mi-dec" data-copy="${esc(String(uVal))}" title="Click to copy decimal">${dec}</span>` +
        `<span class="mi-hex" data-copy="${esc(hex)}" title="Click to copy hex">${hex}</span>` +
        `</div>` +
        `</div>`;
}

export function multiValueGroupHtml(width: number, values: MultiValues): string {
    if (width === 2) {
        return (
            multiUnsignedCard('uint16', values.u16, 4) +
            multiCard('int16', formatDecimal(values.i16), String(values.i16))
        );
    }
    if (width === 4) {
        return (
            multiUnsignedCard('uint32', values.u32, 8) +
            multiCard('int32', formatDecimal(values.i32), String(values.i32)) +
            multiCard('float32', fmtFloat(values.f32, 7), fmtFloat(values.f32, 7))
        );
    }
    return (
        multiUnsignedCard('uint64', values.u64, 16) +
        multiCard('int64', formatDecimal(values.i64), String(values.i64)) +
        multiCard('float64', fmtFloat(values.f64, 10), fmtFloat(values.f64, 10))
    );
}

/**
 * Decode-context note for the multi-byte interpreter: endian tag + zero-pad
 * note when the selection is narrower than the decode width. Pure markup;
 * styled with the pad-note language (`.mi-pad-note`), endian part honed with
 * `.mi-endian-note`.
 */
export function multiContextHtml(endian: 'le' | 'be', width: number, selLen: number): string {
    const tag = `<span class="mi-pad-note mi-endian-note">[${endian.toUpperCase()} · ${width}-byte]</span>`;
    const pad = selLen < width
        ? `<span class="mi-pad-note">zero-padded to ${width * 8}-bit</span>`
        : '';
    return `<div class="mi-pad-row">${tag}${pad ? ` ${pad}` : ''}</div>`;
}

export function gapPaddingNoteHtml(skipped: number): string {
    return `<div class="mi-pad-row"><span class="mi-pad-note">${esc(String(skipped))} gap byte${skipped > 1 ? 's' : ''} zero-padded</span></div>`;
}

// ── Labels (merged user labels + permanent segment rows) ────────

export function labelAddrHex(n: number): string {
    return `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
}

/** One display row in the merged Labels list (segments are permanent, name-only editable). */
type LabelDisplayRow =
    | { kind: 'user'; label: SegmentLabel }
    | { kind: 'segment'; name: string; parsedName: string; start: number; length: number };

function rowStart(row: LabelDisplayRow): number {
    return row.kind === 'user' ? row.label.startAddress : row.start;
}

/** Parsed segment names rank by address order: "Segment 1", "Segment 2", … */
export function parsedSegmentName(segments: SerializedSegment[], startAddress: number): string {
    const idx = [...segments]
        .sort((a, b) => a.startAddress - b.startAddress)
        .findIndex(s => s.startAddress === startAddress);
    return `Segment ${idx + 1}`;
}

/**
 * Merges segments (permanent rows) with user labels into one
 * address-sorted list. Segment names rank by address order; on an
 * equal start, segments sort before user labels (stable input order).
 * `segmentNames` overrides a segment's display name by start address.
 */
function mergeForDisplay(
    labels: SegmentLabel[],
    segments: SerializedSegment[],
    segmentNames: Record<string, string> = {},
): LabelDisplayRow[] {
    const segRows: LabelDisplayRow[] = [...segments]
        .sort((a, b) => a.startAddress - b.startAddress)
        .map(s => {
            const parsedName = parsedSegmentName(segments, s.startAddress);
            return {
                kind: 'segment' as const,
                name: segmentNames[String(s.startAddress)] ?? parsedName,
                parsedName,
                start: s.startAddress,
                length: s.data.length,
            };
        });
    const userRows: LabelDisplayRow[] = labels.map(label => ({ kind: 'user', label }));
    return [...segRows, ...userRows].sort((a, b) => rowStart(a) - rowStart(b));
}

export function nextLabelName(labels: SegmentLabel[]): string {
    const taken = new Set(labels.map(l => l.name));
    let candidate = 'Label_0';
    let n = 1;
    while (taken.has(candidate)) { candidate = `Label_${n++}`; }
    return candidate;
}

export function defaultLabelStart(selection: { start: number | null; end: number | null }, editing: SegmentLabel | undefined): string {
    if (editing) { return labelAddrHex(editing.startAddress); }
    return selection.start !== null ? labelAddrHex(selection.start) : '';
}

export function defaultLabelRange(selection: { start: number | null; end: number | null }, editing: SegmentLabel | undefined, mode: 'len' | 'end' = 'len'): string {
    if (editing) {
        return mode === 'end' ? labelAddrHex(editing.startAddress + editing.length - 1) : `${editing.length}`;
    }
    const { start, end } = selection;
    if (start === null || end === null || end < start) { return ''; }
    return mode === 'end' ? labelAddrHex(end) : `${end - start + 1}`;
}

export function labelSwatchesHtml(chosenColor: string): string {
    return LABEL_COLORS.map(c =>
        `<button type="button" class="lf-swatch${c.v === chosenColor ? ' selected' : ''}" data-color="${c.v}" style="background:${c.v}" title="${c.name}" aria-label="Use ${c.name} label color" aria-pressed="${c.v === chosenColor}"></button>`
    ).join('');
}

export function labelItemsHtml(
    labels: SegmentLabel[],
    segments: SerializedSegment[],
    segmentNames: Record<string, string> = {},
): string {
    const rows = mergeForDisplay(labels, segments, segmentNames);
    if (rows.length === 0) { return '<div class="sb-empty">No labels defined</div>'; }
    return rows.map(row => row.kind === 'user' ? labelItemHtml(row.label) : segmentLabelItemHtml(row)).join('');
}

/** Permanent segment row: jump + ✎ rename; no delete/color/visibility controls. */
function segmentLabelItemHtml(seg: LabelDisplayRow & { kind: 'segment' }): string {
    const start = labelAddrHex(seg.start);
    const end = labelAddrHex(seg.start + seg.length - 1);
    const renamed = seg.name !== seg.parsedName;
    return `
        <div class="label-item label-perma" data-start="${seg.start}" role="button" tabindex="0"
             title="Jump to ${start}" aria-label="Jump to ${esc(seg.name)} at ${start}">
            <div class="label-sw label-sw-perma" aria-hidden="true"></div>
            <div class="label-inf">
                <div class="label-nm"><span class="label-perma-name"${renamed ? ` title="${esc(seg.parsedName)}"` : ''}>${esc(seg.name)}</span><span class="label-perma-glyph" aria-hidden="true">&#128204;&#xFE0E;</span></div>
                <div class="label-rng">${start}&ndash;${end} &middot; ${fmtB(seg.length)}</div>
            </div>
            <button type="button" class="label-act label-seg-edit" data-start="${seg.start}" title="Rename segment" aria-label="Rename segment">&#9998;</button>
        </div>`;
}
