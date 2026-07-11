import type { SerializedRecord, SerializedParseResult } from '../core/types';
import { MAX_VIRTUAL_SCROLL_HEIGHT, physicalToLogicalScrollForLayout } from './render/virtualScroll';
import { S } from './state';
import { postProviderMessage } from './vscodeApi';
import { RECORD_PAGE_SIZE } from '../webviewProtocol';
import { RecordPageCache } from './recordPageCache';

const IHEX_TYPE_LABELS: Record<number, string> = {
    0: 'DATA', 1: 'EOF', 2: 'EXT SEG ADDR', 3: 'START SEG ADDR',
    4: 'EXT LIN ADDR', 5: 'START LIN ADDR',
};

const SREC_TYPE_LABELS: Record<number, string> = {
    0: 'HEADER', 1: 'DATA S1', 2: 'DATA S2', 3: 'DATA S3',
    5: 'COUNT', 6: 'COUNT S6', 7: 'END S7', 8: 'END S8', 9: 'END S9',
};

const RECORD_FALLBACK_ROW_HEIGHT = 28;
const RECORD_BUFFER_ROWS = 5;
const RECORD_MAX_SPACER_PX = 1_000_000;
let recordRenderSignature = '';
const recordPages = new RecordPageCache(8);

export function resetRecordPages(generation: number): void {
    recordPages.reset(generation);
    recordRenderSignature = '';
}

export function acceptRecordPage(generation: number, start: number, records: SerializedRecord[]): void {
    if (!recordPages.accept(generation, start, records)) { return; }
    recordRenderSignature = '';
    renderRecordView();
}

function requestRecordPage(start: number, recordCount: number): void {
    if (!recordPages.request(start, recordCount)) { return; }
    postProviderMessage({
        type: 'requestRecordPage',
        generation: recordPages.generation,
        start,
        count: Math.min(RECORD_PAGE_SIZE, recordCount - start),
    });
}

function requestRecordWindow(first: number, last: number, recordCount: number): void {
    const firstPage = Math.floor(first / RECORD_PAGE_SIZE) * RECORD_PAGE_SIZE;
    const lastPage = Math.floor(last / RECORD_PAGE_SIZE) * RECORD_PAGE_SIZE;
    for (let start = firstPage; start <= lastPage; start += RECORD_PAGE_SIZE) { requestRecordPage(start, recordCount); }
    requestRecordPage(firstPage - RECORD_PAGE_SIZE, recordCount);
    requestRecordPage(lastPage + RECORD_PAGE_SIZE, recordCount);
}

function cachedRecord(index: number): SerializedRecord | undefined {
    return recordPages.get(index) ?? S.parseResult?.records[index];
}

interface RecordScrollLayout {
    totalHeight: number;
    physicalHeight: number;
    logicalScrollable: number;
    physicalScrollable: number;
    isCompressed: boolean;
}

type RecordRenderWindow = {
    firstVisibleIdx: number;
    lastVisibleIdx: number;
    physicalScrollTop: number;
    scrollTop: number;
    rowHeight: number;
    layout: RecordScrollLayout;
};

function calcRecordScrollLayout(recordCount: number, containerHeight: number, rowHeight: number): RecordScrollLayout {
    const totalHeight = recordCount * rowHeight;
    const physicalHeight = Math.min(totalHeight, MAX_VIRTUAL_SCROLL_HEIGHT);
    const logicalScrollable = Math.max(0, totalHeight - containerHeight);
    const physicalScrollable = Math.max(0, physicalHeight - containerHeight);

    return {
        totalHeight,
        physicalHeight,
        logicalScrollable,
        physicalScrollable,
        isCompressed: totalHeight > physicalHeight,
    };
}

function recordPhysicalToLogicalScroll(physicalScrollTop: number, layout: RecordScrollLayout): number {
    return physicalToLogicalScrollForLayout(physicalScrollTop, layout);
}

function getRecordRowHeight(el: HTMLElement): number {
    const table = document.createElement('table');
    table.className = 'rtbl';
    table.style.position = 'absolute';
    table.style.visibility = 'hidden';
    table.style.pointerEvents = 'none';
    table.style.width = '100%';

    const tbody = document.createElement('tbody');
    const row = document.createElement('tr');
    row.appendChild(recordCellFromText('raddr', '00000000'));
    tbody.appendChild(row);
    table.appendChild(tbody);
    el.appendChild(table);

    const height = row.getBoundingClientRect().height;
    table.remove();
    return height > 0 ? height : RECORD_FALLBACK_ROW_HEIGHT;
}

export function renderRecordView(): void {
    const view = availableRecordView();
    if (!view) { return; }
    const { el, parseResult } = view;

    if (recordCountOf(parseResult) === 0) {
        el.replaceChildren(recordViewUnavailableNode());
        return;
    }

    initializeRecordScroll(el);

    recordRenderSignature = '';
    renderRecordViewImpl(el);
}

function availableRecordView(): { el: HTMLElement; parseResult: SerializedParseResult } | null {
    const el = document.getElementById('record-view');
    if (!el || !S.parseResult) { return null; }
    return { el, parseResult: S.parseResult };
}

function calcRecordRenderWindow(el: HTMLElement, recordCount: number): RecordRenderWindow {
    const containerHeight = el.clientHeight;
    const rowHeight = getRecordRowHeight(el);
    const layout = calcRecordScrollLayout(recordCount, containerHeight, rowHeight);
    const physicalScrollTop = el.scrollTop;
    const scrollTop = recordPhysicalToLogicalScroll(physicalScrollTop, layout);
    return {
        firstVisibleIdx: Math.max(0, Math.floor(scrollTop / rowHeight) - RECORD_BUFFER_ROWS),
        lastVisibleIdx: Math.min(recordCount - 1, Math.ceil((scrollTop + containerHeight) / rowHeight) + RECORD_BUFFER_ROWS),
        physicalScrollTop,
        scrollTop,
        rowHeight,
        layout,
    };
}

function recordWindowSignature(recordCount: number, win: RecordRenderWindow): string {
    const physicalPart = win.layout.isCompressed ? Math.floor(win.physicalScrollTop) : '';
    return `${recordCount}:${win.firstVisibleIdx}:${win.lastVisibleIdx}:${physicalPart}`;
}

function appendRecordTopSpacer(rows: HTMLTableRowElement[], win: RecordRenderWindow): void {
    if (win.firstVisibleIdx <= 0 || win.layout.isCompressed) { return; }
    appendRecordSpacerRows(rows, win.firstVisibleIdx * win.rowHeight);
}

function appendVisibleRecordRows(
    rows: HTMLTableRowElement[],
    win: RecordRenderWindow,
    isSrec: boolean,
    typeLabels: Record<number, string>,
): void {
    for (let i = Math.max(0, win.firstVisibleIdx); i <= win.lastVisibleIdx; i++) {
        const record = cachedRecord(i);
        rows.push(record ? recordRow(record, isSrec, typeLabels) : recordPlaceholderRow());
    }
}

function recordCountOf(parseResult: SerializedParseResult): number {
    return parseResult.recordCount ?? parseResult.records.length;
}

function initializeRecordScroll(el: HTMLElement): void {
    if (el.dataset.recordVscrollInit) { return; }
    el.dataset.recordVscrollInit = '1';
    el.addEventListener('scroll', () => renderRecordViewImpl(el));
}

function recordPlaceholderRow(): HTMLTableRowElement {
    const row = document.createElement('tr');
    row.className = 'record-loading';
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = 'Loading…';
    row.appendChild(cell);
    return row;
}

function appendRecordBottomSpacer(rows: HTMLTableRowElement[], recordCount: number, win: RecordRenderWindow): void {
    if (win.lastVisibleIdx >= recordCount - 1 || win.layout.isCompressed) { return; }
    appendRecordSpacerRows(rows, (recordCount - 1 - win.lastVisibleIdx) * win.rowHeight);
}

function replaceRecordViewContent(el: HTMLElement, table: HTMLTableElement, win: RecordRenderWindow): void {
    if (!win.layout.isCompressed) {
        el.replaceChildren(table);
        return;
    }
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.height = `${win.layout.physicalHeight}px`;
    const topOffset = win.firstVisibleIdx * win.rowHeight;
    table.style.position = 'absolute';
    table.style.top = `${win.physicalScrollTop + topOffset - win.scrollTop}px`;
    table.style.left = '0';
    wrapper.appendChild(table);
    el.replaceChildren(wrapper);
}

function renderRecordViewImpl(el: HTMLElement): void {
    const parseResult = S.parseResult;
    if (!parseResult) { return; }

    const recordCount = recordCountOf(parseResult);
    const win = calcRecordRenderWindow(el, recordCount);
    requestRecordWindow(win.firstVisibleIdx, win.lastVisibleIdx, recordCount);
    const signature = recordWindowSignature(recordCount, win);
    if (signature === recordRenderSignature) { return; }
    recordRenderSignature = signature;

    const isSrec = parseResult.format === 'srec';
    const TYPE_LABELS = recordTypeLabels(isSrec);
    const table = recordTableElement();
    const rows: HTMLTableRowElement[] = [];

    appendRecordTopSpacer(rows, win);
    appendVisibleRecordRows(rows, win, isSrec, TYPE_LABELS);
    appendRecordBottomSpacer(rows, recordCount, win);

    const tbody = document.createElement('tbody');
    tbody.append(...rows);
    table.appendChild(tbody);

    replaceRecordViewContent(el, table, win);
}

function recordTypeLabels(isSrec: boolean): Record<number, string> {
    return isSrec ? SREC_TYPE_LABELS : IHEX_TYPE_LABELS;
}

function recordTableElement(): HTMLTableElement {
    const table = document.createElement('table');
    table.className = 'rtbl';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Addr', 'Type', 'Cnt', 'Data', 'CHK'].forEach(label => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    return table;
}

function recordRow(r: SerializedRecord, isSrec: boolean, typeLabels: Record<number, string>): HTMLTableRowElement {
    const row = document.createElement('tr');
    if (r.error || !r.checksumValid) { row.className = 'rerr'; }

    row.append(
        recordCellFromText(recordAddressClass(r, isSrec), recordAddressText(r, isSrec)),
        recordTypeCell(recordBadgeClass(r, isSrec), recordTypeLabel(r, isSrec, typeLabels)),
        recordCellFromText('rcnt', String(r.byteCount)),
        recordCellFromText(recordDataClass(r), recordDataText(r)),
        recordChecksumCell(!!r.error, r.checksumValid, formatRecordByte(r.checksum)),
    );
    return row;
}

function recordTypeLabel(r: SerializedRecord, isSrec: boolean, typeLabels: Record<number, string>): string {
    return typeLabels[r.recordType] ?? defaultRecordTypeLabel(r.recordType, isSrec);
}

function defaultRecordTypeLabel(recordType: number, isSrec: boolean): string {
    return isSrec ? `S${recordType}` : `TYPE ${recordType}`;
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

const SREC_DATA_RECORD_TYPES = new Set([1, 2, 3]);

function recordHasDataAddress(r: SerializedRecord, isSrec: boolean): boolean {
    return !r.error && (isSrec
        ? SREC_DATA_RECORD_TYPES.has(r.recordType)
        : r.recordType === 0);
}

const IHEX_EXT_RECORD_TYPES = new Set([2, 4]);
const IHEX_START_RECORD_TYPES = new Set([3, 5]);
const SREC_EOF_RECORD_TYPES = new Set([7, 8, 9]);

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

function appendRecordSpacerRows(rows: HTMLTableRowElement[], totalHeight: number): void {
    let remaining = totalHeight;
    while (remaining > 0) {
        const chunk = Math.min(remaining, RECORD_MAX_SPACER_PX);
        const safeChunk = Math.max(0, Math.floor(chunk));
        const row = document.createElement('tr');
        row.style.height = `${safeChunk}px`;
        const cell = document.createElement('td');
        cell.colSpan = 5;
        row.appendChild(cell);
        rows.push(row);
        remaining -= chunk;
    }
}

function recordCellFromText(className: string, text: string): HTMLTableCellElement {
    const cell = document.createElement('td');
    cell.className = className;
    cell.textContent = text;
    return cell;
}

function recordTypeCell(badgeClass: string, label: string): HTMLTableCellElement {
    const cell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `rbadge ${badgeClass}`;
    badge.textContent = label;
    cell.appendChild(badge);
    return cell;
}

function recordChecksumCell(hasError: boolean, checksumValid: boolean, checksumHex: string): HTMLTableCellElement {
    const cell = document.createElement('td');
    if (hasError) {
        const dash = document.createElement('span');
        dash.className = 'rerr-dash';
        dash.textContent = '\u2014';
        cell.appendChild(dash);
        return cell;
    }
    if (checksumValid) {
        const ok = document.createElement('span');
        ok.className = 'cok';
        ok.textContent = checksumHex;
        cell.appendChild(ok);
        return cell;
    }

    const bad = document.createElement('span');
    bad.className = 'cerr';
    bad.textContent = checksumHex;
    const tag = document.createElement('span');
    tag.className = 'cerr-tag';
    tag.textContent = 'checksum error';
    cell.append(bad, tag);
    return cell;
}

function recordViewUnavailableNode(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'raw-problems';
    wrapper.style.margin = '10px';

    const header = document.createElement('div');
    header.className = 'raw-problems-hdr';
    const title = document.createElement('span');
    title.className = 'raw-problems-title';
    title.textContent = 'Record View Unavailable';
    header.appendChild(title);

    const body = document.createElement('div');
    body.style.padding = '10px 12px';
    body.textContent = 'Record details are not loaded in the webview. Use Memory view for navigation and editing.';

    wrapper.append(header, body);
    return wrapper;
}
