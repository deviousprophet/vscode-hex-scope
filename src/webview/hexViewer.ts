// ── HexScope Webview Entry Point ─────────────────────────────────
// Bootstraps the UI, handles VS Code messages, wires all modules.

import { S }                                          from './state';
import { vscode }                                     from './api';
import { esc, fmtB }                                  from './utils';
import { rerender }                                   from './render';
import { renderMemHeader, renderMemBody, applySel, scrollTo } from './memoryView';
import { renderInspector, renderBits, renderSegments, renderLabels, updateInspector, updateLabelFormSel } from './sidebar';
import { renderStructPins, onSelectionChangeForStruct, resetStructViewState } from './struct';
import { initSearch, runSearch, clearSearch, nextMatch, prevMatch } from './searchEngine';
import { initFlatBytes, buildMemRows, getByte }      from './data';
import type { SerializedRecord, SidebarTab } from './types';
import { MAX_VIRTUAL_SCROLL_HEIGHT }                 from './virtualScroll';
import {
    activateIntegrity,
    notifyIntegrityBytesChanged,
    notifyIntegrityEditsDiscarded,
    notifyIntegrityEndianChanged,
    renderIntegrity,
    setIntegrityEditHandler,
    setIntegrityProfiles,
} from './integrityView';

vscode.postMessage({ type: 'ready' });

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

type WebviewMessage = { type: string; [key: string]: unknown };
type WebviewMessageHandler = (msg: WebviewMessage) => void;

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
    const entry = MESSAGE_HANDLERS.find(([type]) => type === msg?.type);
    entry?.[1](msg);
});

function handleInitMessage(msg: WebviewMessage): void {
    S.parseResult = msg.parseResult as typeof S.parseResult;
    S.labels      = messageArray<typeof S.labels[number]>(msg.labels);
    S.structs     = messageArray<typeof S.structs[number]>(msg.structs);
    S.structPins  = messageArray<typeof S.structPins[number]>(msg.structPins);
    S.endian      = messageEndian(msg.endian);
    setIntegrityProfiles(msg.integrityProfiles);
    initFlatBytes();
    buildMemRows();

    S.currentView = 'memory';
    render();
}

function messageArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
}

function messageEndian(value: unknown): 'le' | 'be' {
    return value === 'be' ? 'be' : 'le';
}

function handleIntegrityProfilesMessage(msg: WebviewMessage): void {
    setIntegrityProfiles(msg.profiles, typeof msg.error === 'string' ? msg.error : '');
}

function handleLoadErrorMessage(msg: WebviewMessage): void {
    renderLoadError(String(msg.message ?? 'Failed to open file.'));
}

function handleAddLabelMessage(msg: WebviewMessage): void {
    S.labels = [...S.labels, msg.label as typeof S.labels[0]];
    rebuildLabelsAndMemory();
}

function handleUpdateLabelMessage(msg: WebviewMessage): void {
    const updated = msg.label as typeof S.labels[0];
    S.labels = S.labels.map(l => l.id === updated.id ? updated : l);
    rebuildLabelsAndMemory();
}

function handleCopyCommandMessage(msg: WebviewMessage): void {
    handleCopyCommand(msg.command as string);
}

function handleSavedEditsMessage(msg: WebviewMessage): void {
    S.parseResult = msg.parseResult as typeof S.parseResult;
    initFlatBytes();
    buildMemRows();
    clearEditState();
    document.getElementById('btn-edit-mode')!.style.display = '';
    document.getElementById('edit-mode-group')!.style.display = 'none';
    updateDirtyBar();
    renderStats();
    renderSegments();
    renderCurrentDataView();
}

function handleExternalChangeMessage(msg: WebviewMessage): void {
    const incoming = incomingFileFromMessage(msg);
    S.lockedDueToExternalChange = true;
    removeAllExternalChangeBanners();
    updateLockState();
    if (S.editMode && S.edits.size > 0) {
        showExternalChangeConflict(incoming);
    } else {
        showExternalChangeReloadBanner(incoming);
    }
}

function handleExternalChangeErrorMessage(msg: WebviewMessage): void {
    S.parseResult = msg.parseResult as typeof S.parseResult;
    S.labels      = (msg.labels as typeof S.labels) ?? [];
    initFlatBytes();
    buildMemRows();

    S.lockedDueToExternalChange = true;
    removeAllExternalChangeBanners();
    updateLockState();
    if (S.editMode && S.edits.size > 0) { clearEditState(); }

    showExternalChangeError(
        msg.checksumErrors as number,
        msg.malformedLines as number,
        msg.errorCount as number,
        msg.canQuickRepair as boolean,
    );
    renderSegments();
    renderCurrentDataView();
    notifyIntegrityBytesChanged();
}

function handleRepairCompleteMessage(msg: WebviewMessage): void {
    S.parseResult = msg.parseResult as typeof S.parseResult;
    initFlatBytes();
    buildMemRows();
    clearEditState();
    document.getElementById('ext-error-banner')?.remove();
    S.lockedDueToExternalChange = false;
    updateLockState();
    updateEditControls();
    updateDirtyBar();
    renderStats();
    renderSegments();
    renderCurrentDataView();
}

function rebuildLabelsAndMemory(): void {
    buildMemRows();
    rerender.labels();
    if (S.currentView === 'memory') { rerender.memory(); }
}

function clearEditState(reason: 'refresh' | 'discard' = 'refresh'): void {
    S.edits.clear();
    S.undoStack.length = 0;
    S.editMode = false;
    if (reason === 'discard') { notifyIntegrityEditsDiscarded(); }
    else { notifyIntegrityBytesChanged(); }
}

function renderCurrentDataView(): void {
    if (S.currentView === 'memory') { memRerender(); }
    else if (S.currentView === 'record') { renderRecordView(); }
}

function incomingFileFromMessage(msg: WebviewMessage): IncomingFile {
    return {
        parseResult: msg.parseResult as typeof S.parseResult,
        labels:      (msg.labels as typeof S.labels) ?? [],
    };
}

// ── Helper: apply external change and unlock ──────────────────────

function applyExternalChangeAndUnlock(incoming: IncomingFile): void {
    S.parseResult = incoming.parseResult;
    S.labels      = incoming.labels;
    initFlatBytes();
    buildMemRows();
    S.currentView = 'memory';
    S.lockedDueToExternalChange = false;
    updateLockState();
    render();
    vscode.postMessage({ type: 'reloadAccepted' });
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
    vscode.postMessage({ type: 'saveEndian', endian });
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
        vscode.postMessage({ type: 'saveEdits', edits: Array.from(S.edits.entries()) });
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

function handleGlobalKeydown(e: KeyboardEvent, inputEl: HTMLInputElement): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        inputEl.focus();
        inputEl.select();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && S.editMode) {
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

function updateDragSelection(e: MouseEvent, dragAnchor: number | null): number | null {
    if (dragAnchor === null || !(e.buttons & 1)) { return null; }
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-addr]');
    if (!el) { return dragAnchor; }
    const addr = parseInt(el.dataset.addr!, 16);
    if (isNaN(addr)) { return dragAnchor; }
    const newStart = Math.min(dragAnchor, addr);
    const newEnd   = Math.max(dragAnchor, addr);
    if (newStart === S.selStart && newEnd === S.selEnd) { return dragAnchor; }
    S.selStart = newStart;
    S.selEnd   = newEnd;
    applySel();
    updateInspector();
    updateLabelFormSel();
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
    const fmtLabel = p.format === 'srec' ? 'SREC' : 'IHEX';

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

// ── Memory view ───────────────────────────────────────────────────

function memRerender(): void {
    renderMemBody(onByteDown, onByteCtx);
}

function onByteDown(e: MouseEvent, el: HTMLElement): void {
    if (e.button !== 0) { return; }  // ignore right/middle-click
    const addr = parseInt(el.dataset.addr!, 16);
    if (isNaN(addr)) { return; }

    if (e.shiftKey && S.selStart !== null) {
        if (addr < S.selStart) {
            S.selEnd   = S.selStart;
            S.selStart = addr;
        } else {
            S.selEnd = addr;
        }
    } else {
        S.selStart = addr;
        S.selEnd   = addr;
    }

    applySel();
    updateInspector();
    updateLabelFormSel();
    onSelectionChangeForStruct();

}

function onByteCtx(e: MouseEvent, el: HTMLElement): void {
    const addr = parseInt(el.dataset.addr!, 16);
    if (!isNaN(addr)) {
        // Keep existing multi-byte selection if right-click is inside it;
        // otherwise collapse to the clicked byte.
        const inSel = S.selStart !== null && S.selEnd !== null
            && addr >= S.selStart && addr <= S.selEnd;
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
    if (!layout.isCompressed || layout.physicalScrollable <= 0 || layout.logicalScrollable <= 0) {
        return Math.max(0, Math.min(physicalScrollTop, layout.logicalScrollable));
    }
    const ratio = Math.max(0, Math.min(physicalScrollTop, layout.physicalScrollable)) / layout.physicalScrollable;
    return ratio * layout.logicalScrollable;
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
    const el = document.getElementById('record-view');
    if (!el || !S.parseResult) { return; }

    if (S.parseResult.records.length === 0) {
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

function renderRecordViewImpl(el: HTMLElement): void {
    if (!S.parseResult) { return; }

    const recordCount = S.parseResult.records.length;
    const containerHeight = el.clientHeight;
    const rowHeight = getRecordRowHeight(el);
    const layout = calcRecordScrollLayout(recordCount, containerHeight, rowHeight);
    const physicalScrollTop = el.scrollTop;
    const scrollTop = recordPhysicalToLogicalScroll(physicalScrollTop, layout);

    const firstVisibleIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - RECORD_BUFFER_ROWS);
    const lastVisibleIdx = Math.min(recordCount - 1, Math.ceil((scrollTop + containerHeight) / rowHeight) + RECORD_BUFFER_ROWS);
    const signature = `${recordCount}:${firstVisibleIdx}:${lastVisibleIdx}:${layout.isCompressed ? Math.floor(physicalScrollTop) : ''}`;
    if (signature === recordRenderSignature) { return; }
    recordRenderSignature = signature;

    const isSrec = S.parseResult.format === 'srec';
    const TYPE_LABELS = isSrec ? SREC_TYPE_LABELS : IHEX_TYPE_LABELS;
    const table = recordTableElement();
    const rows: HTMLTableRowElement[] = [];

    if (firstVisibleIdx > 0) {
        const topOffset = firstVisibleIdx * rowHeight;
        if (!layout.isCompressed) {
            appendRecordSpacerRows(rows, topOffset);
        }
    }

    for (let i = Math.max(0, firstVisibleIdx); i <= lastVisibleIdx && i < recordCount; i++) {
        rows.push(recordRow(S.parseResult.records[i], isSrec, TYPE_LABELS));
    }

    if (lastVisibleIdx < recordCount - 1) {
        const bottomOffset = (recordCount - 1 - lastVisibleIdx) * rowHeight;
        if (!layout.isCompressed) {
            appendRecordSpacerRows(rows, bottomOffset);
        }
    }

    const tbody = document.createElement('tbody');
    tbody.append(...rows);
    table.appendChild(tbody);

    if (layout.isCompressed) {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.height = `${layout.physicalHeight}px`;
        const topOffset = firstVisibleIdx * rowHeight;
        table.style.position = 'absolute';
        table.style.top = `${physicalScrollTop + topOffset - scrollTop}px`;
        table.style.left = '0';
        wrapper.appendChild(table);
        el.replaceChildren(wrapper);
    } else {
        el.replaceChildren(table);
    }
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

function switchView(v: 'memory' | 'record'): void {
    S.currentView = v;
    document.getElementById('record-view') ?.classList.toggle('visible', v === 'record');
    document.getElementById('memory-view') ?.classList.toggle('visible', v === 'memory');
    document.getElementById('btn-mem')     ?.classList.toggle('active',  v === 'memory');
    document.getElementById('btn-rec')     ?.classList.toggle('active',  v === 'record');
    document.getElementById('btn-edit-mode')!.style.display = v === 'memory' ? '' : 'none';
    document.getElementById('edit-mode-group')!.style.display = v === 'memory' && S.editMode ? '' : 'none';
    document.getElementById('sidebar')!.style.display = v === 'memory' ? '' : 'none';
    document.getElementById('side-tabs')!.style.display = v === 'memory' ? '' : 'none';
    document.getElementById('search-box')!.style.display = v === 'memory' ? '' : 'none';
    if (v === 'memory')      { memRerender(); }
    else if (v === 'record') { renderRecordView(); }
}

// ── External file-change helpers ──────────────────────────────────

type IncomingFile = {
    parseResult: typeof S.parseResult;
    labels: typeof S.labels;
};

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
    const mainArea = document.getElementById('main-area');
    const toolbar = document.getElementById('toolbar');
    
    if (mainArea) {
        const elements = mainArea.querySelectorAll('button, input, [role="button"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            elem.setAttribute('data-was-enabled', 'true');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = true;
            }
        });
    }
    
    if (toolbar) {
        const elements = toolbar.querySelectorAll('button, input, [role="button"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            elem.setAttribute('data-was-enabled', 'true');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = true;
            }
        });
    }
}

/** Re-enable all interactive elements that were disabled by lock. */
function enableAllInteractiveElements(): void {
    const mainArea = document.getElementById('main-area');
    const toolbar = document.getElementById('toolbar');
    
    if (mainArea) {
        const elements = mainArea.querySelectorAll('[data-was-enabled="true"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            elem.removeAttribute('data-was-enabled');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = false;
            }
        });
    }
    
    if (toolbar) {
        const elements = toolbar.querySelectorAll('[data-was-enabled="true"]');
        elements.forEach(el => {
            const elem = el as HTMLElement;
            elem.removeAttribute('data-was-enabled');
            if (elem instanceof HTMLButtonElement || elem instanceof HTMLInputElement) {
                elem.disabled = false;
            }
        });
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
            vscode.postMessage({ type: 'repairAndReload' });
        });
    }

    const viewTextBtn = document.getElementById('eeb-view-text');
    if (viewTextBtn) {
        viewTextBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'viewInNormalEditor' });
        });
    }
}

function getOriginalByte(addr: number): number | undefined {
    if (!S.parseResult) { return undefined; }
    for (const seg of S.parseResult.segments) {
        const off = addr - seg.startAddress;
        if (off >= 0 && off < seg.data.length) { return seg.data[off]; }
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
    dirtySpan.textContent  = count > 0 ? `${count} unsaved byte${count === 1 ? '' : 's'}` : '';
    saveBtn.disabled       = count === 0;
}

// ── Copy helpers ──────────────────────────────────────────────────
function getSelBytes(): number[] {
    if (S.selStart === null || S.selEnd === null) { return []; }
    const out: number[] = [];
    for (let a = S.selStart; a <= S.selEnd; a++) {
        out.push(getByte(a) ?? 0);
    }
    return out;
}

const COPY_COMMANDS = ['hex', 'hex-raw', 'binary', 'ascii', 'dec-array', 'hex-array', 'base64', 'dec', 'c-array'] as const;
type CopyCommand = typeof COPY_COMMANDS[number];
const COPY_COMMAND_SET = new Set<string>(COPY_COMMANDS);

const COPY_FORMATTERS: Record<CopyCommand, (bytes: number[]) => string> = {
    hex: bytes => bytes.map(hexByte).join(' '),
    'hex-raw': bytes => bytes.map(hexByte).join(''),
    binary: bytes => bytes.map(b => b.toString(2).padStart(8, '0')).join(' '),
    ascii: bytes => bytes.map(formatAsciiByte).join(''),
    'dec-array': bytes => `[${bytes.join(', ')}]`,
    'hex-array': bytes => `[${bytes.map(formatHexArrayByte).join(', ')}]`,
    base64: bytes => btoa(String.fromCharCode(...bytes)),
    dec: bytes => `${bytes[0]}`,
    'c-array': bytes => `{${bytes.map(formatHexArrayByte).join(', ')}}`,
};

function handleCopyCommand(cmd: string): void {
    const bytes = getSelBytes();
    if (bytes.length === 0 || !isCopyCommand(cmd)) { return; }

    const text = COPY_FORMATTERS[cmd](bytes);
    vscode.postMessage({ type: 'copyText', text, label: `${bytes.length} bytes as ${cmd}` });
}

function isCopyCommand(cmd: string): cmd is CopyCommand {
    return COPY_COMMAND_SET.has(cmd);
}

function hexByte(b: number): string {
    return b.toString(16).toUpperCase().padStart(2, '0');
}

function formatHexArrayByte(b: number): string {
    return `0x${hexByte(b)}`;
}

function formatAsciiByte(b: number): string {
    return (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
}

// ── CRC helpers ──────────────────────────────────────────────────

function crc8(data: number[]): number {
    let c = 0;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF; }
    }
    return c;
}

function crc16(data: number[]): number {
    let c = 0;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 1 ? ((c >>> 1) ^ 0xA001) : c >>> 1; }
    }
    return c & 0xFFFF;
}

function crc32(data: number[]): number {
    let c = 0xFFFFFFFF;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 1 ? ((c >>> 1) ^ 0xEDB88320) : c >>> 1; }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

type AnalyzeResult = { text: string; label: string };
type AnalyzeFormatter = (bytes: number[]) => AnalyzeResult;
const ANALYZE_COMMANDS = ['an-sum', 'an-xor', 'an-crc8', 'an-crc16', 'an-crc32'] as const;
type AnalyzeCommand = typeof ANALYZE_COMMANDS[number];
const ANALYZE_COMMAND_SET = new Set<string>(ANALYZE_COMMANDS);

const ANALYZE_FORMATTERS: Record<AnalyzeCommand, AnalyzeFormatter> = {
    'an-sum': formatAnalyzeSum,
    'an-xor': formatAnalyzeXor,
    'an-crc8': bytes => ({ text: `0x${hexValue(crc8(bytes))}`, label: 'CRC-8' }),
    'an-crc16': bytes => ({ text: `0x${hexValue(crc16(bytes), 4)}`, label: 'CRC-16' }),
    'an-crc32': bytes => ({ text: `0x${hexValue(crc32(bytes), 8)}`, label: 'CRC-32' }),
};

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
    // Fill / Patch — edit bytes in place (edit mode) or noop
    if (cmd.startsWith('fill-')) {
        handleFillCommand(cmd);
    }
}

function handleAnalyzeCommand(cmd: string, bytes: number[]): boolean {
    if (!isAnalyzeCommand(cmd)) { return false; }

    const { text, label } = ANALYZE_FORMATTERS[cmd](bytes);
    vscode.postMessage({ type: 'copyText', text, label });
    return true;
}

function isAnalyzeCommand(cmd: string): cmd is AnalyzeCommand {
    return ANALYZE_COMMAND_SET.has(cmd);
}

function formatAnalyzeSum(bytes: number[]): AnalyzeResult {
    const sum = bytes.reduce((a, b) => a + b, 0);
    const width = Math.max(4, sum.toString(16).length + (sum.toString(16).length % 2));
    return { text: `0x${hexValue(sum, width)} (${sum})`, label: 'sum' };
}

function formatAnalyzeXor(bytes: number[]): AnalyzeResult {
    const xor = bytes.reduce((a, b) => a ^ b, 0);
    return { text: `0x${hexValue(xor)}`, label: 'XOR' };
}

function handleFillCommand(cmd: string): void {
    if (!S.editMode) { return; }

    const val = parseInt(cmd.slice(5), 16);
    if (val >= 0 && val <= 0xFF) { applyFill(val); }
}

function hexValue(value: number, width = 2): string {
    return value.toString(16).toUpperCase().padStart(width, '0');
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
    if (isNaN(val) || val < 0 || val > 0xFF || raw === '') {
        fillInput?.classList.add('ctx-fill-invalid');
        fillInput?.focus();
        return;
    }
    fillInput?.classList.remove('ctx-fill-invalid');
    handleCtxCommand(`fill-${hexByte(val)}`);
    hideCtx();
}

function positionCtxMenu(el: HTMLElement, x: number, y: number): void {
    el.style.display = 'block';
    const mw = el.offsetWidth || 220;
    const mh = el.offsetHeight || 120;
    el.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
    el.style.top = `${Math.min(y, window.innerHeight - mh - 8)}px`;
}

function wireSubmenus(menuEl: HTMLElement): void {
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSub: HTMLElement | null = null;

    const openSub = (sub: HTMLElement, row: HTMLElement) => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (activeSub && activeSub !== sub) { activeSub.style.display = 'none'; }
        activeSub = sub;
        sub.style.display = 'block';
        // Viewport edge: flip left if no room on right
        const rr = row.getBoundingClientRect();
        const sw = sub.offsetWidth || 220;
        if (rr.right + sw > window.innerWidth - 8) {
            sub.style.left = 'auto'; sub.style.right = '100%';
        } else {
            sub.style.left = '100%'; sub.style.right = 'auto';
        }
    };
    const scheduledClose = (sub: HTMLElement) => {
        closeTimer = setTimeout(() => {
            // Don't close if the custom fill input inside this submenu has focus
            if (sub.contains(document.activeElement)) { return; }
            sub.style.display = 'none';
            if (activeSub === sub) { activeSub = null; }
        }, 100);
    };

    menuEl.querySelectorAll<HTMLElement>('.ctx-has-sub').forEach(row => {
        const sub = row.querySelector<HTMLElement>('.ctx-submenu');
        if (!sub) { return; }
        row.addEventListener('mouseenter', () => openSub(sub, row));
        row.addEventListener('mouseleave', e => {
            if (!sub.contains(e.relatedTarget as Node)) { scheduledClose(sub); }
        });
        sub.addEventListener('mouseenter', () => {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        });
        sub.addEventListener('mouseleave', e => {
            if (!row.contains(e.relatedTarget as Node)) { scheduledClose(sub); }
        });
    });
}

function hideCtx(): void {
    const el = document.getElementById('ctx-menu');
    if (el) { el.style.display = 'none'; }
}
