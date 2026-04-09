// ── HexScope Webview Entry Point ─────────────────────────────────
// Bootstraps the UI, handles VS Code messages, wires all modules.

import { S }                                          from './state';
import { vscode }                                     from './api';
import { esc, fmtB }                                  from './utils';
import { rerender }                                   from './render';
import { renderMemHeader, renderMemBody, applySel, scrollTo } from './memoryView';
import { renderInspector, renderBits, renderLabels, updateInspector } from './sidebar';
import { initSearch, runSearch, clearSearch, nextMatch, prevMatch } from './search';
import { initFlatBytes, buildMemRows }                from './data';

// ── Message handler ───────────────────────────────────────────────

window.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data as { type: string; [key: string]: unknown };
    switch (msg.type) {
        case 'init':
            S.parseResult = msg.parseResult as typeof S.parseResult;
            S.labels      = (msg.labels as typeof S.labels) ?? [];
            S.rawSource   = (msg.rawSource as string) ?? '';
            initFlatBytes();
            buildMemRows();
            render();
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
            S.edits.clear();
            S.undoStack.length = 0;
            S.editMode = false;
            document.getElementById('btn-edit-mode')!.style.display = '';
            document.getElementById('edit-mode-group')!.style.display = 'none';
            updateDirtyBar();
            if (S.currentView === 'memory') { memRerender(); }
            break;
    }
});

// ── Main render ───────────────────────────────────────────────────

function render(): void {
    document.getElementById('app')!.innerHTML = `
        <div id="toolbar">
            <div class="view-tabs">
                <button id="btn-mem" class="${S.currentView === 'memory' ? 'active' : ''}">Memory</button>
                <button id="btn-rec" class="${S.currentView === 'record' ? 'active' : ''}">Records</button>
                <button id="btn-raw" class="${S.currentView === 'raw'    ? 'active' : ''}">Raw</button>
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
                <select id="search-mode">
                    <option value="hex"   ${S.searchMode === 'hex'   ? 'selected' : ''}>Hex</option>
                    <option value="ascii" ${S.searchMode === 'ascii' ? 'selected' : ''}>ASCII</option>
                    <option value="addr"  ${S.searchMode === 'addr'  ? 'selected' : ''}>Addr</option>
                </select>
                <input id="search-input" type="text" placeholder="Search…" autocomplete="off" spellcheck="false">
                <button class="nav-btn" id="btn-prev"         title="Previous match">‹</button>
                <button class="nav-btn" id="btn-next"         title="Next match">›</button>
                <button class="nav-btn" id="btn-clear-search" title="Clear">✕</button>
                <span id="match-count"></span>
            </div>
        </div>
        <div id="stats-bar"></div>
        <div id="main-area">
            <div id="content-pane">
                <div id="record-view" class="${S.currentView === 'record' ? 'visible' : ''}"></div>
                <div id="memory-view" class="${S.currentView === 'memory' ? 'visible' : ''}">
                    <div id="mem-header"></div>
                    <div id="mem-scroll"><div id="mem-rows"></div></div>
                </div>
                <div id="raw-view" class="${S.currentView === 'raw' ? 'visible' : ''}"></div>
            </div>
            <div id="sidebar">
                <div class="sb-scroll">
                    <div class="sb-section" id="s-insp"></div>
                    <div class="sb-section" id="s-bits"></div>
                    <div class="sb-section" id="s-labels"></div>
                </div>
            </div>
        </div>
        <div id="ctx-menu" style="display:none"></div>`;

    // Toolbar buttons
    document.getElementById('btn-mem')!.addEventListener('click', () => switchView('memory'));
    document.getElementById('btn-rec')!.addEventListener('click', () => switchView('record'));
    document.getElementById('btn-raw')!.addEventListener('click', () => switchView('raw'));

    // Edit mode toggle
    document.getElementById('btn-edit-mode')!.addEventListener('click', () => {
        S.editMode = true;
        document.getElementById('btn-edit-mode')!.style.display = 'none';
        document.getElementById('edit-mode-group')!.style.display = '';
        updateDirtyBar();
        if (S.currentView === 'memory') { memRerender(); }
    });

    // Cancel: discard edits, restore flatBytes
    document.getElementById('btn-cancel')!.addEventListener('click', () => {
        // Restore all edited bytes to their original values
        S.edits.forEach((newVal, addr) => {
            // Re-derive original value from parse result segments
            const orig = getOriginalByte(addr);
            if (orig !== undefined) { S.flatBytes.set(addr, orig); }
        });
        S.edits.clear();
        S.undoStack.length = 0;
        S.editMode = false;
        document.getElementById('btn-edit-mode')!.style.display = '';
        document.getElementById('edit-mode-group')!.style.display = 'none';
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
    modeEl .addEventListener('change',  () => { S.searchMode = modeEl.value as typeof S.searchMode; runSearch(); });
    inputEl.addEventListener('input',   () => runSearch());
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { (e.shiftKey ? prevMatch : nextMatch)(); } });
    document.getElementById('btn-prev')!.addEventListener('click', prevMatch);
    document.getElementById('btn-next')!.addEventListener('click', nextMatch);
    document.getElementById('btn-clear-search')!.addEventListener('click', clearSearch);

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
    });
    document.addEventListener('mouseup', () => { dragAnchor = null; });

    // Wire search module
    initSearch(() => switchView('memory'));

    // Initial renders
    renderStats();
    renderMemHeader();
    renderInspector();
    renderBits();
    renderLabels();
    setupCtxMenu();

    if (S.currentView === 'memory') { memRerender(); }
    else if (S.currentView === 'record') { renderRecordView(); }
    else { renderRawView(); }
}

// ── Stats bar ─────────────────────────────────────────────────────

function renderStats(): void {
    const el = document.getElementById('stats-bar');
    if (!el || !S.parseResult) { return; }
    const p = S.parseResult;
    const ok = p.checksumErrors === 0 && p.malformedLines === 0;
    el.innerHTML =
        `<span class="si"><span class="slb">Bytes</span><span class="svl">${fmtB(p.totalDataBytes)}</span></span>` +
        `<span class="si"><span class="slb">Records</span><span class="svl">${p.records.length}</span></span>` +
        `<span class="si"><span class="slb">Segments</span><span class="svl">${p.segments.length}</span></span>` +
        (p.checksumErrors > 0 ? `<span class="si s-err"><span class="slb">Checksum Errors</span><span class="svl">${p.checksumErrors}</span></span>` : '') +
        (p.malformedLines > 0 ? `<span class="si s-err"><span class="slb">Malformed</span><span class="svl">${p.malformedLines}</span></span>` : '') +
        (ok ? `<span class="si s-ok">✓ Valid</span>` : '');
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
        }
    }
    showCtxMenu(e.clientX, e.clientY);
}

function selLen(): number {
    if (S.selStart === null || S.selEnd === null) { return 0; }
    return S.selEnd - S.selStart + 1;
}

// ── Record view ───────────────────────────────────────────────────

const REC_TYPE_LABELS: Record<number, string> = {
    0: 'DATA', 1: 'EOF', 2: 'EXT SEG ADDR', 3: 'START SEG ADDR',
    4: 'EXT LIN ADDR', 5: 'START LIN ADDR',
};

function renderRecordView(): void {
    const el = document.getElementById('record-view');
    if (!el || !S.parseResult) { return; }

    const header = `<tr><th>Addr</th><th>Type</th><th>Cnt</th><th>Data</th><th>CHK</th></tr>`;

    const rows = S.parseResult.records.map(r => {
        const badge =
            r.recordType === 4 ? 'rb-ext'   :
            r.recordType === 5 ? 'rb-start' :
            r.recordType === 1 ? 'rb-eof'   :
            r.error            ? 'rb-bad'   : 'rb-data';

        const lbl  = REC_TYPE_LABELS[r.recordType] ?? `TYPE ${r.recordType}`;
        const ra   = r.resolvedAddress.toString(16).toUpperCase().padStart(8, '0');
        const data = r.data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        const chk  = r.checksumValid
            ? `<span class="cok">${r.checksum.toString(16).toUpperCase().padStart(2, '0')}</span>`
            : `<span class="cerr">${r.checksum.toString(16).toUpperCase().padStart(2, '0')}</span>`;
        const isData   = r.recordType === 0;
        const gotoAttr = isData ? ` data-goto="${ra}"` : '';
        const addrCell = isData
            ? `<td class="raddr"${gotoAttr}>${ra}</td>`
            : `<td class="raddr raddr-empty">—</td>`;

        return `<tr${gotoAttr}>
            ${addrCell}
            <td><span class="rbadge ${badge}">${esc(lbl)}</span></td>
            <td class="rcnt">${r.byteCount}</td>
            <td class="rdata">${data || '—'}</td>
            <td>${chk}</td>
        </tr>`;
    }).join('');

    el.innerHTML = `<table class="rtbl"><thead>${header}</thead><tbody>${rows}</tbody></table>`;

    el.querySelectorAll<HTMLElement>('tr[data-goto], td[data-goto]').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.title = 'Jump to address in Memory view';
        cell.addEventListener('click', () => {
            const addr = parseInt(cell.dataset.goto!, 16);
            if (!isNaN(addr)) { switchView('memory'); scrollTo(addr); }
        });
    });
}

// ── Raw view ─────────────────────────────────────────────────────

function renderRawView(): void {
    const el = document.getElementById('raw-view');
    if (!el) { return; }

    const lines = S.rawSource.split(/\r?\n/);
    const rows = lines.map((line, i) => {
        const ln = String(i + 1).padStart(4, '\u00A0');
        if (!line.trim()) {
            return `<div class="raw-line"><span class="raw-ln">${ln}</span></div>`;
        }
        if (!line.startsWith(':') || line.length < 11) {
            return `<div class="raw-line raw-malformed"><span class="raw-ln">${ln}</span><span class="raw-text">${esc(line)}</span></div>`;
        }
        // Tokenise: start + bytecount + addr + type + data + checksum
        const ll   = esc(line.slice(1, 3));
        const addr = esc(line.slice(3, 7));
        const tt   = esc(line.slice(7, 9));
        const type = parseInt(line.slice(7, 9), 16);
        const dataEnd = 9 + parseInt(line.slice(1, 3), 16) * 2;
        const data = esc(line.slice(9, dataEnd));
        const chk  = esc(line.slice(dataEnd));
        const typeClass =
            type === 0 ? 'raw-t-data' :
            type === 1 ? 'raw-t-eof'  :
            type === 4 ? 'raw-t-ela'  :
            type === 2 ? 'raw-t-ela'  : 'raw-t-other';
        return `<div class="raw-line">` +
            `<span class="raw-ln">${ln}</span>` +
            `<span class="raw-colon">:</span>` +
            `<span class="raw-ll">${ll}</span>` +
            `<span class="raw-addr">${addr}</span>` +
            `<span class="raw-tt ${typeClass}">${tt}</span>` +
            `<span class="raw-data">${data}</span>` +
            `<span class="raw-chk">${chk}</span>` +
            `</div>`;
    }).join('');

    el.innerHTML = `<div class="raw-scroll"><code class="raw-code">${rows}</code></div>`;
}

// ── View switching ────────────────────────────────────────────────

function switchView(v: 'memory' | 'record' | 'raw'): void {
    S.currentView = v;
    document.getElementById('record-view') ?.classList.toggle('visible', v === 'record');
    document.getElementById('memory-view') ?.classList.toggle('visible', v === 'memory');
    document.getElementById('raw-view')    ?.classList.toggle('visible', v === 'raw');
    document.getElementById('btn-mem')     ?.classList.toggle('active',  v === 'memory');
    document.getElementById('btn-rec')     ?.classList.toggle('active',  v === 'record');
    document.getElementById('btn-raw')     ?.classList.toggle('active',  v === 'raw');
    if (v === 'memory')      { memRerender(); }
    else if (v === 'record') { renderRecordView(); }
    else                     { renderRawView(); }
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
        if (S.flatBytes.has(a)) {
            prev.push([a, S.flatBytes.get(a)!]);
            S.flatBytes.set(a, fillVal);
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
        S.flatBytes.set(addr, prevVal);
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
        out.push(S.flatBytes.get(a) ?? 0);
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
