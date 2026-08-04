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
import { renderInspector, renderBits, renderSegments, renderLabels, updateInspector, updateLabelFormSel } from './sidebar/sidebar';
import { setupSidebarResize } from './sidebar/sidebarResize';
import { renderStructPins, onSelectionChangeForStruct, resetStructViewState } from './sidebar/struct/index';
import { clearSearch, initSearch, nextMatch, prevMatch, runSearch } from './search/searchEngine';
import { SearchBar } from './components/SearchBar/SearchBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import type { SerializedParseResult } from '../core/types';
import type { SidebarTab } from './sidebar/sidebarTypes';
import { acceptRecordPage, renderRecordView, resetRecordPages } from './recordView';
import { renderStats } from './statsBar';
import { fillSelectionTransaction, stageIntegrityEdit, stageIntegrityEditTransaction, undoLastEditTransaction } from './editTransactions';
import { ExternalChange } from './components/ExternalChange/ExternalChange';
import { updateExternalChangeLockState } from './lock';

export { renderRecordView } from './recordView';
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
import { setupContextMenu, showContextMenu } from './contextMenuController';

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
    applySidebarState();
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

function tabPanelClass(tab: SidebarTab): string {
    return S.sidebarTab === tab ? 'sb-tab-panel active' : 'sb-tab-panel';
}

function sideTabClass(tab: SidebarTab): string {
    return S.sidebarTab === tab ? 'stab active' : 'stab';
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
            <div id="sidebar-resizer" aria-label="Resize sidebar" title="Drag to resize sidebar"></div>
            <div id="sidebar">
                <div id="sidebar-common-settings">
                    <span>Byte order</span>
                    <div class="compact-tabs sidebar-endian-tabs">
                        <button id="sidebar-btn-le" class="${activeClass(S.endian === 'le')}" type="button">LE</button>
                        <button id="sidebar-btn-be" class="${activeClass(S.endian === 'be')}" type="button">BE</button>
                    </div>
                </div>
                <div class="${tabPanelClass('inspector')}" id="sbp-insp">
                    <div class="sb-section" id="s-insp"></div>
                    <div class="sb-section" id="s-bits"></div>
                    <div class="sb-section" id="s-segments"></div>
                    <div class="sb-section" id="s-labels"></div>
                </div>
                <div class="${tabPanelClass('struct')}" id="sbp-struct">
                    <div id="s-struct-pins"></div>
                </div>
                <div class="${tabPanelClass('integrity')}" id="sbp-integrity">
                    <div id="s-integrity"></div>
                </div>
                <div class="${tabPanelClass('scripts')}" id="sbp-scripts">
                    <div id="s-scripts"></div>
                </div>
            </div>
            <div id="side-tabs">
                <button class="${sideTabClass('inspector')}" id="stab-insp">Inspector</button>
                <button class="${sideTabClass('struct')}" id="stab-struct">Struct</button>
                <button class="${sideTabClass('integrity')}" id="stab-integrity">Integrity</button>
                <button class="${sideTabClass('scripts')}" id="stab-scripts">Scripts</button>
            </div>
        </div>
        <div id="ctx-menu" style="display:none"></div>`;

    invalidateGridRender();
    setupRenderedUi();
}

function setupRenderedUi(): void {
    setupLockInterception();
    setupSidebarResize();
    setupEndianControl();
    searchBar.mount();
    toolbar.mount();
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
    setupSideTabs();
    renderInitialViews();
    document.addEventListener('keydown', onEditKeydown, { capture: true });
    document.addEventListener('keydown', onCopyPasteKeydown);
}

function setupEndianControl(): void {
    document.getElementById('sidebar-btn-le')?.addEventListener('click', () => setFileEndian('le'));
    document.getElementById('sidebar-btn-be')?.addEventListener('click', () => setFileEndian('be'));
}

function setFileEndian(endian: 'le' | 'be'): void {
    if (S.endian === endian) { return; }
    S.endian = endian;
    document.getElementById('sidebar-btn-le')?.classList.toggle('active', endian === 'le');
    document.getElementById('sidebar-btn-be')?.classList.toggle('active', endian === 'be');
    postProviderMessage({ type: 'saveEndian', endian });
    renderInspector();
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

function setupSideTabs(): void {
    document.getElementById('stab-insp')!.addEventListener('click', () => {
        resetStructViewState();
        S.sidebarTab = 'inspector';
        applySidebarState();
    });
    document.getElementById('stab-struct')!.addEventListener('click', () => {
        renderLabels();
        S.sidebarTab = 'struct';
        applySidebarState();
    });
    document.getElementById('stab-integrity')!.addEventListener('click', () => {
        S.sidebarTab = 'integrity';
        applySidebarState();
        activateIntegrity();
    });
    document.getElementById('stab-scripts')!.addEventListener('click', () => {
        S.sidebarTab = 'scripts';
        applySidebarState();
        activateScripts();
    });
}

function applySidebarState(): void {
    document.getElementById('sbp-insp')!.classList.toggle('active', S.sidebarTab === 'inspector');
    document.getElementById('sbp-struct')!.classList.toggle('active', S.sidebarTab === 'struct');
    document.getElementById('sbp-integrity')!.classList.toggle('active', S.sidebarTab === 'integrity');
    document.getElementById('sbp-scripts')!.classList.toggle('active', S.sidebarTab === 'scripts');
    document.getElementById('stab-insp')!.classList.toggle('active', S.sidebarTab === 'inspector');
    document.getElementById('stab-struct')!.classList.toggle('active', S.sidebarTab === 'struct');
    document.getElementById('stab-integrity')!.classList.toggle('active', S.sidebarTab === 'integrity');
    document.getElementById('stab-scripts')!.classList.toggle('active', S.sidebarTab === 'scripts');
}

function renderInitialViews(): void {
    renderStatsBar();
    renderInspector();
    renderBits();
    renderStructPins();
    renderIntegrity();
    renderScripts();
    renderSegments();
    renderLabels();
    setupCtxMenu();
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
    applyContextCommandResult(contextCommandResult(cmd, selectedBytes(), S.editMode));
}

function applyContextCommandResult(result: ReturnType<typeof contextCommandResult>): void {
    if (result.type === 'copyText') {
        postProviderMessage({ type: 'copyText', text: result.text, label: result.label });
    }
    if (result.type === 'fill') { applyFill(result.value); }
}

function setupCtxMenu(): void {
    setupContextMenu();
}

function showCtxMenu(x: number, y: number): void {
    showContextMenu(x, y, {
        selectionActive: () => S.selStart !== null && selLen() > 0,
        selectionLength: selLen,
        selectionBytes: selectedBytes,
        editMode: () => S.editMode,
    }, handleCtxCommand);
}
