// ── HexScope Webview Entry Point ─────────────────────────────────
// Bootstraps the UI, handles VS Code messages, wires all modules.

import { S }                                          from './state';
import { postProviderMessage, vscode }                from './vscodeApi';
import { esc } from './utils';
import { rerender }                                   from './render/registry';
import { parsePasteText }                             from './pasteUtils';
import {
    getShowAscii,
    invalidateGridRender,
    memRerender,
    mountHexView,
    paintCell,
    paintMemoryMatchHighlights,
    paintMemorySelection,
    scrollTo,
    setShowAscii as setGridShowAscii,
} from './memory/memoryGrid';
import { getByte } from './memory/memoryData';
import { currentSelectionRange, selectedBytes } from './memory/selection';
import type { HexViewRange } from './components/HexView/HexView';
import { renderSegments, renderLabels, renderInspectorSections, updateInspector,
    updateLabelFormSel } from './sidebar/sidebar';
import { renderStructPins, onSelectionChangeForStruct, resetStructViewState } from './sidebar/struct/index';
import { clearSearch, initSearch, nextMatch, prevMatch, runSearch } from './search/searchEngine';
import { SearchBar } from './components/SearchBar/SearchBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import type { SerializedParseResult, SerializedRecord } from '../core/types';
import type { SidebarTab } from './sidebar/sidebarTypes';
import { RecordView, type RecordViewRenderInput } from './components/RecordView/RecordView';
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
import { fillSelectionTransaction, stageIntegrityEdit, stageIntegrityEditTransaction, undoLastEditTransaction } from './editTransactions';
import { ExternalChange } from './components/ExternalChange/ExternalChange';
import { updateExternalChangeLockState } from './lock';

import {
    clearEditModel,
    loadIncomingFile,
    rebuildMemoryRows,
    type ClearEditReason,
    type IncomingFile,
    unlockExternalChange,
} from './appModel';
import {
    activateIntegrity,
    notifyIntegrityBytesChanged,
    notifyIntegrityEditsDiscarded,
    notifyIntegrityEndianChanged,
    renderIntegrity,
    setIntegrityEditHandler,
    setIntegrityProfiles,
} from './sidebar/integrity/index';
import { updateScriptList, updateScriptResult, updateScriptOutput, activateScripts, renderScripts } from './sidebar/scripts/index';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { dispatchProviderMessage, type ProviderMessageHandlers } from './webviewMessageDispatcher';
import {
    applyProviderMessageToModel,
    type WebviewInvalidations,
    type WebviewModelUpdate,
} from './webviewMessageModel';
import { contextCommandResult, copyCommandResult } from './contextCommands';
import { formatCopyCommand } from '../core/byte-tools/copy';
import { ContextMenu, type ContextMenuState } from './components/ContextMenu/ContextMenu';
import { Sidebar, type SidebarPanel } from './components/Sidebar/Sidebar';

// ── Record view component ────────────────────────────────────────
// Component owns table markup, format-specific row formatting, scroll
// reporting, and styles. Host owns the paging cache (RecordPageCache),
// slice computation (shared render/virtualScroll.ts), page requests,
// and page-arrival re-renders.

const RECORD_BUFFER_ROWS = 5;
const RECORD_FALLBACK_ROW_HEIGHT = 28;
const RECORD_EMPTY_MESSAGE = 'Record details are not loaded in the webview. Use Memory view for navigation and editing.';

const recordPages = new RecordPageCache(8);
let recordRenderSignature = '';
let recordVscrollState: VirtualScrollState | null = null;
let recordRowHeight = RECORD_FALLBACK_ROW_HEIGHT;
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

const sidebarPanels: SidebarPanel[] = [
    { id: 'inspector', label: 'Inspector', mount: root => renderInspectorSections(root) },
    { id: 'struct', label: 'Struct', mount: root => { root.innerHTML = '<div id="s-struct-pins"></div>'; renderStructPins(); } },
    { id: 'integrity', label: 'Integrity', mount: root => { root.innerHTML = '<div id="s-integrity"></div>'; renderIntegrity(); } },
    { id: 'scripts', label: 'Scripts', mount: root => { root.innerHTML = '<div id="s-scripts"></div>'; renderScripts(); } },
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
        recordView.renderEmpty(RECORD_EMPTY_MESSAGE);
        return;
    }
    refreshRecordSlice();
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

// ── ContextMenu component ────────────────────────────────────────
// Component owns menu markup, positioning, dismiss, hover-submenus and
// the transient inline-input state; host owns all command execution +
// the new action logic (go-address, select-all, select-segment).
const contextMenu = new ContextMenu({
    onCommand: cmd => handleCtxCommand(cmd),
});

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
    updateInspector();
}

function clearNibbleBuffer(): void {
    nibbleBuffer = null;
    if (nibbleBufferAddr !== null) {
        paintCell(nibbleBufferAddr, null);
        nibbleBufferAddr = null;
    }
}

function applyTypedEdit(addr: number, value: number): void {
    clearNibbleBuffer();
    const prior = stageIntegrityEdit(addr, value);
    if (!prior) {return;}
    S.undoStack.push([prior]);
    S.editMode = true;
    toolbar.setDirty(S.edits.size);
    toolbar.setEditMode(S.editMode);
    memRerender();
    updateInspector();
    renderStructPins();
    notifyIntegrityBytesChanged();
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
    updateInspector();
}

function handleEditBufferChar(selStart: number, char: string): void {
    if (nibbleBuffer === null) {
        nibbleBuffer = char;
        nibbleBufferAddr = selStart;
        paintCell(selStart, `${char}-`);
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
        || !!document.activeElement?.closest('#search-box, #ctx-menu');
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

function stagePasteFromText(range: { start: number; end: number }, clipText: string): Array<[number, number]> {
    const parsed = parsePasteText(clipText);
    const bytes = parsed ?? [...clipText].map(c => c.charCodeAt(0));
    return bytes.length > 0 ? buildPasteEdits(range, bytes) : [];
}

function applyPasteBytes(range: { start: number; end: number }, clipText: string): void {
    const edits = stagePasteFromText(range, clipText);
    if (edits.length > 0 && stageIntegrityEditTransaction(edits)) {
        toolbar.setDirty(S.edits.size);
        toolbar.setEditMode(S.editMode);
        memRerender();
        updateInspector();
        renderStructPins();
        notifyIntegrityBytesChanged();
    }
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
    return (e.ctrlKey || e.metaKey) && e.key === 'z' && S.editMode;
}

function onUndoKeydown(e: KeyboardEvent): void {
    if (isUndoShortcut(e)) {
        e.preventDefault();
        undoLastEdit();
    }
}

document.addEventListener('keydown', onUndoKeydown);

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
    const progress = document.getElementById('search-progress');
    if (!progress) { return; }
    progress.textContent = `Loading ${label}…`;
    progress.setAttribute('aria-hidden', 'false');
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
    updateScriptList(msg);
}

function handleScriptResultMessage(msg: WebviewMessageByType<'scriptResult'>): void {
    updateScriptResult(msg.scriptPath, msg.result, msg.error, msg.errorType, msg.pendingWriteCount);
}

function handleScriptOutputMessage(msg: WebviewMessageByType<'scriptOutput'>): void {
    updateScriptOutput(msg.scriptPath, msg.text);
}

function handleActivateScriptsTabMessage(_msg: WebviewMessageByType<'activateScriptsTab'>): void {
    S.sidebarTab = 'scripts';
    syncSidebarTab();
    activateScripts();
}

function clearLoadProgress(): void {
    const progress = document.getElementById('search-progress');
    if (!progress) { return; }
    progress.textContent = '';
    progress.setAttribute('aria-hidden', 'true');
}

function rebuildLabelsAndMemory(): void {
    rebuildMemoryRows();
    rerender.labels();
    if (S.currentView === 'memory') { rerender.memory(); }
}

function clearEditState(reason: ClearEditReason = 'refresh'): void {
    clearEditModel();
    if (reason === 'discard') { notifyIntegrityEditsDiscarded(); }
    else { notifyIntegrityBytesChanged(); }
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
        setIntegrityProfiles(update.integrityProfiles, update.integrityProfileError ?? '');
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
        ['segments', renderSegments],
        ['structPins', renderStructPins],
        ['currentDataView', renderCurrentDataView],
        ['integrityBytesChanged', notifyIntegrityBytesChanged],
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
                <div id="memory-view" class="${visibleClass(S.currentView === 'memory')}">
                    <div id="mem-header"></div>
                    <div id="mem-scroll"><div id="mem-rows"></div></div>
                </div>
                <div id="record-view" class="${visibleClass(S.currentView === 'record')}"></div>
            </div>
            ${sidebar.toHtml()}
        </div>
        <div id="ctx-menu" style="display:none"></div>`;

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
    contextMenu.mount();
    toolbar.setView(S.currentView);
    toolbar.setEditMode(S.editMode);
    toolbar.setAscii(getShowAscii());
    toolbar.setDirty(S.edits.size);
    setupRerenderCallbacks();
    setIntegrityEditHandler(stageIntegrityEdits);
    initSearch(() => switchView('memory'), {
        setCount: (count, current) => searchBar.setCount(count, current),
        setBusy: (busy) => searchBar.setBusy(busy),
    });
    mountHexView({
        onCellClick: onHexViewClick,
        onCellContext: onHexViewContext,
        onSelectionChange: onHexViewSelectionChange,
        onCopy: doCopySelection,
    });
    renderInitialViews();
    document.addEventListener('keydown', onEditKeydown, { capture: true });
    document.addEventListener('keydown', onCopyPasteKeydown);
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
    updateInspector();
    renderStructPins();
    notifyIntegrityEndianChanged();
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
    rerender.labels   = () => renderLabels();
    rerender.toMemory = () => switchView('memory');
    rerender.jumpTo   = (addr: number) => { switchView('memory'); scrollTo(addr); };
}

function reloadDiscardingEdits(incoming: IncomingFile): void {
    S.edits.clear();
    S.undoStack.length = 0;
    S.editMode = false;
    applyExternalChangeAndUnlock(incoming);
}

/** Host-owned per-tab side effects (moved from the old setupSideTabs switch). */
const SIDEBAR_TAB_EFFECTS: Record<SidebarTab, () => void> = {
    inspector: resetStructViewState,
    struct: renderLabels,
    integrity: activateIntegrity,
    scripts: activateScripts,
};

function onSidebarTabChange(tab: SidebarTab): void {
    S.sidebarTab = tab;
    sidebar.setTab(tab);
    SIDEBAR_TAB_EFFECTS[tab]();
}

/** Mounts-or-rerenders the lazy panel content into its slot root. */
function mountSidebarPanel(tab: SidebarTab): void {
    const panel = sidebarPanels.find(p => p.id === tab);
    if (!panel) { return; }
    const root = document.getElementById(`sbp-${tab}`);
    if (!root) { return; }
    panel.mount(root);
}

/** After a full render: sync component active tab to host truth + mount active panel. */
function syncSidebarTab(): void {
    sidebar.setTab(S.sidebarTab);
    mountSidebarPanel(S.sidebarTab);
}

function renderInitialViews(): void {
    renderStatsBar();
    renderCurrentDataView();
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

function updateByteSelection(start: number, end: number): void {
    clearNibbleBuffer();
    S.selStart = start;
    S.selEnd   = end;
    paintMemorySelection();
    updateInspector();
    updateLabelFormSel();
    onSelectionChangeForStruct();
}

function onHexViewClick(addr: number, shift: boolean, column: 'hex' | 'char'): void {
    clearNibbleBuffer();
    S.lastClickColumn = column;
    const range = shift && S.selStart !== null
        ? (addr < S.selStart ? { start: addr, end: S.selStart } : { start: S.selStart, end: addr })
        : { start: addr, end: addr };
    updateByteSelection(range.start, range.end);
}

function onHexViewContext(addr: number, x: number, y: number): void {
    if (!isAddressInSelection(addr)) {
        updateByteSelection(addr, addr);
    }
    showCtxMenu(x, y);
}

function isAddressInSelection(addr: number): boolean {
    return S.selStart !== null && S.selEnd !== null && addr >= S.selStart && addr <= S.selEnd;
}

function onHexViewSelectionChange(range: HexViewRange): void {
    S.selStart = range.start;
    S.selEnd = range.end;
    paintMemorySelection();
    updateInspector();
    updateLabelFormSel();
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
    toolbar.setEditMode(S.editMode);
    toolbar.setDirty(S.edits.size);
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
    renderStructPins();
    notifyIntegrityBytesChanged();
}

// ── Edit helpers ──────────────────────────────────────────────────

function applyFill(fillVal: number): void {
    fillSelectionTransaction(currentSelectionRange(), fillVal);
    toolbar.setDirty(S.edits.size);
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
    renderStructPins();
    notifyIntegrityBytesChanged();
}

function undoLastEdit(): void {
    clearNibbleBuffer();
    if (!undoLastEditTransaction()) { return; }
    toolbar.setDirty(S.edits.size);
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
    renderStructPins();
    notifyIntegrityBytesChanged();
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
    }
    if (result.type === 'fill') { applyFill(result.value); }
}

function ctxMenuState(): ContextMenuState {
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
    contextMenu.show(x, y, ctxMenuState());
}

/** Go-address target: uint32 read from the 4 selected bytes in system endian. */
function computeGoAddress(len: number): ContextMenuState['goAddress'] {
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

