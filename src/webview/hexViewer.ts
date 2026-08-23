// ── HexScope Webview Entry Point ─────────────────────────────────
// Bootstraps the UI, handles VS Code messages, wires all modules.

import { S, BPR }                                       from './state';
import { postProviderMessage, vscode }                from './vscodeApi';
import { esc } from './utils';
import { rerender }                                   from './render/registry';
import { parsePasteText, pasteOverflowNotice } from './pasteUtils';
import {
    getShowAscii,
    invalidateGridRender,
    memRerender,
    mountHexView,
    paintCell,
    paintClearStructHighlight,
    paintMemoryLabelDraft,
    paintMemoryMatchHighlights,
    paintMemorySelection,
    paintStructHighlight,
    scrollTo,
    setShowAscii as setGridShowAscii,
} from './memory/memoryGrid';
import { buildMemRows, getByte } from './memory/memoryData';
import { currentSelectionRange, mappedSelectionRange, selectedBytes } from './memory/selection';
import type { HexViewRange } from './components/hexView/hexViewRender';
import { InspectorPanel } from './components/sidebar/inspectorPanel/inspectorPanel';
import { StructPanel } from './components/sidebar/structPanel/structPanel';
import { clearSearch, initSearch, invalidateSearchIfDiverged, nextMatch, prevMatch, runSearch } from './search/searchEngine';
import { SearchBar } from './components/searchBar/searchBar';
import { Toolbar } from './components/toolbar/toolbar';
import type { LabelDraftPreview, SerializedParseResult, SerializedRecord, StructDef, StructPin } from '../core/types';
import type { SidebarTab } from './components/sidebar/sidebar';
import { RecordView, type RecordViewRenderInput } from './components/recordView/recordView';
import { RecordPageCache } from './recordPageCache';
import { RECORD_PAGE_SIZE } from '../webviewProtocol';
import {
    calcRowOffset,
    calcScrollLayout,
    calcVisibleRange,
    clampWindowTop,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollLayout,
    type VirtualScrollState,
} from './render/virtualScroll';
import { renderStats } from './statsBar';
import { fillSelectionTransaction, redoLastEditTransaction, stageIntegrityEdit, stageIntegrityEditTransaction, undoLastEditTransaction } from './editTransactions';
import { ExternalChange } from './components/externalChange/externalChange';
import { updateExternalChangeLockState } from './lock';

import {
    clearEditModel,
    loadIncomingFile,
    rebuildMemoryRows,
    type ClearEditReason,
    type IncomingFile,
    unlockExternalChange,
} from './appModel';
import { IntegrityPanel, type IntegrityHighlight } from './components/sidebar/integrityPanel/integrityPanel';
import { ScriptsPanel } from './components/sidebar/scriptsPanel/scriptsPanel';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { dispatchProviderMessage, type ProviderMessageHandlers } from './webviewMessageDispatcher';
import {
    applyProviderMessageToModel,
    type WebviewInvalidations,
    type WebviewModelUpdate,
} from './webviewMessageModel';
import { contextCommandResult, copyCommandResult } from './contextCommands';
import { showToast } from './components/toast';
import { formatCopyCommand } from '../core/byteTools/copy';
import { menuController } from './components/menuController/menuController';
import { renderMenuHtml, type MenuState } from './components/menuController/menuRender';
import { Sidebar, type SidebarPanel } from './components/sidebar/sidebar';

// ── Record view component ────────────────────────────────────────
// Component owns table markup, format-specific row formatting, scroll
// reporting, and styles. Host owns the paging cache (RecordPageCache),
// slice computation (shared render/virtualScroll.ts), page requests,
// and page-arrival re-renders.

const RECORD_BUFFER_ROWS = 5;
const RECORD_FALLBACK_ROW_HEIGHT = 28;

const recordPages = new RecordPageCache(8);
let recordRenderSignature = '';
let recordVscrollState: VirtualScrollState | null = null;
let recordRowHeight = RECORD_FALLBACK_ROW_HEIGHT;
let recordResizeObserver: ResizeObserver | null = null;
const recordRowHeightGetter = (): number => recordRowHeight;

const recordView = new RecordView('#record-view', {
    onScrollTop: refreshRecordSlice,
    onNeedPage: (first, last) => requestRecordWindow(first, last, recordCountOfCurrentParse()),
});

// ── Sidebar component ────────────────────────────────────────────
// Generic config-driven tabbed shell. The host wires panel descriptors
// (wrapping existing render fns; each mounts lazily on first activation)
// and the header slot (endian toggle). Per-tab activation side effects
// run host-side in onSidebarTabChange; shell never imports panel modules.

// ── Inspector component ───────────────────────────────────────────
// Self-contained Inspector panel (labels/segments/bits/byte order).
// The host pushes data via setters; the panel reports actions via
// callbacks (jump, label changes, copy).

const inspectorPanel = new InspectorPanel({
    readByte: getByte,
    onJumpTo: address => rerender.jumpTo(address),
    onLabelsChange: applyInspectorLabels,
    onCopy: (text, label) => postProviderMessage({ type: 'copyText', text, label }),
    onLabelDraftChange: applyLabelDraftPreview,
});

/** Live label-form draft: store the range and repaint the grid tint. */
function applyLabelDraftPreview(draft: LabelDraftPreview | null): void {
    S.labelDraft = draft;
    if (S.currentView === 'memory') { paintMemoryLabelDraft(); }
}

/** Persist label mutations from the Inspector component and invalidate. */
function applyInspectorLabels(labels: typeof S.labels, segmentNames?: typeof S.segmentNames): void {
    S.labels = labels;
    if (segmentNames) { S.segmentNames = segmentNames; }
    postProviderMessage({ type: 'saveLabels', labels, segmentNames: S.segmentNames });
    buildMemRows();
    rerender.labels();
    if (S.currentView === 'memory') { rerender.memory(); }
}

/** Push the full Inspector data snapshot after a mount/full render. */
function pushInspectorState(): void {
    inspectorPanel.setEndian(S.endian);
    inspectorPanel.setSegments(S.parseResult?.segments ?? []);
    inspectorPanel.setLabels(S.labels, S.segmentNames);
    inspectorPanel.setSelection(S.selStart, S.selEnd);
}

// ── Struct panel component ────────────────────────────────────────
// Self-contained Struct panel (pins/instances + types/editor tracks).
// Data flows via setters; mutations/selection/highlight report via
// callbacks. Persistence (saveStructs/saveStructPins) lives here; hex
// [data-addr] highlight moves from the component to host-owned helpers.

const structPanel = new StructPanel({
    readByte: getByte,
    onStructsChange: applyStructs,
    onPinsChange: applyPins,
    onStateChange: applyStructState,
    onSelectRange: selectStructRangeHost,
    onHighlightHex: (addrs, cls) => {
        paintStructHighlight(addrs, cls);
    },
    onClearHighlightHex: cls => {
        paintClearStructHighlight(cls);
    },
});

/** Persist struct-definition mutations from the Struct panel. */
function applyStructs(structs: StructDef[]): void {
    S.structs = structs;
    postProviderMessage({ type: 'saveStructs', structs });
}

/** Persist struct-pin mutations from the Struct panel. */
function applyPins(pins: StructPin[]): void {
    S.structPins = pins;
    postProviderMessage({ type: 'saveStructPins', pins });
}

/** Both changed in one action (delete struct cascades pins). */
function applyStructState(structs: StructDef[], pins: StructPin[]): void {
    applyStructs(structs);
    applyPins(pins);
}

/** Struct row/range selection → hex selection + jump + inspector sync (moved from struct module). */
function selectStructRangeHost(start: number, count: number): void {
    S.selStart = start;
    S.selEnd = start + count - 1;
    rerender.jumpTo(start);
    rerender.inspector();
}

/** Push the full Struct panel snapshot after a mount/full render. */
function pushStructState(): void {
    structPanel.setData(S.structs, S.structPins);
    structPanel.setEndian(S.endian);
    structPanel.setBitFieldAllocation(S.bitFieldAllocation);
}

// ── Integrity panel component ────────────────────────────────────
// Self-contained Integrity panel (checks + profiles). Data flows via
// setters; byte reads / selection / endian are pulled via callbacks;
// mutations, persistence, and highlights report via callbacks. Edit
// staging and highlight application stay host-owned.

const integrityPanel = new IntegrityPanel({
    readByte: getByte,
    onStoredValueEdits: stageIntegrityEdits,
    getSelection: () => (S.selStart !== null && S.selEnd !== null ? { start: S.selStart, end: S.selEnd } : null),
    getDataRange: dataRangeFromSegments,
    getEndian: () => S.endian,
    onHighlightChange: applyIntegrityHighlight,
    onCopyText: (text, label) => postProviderMessage({ type: 'copyText', text, label }),
    onPersistChecks: state => postProviderMessage({ type: 'saveIntegrityChecks', state }),
    onCreateProfile: profile => postProviderMessage({ type: 'createIntegrityProfile', profile }),
    onUpdateProfile: profile => postProviderMessage({ type: 'updateIntegrityProfile', profile }),
    onRenameProfile: (id, name) => postProviderMessage({ type: 'renameIntegrityProfile', id, name }),
    onDeleteProfile: id => postProviderMessage({ type: 'deleteIntegrityProfile', id }),
});

/** Integrity check range/stored-field highlight (was S.integrityHighlight + rerender.memory in the module). */
function applyIntegrityHighlight(highlight: IntegrityHighlight | null): void {
    S.integrityHighlight = highlight;
    if (S.currentView === 'memory') { rerender.memory(); }
}

/** Full-file mapped range (min segment start → max segment end); null when no data. */
function dataRangeFromSegments(): { start: number; end: number } | null {
    const segments = S.parseResult?.segments;
    if (!segments || segments.length === 0) { return null; }
    return spanOf(segments);
}

function spanOf(segments: ReadonlyArray<{ startAddress: number; data: ArrayLike<number> }>): { start: number; end: number } {
    let start = Number.MAX_SAFE_INTEGER;
    let end = -1;
    for (const seg of segments) {
        start = Math.min(start, seg.startAddress);
        end = Math.max(end, seg.startAddress + seg.data.length - 1);
    }
    return { start, end };
}

const scriptsPanel = new ScriptsPanel({
    onRequestList: () => postProviderMessage({ type: 'requestScriptList' }),
    onRunScript: (scriptPath, generation, selectionRange) => postProviderMessage({ type: 'runScript', scriptPath, generation, selectionRange }),
    onCancelScript: scriptPath => postProviderMessage({ type: 'cancelScript', scriptPath }),
    onApplyScriptWrites: (_scriptPath, writes) => applyScriptWrites(writes),
    onDiscardScriptWrites: () => {},
    getSelection: () => currentSelectionRange(),
    getGeneration: () => S.documentGeneration,
});

/** Stage script-written bytes as viewer edits (mapped addresses only), then save. */
function applyScriptWrites(writes: Array<[number, number]>): void {
    const mapped = mappedScriptWrites(writes);
    if (mapped.length === 0) { return; }
    for (const [addr, value] of mapped) { S.edits.set(addr, value); }
    S.editMode = true;
    toolbar.setEditMode(true);
    saveEdits();
    refreshAfterLocalEdit();
}

function mappedScriptWrites(writes: Array<[number, number]>): Array<[number, number]> {
    const segments = S.parseResult?.segments ?? [];
    return writes.filter(([addr]) => segments.some(s => addr >= s.startAddress && addr <= s.startAddress + s.data.length - 1));
}

const sidebarPanels: SidebarPanel[] = [
    { id: 'inspector', label: 'Inspector', mount: root => inspectorPanel.mount(root) },
    { id: 'struct', label: 'Struct', mount: root => structPanel.mount(root) },
    { id: 'integrity', label: 'Integrity', mount: root => integrityPanel.mount(root) },
    { id: 'scripts', label: 'Scripts', mount: root => scriptsPanel.mount(root) },
];

const sidebar = new Sidebar({
    panels: sidebarPanels,
    headerSlot: renderEndianToggle,
    cb: { onTabChange: onSidebarTabChange, onPanelActivate: mountSidebarPanel },
});

export function resetRecordPages(generation: number): void {
    recordPages.reset(generation);
    recordRenderSignature = '';
}

export function acceptRecordPage(generation: number, start: number, records: SerializedRecord[]): void {
    if (!recordPages.accept(generation, start, records)) { return; }
    recordRenderSignature = '';
    renderRecordView();
}

export function renderRecordView(): void {
    const parseResult = S.parseResult;
    if (!parseResult) { return; }
    const el = document.getElementById('record-view');
    if (!el) { return; }
    if (recordCountOf(parseResult) === 0) {
        recordView.renderEmpty('This file contains no records.', 'No Records');
        return;
    }
    refreshRecordSlice();
}

/** Re-target the record-view resize observer (full renders recreate the DOM). */
function observeRecordResize(el: HTMLElement): void {
    recordResizeObserver?.disconnect();
    if (typeof ResizeObserver === 'undefined') { return; }
    recordResizeObserver = new ResizeObserver(() => {
        if (S.currentView !== 'record') { return; }
        if (recordCountOf(S.parseResult) === 0) { return; }
        recordRenderSignature = '';
        refreshRecordSlice();
    });
    recordResizeObserver.observe(el);
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

function recordCountOfCurrentParse(): number {
    return recordCountOf(S.parseResult);
}

function recordCountOf(parseResult: SerializedParseResult | null | undefined): number {
    return parseResult ? (parseResult.recordCount ?? parseResult.records.length) : 0;
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
    const cell = document.createElement('td');
    cell.className = 'raddr';
    cell.textContent = '00000000';
    row.appendChild(cell);
    tbody.appendChild(row);
    table.appendChild(tbody);
    el.appendChild(table);

    const height = row.getBoundingClientRect().height;
    table.remove();
    return height > 0 ? height : RECORD_FALLBACK_ROW_HEIGHT;
}

function recordWindowSignature(recordCount: number, first: number, last: number, physicalScrollTop: number, layout: VirtualScrollLayout): string {
    const physicalPart = layout.isCompressed ? Math.floor(physicalScrollTop) : '';
    return `${recordCount}:${first}:${last}:${physicalPart}`;
}

function refreshRecordSlice(): void {
    const ctx = recordViewContext();
    if (!ctx) { return; }
    const { parseResult, el, recordCount } = ctx;

    const state = syncRecordVscrollState(el, recordCount);
    const layout = calcScrollLayout(state);
    const [startIdx, endIdx] = calcVisibleRange(state);
    const lastVisibleIdx = Math.min(recordCount - 1, endIdx - 1);
    requestRecordWindow(startIdx, lastVisibleIdx, recordCount);

    const signature = recordWindowSignature(recordCount, startIdx, lastVisibleIdx, el.scrollTop, layout);
    if (signature === recordRenderSignature) { return; }
    recordRenderSignature = signature;

    recordView.render(buildRecordInput(parseResult, state, layout, startIdx, endIdx, el.scrollTop));
}

function recordViewContext(): { parseResult: SerializedParseResult; el: HTMLElement; recordCount: number } | null {
    const parseResult = S.parseResult;
    const el = document.getElementById('record-view');
    if (!parseResult || !el) { return null; }
    const recordCount = recordCountOf(parseResult);
    if (recordCount === 0) { return null; }
    return { parseResult, el, recordCount };
}

function syncRecordVscrollState(el: HTMLElement, recordCount: number): VirtualScrollState {
    recordRowHeight = getRecordRowHeight(el);
    const state = recordVscrollState ??= {
        containerHeight: 0,
        scrollTop: 0,
        bufferSize: RECORD_BUFFER_ROWS,
        visibleRowIndices: [0, 0],
        rowCount: 0,
        heightVersion: 0,
        getRowHeight: recordRowHeightGetter,
    };
    state.containerHeight = el.clientHeight;
    state.rowCount = recordCount;
    state.heightVersion = recordRowHeight;
    state.scrollTop = physicalToLogicalScroll(el.scrollTop, state);
    return state;
}

function buildRecordInput(
    parseResult: SerializedParseResult,
    state: VirtualScrollState,
    layout: VirtualScrollLayout,
    startIdx: number,
    endIdx: number,
    physicalScrollTop: number,
): RecordViewRenderInput {
    const records = sliceRecordRecords(startIdx, endIdx);
    const { windowTop, topSpacer, bottomSpacer } = recordLayoutSpacers(state, layout, startIdx, endIdx, physicalScrollTop);

    return {
        format: parseResult.format,
        records,
        recordOffset: startIdx,
        totalHeight: layout.physicalHeight,
        containerHeight: state.containerHeight,
        windowTop,
        compressed: layout.isCompressed,
        topSpacer,
        bottomSpacer,
    };
}

function sliceRecordRecords(startIdx: number, endIdx: number): Array<SerializedRecord | null> {
    const records: Array<SerializedRecord | null> = [];
    for (let i = startIdx; i < endIdx; i++) { records.push(cachedRecord(i) ?? null); }
    return records;
}

function recordLayoutSpacers(
    state: VirtualScrollState,
    layout: VirtualScrollLayout,
    startIdx: number,
    endIdx: number,
    physicalScrollTop: number,
): { windowTop: number; topSpacer: number; bottomSpacer: number } {
    const topOffset = calcRowOffset(startIdx, state);
    const renderedHeight = Math.max(0, endIdx - startIdx) * recordRowHeight;
    if (layout.isCompressed) {
        const windowTop = clampWindowTop(physicalScrollTop + topOffset - state.scrollTop, layout.physicalHeight, renderedHeight);
        return { windowTop, topSpacer: 0, bottomSpacer: 0 };
    }
    const bottomSpacer = Math.max(0, (state.rowCount - endIdx) * recordRowHeight);
    return { windowTop: 0, topSpacer: topOffset, bottomSpacer };
}

// ── Direct-typing edit buffer ─────────────────────────────────────
let nibbleBuffer: string | null = null;
let nibbleBufferAddr: number | null = null;

// ── Search bar component ──────────────────────────────────────────
// Component owns search markup/UI state; host owns execution + feedback.
const searchBar = new SearchBar(
    {
        onSearch: (query, mode, endianness, trigger) => {
            S.searchMode = mode;
            S.searchEndianness = endianness;
            runSearch(query, mode, endianness, trigger);
        },
        onPrev: () => prevMatch(),
        onNext: () => nextMatch(),
        onClear: () => clearSearch(),
        onQueryChanged: (query, mode, endianness) => invalidateSearchIfDiverged(query, mode, endianness),
    },
    { mode: S.searchMode, endianness: S.searchEndianness },
);

// ── Toolbar component ────────────────────────────────────────────
// Component owns #toolbar chrome + button wiring; host owns all state
// and edit/save/cancel/view logic (pushed back via setters).
const toolbar = new Toolbar({
    onViewChange: v => switchView(v),
    onAsciiToggle: () => setShowAscii(!getShowAscii()),
    onEditStart: enterEditMode,
    onSave: saveEdits,
    onCancel: cancelEdits,
});

// ── ExternalChange component ────────────────────────────────────
// Component owns the three external-change banners (conflict/reload/
// error) + colocated styles; host owns reload/repair/view logic and
// lock-state transitions (lock.ts).
const externalChange = new ExternalChange();

// ── Context menu (MenuController) ───────────────────────────────
// The shared MenuController owns menu markup/positioning/dismiss/
// hover-submenus/keyboard nav; this host owns all command execution +
// the action logic (go-address, select-all, select-segment).

function enterEditMode(): void {
    S.editMode = true;
    toolbar.setEditMode(true);
    toolbar.setDirty(S.edits.size);
    if (S.currentView === 'memory') { memRerender(); }
}

function saveEdits(): void {
    if (S.edits.size === 0) { return; }
    postProviderMessage({ type: 'saveEdits', edits: Array.from(S.edits.entries()) });
}

function cancelEdits(): void {
    clearNibbleBuffer();
    clearEditState('discard');
    toolbar.setEditMode(false);
    toolbar.setDirty(S.edits.size);
    if (S.currentView === 'memory') { memRerender(); }
    inspectorPanel.setSelection(S.selStart, S.selEnd);
}

function clearNibbleBuffer(): void {
    nibbleBuffer = null;
    if (nibbleBufferAddr !== null) {
        paintCell(nibbleBufferAddr, null);
        nibbleBufferAddr = null;
    }
}

/** Refresh edit-driven chrome after a local byte edit (typed/paste/fill/undo). */
export function refreshAfterLocalEdit(): void {
    toolbar.setDirty(S.edits.size);
    if (S.currentView === 'memory') { memRerender(); }
    inspectorPanel.setSelection(S.selStart, S.selEnd);
    structPanel.render();
    integrityPanel.notifyBytesChanged();
}

function applyTypedEdit(addr: number, value: number): void {
    clearNibbleBuffer();
    const prior = stageIntegrityEdit(addr, value);
    if (!prior) {return;}
    S.undoStack.push([prior]);
    S.redoStack.length = 0;
    S.editMode = true;
    toolbar.setEditMode(S.editMode);
    refreshAfterLocalEdit();
}

function advanceSel(addr: number): void {
    const segs = S.parseResult?.segments;
    const next = addr + 1;
    const same = segs?.find(s => next >= s.startAddress && next < s.startAddress + s.data.length);
    if (same) { updateByteSelection(next, next); return; }
    const later = segs?.find(s => s.startAddress > addr);
    if (later) { updateByteSelection(later.startAddress, later.startAddress); }
}

const HEX_CHAR_RE = /^[0-9a-fA-F]$/;

function handleEditEscape(): void {
    clearNibbleBuffer();
    S.selStart = null;
    S.selEnd = null;
    paintMemorySelection();
    inspectorPanel.setSelection(S.selStart, S.selEnd);
}

function handleEditBufferChar(selStart: number, char: string): void {
    if (nibbleBuffer === null) {
        nibbleBuffer = char;
        nibbleBufferAddr = selStart;
        paintCell(selStart, `${char}\u00b7`);
    } else if (nibbleBufferAddr === selStart) {
        const value = parseInt(nibbleBuffer + char, 16);
        applyTypedEdit(selStart, value);
        advanceSel(selStart);
    } else {
        clearNibbleBuffer();
    }
}

function isEditBlocked(): boolean {
    return !S.editMode || S.lockedDueToExternalChange
        || !!document.activeElement?.closest('#search-box, #menu');
}

function isSingleByteSelected(): boolean {
    return S.selStart !== null && S.selEnd === S.selStart;
}

function isModifierKey(e: KeyboardEvent): boolean {
    return e.ctrlKey || e.metaKey;
}

function onEditKeydown(e: KeyboardEvent): void {
    if (isEditBlocked()) {return;}
    if (isModifierKey(e)) { return; }
    if (!isSingleByteSelected()) { clearNibbleBuffer(); return; }
    processEditKeypress(e, S.selStart!);
}

function isPrintableCharCode(code: number): boolean {
    return code >= 0x20 && code <= 0x7E;
}

function handleCharColumnEdit(e: KeyboardEvent, addr: number): boolean {
    if (S.lastClickColumn !== 'char' || e.key.length !== 1) { return false; }
    const code = e.key.charCodeAt(0);
    if (!isPrintableCharCode(code)) { return false; }
    e.preventDefault();
    applyTypedEdit(addr, code);
    advanceSel(addr);
    return true;
}

function processEditKeypress(e: KeyboardEvent, addr: number): void {
    if (e.key === 'Escape') { handleEditEscape(); return; }
    if (handleCharColumnEdit(e, addr)) { return; }
    if (!HEX_CHAR_RE.test(e.key)) {return;}
    e.preventDefault();
    handleEditBufferChar(addr, e.key.toUpperCase());
}

// ── Copy/paste keyboard handler ──────────────────────────────────

function collectSelectedBytes(): number[] {
    if (S.selStart === null || S.selEnd === null) { return []; }
    const addrs = [];
    for (let a = S.selStart; a <= S.selEnd; a++) { addrs.push(a); }
    return addrs.filter(a => getByte(a) !== undefined).map(a => getByte(a)!);
}

function doCopySelection(): void {
    const bytes = collectSelectedBytes();
    if (bytes.length === 0) { return; }
    const fmt = S.lastClickColumn === 'char' ? 'ascii' as const : 'hex' as const;
    navigator.clipboard.writeText(formatCopyCommand(fmt, bytes)).catch(() => {});
}

function buildPasteEdits(range: { start: number; end: number }, bytes: number[]): Array<[number, number]> {
    const edits: Array<[number, number]> = [];
    let addr = range.start;
    for (const b of bytes) {
        if (getByte(addr) === undefined) { break; }
        edits.push([addr, b]);
        addr++;
    }
    return edits;
}

function applyPasteBytes(range: { start: number; end: number }, clipText: string): void {
    const bytes = pasteBytes(clipText);
    if (bytes.length === 0) { return; }
    const edits = buildPasteEdits(range, bytes);
    const staged = stagePasteEdits(edits);
    if (staged > 0) { refreshAfterLocalEdit(); }
    const notice = pasteOverflowNotice(staged, bytes.length);
    if (notice) { toolbar.setStatus(notice); }
}

function pasteBytes(clipText: string): number[] {
    return parsePasteText(clipText) ?? [...clipText].map(c => c.charCodeAt(0));
}

function stagePasteEdits(edits: Array<[number, number]>): number {
    return edits.length > 0 ? stageIntegrityEditTransaction(edits) : 0;
}

function doPasteToSelection(): void {
    if (isEditBlocked()) { return; }
    clearNibbleBuffer();
    if (S.selStart === null) { return; }
    const range = currentSelectionRange();
    if (!range) { return; }
    navigator.clipboard.readText()
        .then(text => applyPasteBytes(range, text))
        .catch(() => {});
}

function isCopyKey(e: KeyboardEvent): boolean { return e.key === 'c'; }
function isPasteKey(e: KeyboardEvent): boolean { return e.key === 'v'; }

function onCopyPasteKeydown(e: KeyboardEvent): void {
    if (!isModifierKey(e)) { return; }
    if (isCopyKey(e)) { e.preventDefault(); doCopySelection(); return; }
    if (isPasteKey(e)) { e.preventDefault(); doPasteToSelection(); return; }
}

postProviderMessage({ type: 'ready' });

// ── Message handler ───────────────────────────────────────────────

type WebviewMessage = ProviderToWebviewMessage;
type WebviewMessageByType<T extends WebviewMessage['type']> = Extract<WebviewMessage, { type: T }>;
type ModelUpdateEffect = (update: WebviewModelUpdate) => void;
type InvalidationEffect = readonly [keyof WebviewInvalidations, () => void];

const MESSAGE_HANDLERS: ProviderMessageHandlers = {
    init: handleInitMessage,
    loadProgress: handleLoadProgressMessage,
    recordPage: handleRecordPageMessage,
    loadError: handleLoadErrorMessage,
    addLabel: handleAddLabelMessage,
    updateLabel: handleUpdateLabelMessage,
    copyCommand: handleCopyCommandMessage,
    savedEdits: handleSavedEditsMessage,
    externalChange: handleExternalChangeMessage,
    externalChangeError: handleExternalChangeErrorMessage,
    repairComplete: handleRepairCompleteMessage,
    integrityProfiles: handleIntegrityProfilesMessage,
    scriptInfo: handleScriptInfoMessage,
    scriptResult: handleScriptResultMessage,
    scriptOutput: handleScriptOutputMessage,
    activateScriptsTab: handleActivateScriptsTabMessage,
};

const MODEL_UPDATE_EFFECTS: readonly ModelUpdateEffect[] = [
    applyIntegrityProfileUpdate,
    applyLoadErrorUpdate,
    applyCopyCommandUpdate,
    applyExternalBannerUpdate,
    applyExternalChangeUpdate,
    applyExternalChangeErrorUpdate,
];

window.addEventListener('message', (e: MessageEvent) => {
    dispatchProviderMessage(e.data, MESSAGE_HANDLERS);
});

// Ctrl+Z undo lives in the host (not the search component), gated on edit mode.
function isUndoShortcut(e: KeyboardEvent): boolean {
    return hasCombination(e) && e.key === 'z' && !e.shiftKey && S.editMode;
}

function isRedoShortcut(e: KeyboardEvent): boolean {
    return S.editMode && hasCombination(e) && redoKey(e);
}

/** Ctrl/Cmd modifier held (either key). */
function hasCombination(e: KeyboardEvent): boolean {
    return !!(e.ctrlKey || e.metaKey);
}

/** Redo is Cmd/Ctrl+Y or Cmd/Ctrl+Shift+Z. */
function redoKey(e: KeyboardEvent): boolean {
    return e.key === 'y' || (e.key === 'z' && e.shiftKey);
}

function onUndoKeydown(e: KeyboardEvent): void {
    if (isUndoShortcut(e)) {
        e.preventDefault();
        undoLastEdit();
        return;
    }
    if (isRedoShortcut(e)) {
        e.preventDefault();
        redoLastEdit();
    }
}

function onSaveShortcut(e: KeyboardEvent): void {
    if (!isSaveShortcut(e) || !hasEditsToSave()) { return; }
    e.preventDefault();
    saveEdits();
}

/** True when there is at least one staged byte to persist. */
function hasEditsToSave(): boolean {
    return S.editMode && S.edits.size > 0;
}

function isSaveShortcut(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && e.key === 's';
}

// Document-level keydown handlers register ONCE at module load (not per render):
// render() runs again on external-change reloads, and re-registering would
// double-fire arrows/save/edit keys after every reload.
document.addEventListener('keydown', onUndoKeydown);
document.addEventListener('keydown', onEditKeydown, { capture: true });
document.addEventListener('keydown', onCopyPasteKeydown);
document.addEventListener('keydown', onGridSelectionKeydown);
document.addEventListener('keydown', onSaveShortcut);

function handleInitMessage(msg: WebviewMessageByType<'init'>): void {
    resetRecordPages(msg.generation);
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleLoadProgressMessage(msg: WebviewMessageByType<'loadProgress'>): void {
    if (msg.generation < S.documentGeneration) { return; }
    const label = loadProgressLabel(msg);
    if (!S.parseResult) {
        renderInitialLoadProgress(label);
        return;
    }
    renderActiveLoadProgress(label);
}

function loadProgressLabel(msg: WebviewMessageByType<'loadProgress'>): string {
    if (!msg.total || msg.total <= 0) { return msg.stage; }
    return `${msg.stage} ${Math.floor((msg.completed / msg.total) * 100)}%`;
}

function renderInitialLoadProgress(label: string): void {
    const text = document.querySelector('.loading-text');
    if (text) { text.textContent = `Loading ${label}…`; }
}

function renderActiveLoadProgress(label: string): void {
    // Spinner (16px #search-progress slot) plus a text label in the toolbar.
    const progress = document.getElementById('search-progress');
    if (progress) {
        progress.classList.add('active');
        progress.setAttribute('aria-hidden', 'false');
    }
    const text = document.getElementById('load-progress');
    if (text) {
        text.textContent = `Loading ${label}…`;
        text.removeAttribute('hidden');
    }
}

function handleRecordPageMessage(msg: WebviewMessageByType<'recordPage'>): void {
    acceptRecordPage(msg.generation, msg.start, msg.records);
}

function handleIntegrityProfilesMessage(msg: WebviewMessageByType<'integrityProfiles'>): void {
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleLoadErrorMessage(msg: WebviewMessageByType<'loadError'>): void {
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleAddLabelMessage(msg: WebviewMessageByType<'addLabel'>): void {
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleUpdateLabelMessage(msg: WebviewMessageByType<'updateLabel'>): void {
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleCopyCommandMessage(msg: WebviewMessageByType<'copyCommand'>): void {
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleSavedEditsMessage(msg: WebviewMessageByType<'savedEdits'>): void {
    clearNibbleBuffer();
    resetRecordPages(msg.generation);
    clearLoadProgress();
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleExternalChangeMessage(msg: WebviewMessageByType<'externalChange'>): void {
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleExternalChangeErrorMessage(msg: WebviewMessageByType<'externalChangeError'>): void {
    resetRecordPages(msg.generation);
    clearLoadProgress();
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleRepairCompleteMessage(msg: WebviewMessageByType<'repairComplete'>): void {
    resetRecordPages(msg.generation);
    clearLoadProgress();
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleScriptInfoMessage(msg: WebviewMessageByType<'scriptInfo'>): void {
    scriptsPanel.setScripts(msg.scripts, msg.trusted);
}

function handleScriptResultMessage(msg: WebviewMessageByType<'scriptResult'>): void {
    scriptsPanel.showResult(msg.scriptPath, msg.result?.results, msg.result?.log, msg.error, msg.errorType, msg.pendingWriteCount, msg.pendingWrites);
}

function handleScriptOutputMessage(msg: WebviewMessageByType<'scriptOutput'>): void {
    scriptsPanel.appendOutput(msg.scriptPath, msg.text);
}

function handleActivateScriptsTabMessage(_msg: WebviewMessageByType<'activateScriptsTab'>): void {
    S.sidebarTab = 'scripts';
    syncSidebarTab();
    scriptsPanel.setTabActive(true);
}

function clearLoadProgress(): void {
    const progress = document.getElementById('search-progress');
    if (progress) {
        progress.classList.remove('active');
        progress.setAttribute('aria-hidden', 'true');
    }
    const text = document.getElementById('load-progress');
    if (text) {
        text.textContent = '';
        text.setAttribute('hidden', '');
    }
}

function rebuildLabelsAndMemory(): void {
    rebuildMemoryRows();
    rerender.labels();
    if (S.currentView === 'memory') { rerender.memory(); }
}

function clearEditState(reason: ClearEditReason = 'refresh'): void {
    clearEditModel();
    if (reason === 'discard') { integrityPanel.notifyEditsDiscarded(); }
    else { integrityPanel.notifyBytesChanged(); }
}

function renderCurrentDataView(): void {
    if (S.currentView === 'memory') { memRerender(); }
    else if (S.currentView === 'record') { renderRecordView(); }
}

function applyWebviewModelUpdate(update: WebviewModelUpdate): void {
    for (const effect of MODEL_UPDATE_EFFECTS) { effect(update); }
    applyInvalidations(update.invalidations);
}

function applyIntegrityProfileUpdate(update: WebviewModelUpdate): void {
    if (update.integrityProfiles) {
        integrityPanel.setProfiles(update.integrityProfiles, update.integrityProfileError ?? '');
    }
}

function applyLoadErrorUpdate(update: WebviewModelUpdate): void {
    if ('loadErrorMessage' in update) { renderLoadError(update.loadErrorMessage ?? ''); }
}

function applyCopyCommandUpdate(update: WebviewModelUpdate): void {
    if (update.copyCommand) { applyContextCommandResult(copyCommandResult(update.copyCommand, selectedBytes())); }
}

function applyExternalBannerUpdate(update: WebviewModelUpdate): void {
    if (update.removeExternalChangeBanners) { externalChange.clearAll(); }
    // ponytail: host still owns the single error-banner removal (model-driven
    // repair-complete path); if a dedicated clearError API is ever needed it
    // can move into the component.
    if (update.removeExternalChangeErrorBanner) { externalChange.clearError(); }
}

function applyExternalChangeUpdate(update: WebviewModelUpdate): void {
    if (!update.externalChange) { return; }
    if (update.externalChange.hasUnsavedEdits) {
        externalChange.showConflict(update.externalChange.incoming, S.edits.size, reloadDiscardingEdits);
    } else {
        externalChange.showReload(update.externalChange.incoming, applyExternalChangeAndUnlock);
    }
}

function applyExternalChangeErrorUpdate(update: WebviewModelUpdate): void {
    if (!update.externalChangeError) { return; }
    externalChange.showError(
        update.externalChangeError.checksumErrors,
        update.externalChangeError.malformedLines,
        update.externalChangeError.canQuickRepair,
        () => postProviderMessage({ type: 'repairAndReload' }),
        () => postProviderMessage({ type: 'viewInNormalEditor' }),
    );
}

function applyInvalidations(invalidations: WebviewInvalidations): void {
    if (invalidations.fullRender) {
        render();
        return;
    }
    applyScopedInvalidations(invalidations);
}

function applyScopedInvalidations(invalidations: WebviewInvalidations): void {
    const effects: readonly InvalidationEffect[] = [
        ['labelsAndMemory', rebuildLabelsAndMemory],
        ['lockState', updateLockState],
        ['editControls', () => toolbar.setEditMode(S.editMode)],
        ['dirtyBar', () => toolbar.setDirty(S.edits.size)],
        ['stats', renderStatsBar],
        ['segments', () => inspectorPanel.setSegments(S.parseResult?.segments ?? [])],
        ['structPins', () => structPanel.setData(S.structs, S.structPins)],
        ['currentDataView', renderCurrentDataView],
        ['integrityBytesChanged', () => integrityPanel.notifyBytesChanged()],
    ];
    for (const [key, effect] of effects) {
        if (invalidations[key]) { effect(); }
    }
}

// ── Helper: apply external change and unlock ──────────────────────

function applyExternalChangeAndUnlock(incoming: IncomingFile): void {
    resetRecordPages(incoming.generation);
    clearLoadProgress();
    loadIncomingFile(incoming);
    S.currentView = 'memory';
    unlockExternalChange();
    updateLockState();
    render();
    postProviderMessage({ type: 'reloadAccepted' });
}

function activeClass(isActive: boolean): string {
    return isActive ? 'active' : '';
}

function visibleClass(isVisible: boolean): string {
    return isVisible ? 'visible' : '';
}

// ── Lock click interception ──────────────────────────────────────

function preventClickWhenLocked(e: Event): void {
    if (S.lockedDueToExternalChange) {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
    }
}

// ── Main render ───────────────────────────────────────────────────

function render(): void {
    document.getElementById('app')!.innerHTML = `
        ${toolbar.toHtml(searchBar.toHtml())}
        <div id="stats-bar"></div>
        <div id="main-area">
            <div id="content-pane">
                <div id="memory-view" class="${visibleClass(S.currentView === 'memory')}" tabindex="0" aria-label="Hex editor grid">
                    <div id="mem-header"></div>
                    <div id="mem-scroll"><div id="mem-rows"></div></div>
                </div>
                <div id="record-view" class="${visibleClass(S.currentView === 'record')}"></div>
            </div>
            ${sidebar.toHtml()}
        </div>`;

    invalidateGridRender();
    setupRenderedUi();
}

function setupRenderedUi(): void {
    setupLockInterception();
    sidebar.mount();
    syncSidebarTab();
    searchBar.mount();
    toolbar.mount();
    recordView.mount();
    const recordRoot = document.getElementById('record-view');
    if (recordRoot) { observeRecordResize(recordRoot); }
    toolbar.setView(S.currentView);
    toolbar.setEditMode(S.editMode);
    toolbar.setAscii(getShowAscii());
    toolbar.setDirty(S.edits.size);
    setupRerenderCallbacks();
    initSearch(() => switchView('memory'), {
        setCount: (count, current) => searchBar.setCount(count, current),
        setBusy: (busy) => searchBar.setBusy(busy),
    });
    mountHexView({
        onCellClick: onHexViewClick,
        onCellContext: onHexViewContext,
        onSelectionChange: onHexViewSelectionChange,
        onCopy: doCopySelection,
        onAddressRowClick: selectAddressRow,
        onAddressRowDrag: selectAddressRows,
    });
    renderInitialViews();
}

/** Header-slot render: feature-specific endian toggle inside #sidebar-common-settings. */
function renderEndianToggle(root: HTMLElement): void {
    root.innerHTML = `
        <span>Byte order</span>
        <div class="compact-tabs sidebar-endian-tabs">
            <button id="sidebar-btn-le" class="${activeClass(S.endian === 'le')}" type="button">LE</button>
            <button id="sidebar-btn-be" class="${activeClass(S.endian === 'be')}" type="button">BE</button>
        </div>`;
    root.querySelector('#sidebar-btn-le')?.addEventListener('click', () => setFileEndian('le'));
    root.querySelector('#sidebar-btn-be')?.addEventListener('click', () => setFileEndian('be'));
}

function setFileEndian(endian: 'le' | 'be'): void {
    if (S.endian === endian) { return; }
    S.endian = endian;
    const settings = document.getElementById('sidebar-common-settings');
    if (settings) { renderEndianToggle(settings); }
    postProviderMessage({ type: 'saveEndian', endian });
    inspectorPanel.setEndian(S.endian);
    structPanel.setEndian(S.endian);
    integrityPanel.notifyEndianChanged();
}

function setShowAscii(value: boolean): void {
    if (getShowAscii() === value) { return; }
    setGridShowAscii(value);
    toolbar.setAscii(value);
}

function setupLockInterception(): void {
    document.getElementById('main-area')?.addEventListener('click', preventClickWhenLocked, { capture: true });
    document.getElementById('toolbar')?.addEventListener('click', preventClickWhenLocked, { capture: true });
}

function setupRerenderCallbacks(): void {
    rerender.memory   = () => memRerender();
    rerender.labels   = () => inspectorPanel.setLabels(S.labels, S.segmentNames);
    rerender.inspector = () => inspectorPanel.setSelection(S.selStart, S.selEnd);
    rerender.toMemory = () => switchView('memory');
    rerender.jumpTo   = (addr: number) => { switchView('memory'); scrollTo(addr); };
}

function reloadDiscardingEdits(incoming: IncomingFile): void {
    S.edits.clear();
    S.undoStack.length = 0;
    S.redoStack.length = 0;
    S.editMode = false;
    applyExternalChangeAndUnlock(incoming);
}

/** Host-owned per-tab side effects (moved from the old setupSideTabs switch). */
const SIDEBAR_TAB_EFFECTS: Record<SidebarTab, () => void> = {
    inspector: () => structPanel.resetViewState(),
    struct: () => inspectorPanel.setLabels(S.labels, S.segmentNames),
    integrity: () => integrityPanel.setTabActive(true),
    scripts: () => scriptsPanel.setTabActive(true),
};

function onSidebarTabChange(tab: SidebarTab): void {
    S.sidebarTab = tab;
    sidebar.setTab(tab);
    structPanel.setTabActive(tab === 'struct');
    SIDEBAR_TAB_EFFECTS[tab]();
}

/** Lazy-mounts the panel content into its slot root, once per rendered shell. */
function mountSidebarPanel(tab: SidebarTab): void {
    const panel = sidebarPanels.find(p => p.id === tab);
    if (!panel) { return; }
    const root = document.getElementById(`sbp-${tab}`);
    // Behavior-preserving: tab switching toggles visibility only (matches
    // pre-refactor applySidebarState). A panel's content is built once so
    // collapse state / script output survive switching away and back.
    if (!root || root.hasChildNodes()) { return; }
    panel.mount(root);
}

/** After a full render: sync component active tab to host truth + mount active panel. */
function syncSidebarTab(): void {
    sidebar.setTab(S.sidebarTab);
    structPanel.setTabActive(S.sidebarTab === 'struct');
    mountSidebarPanel(S.sidebarTab);
}

function renderInitialViews(): void {
    pushInspectorState();
    pushStructState();
    renderStatsBar();
    renderCurrentDataView();
    searchBar.setCount(S.matchAddrs.length, S.matchIdx);
}

function renderLoadError(message: string): void {
    document.getElementById('app')!.innerHTML = `
        <div class="loading-shell">
            <div class="loading-card">
                <div class="loading-eyebrow">HexScope</div>
                <div class="loading-title">Could not open file</div>
                <div class="loading-text">${esc(message)}</div>
            </div>
        </div>`;
}

function renderStatsBar(): void {
    renderStats(S.parseResult);
}

// ── Memory view ───────────────────────────────────────────────────

function updateByteSelection(start: number, end: number, keepGridAnchor = false): void {
    clearNibbleBuffer();
    S.selStart = start;
    S.selEnd   = end;
    // Every selection change drops a stale Shift-extend anchor, except the
    // extend path itself (it re-anchors each keypress).
    if (!keepGridAnchor) { gridArrowAnchor = null; }
    paintMemorySelection();
    inspectorPanel.setSelection(S.selStart, S.selEnd);
    inspectorPanel.syncLabelForm();
    structPanel.setSelection(S.selStart);
}

function onHexViewClick(addr: number, shift: boolean, column: 'hex' | 'char'): void {
    clearNibbleBuffer();
    S.lastClickColumn = column;
    const range = shift && S.selStart !== null
        ? (addr < S.selStart ? { start: addr, end: S.selStart } : { start: S.selStart, end: addr })
        : { start: addr, end: addr };
    updateByteSelection(range.start, range.end);
}

/** Address-gutter click: select the mapped bytes of that row. */
function selectAddressRow(rowBase: number, shift: boolean): void {
    clearNibbleBuffer();
    if (!S.parseResult) { return; }
    const span = rowAddressSpan(rowBase);
    if (!span) { return; }
    updateByteSelection(...mappedSelectionRange(...span, shift));
}

/** Address-gutter drag: select the mapped span across the dragged rows. */
function selectAddressRows(rows: HexViewRange): void {
    clearNibbleBuffer();
    if (!S.parseResult) { return; }
    const first = rowAddressSpan(rows.start);
    const last = rowAddressSpan(rows.end);
    if (!first || !last) { return; }
    updateByteSelection(first[0], last[1]);
}

/** First/last mapped address among the `BPR` bytes of a row. */
function rowAddressSpan(rowBase: number): [number, number] | null {
    const addrs = rowAddresses(rowBase);
    if (addrs.length === 0) { return null; }
    return [addrs[0], addrs[addrs.length - 1]];
}

/** Mapped addresses among the BPR bytes of a row. */
function rowAddresses(rowBase: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < BPR; i++) {
        const addr = rowBase + i;
        if (getByte(addr) === undefined) { continue; }
        out.push(addr);
    }
    return out;
}

// ── Grid keyboard selection (arrow keys; Shift extends) ───────────

/** Fixed end of a Shift-extended selection; reset by mouse selection paths. */
let gridArrowAnchor: number | null = null;

function onGridSelectionKeydown(e: KeyboardEvent): void {
    if (!gridSelectionGate(e)) { return; }
    if (S.selStart === null) { selectFirstMappedByte(e); return; }
    e.preventDefault();
    applyGridArrow(e.shiftKey, arrowKeyDirection(e.key));
}

/** True when this keydown targets the focused, active grid outside inputs/menu. */
function gridSelectionGate(e: KeyboardEvent): boolean {
    return isGridActive() && isGridFocused() && !isTypingTarget(e) && isGridArrowKey(e);
}

function isGridActive(): boolean {
    return S.currentView === 'memory' && !S.editMode;
}

function isGridFocused(): boolean {
    return !!document.activeElement?.closest('#memory-view');
}

function isTypingTarget(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && !!t.closest('input, select, textarea');
}

/** Arrow key → selection movement; menu key → open the context menu at the grid center. */
function isGridArrowKey(e: KeyboardEvent): boolean {
    if (isArrowKey(e.key)) { return true; }
    if (isGridMenuKey(e)) { e.preventDefault(); openGridContextMenu(); }
    return false;
}

function isGridMenuKey(e: KeyboardEvent): boolean {
    return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

function isArrowKey(key: string): boolean {
    return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

type NavDirection = 'up' | 'down' | 'left' | 'right';

function arrowKeyDirection(key: string): NavDirection {
    return key === 'ArrowLeft' ? 'left' : key === 'ArrowRight' ? 'right' : key === 'ArrowUp' ? 'up' : 'down';
}

function selectFirstMappedByte(e: KeyboardEvent): void {
    const first = S.segmentIndex[0];
    if (!first) { return; }
    gridArrowAnchor = null;
    e.preventDefault();
    updateByteSelection(first.startAddr, first.startAddr);
}

function applyGridArrow(shift: boolean, dir: NavDirection): void {
    if (!shift) { gridArrowAnchor = null; collapseGridSelection(dir); return; }
    if (gridArrowAnchor === null) { gridArrowAnchor = S.selStart; }
    extendGridSelection(dir);
}

function collapseGridSelection(dir: NavDirection): void {
    if (S.selStart === null) { return; }
    const target = walkMappedAddress(S.selStart, dir);
    if (target !== null) { updateByteSelection(target, target); }
}

function extendGridSelection(dir: NavDirection): void {
    const activeEnd = gridActiveEnd();
    if (activeEnd === null) { return; }
    const target = walkMappedAddress(activeEnd, dir);
    if (target === null) { return; }
    updateByteSelection(Math.min(gridArrowAnchor!, target), Math.max(gridArrowAnchor!, target), true);
}

function gridActiveEnd(): number | null {
    if (noGridSelection()) { return null; }
    return gridArrowAnchor === S.selStart ? S.selEnd : S.selStart;
}

function noGridSelection(): boolean {
    return gridArrowAnchor === null || S.selStart === null || S.selEnd === null;
}

function openGridContextMenu(): void {
    if (S.selStart === null) { return; }
    const el = document.getElementById('memory-view');
    if (!el) { return; }
    const r = el.getBoundingClientRect();
    showCtxMenu(r.left + r.width / 2, r.top + r.height / 2);
}

/** Nearest mapped address `dir` away, skipping unmapped gaps (segment jumps, bounded). */
export function walkMappedAddress(from: number, dir: NavDirection): number | null {
    if (S.segmentIndex.length === 0) { return null; }
    return firstMappedStep(from, dir);
}

function firstMappedStep(from: number, dir: NavDirection): number | null {
    if (isVertical(dir)) { return verticalMappedStep(from, dir); }
    let addr = horizontalStep(from, dir);
    while (inMappedBounds(addr)) {
        if (getByte(addr) !== undefined) { return addr; }
        addr = nextCandidate(addr, dir);
    }
    return null;
}

function isVertical(dir: NavDirection): dir is 'up' | 'down' {
    return dir === 'up' || dir === 'down';
}

function horizontalStep(from: number, dir: NavDirection): number {
    return dir === 'right' ? from + 1 : from - 1;
}

/** Column-preserving vertical movement: keep the same column across a gap; ragged rows fall back to the row edge. */
function verticalMappedStep(from: number, dir: 'up' | 'down'): number | null {
    const col = from % BPR;
    let probe = verticalProbe(from, dir);
    while (inMappedBounds(probe)) {
        const anchor = rowAnchorFor(probe, dir);
        if (anchor === null) {
            probe = nextCandidate(probe, dir);
            continue;
        }
        const colAddr = (anchor - (anchor % BPR)) + col;
        if (getByte(colAddr) !== undefined) { return colAddr; }
        return anchor;
    }
    return null;
}

function verticalProbe(from: number, dir: 'up' | 'down'): number {
    return dir === 'down' ? from + BPR : from - BPR;
}

function rowAnchorFor(addr: number, dir: 'up' | 'down'): number | null {
    return dir === 'down' ? firstMappedInRow(addr) : lastMappedInRow(addr);
}

function firstMappedInRow(addr: number): number | null {
    const rowTop = addr - (addr % BPR);
    for (let a = rowTop; a < rowTop + BPR; a++) {
        if (getByte(a) !== undefined) { return a; }
    }
    return null;
}

function lastMappedInRow(addr: number): number | null {
    const rowTop = addr - (addr % BPR);
    for (let a = rowTop + BPR - 1; a >= rowTop; a--) {
        if (getByte(a) !== undefined) { return a; }
    }
    return null;
}

function nextCandidate(addr: number, dir: NavDirection): number {
    if (isForward(dir)) { return segmentStartAfter(addr) ?? Number.MAX_SAFE_INTEGER; }
    return segmentEndBefore(addr) ?? Number.MIN_SAFE_INTEGER;
}

function isForward(dir: NavDirection): boolean {
    return dir === 'down' || dir === 'right';
}

function mappedBounds(): { min: number; max: number } | null {
    const first = S.segmentIndex[0];
    const last = S.segmentIndex[S.segmentIndex.length - 1];
    if (!first || !last) { return null; }
    return { min: first.startAddr, max: last.endAddr };
}

function inMappedBounds(addr: number, bounds: { min: number; max: number } | null = mappedBounds()): boolean {
    return bounds !== null && addr >= bounds.min && addr <= bounds.max;
}

/** First segment start strictly after `addr`, or null. */
function segmentStartAfter(addr: number): number | null {
    const segs = S.segmentIndex;
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (segs[mid].startAddr <= addr) { lo = mid + 1; } else { hi = mid; }
    }
    return lo < segs.length ? segs[lo].startAddr : null;
}

/** Last segment end strictly before `addr`, or null. */
function segmentEndBefore(addr: number): number | null {
    const segs = S.segmentIndex;
    let lo = 0;
    let hi = segs.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (segs[mid].endAddr < addr) { lo = mid + 1; } else { hi = mid; }
    }
    return lo > 0 ? segs[lo - 1].endAddr : null;
}

function onHexViewContext(addr: number, x: number, y: number): void {
    gridArrowAnchor = null;
    if (!isAddressInSelection(addr)) {
        updateByteSelection(addr, addr);
    }
    showCtxMenu(x, y);
}

function isAddressInSelection(addr: number): boolean {
    return S.selStart !== null && S.selEnd !== null && addr >= S.selStart && addr <= S.selEnd;
}

function onHexViewSelectionChange(range: HexViewRange): void {
    gridArrowAnchor = null;
    S.selStart = range.start;
    S.selEnd = range.end;
    paintMemorySelection();
    inspectorPanel.setSelection(S.selStart, S.selEnd);
    inspectorPanel.syncLabelForm();
    integrityPanel.notifySelectionChanged();
}

function selLen(): number {
    if (S.selStart === null || S.selEnd === null) { return 0; }
    return S.selEnd - S.selStart + 1;
}

// ── View switching ────────────────────────────────────────────────

type ViewName = 'memory' | 'record';

function toggleClassById(id: string, className: string, active: boolean): void {
    document.getElementById(id)?.classList.toggle(className, active);
}

function setDisplayById(id: string, visible: boolean): void {
    document.getElementById(id)!.style.display = visible ? '' : 'none';
}

function updateViewVisibility(v: ViewName): void {
    toggleClassById('record-view', 'visible', v === 'record');
    toggleClassById('memory-view', 'visible', v === 'memory');
}

function updateMemoryOnlyControls(visible: boolean): void {
    setDisplayById('sidebar', visible);
    setDisplayById('side-tabs', visible);
    searchBar.setVisible(visible);
}

function renderCurrentView(v: ViewName): void {
    if (v === 'memory') { memRerender(); return; }
    renderRecordView();
}

function switchView(v: ViewName): void {
    S.currentView = v;
    toolbar.setView(v);
    updateViewVisibility(v);
    updateMemoryOnlyControls(v === 'memory');
    renderCurrentView(v);
}

/** Update UI lock state when external change occurs or is resolved. */
function updateLockState(): void {
    updateExternalChangeLockState(S.lockedDueToExternalChange);
}

function stageIntegrityEdits(edits: Array<[number, number]>): void {
    if (!stageIntegrityEditTransaction(edits)) { return; }
    refreshAfterIntegrityEdits();
}

function refreshAfterIntegrityEdits(): void {
    refreshAfterLocalEdit();
    toolbar.setEditMode(S.editMode);
}

// ── Edit helpers ──────────────────────────────────────────────────

function applyFill(fillVal: number): void {
    fillSelectionTransaction(currentSelectionRange(), fillVal);
    refreshAfterLocalEdit();
}

function undoLastEdit(): void {
    clearNibbleBuffer();
    if (!undoLastEditTransaction()) { return; }
    refreshAfterLocalEdit();
}

function redoLastEdit(): void {
    clearNibbleBuffer();
    if (!redoLastEditTransaction()) { return; }
    refreshAfterLocalEdit();
}

// ── Copy helpers ──────────────────────────────────────────────────
// ── Context menu ──────────────────────────────────────────────────

function handleCtxCommand(cmd: string): void {
    if (cmd === 'go-address') { goToContextAddress(); return; }
    if (cmd === 'select-all') { selectAllMappedBytes(); return; }
    if (cmd === 'select-segment') { selectSegmentAtSelection(); return; }
    applyContextCommandResult(contextCommandResult(cmd, selectedBytes(), S.editMode));
}

function applyContextCommandResult(result: ReturnType<typeof contextCommandResult>): void {
    if (result.type === 'copyText') {
        postProviderMessage({ type: 'copyText', text: result.text, label: result.label });
        showToast('Copied ✓');
    }
    if (result.type === 'fill') { applyFill(result.value); }
}

function ctxMenuState(): MenuState {
    const len = selLen();
    return {
        selectionActive: S.selStart !== null && len > 0,
        len,
        bytes: selectedBytes(),
        editMode: S.editMode,
        endian: S.endian,
        goAddress: computeGoAddress(len),
    };
}

function showCtxMenu(x: number, y: number): void {
    menuController.show(x, y, {
        innerHTML: renderMenuHtml(ctxMenuState()),
        emit: handleCtxCommand,
    });
}

/** Go-address target: uint32 read from the 4 selected bytes in system endian. */
function computeGoAddress(len: number): MenuState['goAddress'] {
    if (len !== 4 || S.selStart === null) { return null; }
    const bytes = selectedBytes();
    if (bytes.length !== 4) { return null; }
    const address = joinEndianBytes(bytes, S.endian);
    return { address, valid: getByte(address) !== undefined };
}

function joinEndianBytes(bytes: number[], endian: 'le' | 'be'): number {
    const raw = endian === 'le'
        ? bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)
        : (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    return raw >>> 0;
}

function goToContextAddress(): void {
    const go = computeGoAddress(selLen());
    if (!go || !go.valid) { return; }
    scrollTo(go.address);
    updateByteSelection(go.address, go.address);
}

function selectAllMappedBytes(): void {
    const idx = S.segmentIndex;
    if (idx.length === 0) { return; }
    updateByteSelection(idx[0].startAddr, idx[idx.length - 1].endAddr);
}

function selectSegmentAtSelection(): void {
    if (S.selStart === null) { return; }
    const seg = S.segmentIndex.find(s => S.selStart! >= s.startAddr && S.selStart! <= s.endAddr);
    if (!seg) { return; }
    updateByteSelection(seg.startAddr, seg.endAddr);
}

