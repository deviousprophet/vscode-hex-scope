// ── HexScope Webview Entry Point ─────────────────────────────────
// Bootstraps the UI, handles VS Code messages, wires all modules.

import { S }                                          from './state';
import { postProviderMessage, vscode }                from './api';
import { esc, fmtB, positionContextMenu, wireHoverSubmenus } from './utils';
import { rerender }                                   from './render';
import { renderMemHeader, renderMemBody, applySel, scrollTo } from './memory/memoryView';
import { renderInspector, renderBits, renderSegments, renderLabels, updateInspector, updateLabelFormSel } from './panels/sidebar';
import { renderStructPins, onSelectionChangeForStruct, resetStructViewState } from './panels/struct';
import { initSearch, runSearch, clearSearch, nextMatch, prevMatch } from './search/searchEngine';
import { getByte }                                    from './data';
import type { SerializedParseResult, SerializedRecord } from '../core/types';
import type { SidebarTab } from './types';
import {
    crc8,
    crc16,
    crc32,
    formatAnalyzeCommand,
    formatAsciiByte,
    formatCopyCommand,
    formatHexArrayByte,
    hexByte,
    hexValue,
    isAnalyzeCommand,
    isCopyCommand,
} from '../core/byte-tools';
import { MAX_VIRTUAL_SCROLL_HEIGHT, physicalToLogicalScrollForLayout } from './memory/virtualScroll';
import {
    addLabel,
    applyInitialState,
    clearEditModel,
    hasUnsavedEdits,
    incomingFile,
    loadIncomingFile,
    loadParsedMemory,
    lockForExternalChange,
    rebuildMemoryRows,
    type ClearEditReason,
    type IncomingFile,
    unlockExternalChange,
    updateLabel,
} from './appModel';
import {
    activateIntegrity,
    notifyIntegrityBytesChanged,
    notifyIntegrityEditsDiscarded,
    notifyIntegrityEndianChanged,
    renderIntegrity,
    setIntegrityEditHandler,
    setIntegrityProfiles,
} from './panels/integrityView';
import { messageType, type ProviderToWebviewMessage, type WebviewToProviderMessage } from '../webviewProtocol';

postProviderMessage({ type: 'ready' });

const SIDEBAR_WIDTH_KEY = 'hexScope.sidebarWidth';
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 900;

function parseSidebarWidth(raw: string | null | undefined): number | null {
    if (!raw) { return null; }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) { return null; }
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, n));
}

// ── Message handler ───────────────────────────────────────────────

type WebviewMessage = ProviderToWebviewMessage;
type WebviewMessageByType<T extends WebviewMessage['type']> = Extract<WebviewMessage, { type: T }>;
type WebviewMessageHandler = (msg: any) => void;

const MESSAGE_HANDLERS: ReadonlyArray<readonly [string, WebviewMessageHandler]> = [
    ['init', handleInitMessage],
    ['loadError', handleLoadErrorMessage],
    ['addLabel', handleAddLabelMessage],
    ['updateLabel', handleUpdateLabelMessage],
    ['copyCommand', handleCopyCommandMessage],
    ['savedEdits', handleSavedEditsMessage],
    ['externalChange', handleExternalChangeMessage],
    ['externalChangeError', handleExternalChangeErrorMessage],
    ['repairComplete', handleRepairCompleteMessage],
    ['integrityProfiles', handleIntegrityProfilesMessage],
];

window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as WebviewMessage;
    const entry = MESSAGE_HANDLERS.find(([type]) => type === messageType(msg));
    entry?.[1](msg);
});

function handleInitMessage(msg: WebviewMessageByType<'init'>): void {
    applyInitialState(msg);
    setIntegrityProfiles(msg.integrityProfiles);
    render();
}

function handleIntegrityProfilesMessage(msg: WebviewMessageByType<'integrityProfiles'>): void {
    setIntegrityProfiles(msg.profiles, typeof msg.error === 'string' ? msg.error : '');
}

function handleLoadErrorMessage(msg: WebviewMessageByType<'loadError'>): void {
    renderLoadError(String(msg.message ?? 'Failed to open file.'));
}

function handleAddLabelMessage(msg: WebviewMessageByType<'addLabel'>): void {
    addLabel(msg.label);
    rebuildLabelsAndMemory();
}

function handleUpdateLabelMessage(msg: WebviewMessageByType<'updateLabel'>): void {
    updateLabel(msg.label);
    rebuildLabelsAndMemory();
}

function handleCopyCommandMessage(msg: WebviewMessageByType<'copyCommand'>): void {
    handleCopyCommand(msg.command as string);
}

function handleSavedEditsMessage(msg: WebviewMessageByType<'savedEdits'>): void {
    loadParsedMemory(msg.parseResult);
    clearEditState();
    document.getElementById('btn-edit-mode')!.style.display = '';
    document.getElementById('edit-mode-group')!.style.display = 'none';
    updateDirtyBar();
    renderStats();
    renderSegments();
    renderStructPins();
    renderCurrentDataView();
}

function handleExternalChangeMessage(msg: WebviewMessageByType<'externalChange'>): void {
    const incoming = incomingFileFromMessage(msg);
    lockForExternalChange();
    removeAllExternalChangeBanners();
    updateLockState();
    if (hasUnsavedEdits()) {
        showExternalChangeConflict(incoming);
    } else {
        showExternalChangeReloadBanner(incoming);
    }
}

function handleExternalChangeErrorMessage(msg: WebviewMessageByType<'externalChangeError'>): void {
    loadIncomingFile(incomingFile(msg.parseResult, msg.labels));
    lockForExternalChange();
    removeAllExternalChangeBanners();
    updateLockState();
    if (hasUnsavedEdits()) { clearEditState(); }

    showExternalChangeError(
        msg.checksumErrors as number,
        msg.malformedLines as number,
        msg.errorCount as number,
        msg.canQuickRepair as boolean,
    );
    renderSegments();
    renderStructPins();
    renderCurrentDataView();
    notifyIntegrityBytesChanged();
}

function handleRepairCompleteMessage(msg: WebviewMessageByType<'repairComplete'>): void {
    loadParsedMemory(msg.parseResult);
    clearEditState();
    document.getElementById('ext-error-banner')?.remove();
    unlockExternalChange();
    updateLockState();
    updateEditControls();
    updateDirtyBar();
    renderStats();
    renderSegments();
    renderStructPins();
    renderCurrentDataView();
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

function incomingFileFromMessage(msg: WebviewMessageByType<'externalChange'>): IncomingFile {
    return incomingFile(msg.parseResult, msg.labels);
}

// ── Helper: apply external change and unlock ──────────────────────

function applyExternalChangeAndUnlock(incoming: IncomingFile): void {
    loadIncomingFile(incoming);
    S.currentView = 'memory';
    unlockExternalChange();
    updateLockState();
    render();
    postProviderMessage({ type: 'reloadAccepted' });
}

// ── Helper: update edit controls visibility ──────────────────────

function updateEditControls(): void {
    const inMemory = S.currentView === 'memory';
    document.getElementById('btn-edit-mode')!.style.display = inMemory ? '' : 'none';
    document.getElementById('edit-mode-group')!.style.display = inMemory && S.editMode ? '' : 'none';
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
    setupSearchControls();
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

function setupSidebarResize(): void {
    const root = document.documentElement;
    const cssDefaultWidth = parseSidebarWidth(getComputedStyle(root).getPropertyValue('--sidebar-w')) ?? 360;
    const savedWidth = parseSidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    let sidebarWidth = savedWidth ?? cssDefaultWidth;
    root.style.setProperty('--sidebar-w', `${sidebarWidth}px`);

    const sidebarResizer = document.getElementById('sidebar-resizer');
    if (!sidebarResizer) { return; }

    let dragging = false;
    const onMove = (ev: MouseEvent) => {
        if (!dragging) { return; }
        const tabs = document.getElementById('side-tabs');
        const tabsWidth = tabs ? tabs.getBoundingClientRect().width : 0;
        const maxAllowed = Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - tabsWidth - 220);
        sidebarWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxAllowed, window.innerWidth - ev.clientX - tabsWidth));
        root.style.setProperty('--sidebar-w', `${sidebarWidth}px`);
    };
    const stopDrag = () => {
        if (!dragging) { return; }
        dragging = false;
        sidebarResizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', stopDrag);
    };

    sidebarResizer.addEventListener('mousedown', ev => {
        if (ev.button !== 0) { return; }
        dragging = true;
        sidebarResizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', stopDrag);
        ev.preventDefault();
    });
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

function setupSearchControls(): void {
    const modeEl  = document.getElementById('search-mode')  as HTMLSelectElement;
    const inputEl = document.getElementById('search-input') as HTMLInputElement;
    const endianToggleEl = document.getElementById('search-endian-toggle') as HTMLDivElement;
    const searchBtnAuto = document.getElementById('search-btn-auto') as HTMLButtonElement;
    const searchBtnLE = document.getElementById('search-btn-le') as HTMLButtonElement;
    const searchBtnBE = document.getElementById('search-btn-be') as HTMLButtonElement;

    const applySearchModeUi = (): void => {
        endianToggleEl.style.display = S.searchMode === 'value' ? 'inline-flex' : 'none';
        inputEl.placeholder = searchPlaceholder();
    };
    const applyEndianUi = (): void => {
        searchBtnAuto.classList.toggle('active', S.searchEndianness === 'auto');
        searchBtnLE.classList.toggle('active', S.searchEndianness === 'le');
        searchBtnBE.classList.toggle('active', S.searchEndianness === 'be');
    };

    modeEl.addEventListener('change', () => {
        S.searchMode = modeEl.value as typeof S.searchMode;
        applySearchModeUi();
    });
    inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runSearch(e.shiftKey ? 'enter-prev' : 'enter-next');
        }
    });
    document.getElementById('btn-search')!.addEventListener('click', () => runSearch('button'));
    document.getElementById('btn-prev')!.addEventListener('click', prevMatch);
    document.getElementById('btn-next')!.addEventListener('click', nextMatch);
    document.getElementById('btn-clear-search')!.addEventListener('click', clearSearch);
    searchBtnAuto.addEventListener('click', () => setSearchEndian('auto', applyEndianUi));
    searchBtnLE.addEventListener('click', () => setSearchEndian('le', applyEndianUi));
    searchBtnBE.addEventListener('click', () => setSearchEndian('be', applyEndianUi));
    document.addEventListener('keydown', e => handleGlobalKeydown(e, inputEl));

    applySearchModeUi();
    applyEndianUi();
}

function searchPlaceholder(): string {
    const placeholders: Record<typeof S.searchMode, string> = {
        bytes: 'Bytes (e.g. DE AD BE EF)',
        value: 'Value (e.g. 0x12345678 or 305419896)',
        ascii: 'ASCII text',
        addr: 'Address (e.g. 0800 or 0x08001234)',
    };
    return placeholders[S.searchMode];
}

function setSearchEndian(value: typeof S.searchEndianness, updateUi: () => void): void {
    S.searchEndianness = value;
    updateUi();
}

function isSearchShortcut(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && e.key === 'f';
}

function isUndoShortcut(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && e.key === 'z' && S.editMode;
}

function focusSearchInput(inputEl: HTMLInputElement): void {
    inputEl.focus();
    inputEl.select();
}

function handleGlobalKeydown(e: KeyboardEvent, inputEl: HTMLInputElement): void {
    if (isSearchShortcut(e)) {
        e.preventDefault();
        focusSearchInput(inputEl);
    }
    if (isUndoShortcut(e)) {
        e.preventDefault();
        undoLastEdit();
    }
}

function setupRerenderCallbacks(): void {
    rerender.memory   = () => memRerender();
    rerender.labels   = () => renderLabels();
    rerender.toMemory = () => switchView('memory');
    rerender.jumpTo   = (addr: number) => { switchView('memory'); scrollTo(addr); };
}

function setupMemoryDragSelection(): void {
    let dragAnchor: number | null = null;
    document.getElementById('mem-rows')!.addEventListener('mousedown', e => {
        if (e.button !== 0) { return; }
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-addr]');
        if (!el) { return; }
        dragAnchor = parseInt(el.dataset.addr!, 16);
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        dragAnchor = updateDragSelection(e, dragAnchor);
    });
    document.addEventListener('mouseup', () => { dragAnchor = null; });
}

function dragSelectionAddressFromPoint(e: MouseEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-addr]');
    if (!el) { return null; }
    const addr = parseInt(el.dataset.addr!, 16);
    return isNaN(addr) ? null : addr;
}

function isSameSelection(start: number, end: number): boolean {
    return start === S.selStart && end === S.selEnd;
}

function applyDragSelection(start: number, end: number): void {
    S.selStart = start;
    S.selEnd   = end;
    applySel();
    updateInspector();
    updateLabelFormSel();
}

function hasActiveDragSelection(e: MouseEvent, dragAnchor: number | null): dragAnchor is number {
    return dragAnchor !== null && Boolean(e.buttons & 1);
}

function updateDragSelection(e: MouseEvent, dragAnchor: number | null): number | null {
    if (!hasActiveDragSelection(e, dragAnchor)) { return null; }
    const addr = dragSelectionAddressFromPoint(e);
    if (addr === null) { return dragAnchor; }
    const newStart = Math.min(dragAnchor, addr);
    const newEnd   = Math.max(dragAnchor, addr);
    if (isSameSelection(newStart, newEnd)) { return dragAnchor; }
    applyDragSelection(newStart, newEnd);
    return dragAnchor;
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
    renderStats();
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

// ── Stats bar ─────────────────────────────────────────────────────

function renderStats(): void {
    const el = document.getElementById('stats-bar');
    if (!el || !S.parseResult) { return; }
    const p = S.parseResult;
    const fmtLabel = formatLabel(p.format);

    const addItem = (label: string | null, value: string, extraClass = ''): void => {
        const item = document.createElement('span');
        item.className = extraClass ? `si ${extraClass}` : 'si';

        if (label !== null) {
            const labelEl = document.createElement('span');
            labelEl.className = 'slb';
            labelEl.textContent = label;
            item.appendChild(labelEl);
        }

        const valueEl = document.createElement('span');
        valueEl.className = 'svl';
        valueEl.textContent = value;
        item.appendChild(valueEl);

        el.appendChild(item);
    };

    el.textContent = '';
    addItem(null, fmtLabel, 'si-fmt');
    addItem('Bytes', fmtB(p.totalDataBytes));
    addItem('Records', String(p.recordCount ?? p.records.length));
    addItem('Segments', String(p.segments.length));
}

function formatLabel(format: 'ihex' | 'srec'): string {
    return format === 'srec' ? 'SREC' : 'IHEX';
}

// ── Memory view ───────────────────────────────────────────────────

function memRerender(): void {
    renderMemBody(onByteDown, onByteCtx);
}

function selectedRangeForClick(e: MouseEvent, addr: number): { start: number; end: number } {
    if (e.shiftKey && S.selStart !== null) {
        return addr < S.selStart
            ? { start: addr, end: S.selStart }
            : { start: S.selStart, end: addr };
    }
    return { start: addr, end: addr };
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
    if (e.button !== 0) { return; }  // ignore right/middle-click
    const addr = parseInt(el.dataset.addr!, 16);
    if (isNaN(addr)) { return; }

    const range = selectedRangeForClick(e, addr);
    updateByteSelection(range.start, range.end);
}

function onByteCtx(e: MouseEvent, el: HTMLElement): void {
    const addr = parseInt(el.dataset.addr!, 16);
    if (!isNaN(addr)) {
        // Keep existing multi-byte selection if right-click is inside it;
        // otherwise collapse to the clicked byte.
        const inSel = isAddressInSelection(addr);
        if (!inSel) {
            S.selStart = addr;
            S.selEnd   = addr;
            applySel();
            updateInspector();
            updateLabelFormSel();
            onSelectionChangeForStruct();
        }
    }
    showCtxMenu(e.clientX, e.clientY);
}

function isAddressInSelection(addr: number): boolean {
    return S.selStart !== null && S.selEnd !== null && addr >= S.selStart && addr <= S.selEnd;
}

function selLen(): number {
    if (S.selStart === null || S.selEnd === null) { return 0; }
    return S.selEnd - S.selStart + 1;
}

// ── Record view ───────────────────────────────────────────────────

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

interface RecordScrollLayout {
    totalHeight: number;
    physicalHeight: number;
    logicalScrollable: number;
    physicalScrollable: number;
    isCompressed: boolean;
}

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

    if (parseResult.records.length === 0) {
        el.replaceChildren(recordViewUnavailableNode());
        return;
    }

    if (!el.dataset.recordVscrollInit) {
        el.dataset.recordVscrollInit = '1';
        el.addEventListener('scroll', () => {
            renderRecordViewImpl(el);
        });
    }

    recordRenderSignature = '';
    renderRecordViewImpl(el);
}

function availableRecordView(): { el: HTMLElement; parseResult: SerializedParseResult } | null {
    const el = document.getElementById('record-view');
    if (!el || !S.parseResult) { return null; }
    return { el, parseResult: S.parseResult };
}

type RecordRenderWindow = {
    firstVisibleIdx: number;
    lastVisibleIdx: number;
    physicalScrollTop: number;
    scrollTop: number;
    rowHeight: number;
    layout: RecordScrollLayout;
};

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
    records: SerializedRecord[],
    win: RecordRenderWindow,
    isSrec: boolean,
    typeLabels: Record<number, string>,
): void {
    for (let i = Math.max(0, win.firstVisibleIdx); i <= win.lastVisibleIdx && i < records.length; i++) {
        rows.push(recordRow(records[i], isSrec, typeLabels));
    }
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
    if (!S.parseResult) { return; }

    const recordCount = S.parseResult.records.length;
    const win = calcRecordRenderWindow(el, recordCount);
    const signature = recordWindowSignature(recordCount, win);
    if (signature === recordRenderSignature) { return; }
    recordRenderSignature = signature;

    const isSrec = S.parseResult.format === 'srec';
    const TYPE_LABELS = isSrec ? SREC_TYPE_LABELS : IHEX_TYPE_LABELS;
    const table = recordTableElement();
    const rows: HTMLTableRowElement[] = [];

    appendRecordTopSpacer(rows, win);
    appendVisibleRecordRows(rows, S.parseResult.records, win, isSrec, TYPE_LABELS);
    appendRecordBottomSpacer(rows, recordCount, win);

    const tbody = document.createElement('tbody');
    tbody.append(...rows);
    table.appendChild(tbody);

    replaceRecordViewContent(el, table, win);
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
        dash.textContent = '—';
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

// ── External file-change helpers ──────────────────────────────────

/** Remove all external change banners to ensure only latest state is shown. */
function removeAllExternalChangeBanners(): void {
    document.getElementById('ext-conflict-banner')?.remove();
    document.getElementById('ext-reload-banner')?.remove();
    document.getElementById('ext-error-banner')?.remove();
}

/** Show a non-destructive conflict banner when external change arrives during edit mode. */
function showExternalChangeConflict(incoming: IncomingFile): void {
    // Remove any previous banner
    document.getElementById('ext-conflict-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'ext-conflict-banner';
    banner.className = 'ext-conflict-banner';
    banner.innerHTML =
        `<span class="ecb-icon">⚠</span>` +
        `<span class="ecb-msg">File changed externally. You have <strong>${S.edits.size}</strong> unsaved edit${S.edits.size === 1 ? '' : 's'}. Changes must be reloaded.</span>` +
        `<button class="ecb-btn ecb-reload"  id="ecb-reload">Reload &amp; discard my edits</button>`;

    document.getElementById('app')!.prepend(banner);

    document.getElementById('ecb-reload')!.addEventListener('click', () => {
        banner.remove();
        // Exit edit mode cleanly before reloading
        S.edits.clear();
        S.undoStack.length = 0;
        S.editMode = false;
        applyExternalChangeAndUnlock(incoming);
    });
}

/** Show a reload banner when external change arrives and there are no unsaved edits. */
function showExternalChangeReloadBanner(incoming: IncomingFile): void {
    // Remove any previous banner
    document.getElementById('ext-reload-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'ext-reload-banner';
    banner.className = 'ext-reload-banner';
    banner.innerHTML =
        `<span class="erb-icon">🔄</span>` +
        `<span class="erb-msg">File changed externally. Reloading...</span>` +
        `<button class="erb-btn erb-reload"  id="erb-reload">Reload</button>`;

    document.getElementById('app')!.prepend(banner);

    document.getElementById('erb-reload')!.addEventListener('click', () => {
        banner.remove();
        applyExternalChangeAndUnlock(incoming);
    });
}

/** Update UI lock state when external change occurs or is resolved. */
function updateLockState(): void {
    const app = document.getElementById('app');
    if (!app) { return; }
    
    if (S.lockedDueToExternalChange) {
        app.classList.add('locked-due-to-external-change');
        disableAllInteractiveElements();
    } else {
        app.classList.remove('locked-due-to-external-change');
        enableAllInteractiveElements();
    }
}

/** Disable all buttons, inputs, and clickable elements when locked. */
function disableAllInteractiveElements(): void {
    forEachLockableRoot(root => {
        const elements = root.querySelectorAll('button, input, [role="button"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            elem.setAttribute('data-was-enabled', 'true');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = true;
            }
        });
    });
}

/** Re-enable all interactive elements that were disabled by lock. */
function enableAllInteractiveElements(): void {
    forEachLockableRoot(root => {
        const elements = root.querySelectorAll('[data-was-enabled="true"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            elem.removeAttribute('data-was-enabled');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = false;
            }
        });
    });
}

function forEachLockableRoot(callback: (root: HTMLElement) => void): void {
    for (const id of ['main-area', 'toolbar']) {
        const root = document.getElementById(id);
        if (root) { callback(root); }
    }
}

/** Show an error banner when external change results in an invalid file. */
function showExternalChangeError(checksumErrors: number, malformedLines: number, errorCount: number, canQuickRepair: boolean): void {
    document.getElementById('ext-error-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'ext-error-banner';
    banner.className = 'ext-error-banner';

    banner.append(createExternalErrorIcon(), createExternalErrorMessage(checksumErrors, malformedLines));
    banner.append(createExternalErrorAction(canQuickRepair));
    document.getElementById('app')!.prepend(banner);
    wireExternalErrorActions();
}

function formatExternalErrorText(checksumErrors: number, malformedLines: number): string {
    if (checksumErrors > 0 && malformedLines > 0) {
        return `${formatCount(checksumErrors, 'checksum error')} and ${formatCount(malformedLines, 'malformed line')}`;
    }

    return checksumErrors > 0
        ? formatCount(checksumErrors, 'checksum error')
        : formatCount(malformedLines, 'malformed line');
}

function formatCount(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function createExternalErrorIcon(): HTMLSpanElement {
    const icon = document.createElement('span');
    icon.className = 'eeb-icon';
    icon.textContent = '\u274C';
    return icon;
}

function createExternalErrorMessage(checksumErrors: number, malformedLines: number): HTMLSpanElement {
    const msgSpan = document.createElement('span');
    msgSpan.className = 'eeb-msg';
    msgSpan.append('File changed externally and is now invalid: ');

    const strong = document.createElement('strong');
    strong.textContent = formatExternalErrorText(checksumErrors, malformedLines);
    msgSpan.append(strong);
    return msgSpan;
}

function createExternalErrorAction(canQuickRepair: boolean): HTMLButtonElement {
    return canQuickRepair
        ? createExternalErrorButton('eeb-repair', 'eeb-btn eeb-repair', 'Quick Repair & reload')
        : createExternalErrorButton('eeb-view-text', 'eeb-btn eeb-view-text', 'View in text editor');
}

function createExternalErrorButton(id: string, className: string, text: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.id = id;
    button.className = className;
    button.textContent = text;
    return button;
}

function wireExternalErrorActions(): void {
    const repairBtn = document.getElementById('eeb-repair');
    if (repairBtn) {
        repairBtn.addEventListener('click', () => {
            postProviderMessage({ type: 'repairAndReload' });
        });
    }

    const viewTextBtn = document.getElementById('eeb-view-text');
    if (viewTextBtn) {
        viewTextBtn.addEventListener('click', () => {
            postProviderMessage({ type: 'viewInNormalEditor' });
        });
    }
}

function getOriginalByte(addr: number): number | undefined {
    if (!S.parseResult) { return undefined; }
    for (const seg of S.parseResult.segments) {
        const off = addr - seg.startAddress;
        if (isSegmentOffset(off, seg.data.length)) { return seg.data[off]; }
    }
    return undefined;
}

function stageIntegrityEdits(edits: Array<[number, number]>): void {
    const previous: Array<[number, number]> = [];
    for (const [address, value] of edits) {
        const prior = stageIntegrityEdit(address, value);
        if (prior) { previous.push(prior); }
    }
    if (previous.length === 0) { return; }
    S.undoStack.push(previous);
    S.editMode = true;
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

function stageIntegrityEdit(address: number, value: number): [number, number] | null {
    const original = getOriginalByte(address);
    if (original === undefined) { return null; }
    const current = currentIntegrityByte(address, original);
    if (current === value) { return null; }
    if (value === original) { S.edits.delete(address); }
    else { S.edits.set(address, value); }
    return [address, current];
}

function currentIntegrityByte(address: number, original: number): number {
    return S.edits.has(address) ? S.edits.get(address)! : original;
}

// ── Edit helpers ──────────────────────────────────────────────────

function applyFill(fillVal: number): void {
    const prev = buildFillTransaction(fillVal);
    if (prev.length > 0) { S.undoStack.push(prev); }
    updateDirtyBar();
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
    renderStructPins();
    notifyIntegrityBytesChanged();
}

function currentSelectionRange(): { start: number; end: number } | null {
    if (S.selStart === null) { return null; }
    if (S.selEnd === null) { return null; }
    return { start: S.selStart, end: S.selEnd };
}

function buildFillTransaction(fillVal: number): Array<[number, number]> {
    const range = currentSelectionRange();
    if (!range) { return []; }
    const prev: Array<[number, number]> = [];
    for (let a = range.start; a <= range.end; a++) {
        const orig = getByte(a);
        if (orig === undefined) { continue; }
        prev.push([a, orig]);
        S.edits.set(a, fillVal);
    }
    return prev;
}

function undoLastEdit(): void {
    const txn = popUndoTransaction();
    if (!txn) { return; }
    for (const [addr, prevVal] of txn) {
        restoreEditedByte(addr, prevVal);
    }
    updateDirtyBar();
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
    renderStructPins();
    notifyIntegrityBytesChanged();
}

function popUndoTransaction(): Array<[number, number]> | null {
    if (!S.editMode) { return null; }
    if (S.undoStack.length === 0) { return null; }
    return S.undoStack.pop()!;
}

function restoreEditedByte(addr: number, prevVal: number): void {
    const orig = getOriginalByte(addr);
    if (orig !== undefined && prevVal === orig) {
        S.edits.delete(addr);
        return;
    }
    S.edits.set(addr, prevVal);
}

function updateDirtyBar(): void {
    const count     = S.edits.size;
    const dirtySpan = document.getElementById('edit-dirty-count');
    const saveBtn   = document.getElementById('btn-save') as HTMLButtonElement | null;
    if (!dirtySpan || !saveBtn) { return; }
    dirtySpan.textContent  = dirtyEditText(count);
    saveBtn.disabled       = count === 0;
}

function isSegmentOffset(offset: number, length: number): boolean {
    return offset >= 0 && offset < length;
}

function dirtyEditText(count: number): string {
    return count > 0 ? `${count} unsaved byte${count === 1 ? '' : 's'}` : '';
}

// ── Copy helpers ──────────────────────────────────────────────────
function getSelBytes(): number[] {
    const range = currentSelectionRange();
    if (!range) { return []; }
    const out: number[] = [];
    for (let a = range.start; a <= range.end; a++) {
        out.push(getByte(a) ?? 0);
    }
    return out;
}

function handleCopyCommand(cmd: string): void {
    const bytes = getSelBytes();
    if (bytes.length === 0 || !isCopyCommand(cmd)) { return; }

    const text = formatCopyCommand(cmd, bytes);
    postProviderMessage({ type: 'copyText', text, label: `${bytes.length} bytes as ${cmd}` });
}

// ── CRC helpers ──────────────────────────────────────────────────

// ── Context menu ──────────────────────────────────────────────────

function handleCtxCommand(cmd: string): void {
    const bytes = getSelBytes();
    if (bytes.length === 0) { return; }
    // Copy
    if (isCopyCommand(cmd)) {
        handleCopyCommand(cmd);
        return;
    }
    // Analyze
    if (handleAnalyzeCommand(cmd, bytes)) { return; }
    handlePossibleFillCommand(cmd);
}

function handlePossibleFillCommand(cmd: string): void {
    if (cmd.startsWith('fill-')) { handleFillCommand(cmd); }
}

function handleAnalyzeCommand(cmd: string, bytes: number[]): boolean {
    if (!isAnalyzeCommand(cmd)) { return false; }

    const { text, label } = formatAnalyzeCommand(cmd, bytes);
    postProviderMessage({ type: 'copyText', text, label });
    return true;
}

function handleFillCommand(cmd: string): void {
    if (!S.editMode) { return; }

    const val = parseInt(cmd.slice(5), 16);
    if (val >= 0 && val <= 0xFF) { applyFill(val); }
}

function setupCtxMenu(): void {
    document.addEventListener('click', hideCtx);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideCtx(); } });
}

const CTX_SEP = `<div class="ctx-sep"></div>`;

function ctxItem(cmd: string, label: string, hint = ''): string {
    return `<div class="ctx-row" data-cmd="${cmd}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        (hint ? `<span class="ctx-hint">${esc(hint)}</span>` : '') +
        `</div>`;
}

function ctxSubmenu(label: string, id: string, body: string): string {
    return `<div class="ctx-row ctx-has-sub" data-sub="${id}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<div class="ctx-submenu">${body}</div>` +
        `</div>`;
}

function ctxPreview(text: string): string {
    return text.length > 20 ? `${text.slice(0, 18)}\u2026` : text;
}

function buildFillMenu(len: number): string {
    const fillPresets: [number, string][] = [
        [0x00, 'Zero              (0x00)'],
        [0xFF, 'Erased flash      (0xFF)'],
    ];
    const customRow =
        `<div class="ctx-custom-row">` +
        `<span class="ctx-label">Custom</span>` +
        `<div class="ctx-custom-input-wrap">` +
        `<span class="ctx-custom-prefix">0x</span>` +
        `<input class="ctx-fill-input" type="text" maxlength="2" placeholder="FF" spellcheck="false">` +
        `<button class="ctx-fill-apply" title="Apply">&#10003;</button>` +
        `</div></div>`;

    return fillPresets.map(([v, lbl]) => ctxItem(`fill-${hexByte(v)}`, lbl, len > 1 ? `× ${len}` : '')).join('') +
        CTX_SEP +
        customRow;
}

function buildSingleByteCtxMenu(val: number, len: number): string {
    const hexV = `0x${hexByte(val)}`;
    const binV = val.toString(2).padStart(8, '0');
    const copyMenu =
        ctxItem('hex',    'Hex',     hexV) +
        ctxItem('dec',    'Decimal', `${val}`) +
        ctxItem('binary', 'Binary',  `${binV.slice(0, 4)} ${binV.slice(4)}`) +
        (formatAsciiByte(val) !== '.' ? ctxItem('ascii', 'ASCII', `'${String.fromCharCode(val)}'`) : '');

    return ctxSubmenu('Copy', 'copy', copyMenu) +
        (S.editMode ? CTX_SEP + ctxSubmenu('Patch', 'fill', buildFillMenu(len)) : '');
}

function buildMultiByteCopyMenu(bytes: number[]): string {
    return ctxItem('hex',       'Hex (spaces)',  ctxPreview(bytes.map(hexByte).join(' '))) +
        ctxItem('hex-raw',   'Hex (raw)',     ctxPreview(bytes.map(hexByte).join(''))) +
        ctxItem('binary',    'Binary',        ctxPreview(bytes.map(b => b.toString(2).padStart(8, '0')).join(' '))) +
        ctxItem('ascii',     'ASCII',         ctxPreview(bytes.map(formatAsciiByte).join(''))) +
        CTX_SEP +
        ctxItem('dec-array', 'Decimal Array', ctxPreview(`[${bytes.join(', ')}]`)) +
        ctxItem('hex-array', 'Hex Array',     ctxPreview(`[${bytes.map(formatHexArrayByte).join(', ')}]`)) +
        ctxItem('c-array',   'C Array',       ctxPreview(`{${bytes.map(formatHexArrayByte).join(', ')}}`)) +
        CTX_SEP +
        ctxItem('base64',    'Base64',        ctxPreview(btoa(String.fromCharCode(...bytes))));
}

function buildAnalyzeMenu(bytes: number[]): string {
    const sum = bytes.reduce((a, b) => a + b, 0);
    const xorVal = bytes.reduce((a, b) => a ^ b, 0);
    const sumWidth = Math.max(4, sum.toString(16).length + (sum.toString(16).length % 2));

    return ctxItem('an-sum',   'Sum',    `0x${hexValue(sum, sumWidth)}  (${sum})`) +
        ctxItem('an-xor',   'XOR',    `0x${hexValue(xorVal)}`) +
        CTX_SEP +
        ctxItem('an-crc8',  'CRC-8',  `0x${hexValue(crc8(bytes))}`) +
        ctxItem('an-crc16', 'CRC-16', `0x${hexValue(crc16(bytes), 4)}`) +
        ctxItem('an-crc32', 'CRC-32', `0x${hexValue(crc32(bytes), 8)}`);
}

function buildMultiByteCtxMenu(bytes: number[], len: number): string {
    return ctxSubmenu('Copy', 'copy', buildMultiByteCopyMenu(bytes)) +
        ctxSubmenu('Analyze', 'analyze', buildAnalyzeMenu(bytes)) +
        (S.editMode ? CTX_SEP + ctxSubmenu('Fill / Patch', 'fill', buildFillMenu(len)) : '');
}

function renderCtxMenuHtml(bytes: number[], len: number): string {
    const menuBody = len === 1 ? buildSingleByteCtxMenu(bytes[0], len) : buildMultiByteCtxMenu(bytes, len);

    return `<div class="ctx-hdr">${esc(`${len} byte${len === 1 ? '' : 's'} selected`)}</div>` +
        (S.editMode ? `<div class="ctx-edit-badge">✏ Editing</div>` : '') +
        CTX_SEP +
        menuBody;
}

function showCtxMenu(x: number, y: number): void {
    if (S.selStart === null || selLen() === 0) { return; }

    const el    = document.getElementById('ctx-menu')!;
    const len   = selLen();
    const bytes = getSelBytes();

    el.innerHTML = renderCtxMenuHtml(bytes, len);
    wireCtxCommands(el);
    wireCustomFill(el);
    wireSubmenus(el);
    positionCtxMenu(el, x, y);
}

function wireCtxCommands(el: HTMLElement): void {
    el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row =>
        row.addEventListener('click', ev => {
            ev.stopPropagation();
            handleCtxCommand(row.dataset.cmd!);
            hideCtx();
        })
    );
}

function wireCustomFill(el: HTMLElement): void {
    const fillInput = el.querySelector<HTMLInputElement>('.ctx-fill-input');
    const fillApply = el.querySelector<HTMLButtonElement>('.ctx-fill-apply');

    fillInput?.addEventListener('click', ev => ev.stopPropagation());
    fillInput?.addEventListener('mousedown', ev => ev.stopPropagation());
    fillInput?.addEventListener('focus', () => keepFillSubmenuOpen(fillInput));
    fillInput?.addEventListener('keydown', ev => handleFillInputKeydown(ev, fillInput));
    fillInput?.addEventListener('input', () => fillInput.classList.remove('ctx-fill-invalid'));
    fillApply?.addEventListener('click', ev => { ev.stopPropagation(); applyCustomFill(fillInput); });
    fillApply?.addEventListener('mousedown', ev => ev.stopPropagation());
}

function keepFillSubmenuOpen(fillInput: HTMLInputElement): void {
    const sub = fillInput.closest<HTMLElement>('.ctx-submenu');
    if (sub) { sub.style.display = 'block'; }
}

function handleFillInputKeydown(ev: KeyboardEvent, fillInput: HTMLInputElement): void {
    ev.stopPropagation();
    if (ev.key === 'Enter') { applyCustomFill(fillInput); }
    if (ev.key === 'Escape') { hideCtx(); }
}

function applyCustomFill(fillInput: HTMLInputElement | null): void {
    const raw = fillInput?.value.trim().replace(/^0x/i, '') ?? '';
    const val = parseInt(raw, 16);
    if (!isValidCustomFill(raw, val)) {
        fillInput?.classList.add('ctx-fill-invalid');
        fillInput?.focus();
        return;
    }
    fillInput?.classList.remove('ctx-fill-invalid');
    handleCtxCommand(`fill-${hexByte(val)}`);
    hideCtx();
}

function isValidCustomFill(raw: string, value: number): boolean {
    return raw !== '' && !isNaN(value) && value >= 0 && value <= 0xFF;
}

function positionCtxMenu(el: HTMLElement, x: number, y: number): void {
    positionContextMenu(el, x, y);
}

function wireSubmenus(menuEl: HTMLElement): void {
    wireHoverSubmenus(menuEl, true);
}

function hideCtx(): void {
    const el = document.getElementById('ctx-menu');
    if (el) { el.style.display = 'none'; }
}
