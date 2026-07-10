// ── HexScope Webview Entry Point ─────────────────────────────────
// Bootstraps the UI, handles VS Code messages, wires all modules.

import { S }                                          from './state';
import { postProviderMessage, vscode }                from './vscodeApi';
import { esc } from './utils';
import { rerender }                                   from './render/registry';
import { renderMemHeader, renderMemBody, applySel, scrollTo } from './memory/memoryView';
import { setupMemoryDragSelection as setupMemoryDragSelectionController } from './memory/dragSelection';
import { currentSelectionRange, selectedBytes, selectByteForContextMenu, selectByteFromClick } from './memory/selection';
import { renderInspector, renderBits, renderSegments, renderLabels, updateInspector, updateLabelFormSel } from './sidebar/sidebar';
import { setupSidebarResize } from './sidebar/sidebarResize';
import { renderStructPins, onSelectionChangeForStruct, resetStructViewState } from './sidebar/struct/index';
import { initSearch } from './search/searchEngine';
import { setupSearchControls } from './search/searchControls';
import type { SerializedParseResult } from '../core/types';
import type { SidebarTab } from './sidebar/sidebarTypes';
import { acceptRecordPage, renderRecordView, resetRecordPages } from './recordView';
import { renderStats } from './statsBar';
import { fillSelectionTransaction, stageIntegrityEditTransaction, undoLastEditTransaction } from './editTransactions';
import { updateDirtyBar, updateEditControls } from './editControls';
import {
    removeAllExternalChangeBanners,
    showExternalChangeConflict,
    showExternalChangeError,
    showExternalChangeReloadBanner,
    updateExternalChangeLockState,
} from './externalChangeUi';

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
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { dispatchProviderMessage, type ProviderMessageHandlers } from './webviewMessageDispatcher';
import {
    applyProviderMessageToModel,
    type WebviewInvalidations,
    type WebviewModelUpdate,
} from './webviewMessageModel';
import { contextCommandResult, copyCommandResult } from './contextCommands';
import { setupContextMenu, showContextMenu } from './contextMenuController';

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

function handleInitMessage(msg: WebviewMessageByType<'init'>): void {
    resetRecordPages(msg.generation);
    applyWebviewModelUpdate(applyProviderMessageToModel(msg));
}

function handleLoadProgressMessage(msg: WebviewMessageByType<'loadProgress'>): void {
    if (msg.generation < S.documentGeneration) { return; }
    const percent = msg.total && msg.total > 0 ? Math.floor((msg.completed / msg.total) * 100) : null;
    const label = percent === null ? msg.stage : `${msg.stage} ${percent}%`;
    if (!S.parseResult) {
        document.getElementById('app')!.innerHTML = `<div class="load-progress" role="status">Loading ${esc(label)}…</div>`;
        return;
    }
    const progress = document.getElementById('search-progress');
    if (progress) {
        progress.textContent = `Loading ${label}…`;
        progress.setAttribute('aria-hidden', 'false');
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
    if (update.removeExternalChangeBanners) { removeAllExternalChangeBanners(); }
    if (update.removeExternalChangeErrorBanner) { document.getElementById('ext-error-banner')?.remove(); }
}

function applyExternalChangeUpdate(update: WebviewModelUpdate): void {
    if (!update.externalChange) { return; }
    if (update.externalChange.hasUnsavedEdits) {
        showExternalChangeConflict(update.externalChange.incoming, S.edits.size, reloadDiscardingEdits);
    } else {
        showExternalChangeReloadBanner(update.externalChange.incoming, applyExternalChangeAndUnlock);
    }
}

function applyExternalChangeErrorUpdate(update: WebviewModelUpdate): void {
    if (!update.externalChangeError) { return; }
    showExternalChangeError(
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
        ['editControls', updateEditControls],
        ['dirtyBar', updateDirtyBar],
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

function selectedAttr(isSelected: boolean): string {
    return isSelected ? 'selected' : '';
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
        <div id="toolbar">
            <div class="view-tabs">
                <button id="btn-mem" class="${activeClass(S.currentView === 'memory')}">Memory</button>
                <button id="btn-rec" class="${activeClass(S.currentView === 'record')}">Records</button>
            </div>
            <div class="tb-sep"></div>
            <button id="btn-edit-mode" class="tb-edit-btn" title="Enter edit mode">&#11041; Edit</button>
            <div id="edit-mode-group" style="display:none">
                <span class="tb-editing-pill">&#9679; EDITING</span>
                <span id="edit-dirty-count"></span>
                <button id="btn-save"   class="tb-save-btn"   title="Save edits to file">&#128190; Save</button>
                <button id="btn-cancel" class="tb-cancel-btn" title="Discard all edits">&#10005; Cancel</button>
            </div>
            <div id="search-box">
                <div id="search-endian-toggle" class="compact-tabs search-endian-toggle" style="display:none">
                    <button id="search-btn-auto" class="${activeClass(S.searchEndianness === 'auto')}" type="button">Auto</button>
                    <button id="search-btn-le" class="${activeClass(S.searchEndianness === 'le')}" type="button">LE</button>
                    <button id="search-btn-be" class="${activeClass(S.searchEndianness === 'be')}" type="button">BE</button>
                </div>
                <select id="search-mode">
                    <option value="bytes" ${selectedAttr(S.searchMode === 'bytes')}>Bytes</option>
                    <option value="value" ${selectedAttr(S.searchMode === 'value')}>Value</option>
                    <option value="ascii" ${selectedAttr(S.searchMode === 'ascii')}>ASCII</option>
                    <option value="addr"  ${selectedAttr(S.searchMode === 'addr')}>Addr</option>
                </select>
                <input id="search-input" type="text" placeholder="Search…" autocomplete="off" spellcheck="false">
                <button class="nav-btn search-btn" id="btn-search" title="Run search" aria-label="Run search">🔍</button>
                <button class="nav-btn" id="btn-prev"         title="Previous match">▲</button>
                <button class="nav-btn" id="btn-next"         title="Next match">▼</button>
                <button class="nav-btn" id="btn-clear-search" title="Clear">✕</button>
                <span id="search-progress" class="search-progress" aria-hidden="true"></span>
                <span id="match-count"></span>
            </div>
        </div>
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
            </div>
            <div id="side-tabs">
                <button class="${sideTabClass('inspector')}" id="stab-insp">Inspector</button>
                <button class="${sideTabClass('struct')}" id="stab-struct">Struct Overlay</button>
                <button class="${sideTabClass('integrity')}" id="stab-integrity">Integrity Checks</button>
            </div>
        </div>
        <div id="ctx-menu" style="display:none"></div>`;

    setupRenderedUi();
}

function setupRenderedUi(): void {
    setupToolbarButtons();
    setupLockInterception();
    setupSidebarResize();
    setupEndianControl();
    setupEditButtons();
    setupSearchControls(undoLastEdit);
    setupRerenderCallbacks();
    setIntegrityEditHandler(stageIntegrityEdits);
    initSearch(() => switchView('memory'));
    setupMemoryDragSelection();
    setupSideTabs();
    renderInitialViews();
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

function setupToolbarButtons(): void {
    document.getElementById('btn-mem')!.addEventListener('click', () => switchView('memory'));
    document.getElementById('btn-rec')!.addEventListener('click', () => switchView('record'));
    updateEditControls();
}

function setupLockInterception(): void {
    document.getElementById('main-area')?.addEventListener('click', preventClickWhenLocked, { capture: true });
    document.getElementById('toolbar')?.addEventListener('click', preventClickWhenLocked, { capture: true });
}

function setupEditButtons(): void {
    document.getElementById('btn-edit-mode')!.addEventListener('click', () => {
        S.editMode = true;
        updateEditControls();
        updateDirtyBar();
        if (S.currentView === 'memory') { memRerender(); }
    });
    document.getElementById('btn-cancel')!.addEventListener('click', () => {
        clearEditState('discard');
        updateEditControls();
        updateDirtyBar();
        if (S.currentView === 'memory') { memRerender(); }
        updateInspector();
    });
    document.getElementById('btn-save')!.addEventListener('click', () => {
        if (S.edits.size === 0) { return; }
        postProviderMessage({ type: 'saveEdits', edits: Array.from(S.edits.entries()) });
    });
}

function setupRerenderCallbacks(): void {
    rerender.memory   = () => memRerender();
    rerender.labels   = () => renderLabels();
    rerender.toMemory = () => switchView('memory');
    rerender.jumpTo   = (addr: number) => { switchView('memory'); scrollTo(addr); };
}

function setupMemoryDragSelection(): void {
    setupMemoryDragSelectionController(currentSelectionRange, (start, end) => {
        S.selStart = start;
        S.selEnd = end;
        applySel();
        updateInspector();
        updateLabelFormSel();
    });
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
}

function applySidebarState(): void {
    document.getElementById('sbp-insp')!.classList.toggle('active', S.sidebarTab === 'inspector');
    document.getElementById('sbp-struct')!.classList.toggle('active', S.sidebarTab === 'struct');
    document.getElementById('sbp-integrity')!.classList.toggle('active', S.sidebarTab === 'integrity');
    document.getElementById('stab-insp')!.classList.toggle('active', S.sidebarTab === 'inspector');
    document.getElementById('stab-struct')!.classList.toggle('active', S.sidebarTab === 'struct');
    document.getElementById('stab-integrity')!.classList.toggle('active', S.sidebarTab === 'integrity');
}

function renderInitialViews(): void {
    renderStatsBar();
    renderMemHeader();
    renderInspector();
    renderBits();
    renderStructPins();
    renderIntegrity();
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

function memRerender(): void {
    renderMemBody(onByteDown, onByteCtx);
}

function updateByteSelection(start: number, end: number): void {
    S.selStart = start;
    S.selEnd   = end;
    applySel();
    updateInspector();
    updateLabelFormSel();
    onSelectionChangeForStruct();
}

function onByteDown(e: MouseEvent, el: HTMLElement): void {
    selectByteFromClick(e, el, updateByteSelection);
}

function onByteCtx(e: MouseEvent, el: HTMLElement): void {
    selectByteForContextMenu(el, updateByteSelection);
    showCtxMenu(e.clientX, e.clientY);
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
    toggleClassById('btn-mem', 'active', v === 'memory');
    toggleClassById('btn-rec', 'active', v === 'record');
}

function updateMemoryOnlyControls(visible: boolean): void {
    setDisplayById('btn-edit-mode', visible);
    setDisplayById('edit-mode-group', visible && S.editMode);
    setDisplayById('sidebar', visible);
    setDisplayById('side-tabs', visible);
    setDisplayById('search-box', visible);
}

function renderCurrentView(v: ViewName): void {
    if (v === 'memory') { memRerender(); return; }
    renderRecordView();
}

function switchView(v: ViewName): void {
    S.currentView = v;
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
    updateEditControls();
    updateDirtyBar();
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
    renderStructPins();
    notifyIntegrityBytesChanged();
}

// ── Edit helpers ──────────────────────────────────────────────────

function applyFill(fillVal: number): void {
    fillSelectionTransaction(currentSelectionRange(), fillVal);
    updateDirtyBar();
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
    renderStructPins();
    notifyIntegrityBytesChanged();
}

function undoLastEdit(): void {
    if (!undoLastEditTransaction()) { return; }
    updateDirtyBar();
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
