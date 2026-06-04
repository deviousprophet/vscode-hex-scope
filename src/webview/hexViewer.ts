// ── HexScope Webview Entry Point ─────────────────────────────────
// Bootstraps the UI, handles VS Code messages, wires all modules.

import { S }                                          from './state';
import { vscode }                                     from './api';
import { esc, fmtB }                                  from './utils';
import { rerender }                                   from './render';
import { renderMemHeader, renderMemBody, applySel, scrollTo } from './memoryView';
import { renderInspector, renderBits, renderLabels, updateInspector, updateLabelFormSel } from './sidebar';
import { renderStructPins, onSelectionChangeForStruct, resetStructViewState } from './struct';
import { initSearch, runSearch, clearSearch, nextMatch, prevMatch } from './searchEngine';
import { initFlatBytes, buildMemRows, getByte }      from './data';

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

window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { type: string; [key: string]: unknown };
    switch (msg.type) {
        case 'init': {
            S.parseResult = msg.parseResult as typeof S.parseResult;
            S.labels      = (msg.labels as typeof S.labels) ?? [];
            S.structs     = (msg.structs as typeof S.structs) ?? [];
            S.structPins  = (msg.structPins as typeof S.structPins) ?? [];
            initFlatBytes();
            buildMemRows();
            
            S.currentView = 'memory';
            render();
            break;
        }
        case 'loadError':
            renderLoadError(String(msg.message ?? 'Failed to open file.'));
            break;
        case 'addLabel':
            S.labels = [...S.labels, msg.label as typeof S.labels[0]];
            buildMemRows();
            rerender.labels();
            if (S.currentView === 'memory') { rerender.memory(); }
            break;
        case 'updateLabel': {
            const updated = msg.label as typeof S.labels[0];
            S.labels = S.labels.map(l => l.id === updated.id ? updated : l);
            buildMemRows();
            rerender.labels();
            if (S.currentView === 'memory') { rerender.memory(); }
            break;
        }
        case 'copyCommand':
            handleCopyCommand(msg.command as string);
            break;
        case 'savedEdits':
            // Extension confirmed the file was written — clear edits and exit edit mode
            S.parseResult = msg.parseResult as typeof S.parseResult;
            initFlatBytes();
            buildMemRows();
            S.edits.clear();
            S.undoStack.length = 0;
            S.editMode = false;
            document.getElementById('btn-edit-mode')!.style.display = '';
            document.getElementById('edit-mode-group')!.style.display = 'none';
            updateDirtyBar();
            renderStats();
            if (S.currentView === 'memory') { memRerender(); }
            else if (S.currentView === 'record') { renderRecordView(); }
            break;
        case 'externalChange': {
            // File changed externally while the webview is open.
            // Lock the view and show conflict decision banner.
            const incoming = {
                parseResult: msg.parseResult as typeof S.parseResult,
                labels:      (msg.labels as typeof S.labels) ?? [],
            };
            S.lockedDueToExternalChange = true;
            removeAllExternalChangeBanners();
            updateLockState();
            if (S.editMode && S.edits.size > 0) {
                showExternalChangeConflict(incoming);
            } else {
                showExternalChangeReloadBanner(incoming);
            }
            break;
        }
        case 'externalChangeError': {
            // File changed externally and became invalid (checksum/malformed errors)
            // Update state with the new (invalid) data and show error banner
            const checksumErrors = msg.checksumErrors as number;
            const malformedLines = msg.malformedLines as number;
            const errorCount = msg.errorCount as number;
            const canQuickRepair = msg.canQuickRepair as boolean;
            
            // Update with the new external data (even though it has errors)
            S.parseResult = msg.parseResult as typeof S.parseResult;
            S.labels      = (msg.labels as typeof S.labels) ?? [];
            initFlatBytes();
            buildMemRows();
            
            S.lockedDueToExternalChange = true;
            removeAllExternalChangeBanners();
            updateLockState();
            
            // Discard any unsaved edits (can't merge with invalid content)
            if (S.editMode && S.edits.size > 0) {
                S.edits.clear();
                S.undoStack.length = 0;
                S.editMode = false;
            }
            
            // Show error banner with action buttons
            showExternalChangeError(checksumErrors, malformedLines, errorCount, canQuickRepair);
            
            // Rerender current view to show the new (invalid) data
            if (S.currentView === 'memory') { memRerender(); }
            else if (S.currentView === 'record') { renderRecordView(); }
            break;
        }
        case 'repairComplete': {
            // Checksums were repaired and file reloaded successfully
            S.parseResult = msg.parseResult as typeof S.parseResult;
            initFlatBytes();
            buildMemRows();
            // Clear edit mode and edits
            S.edits.clear();
            S.undoStack.length = 0;
            S.editMode = false;
            // Remove the error banner and unlock
            document.getElementById('ext-error-banner')?.remove();
            S.lockedDueToExternalChange = false;
            updateLockState();
            updateEditControls();
            updateDirtyBar();
            renderStats();
            if (S.currentView === 'memory') { rerender.memory(); }
            else if (S.currentView === 'record') { renderRecordView(); }
            break;
        }
    }
});

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
                <button id="btn-mem" class="${S.currentView === 'memory' ? 'active' : ''}">Memory</button>
                <button id="btn-rec" class="${S.currentView === 'record' ? 'active' : ''}">Records</button>
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
                <div id="search-endian-toggle" class="endian-tabs search-endian-toggle" style="display:none">
                    <button id="search-btn-auto" class="${S.searchEndianness === 'auto' ? 'active' : ''}" type="button">Auto</button>
                    <button id="search-btn-le" class="${S.searchEndianness === 'le' ? 'active' : ''}" type="button">LE</button>
                    <button id="search-btn-be" class="${S.searchEndianness === 'be' ? 'active' : ''}" type="button">BE</button>
                </div>
                <select id="search-mode">
                    <option value="bytes" ${S.searchMode === 'bytes' ? 'selected' : ''}>Bytes</option>
                    <option value="value" ${S.searchMode === 'value' ? 'selected' : ''}>Value</option>
                    <option value="ascii" ${S.searchMode === 'ascii' ? 'selected' : ''}>ASCII</option>
                    <option value="addr"  ${S.searchMode === 'addr'  ? 'selected' : ''}>Addr</option>
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
                <div id="memory-view" class="${S.currentView === 'memory' ? 'visible' : ''}">
                    <div id="mem-header"></div>
                    <div id="mem-scroll"><div id="mem-rows"></div></div>
                </div>
                <div id="record-view" class="${S.currentView === 'record' ? 'visible' : ''}"></div>
            </div>
            <div id="sidebar-resizer" aria-label="Resize sidebar" title="Drag to resize sidebar"></div>
            <div id="sidebar">
                <div class="sb-tab-panel ${S.sidebarTab === 'inspector' ? 'active' : ''}" id="sbp-insp">
                    <div class="sb-section" id="s-insp"></div>
                    <div class="sb-section" id="s-bits"></div>
                    <div class="sb-section" id="s-labels"></div>
                </div>
                <div class="sb-tab-panel ${S.sidebarTab === 'struct' ? 'active' : ''}" id="sbp-struct">
                    <div id="s-struct-pins"></div>
                </div>
            </div>
            <div id="side-tabs">
                <button class="stab${S.sidebarTab === 'inspector' ? ' active' : ''}" id="stab-insp">Inspector</button>
                <button class="stab${S.sidebarTab === 'struct'    ? ' active' : ''}" id="stab-struct">Struct Overlay</button>
            </div>
        </div>
        <div id="ctx-menu" style="display:none"></div>`;

    // Toolbar buttons
    document.getElementById('btn-mem')!.addEventListener('click', () => switchView('memory'));
    document.getElementById('btn-rec')!.addEventListener('click', () => switchView('record'));
    updateEditControls();

    // Setup persistent lock interception listeners (check flag on each click)
    const mainArea = document.getElementById('main-area');
    const toolbar = document.getElementById('toolbar');
    if (mainArea) {
        mainArea.addEventListener('click', preventClickWhenLocked, { capture: true });
    }
    if (toolbar) {
        toolbar.addEventListener('click', preventClickWhenLocked, { capture: true });
    }

    // Sidebar resize state: current CSS variable is the startup default fallback.
    const root = document.documentElement;
    const cssDefaultWidth = parseSidebarWidth(getComputedStyle(root).getPropertyValue('--sidebar-w')) ?? 360;
    const savedWidth = parseSidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    let sidebarWidth = savedWidth ?? cssDefaultWidth;
    root.style.setProperty('--sidebar-w', `${sidebarWidth}px`);

    const sidebarResizer = document.getElementById('sidebar-resizer');
    if (sidebarResizer) {
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

    // Edit mode toggle
    document.getElementById('btn-edit-mode')!.addEventListener('click', () => {
        S.editMode = true;
        updateEditControls();
        updateDirtyBar();
        if (S.currentView === 'memory') { memRerender(); }
    });

    // Cancel: discard edits
    document.getElementById('btn-cancel')!.addEventListener('click', () => {
        S.edits.clear();
        S.undoStack.length = 0;
        S.editMode = false;
        updateEditControls();
        updateDirtyBar();
        if (S.currentView === 'memory') { memRerender(); }
        updateInspector();
    });

    // Save button
    document.getElementById('btn-save')!.addEventListener('click', () => {
        if (S.edits.size === 0) { return; }
        vscode.postMessage({ type: 'saveEdits', edits: Array.from(S.edits.entries()) });
    });

    // Search
    const modeEl  = document.getElementById('search-mode')  as HTMLSelectElement;
    const inputEl = document.getElementById('search-input') as HTMLInputElement;
    const endianToggleEl = document.getElementById('search-endian-toggle') as HTMLDivElement;
    const searchBtnAuto = document.getElementById('search-btn-auto') as HTMLButtonElement;
    const searchBtnLE = document.getElementById('search-btn-le') as HTMLButtonElement;
    const searchBtnBE = document.getElementById('search-btn-be') as HTMLButtonElement;

    const applySearchModeUi = (): void => {
        endianToggleEl.style.display = S.searchMode === 'value' ? 'inline-flex' : 'none';
        if (S.searchMode === 'bytes') {
            inputEl.placeholder = 'Bytes (e.g. DE AD BE EF)';
        } else if (S.searchMode === 'value') {
            inputEl.placeholder = 'Value (e.g. 0x12345678 or 305419896)';
        } else if (S.searchMode === 'ascii') {
            inputEl.placeholder = 'ASCII text';
        } else {
            inputEl.placeholder = 'Address (e.g. 0800 or 0x08001234)';
        }
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

    const applyEndianUi = (): void => {
        searchBtnAuto.classList.toggle('active', S.searchEndianness === 'auto');
        searchBtnLE.classList.toggle('active', S.searchEndianness === 'le');
        searchBtnBE.classList.toggle('active', S.searchEndianness === 'be');
    };
    applySearchModeUi();
    applyEndianUi();

    searchBtnAuto.addEventListener('click', () => {
        S.searchEndianness = 'auto';
        applyEndianUi();
    });

    searchBtnLE.addEventListener('click', () => {
        S.searchEndianness = 'le';
        applyEndianUi();
    });

    searchBtnBE.addEventListener('click', () => {
        S.searchEndianness = 'be';
        applyEndianUi();
    });

    // Ctrl+F / Cmd+F focuses the search bar; Ctrl+Z undoes last edit
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            inputEl.focus();
            inputEl.select();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && S.editMode) {
            e.preventDefault();
            undoLastEdit();
        }
    });

    // Wire rerender callbacks
    rerender.memory   = () => memRerender();
    rerender.labels   = () => renderLabels();
    rerender.toMemory = () => switchView('memory');
    rerender.jumpTo   = (addr: number) => { switchView('memory'); scrollTo(addr); };

    // Wire search module
    initSearch(() => switchView('memory'));

    // Drag-to-select
    let dragAnchor: number | null = null;
    document.getElementById('mem-rows')!.addEventListener('mousedown', e => {
        if (e.button !== 0) { return; }  // ignore right/middle-click
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-addr]');
        if (el) {
            dragAnchor = parseInt(el.dataset.addr!, 16);
            e.preventDefault(); // prevent browser text selection while dragging
        }
    });
    document.addEventListener('mousemove', e => {
        if (dragAnchor === null || !(e.buttons & 1)) { dragAnchor = null; return; }
        const el = document.elementFromPoint(e.clientX, e.clientY)
            ?.closest<HTMLElement>('[data-addr]');
        if (!el) { return; }
        const addr = parseInt(el.dataset.addr!, 16);
        if (isNaN(addr)) { return; }
        const newStart = Math.min(dragAnchor, addr);
        const newEnd   = Math.max(dragAnchor, addr);
        if (newStart === S.selStart && newEnd === S.selEnd) { return; }
        S.selStart = newStart;
        S.selEnd   = newEnd;
        applySel();
        updateInspector();
        updateLabelFormSel();
    });
    document.addEventListener('mouseup', () => { dragAnchor = null; });

    // Side tabs
    function applySidebarState(): void {
        document.getElementById('sbp-insp')!.classList.toggle('active', S.sidebarTab === 'inspector');
        document.getElementById('sbp-struct')!.classList.toggle('active', S.sidebarTab === 'struct');
        document.getElementById('stab-insp')!.classList.toggle('active', S.sidebarTab === 'inspector');
        document.getElementById('stab-struct')!.classList.toggle('active', S.sidebarTab === 'struct');
    }
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

    // Initial renders
    renderStats();
    renderMemHeader();
    renderInspector();
    renderBits();
    renderStructPins();
    renderLabels();
    setupCtxMenu();

    if (S.currentView === 'memory') { memRerender(); }
    else if (S.currentView === 'record') { renderRecordView(); }
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

const RECORD_ROW_HEIGHT = 28;
const RECORD_BUFFER_ROWS = 5;
const RECORD_MAX_SPACER_PX = 1_000_000;
let recordRenderSignature = '';

function renderRecordView(): void {
    const el = document.getElementById('record-view');
    if (!el || !S.parseResult) { return; }

    if (S.parseResult.records.length === 0) {
        el.innerHTML = `<div class="raw-problems" style="margin:10px"><div class="raw-problems-hdr"><span class="raw-problems-title">Record View Unavailable</span></div><div style="padding:10px 12px">Record details are not loaded in the webview. Use Memory view for navigation and editing.</div></div>`;
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
    const scrollTop = el.scrollTop;

    const firstVisibleIdx = Math.max(0, Math.floor(scrollTop / RECORD_ROW_HEIGHT) - RECORD_BUFFER_ROWS);
    const lastVisibleIdx = Math.min(recordCount - 1, Math.ceil((scrollTop + containerHeight) / RECORD_ROW_HEIGHT) + RECORD_BUFFER_ROWS);
    const signature = `${recordCount}:${firstVisibleIdx}:${lastVisibleIdx}`;
    if (signature === recordRenderSignature) { return; }
    recordRenderSignature = signature;

    const isSrec = S.parseResult.format === 'srec';
    const TYPE_LABELS = isSrec ? SREC_TYPE_LABELS : IHEX_TYPE_LABELS;

    const header = `<tr><th>Addr</th><th>Type</th><th>Cnt</th><th>Data</th><th>CHK</th></tr>`;

    const rows: string[] = [];

    if (firstVisibleIdx > 0) {
        const topOffset = firstVisibleIdx * RECORD_ROW_HEIGHT;
        appendRecordSpacerRows(rows, topOffset);
    }

    for (let i = Math.max(0, firstVisibleIdx); i <= lastVisibleIdx && i < recordCount; i++) {
        const r = S.parseResult.records[i];
        const isData = !r.error && (isSrec ? (r.recordType === 1 || r.recordType === 2 || r.recordType === 3)
                                           : r.recordType === 0);
        const badge =
            (!isSrec && (r.recordType === 4 || r.recordType === 2)) ? 'rb-ext'   :
            (!isSrec && (r.recordType === 5 || r.recordType === 3)) ? 'rb-start' :
            (!isSrec && r.recordType === 1)                         ? 'rb-eof'   :
            (isSrec  && (r.recordType === 7 || r.recordType === 8 || r.recordType === 9)) ? 'rb-eof' :
            (isSrec  && r.recordType === 0)                         ? 'rb-ext'   :
            r.error                                                 ? 'rb-bad'   : 'rb-data';
        const lbl = TYPE_LABELS[r.recordType] ?? (isSrec ? `S${r.recordType}` : `TYPE ${r.recordType}`);
        const ra   = r.resolvedAddress.toString(16).toUpperCase().padStart(8, '0');
        const data = r.data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        const dataCell = r.error
            ? `<td class="rdata rerr-msg">${esc(r.error)}</td>`
            : `<td class="rdata">${data || '—'}</td>`;
        const chk  = r.error
            ? `<span class="rerr-dash">—</span>`
            : r.checksumValid
                ? `<span class="cok">${r.checksum.toString(16).toUpperCase().padStart(2, '0')}</span>`
                : `<span class="cerr">${r.checksum.toString(16).toUpperCase().padStart(2, '0')}</span><span class="cerr-tag">checksum error</span>`;
        const rowClass = (r.error || !r.checksumValid) ? ' class="rerr"' : '';
        const addrCell = isData
            ? `<td class="raddr">${ra}</td>`
            : `<td class="raddr raddr-empty">—</td>`;

        rows.push(`<tr${rowClass}>
            ${addrCell}
            <td><span class="rbadge ${badge}">${esc(lbl)}</span></td>
            <td class="rcnt">${r.byteCount}</td>
            ${dataCell}
            <td>${chk}</td>
        </tr>`);
    }

    if (lastVisibleIdx < recordCount - 1) {
        const bottomOffset = (recordCount - 1 - lastVisibleIdx) * RECORD_ROW_HEIGHT;
        appendRecordSpacerRows(rows, bottomOffset);
    }

    el.innerHTML = `<table class="rtbl"><thead>${header}</thead><tbody>${rows.join('')}</tbody></table>`;
}

function appendRecordSpacerRows(rows: string[], totalHeight: number): void {
    let remaining = totalHeight;
    while (remaining > 0) {
        const chunk = Math.min(remaining, RECORD_MAX_SPACER_PX);
        rows.push(`<tr style="height:${chunk}px"><td colspan="5"></td></tr>`);
        remaining -= chunk;
    }
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
    // Remove any previous banner
    document.getElementById('ext-error-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'ext-error-banner';
    banner.className = 'ext-error-banner';
    
    let errorMsg = '';
    if (checksumErrors > 0 && malformedLines > 0) {
        errorMsg = `${checksumErrors} checksum error${checksumErrors === 1 ? '' : 's'} and ${malformedLines} malformed line${malformedLines === 1 ? '' : 's'}`;
    } else if (checksumErrors > 0) {
        errorMsg = `${checksumErrors} checksum error${checksumErrors === 1 ? '' : 's'}`;
    } else {
        errorMsg = `${malformedLines} malformed line${malformedLines === 1 ? '' : 's'}`;
    }
    
    let buttonHtml = '';
    if (canQuickRepair) {
        // Only checksum errors — offer quick repair option only
        buttonHtml =
            `<button class="eeb-btn eeb-repair"  id="eeb-repair">Quick Repair &amp; reload</button>`;
    } else {
        // Malformed lines present — can't auto-repair, just offer to switch to text editor
        buttonHtml =
            `<button class="eeb-btn eeb-view-text" id="eeb-view-text">View in text editor</button>`;
    }
    
    banner.innerHTML =
        `<span class="eeb-icon">❌</span>` +
        `<span class="eeb-msg">File changed externally and is now invalid: <strong>${errorMsg}</strong></span>` +
        buttonHtml;

    document.getElementById('app')!.prepend(banner);

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

// ── Edit helpers ──────────────────────────────────────────────────

function applyFill(fillVal: number): void {
    if (S.selStart === null || S.selEnd === null) { return; }
    const prev: Array<[number, number]> = [];
    for (let a = S.selStart; a <= S.selEnd; a++) {
        const orig = getByte(a);
        if (orig !== undefined) {
            prev.push([a, orig]);
            S.edits.set(a, fillVal);
        }
    }
    if (prev.length > 0) { S.undoStack.push(prev); }
    updateDirtyBar();
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
}

function undoLastEdit(): void {
    if (!S.editMode || S.undoStack.length === 0) { return; }
    const txn = S.undoStack.pop()!;
    for (const [addr, prevVal] of txn) {
        const orig = getOriginalByte(addr);
        if (orig !== undefined && prevVal === orig) {
            S.edits.delete(addr);
        } else {
            S.edits.set(addr, prevVal);
        }
    }
    updateDirtyBar();
    if (S.currentView === 'memory') { memRerender(); }
    updateInspector();
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

function handleCopyCommand(cmd: string): void {
    const bytes = getSelBytes();
    if (bytes.length === 0) { return; }
    const h = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
    let text = '';
    switch (cmd) {
        case 'hex':       text = bytes.map(h).join(' ');                                          break;
        case 'hex-raw':   text = bytes.map(h).join('');                                           break;
        case 'binary':    text = bytes.map(b => b.toString(2).padStart(8, '0')).join(' ');        break;
        case 'ascii':     text = bytes.map(b => (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.').join(''); break;
        case 'dec-array': text = `[${bytes.join(', ')}]`;                                         break;
        case 'hex-array': text = `[${bytes.map(b => '0x' + h(b)).join(', ')}]`;                   break;
        case 'base64':    text = btoa(String.fromCharCode(...bytes));                              break;
        case 'dec':       text = `${bytes[0]}`;                                                    break;
        case 'c-array':   text = `{${bytes.map(b => '0x' + h(b)).join(', ')}}`;                   break;
        default: return;
    }
    vscode.postMessage({ type: 'copyText', text, label: `${bytes.length} bytes as ${cmd}` });
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

// ── Context menu ──────────────────────────────────────────────────

function handleCtxCommand(cmd: string): void {
    const bytes = getSelBytes();
    if (bytes.length === 0) { return; }
    const h = (v: number, w = 2) => v.toString(16).toUpperCase().padStart(w, '0');

    // Copy
    if (['hex','hex-raw','binary','ascii','dec','dec-array','hex-array','c-array','base64'].includes(cmd)) {
        handleCopyCommand(cmd); return;
    }
    // Analyze
    if (cmd.startsWith('an-')) {
        let text = '', label = '';
        switch (cmd) {
            case 'an-sum': {
                const s = bytes.reduce((a, b) => a + b, 0);
                const w = Math.max(4, s.toString(16).length + (s.toString(16).length % 2));
                text = `0x${h(s, w)} (${s})`; label = 'sum'; break;
            }
            case 'an-xor': { const x = bytes.reduce((a, b) => a ^ b, 0); text = `0x${h(x)}`; label = 'XOR'; break; }
            case 'an-crc8':  text = `0x${h(crc8(bytes))}`; label = 'CRC-8';  break;
            case 'an-crc16': text = `0x${h(crc16(bytes), 4)}`; label = 'CRC-16'; break;
            case 'an-crc32': text = `0x${h(crc32(bytes), 8)}`; label = 'CRC-32'; break;
        }
        if (text) { vscode.postMessage({ type: 'copyText', text, label }); }
        return;
    }
    // Fill / Patch — edit bytes in place (edit mode) or noop
    if (cmd.startsWith('fill-')) {
        if (!S.editMode) { return; }
        const val = parseInt(cmd.slice(5), 16);
        if (!isNaN(val) && val >= 0 && val <= 0xFF) { applyFill(val); }
        return;
    }
}

function setupCtxMenu(): void {
    document.addEventListener('click', hideCtx);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideCtx(); } });
}

function showCtxMenu(x: number, y: number): void {
    if (S.selStart === null || selLen() === 0) { return; }

    const el    = document.getElementById('ctx-menu')!;
    const len   = selLen();
    const bytes = getSelBytes();
    const h     = (v: number, w = 2) => v.toString(16).toUpperCase().padStart(w, '0');

    // Pre-compute analyze values
    const sum    = bytes.reduce((a, b) => a + b, 0);
    const xorVal = bytes.reduce((a, b) => a ^ b, 0);
    const sumW   = Math.max(4, sum.toString(16).length + (sum.toString(16).length % 2));

    // Truncated preview string for copy hints
    const preview = (s: string) => s.length > 20 ? `${s.slice(0, 18)}…` : s;

    // Build helpers
    const item = (cmd: string, label: string, hint = '') =>
        `<div class="ctx-row" data-cmd="${cmd}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        (hint ? `<span class="ctx-hint">${esc(hint)}</span>` : '') +
        `</div>`;
    const sep = `<div class="ctx-sep"></div>`;
    const sub = (label: string, id: string, body: string) =>
        `<div class="ctx-row ctx-has-sub" data-sub="${id}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<div class="ctx-submenu">${body}</div>` +
        `</div>`;

    let menuBody = '';

    // Shared fill presets + custom input row (used for both single and multi)
    const fillLabel = len === 1 ? 'Patch' : 'Fill / Patch';
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
        `<button class="ctx-fill-apply" title="Apply">✓</button>` +
        `</div></div>`;
    const fillMenu =
        fillPresets.map(([v, lbl]) => item(`fill-${h(v)}`, lbl, len > 1 ? `× ${len}` : '')).join('') +
        sep +
        customRow;

    if (len === 1) {
        // ── Single byte: Copy submenu + Patch submenu ──
        const val  = bytes[0];
        const hexV = `0x${h(val)}`;
        const binV = val.toString(2).padStart(8, '0');
        const p    = val >= 0x20 && val < 0x7F;
        const copyMenu =
            item('hex',    'Hex',     hexV) +
            item('dec',    'Decimal', `${val}`) +
            item('binary', 'Binary',  `${binV.slice(0, 4)} ${binV.slice(4)}`) +
            (p ? item('ascii', 'ASCII', `'${String.fromCharCode(val)}'`) : '');
        menuBody =
            sub('Copy',     'copy',  copyMenu) +
            (S.editMode ? sep + sub(fillLabel,  'fill',  fillMenu) : '');
    } else {
        // ── Multi-byte: Copy + Analyze + Fill submenus ──
        const copyMenu =
            item('hex',       'Hex (spaces)',  preview(bytes.map(b => h(b)).join(' '))) +
            item('hex-raw',   'Hex (raw)',     preview(bytes.map(b => h(b)).join(''))) +
            item('binary',    'Binary',        preview(bytes.map(b => b.toString(2).padStart(8, '0')).join(' '))) +
            item('ascii',     'ASCII',         preview(bytes.map(b => b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.').join(''))) +
            sep +
            item('dec-array', 'Decimal Array', preview(`[${bytes.join(', ')}]`)) +
            item('hex-array', 'Hex Array',     preview(`[${bytes.map(b => '0x' + h(b)).join(', ')}]`)) +
            item('c-array',   'C Array',       preview(`{${bytes.map(b => '0x' + h(b)).join(', ')}}`)) +
            sep +
            item('base64',    'Base64',        preview(btoa(String.fromCharCode(...bytes))));
        const analyzeMenu =
            item('an-sum',   'Sum',    `0x${h(sum, sumW)}  (${sum})`) +
            item('an-xor',   'XOR',    `0x${h(xorVal)}`) +
            sep +
            item('an-crc8',  'CRC-8',  `0x${h(crc8(bytes))}`) +
            item('an-crc16', 'CRC-16', `0x${h(crc16(bytes), 4)}`) +
            item('an-crc32', 'CRC-32', `0x${h(crc32(bytes), 8)}`);
        menuBody =
            sub('Copy',      'copy',    copyMenu) +
            sub('Analyze',   'analyze', analyzeMenu) +
            (S.editMode ? sep + sub(fillLabel,   'fill',    fillMenu) : '');
    }

    el.innerHTML =
        `<div class="ctx-hdr">${esc(`${len} byte${len === 1 ? '' : 's'} selected`)}</div>` +
        (S.editMode ? `<div class="ctx-edit-badge">✏ Editing</div>` : '') +
        sep +
        menuBody;

    // Wire leaf-item clicks
    el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row =>
        row.addEventListener('click', ev => {
            ev.stopPropagation();
            handleCtxCommand(row.dataset.cmd!);
            hideCtx();
        })
    );

    // Wire custom fill input
    const fillInput  = el.querySelector<HTMLInputElement>('.ctx-fill-input');
    const fillApply  = el.querySelector<HTMLButtonElement>('.ctx-fill-apply');
    const applyCustomFill = () => {
        const raw = fillInput?.value.trim().replace(/^0x/i, '') ?? '';
        const val = parseInt(raw, 16);
        if (isNaN(val) || val < 0 || val > 0xFF || raw === '') {
            fillInput?.classList.add('ctx-fill-invalid');
            fillInput?.focus();
            return;
        }
        fillInput?.classList.remove('ctx-fill-invalid');
        handleCtxCommand(`fill-${val.toString(16).toUpperCase().padStart(2, '0')}`);
        hideCtx();
    };
    fillInput?.addEventListener('click',   ev => ev.stopPropagation());
    fillInput?.addEventListener('mousedown', ev => ev.stopPropagation());
    fillInput?.addEventListener('focus', () => {
        // Cancel any pending submenu close when user focuses the input
        const sub = fillInput.closest<HTMLElement>('.ctx-submenu');
        if (sub) { sub.style.display = 'block'; }
    });
    fillInput?.addEventListener('keydown',  ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { applyCustomFill(); }
        if (ev.key === 'Escape') { hideCtx(); }
    });
    fillInput?.addEventListener('input', () => fillInput.classList.remove('ctx-fill-invalid'));
    fillApply?.addEventListener('click',   ev => { ev.stopPropagation(); applyCustomFill(); });
    fillApply?.addEventListener('mousedown', ev => ev.stopPropagation());

    // Wire submenus
    wireSubmenus(el);

    // Position menu
    el.style.display = 'block';
    const mw = el.offsetWidth  || 220;
    const mh = el.offsetHeight || 120;
    el.style.left = `${Math.min(x, window.innerWidth  - mw - 8)}px`;
    el.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;
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
