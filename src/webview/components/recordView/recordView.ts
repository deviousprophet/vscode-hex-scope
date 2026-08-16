// ── RecordView component ─────────────────────────────────────────
// Self-contained record-table UI unit: owns the table markup (incl.
// thead), format-specific row formatting (IHEX/SREC labels, badge
// classes, address/data/checksum cells), scroll reporting, and
// styles (RecordView.css). The host owns paging (RecordPageCache +
// requestRecordWindow page math + provider posts), slice computation
// (shared render/virtualScroll.ts), and page-arrival re-renders.
// This module never imports the `S` global, never touches
// RecordPageCache, and never posts provider messages — it reports
// through callbacks the host wires.

import { esc } from '../../utils';
import type { SerializedRecord } from '../../../core/types';
import './recordView.css';

const RECORD_MAX_SPACER_PX = 1_000_000;

const IHEX_TYPE_LABELS: Record<number, string> = {
    0: 'DATA', 1: 'EOF', 2: 'EXT SEG ADDR', 3: 'START SEG ADDR',
    4: 'EXT LIN ADDR', 5: 'START LIN ADDR',
};

const SREC_TYPE_LABELS: Record<number, string> = {
    0: 'HEADER', 1: 'DATA S1', 2: 'DATA S2', 3: 'DATA S3',
    5: 'COUNT', 6: 'COUNT S6', 7: 'END S7', 8: 'END S8', 9: 'END S9',
};

const SREC_DATA_RECORD_TYPES = new Set([1, 2, 3]);
const IHEX_EXT_RECORD_TYPES = new Set([2, 4]);
const IHEX_START_RECORD_TYPES = new Set([3, 5]);
const SREC_EOF_RECORD_TYPES = new Set([7, 8, 9]);

export interface RecordViewRenderInput {
    format: 'ihex' | 'srec';
    /** The visible slice (host-computed); null = unloaded page → placeholder row. */
    records: readonly (SerializedRecord | null)[];
    /** Index of records[0] in the full record list. */
    recordOffset: number;
    /** Scroll-container content height (px); wrapper height when compressed. */
    totalHeight: number;
    /** Scroll container client height (px). */
    containerHeight: number;
    /** Table top offset (px) when compressed (host-clamped). */
    windowTop: number;
    /** True when content exceeds the max physical height (virtual-scroll compression). */
    compressed: boolean;
    /** Px above the slice (uncompressed only; emitted as capped spacer rows). */
    topSpacer: number;
    /** Px below the slice (uncompressed only). */
    bottomSpacer: number;
}

export interface RecordViewCallbacks {
    /** Scroll → host recomputes the slice and feeds a new render input. */
    onScrollTop?: (scrollTop: number) => void;
    /** Record-index range of unloaded (null) rows in the slice; host maps to pages + requests. */
    onNeedPage?: (first: number, last: number) => void;
}

// ── Pure render ───────────────────────────────────────────────────

export function renderRecordViewHtml(input: RecordViewRenderInput): string {
    const table = recordTableHtml(input);
    if (input.compressed) {
        return `<div style="position:relative;height:${input.totalHeight}px">${table}</div>`;
    }
    return table;
}

function recordTableHtml(input: RecordViewRenderInput): string {
    const style = input.compressed ? ` style="position:absolute;top:${input.windowTop}px;left:0"` : '';
    return `<table class="rtbl"${style}>` +
        `<thead><tr><th>Addr</th><th>Type</th><th>Cnt</th><th>Data</th><th>CHK</th></tr></thead>` +
        `<tbody>${recordRowsHtml(input)}</tbody></table>`;
}

function recordRowsHtml(input: RecordViewRenderInput): string {
    const parts: string[] = [];
    if (!input.compressed) { parts.push(spacerRowsHtml(input.topSpacer)); }
    parts.push(...input.records.map(record => recordRowOrPlaceholder(record, input.format)));
    if (!input.compressed) { parts.push(spacerRowsHtml(input.bottomSpacer)); }
    return parts.join('');
}

function recordRowOrPlaceholder(record: SerializedRecord | null, format: 'ihex' | 'srec'): string {
    return record ? recordRowHtml(record, format === 'srec') : PLACEHOLDER_ROW_HTML;
}

export function renderRecordEmptyHtml(message: string, title = 'Record View Unavailable'): string {
    return `<div class="raw-problems" style="margin:10px">` +
        `<div class="raw-problems-hdr"><span class="raw-problems-title">${esc(title)}</span></div>` +
        `<div style="padding:10px 12px">${esc(message)}</div></div>`;
}

const PLACEHOLDER_ROW_HTML = `<tr class="record-loading"><td colspan="5">Loading…</td></tr>`;

function spacerRowsHtml(totalHeight: number): string {
    let html = '';
    let remaining = totalHeight;
    while (remaining > 0) {
        const chunk = Math.min(remaining, RECORD_MAX_SPACER_PX);
        const safeChunk = Math.max(0, Math.floor(chunk));
        html += `<tr style="height:${safeChunk}px"><td colspan="5"></td></tr>`;
        remaining -= chunk;
    }
    return html;
}

function recordRowHtml(r: SerializedRecord, isSrec: boolean): string {
    const errorClass = r.error || !r.checksumValid ? ' class="rerr"' : '';
    return `<tr${errorClass}>` +
        addressCellHtml(r, isSrec) +
        typeCellHtml(r, isSrec) +
        countCellHtml(r) +
        dataCellHtml(r) +
        checksumCellHtml(r) +
        `</tr>`;
}

function addressCellHtml(r: SerializedRecord, isSrec: boolean): string {
    return `<td class="${recordAddressClass(r, isSrec)}">${esc(recordAddressText(r, isSrec))}</td>`;
}

function typeCellHtml(r: SerializedRecord, isSrec: boolean): string {
    return `<td><span class="rbadge ${recordBadgeClass(r, isSrec)}">${esc(recordTypeLabel(r, isSrec))}</span></td>`;
}

function countCellHtml(r: SerializedRecord): string {
    return `<td class="rcnt">${String(r.byteCount)}</td>`;
}

function dataCellHtml(r: SerializedRecord): string {
    return `<td class="${recordDataClass(r)}">${esc(recordDataText(r))}</td>`;
}

function checksumCellHtml(r: SerializedRecord): string {
    if (r.error) { return `<td><span class="rerr-dash">\u2014</span></td>`; }
    const checksumHex = formatRecordByte(r.checksum);
    if (r.checksumValid) { return `<td><span class="cok">${checksumHex}</span></td>`; }
    return `<td><span class="cerr">${checksumHex}</span><span class="cerr-tag">checksum error</span></td>`;
}

function recordTypeLabel(r: SerializedRecord, isSrec: boolean): string {
    const labels = isSrec ? SREC_TYPE_LABELS : IHEX_TYPE_LABELS;
    return labels[r.recordType] ?? (isSrec ? `S${r.recordType}` : `TYPE ${r.recordType}`);
}

function recordAddressClass(r: SerializedRecord, isSrec: boolean): string {
    return recordHasDataAddress(r, isSrec) ? 'raddr' : 'raddr raddr-empty';
}

function recordAddressText(r: SerializedRecord, isSrec: boolean): string {
    return recordHasDataAddress(r, isSrec)
        ? r.resolvedAddress.toString(16).toUpperCase().padStart(8, '0')
        : '\u2014';
}

function recordDataClass(r: SerializedRecord): string {
    return r.error ? 'rdata rerr-msg' : 'rdata';
}

function recordDataText(r: SerializedRecord): string {
    if (r.error) { return r.error; }
    const data = r.data.map(formatRecordByte).join(' ');
    return data || '\u2014';
}

function formatRecordByte(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, '0');
}

function recordHasDataAddress(r: SerializedRecord, isSrec: boolean): boolean {
    return !r.error && (isSrec
        ? SREC_DATA_RECORD_TYPES.has(r.recordType)
        : r.recordType === 0);
}

function recordBadgeClass(r: SerializedRecord, isSrec: boolean): string {
    if (r.error) { return 'rb-bad'; }
    if (isSrec) { return srecBadgeClass(r.recordType); }
    return ihexBadgeClass(r.recordType);
}

function ihexBadgeClass(recordType: number): string {
    if (IHEX_EXT_RECORD_TYPES.has(recordType)) { return 'rb-ext'; }
    if (IHEX_START_RECORD_TYPES.has(recordType)) { return 'rb-start'; }
    if (recordType === 1) { return 'rb-eof'; }
    return 'rb-data';
}

function srecBadgeClass(recordType: number): string {
    if (SREC_EOF_RECORD_TYPES.has(recordType)) { return 'rb-eof'; }
    if (recordType === 0) { return 'rb-ext'; }
    return 'rb-data';
}

// ── Interaction controller ────────────────────────────────────────

export class RecordView {
    private cb: RecordViewCallbacks;
    private mounted = false;
    private cachedRoot: HTMLElement | null = null;

    constructor(private readonly rootSelector: string, cb: RecordViewCallbacks = {}) {
        this.cb = cb;
    }

    setCallbacks(cb: RecordViewCallbacks): void {
        this.cb = cb;
    }

    /** Document-delegated scroll listener filtered to the root. Idempotent. */
    mount(): void {
        if (this.mounted) { return; }
        this.mounted = true;
        document.addEventListener('scroll', this.handleScroll, true);
    }

    render(input: RecordViewRenderInput): void {
        const root = this.rootEl();
        if (!root) { return; }
        root.innerHTML = renderRecordViewHtml(input);
        this.reportNeedPage(input);
    }

    renderEmpty(message: string, title = 'Record View Unavailable'): void {
        const root = this.rootEl();
        if (!root) { return; }
        root.innerHTML = renderRecordEmptyHtml(message, title);
    }

    private readonly handleScroll = (e: Event): void => {
        const root = this.rootEl();
        if (!root || e.target !== root) { return; }
        this.cb.onScrollTop?.(root.scrollTop);
    };

    private rootEl(): HTMLElement | null {
        if (this.cachedRoot?.isConnected) { return this.cachedRoot; }
        this.cachedRoot = document.querySelector<HTMLElement>(this.rootSelector);
        return this.cachedRoot;
    }

    private reportNeedPage(input: RecordViewRenderInput): void {
        const range = nullRecordRange(input);
        if (range) { this.cb.onNeedPage?.(range[0], range[1]); }
    }
}

/** First..last unloaded (null) record index within the slice, or null if fully loaded. */
function nullRecordRange(input: RecordViewRenderInput): [number, number] | null {
    let first = -1;
    let last = -1;
    input.records.forEach((record, i) => {
        if (record !== null) { return; }
        if (first === -1) { first = input.recordOffset + i; }
        last = input.recordOffset + i;
    });
    return first === -1 ? null : [first, last];
}
