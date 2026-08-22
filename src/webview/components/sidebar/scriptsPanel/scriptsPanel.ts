/** Scripts Panel — self-contained sidebar panel for the script runner.
Owns the full `#s-scripts` shell: framework section header (title/count/refresh
action), script cards (name/ext/status dot/run-cancel state machine, run-time
capability confirm), embedded result areas (output streaming with batching, collapse/expand,
error-type headers, writes-pending notice), and all UI state (`currentScripts`,
`trusted`, `scriptStatus`, `runningPath`, `pendingTimer`, output batching state).
Data is pushed via setters; actions report via callbacks. This module never
imports the S global, never posts provider messages, and never touches the render
registry. */

import { esc } from '../../../utils';
import { SidebarSections } from '../sidebar';
import './scriptsPanel.css';

export interface ScriptInfo {
    name: string;
    filePath: string;
    capabilities: string[];
    fingerprint: string;
}

export interface ScriptsCallbacks {
    /** Host posts requestScriptList (first activation + refresh rescan). */
    onRequestList?: () => void;
    /** Run: host posts runScript with document generation + current selection. */
    onRunScript?: (scriptPath: string, generation: number, selectionRange?: { start: number; end: number }) => void;
    /** Cancel: host posts cancelScript. */
    onCancelScript?: (scriptPath: string) => void;
    /** Apply script-written bytes as staged edits + save (per-run control). */
    onApplyScriptWrites?: (scriptPath: string, writes: Array<[number, number]>) => void;
    /** Discard the current run's script writes (never staged). */
    onDiscardScriptWrites?: (scriptPath: string) => void;
    /** Selection snapshot for the run payload (was currentSelectionRange). */
    getSelection?: () => { start: number; end: number } | null;
    /** Document generation for the run payload (was S.documentGeneration). */
    getGeneration?: () => number;
}

type ScriptStatus = 'success' | 'error' | null;
type ErrorType = 'compile' | 'runtime' | 'timeout' | 'cancel' | undefined;
type ScriptResultValue = { label: string; value: string };
/** One completed run of a script, kept collapsed in the result area (run history). */
type RunRecord = { num: number; at: string; ok: boolean; errCls: string; bodyHtml: string };

const BATCH_THRESHOLD = 100;
/** Max collapsed run rows kept per script card; older rows dropped (design: cap 5 + clear affordance). */
const HISTORY_CAP = 5;

const ERROR_HEADERS: Record<string, { icon: string; label: string; cssClass: string }> = {
    compile: { icon: '&#9888;', label: 'Compile Error', cssClass: ' script-output-hdr-err-compile' },
    runtime: { icon: '&#128308;', label: 'Script Error', cssClass: ' script-output-hdr-err' },
    timeout: { icon: '&#9201;', label: 'Timeout', cssClass: ' script-output-hdr-err-timeout' },
    cancel: { icon: '&#9632;', label: 'Cancelled', cssClass: ' script-output-hdr-err-cancel' },
};

export class ScriptsPanel {
    private readonly cb: ScriptsCallbacks;
    private _panel: HTMLElement | null = null;
    private sections: SidebarSections | null = null;
    private initialized = false;
    private currentScripts: ScriptInfo[] = [];
    private trusted = true;
    private readonly scriptStatus = new Map<string, ScriptStatus>();
    private runningPath: string | null = null;
    private pendingTimer: ReturnType<typeof setTimeout> | null = null;
    private outputCount = 0;
    private outputBuffer: string[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private batchPath: string | null = null;
    /** Per-script run history (oldest first); rendered as collapsed rows under the latest block. */
    private readonly runHistory = new Map<string, RunRecord[]>();
    /** Per-script completed-run counter for stable "run #n" labels. */
    private readonly runCounter = new Map<string, number>();
    /** Paths whose capabilities were accepted at the run-time gate (session state; resets on remount). */
    private readonly confirmedCaps = new Set<string>();
    /** Per-path pending script writes (address/value) awaiting Apply/Discard. */
    private readonly storedWrites = new Map<string, Array<[number, number]>>();
    /** Per-path script file fingerprints; a changed fingerprint resets the
        capability approval (the script was modified → re-confirm next run). */
    private readonly fingerprints = new Map<string, string>();

    constructor(cb: ScriptsCallbacks = {}) {
        this.cb = cb;
    }

    /** Renders the panel into the given root (creates the #s-scripts container). Idempotent. */
    mount(root: HTMLElement): void {
        this._panel = root.id === 's-scripts' ? root : this.ensureScriptsRoot(root);
        this._panel.innerHTML = '';
        this.sections = new SidebarSections(this._panel, 'scripts', [
            { id: 'main', label: 'Scripts', mountActions: r => this.mountToolbarActions(r) },
        ]);
        this.render();
    }

    /**
     * Aborts in-flight timers (pending-run spinner window, output-batch flush).
     * Host/teardown calls this so no timer callback touches a destroyed DOM.
     */
    dispose(): void {
        if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
        if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    }

    private ensureScriptsRoot(root: HTMLElement): HTMLElement {
        const existing = root.querySelector<HTMLElement>('#s-scripts');
        if (existing) { return existing; }
        const div = document.createElement('div');
        div.id = 's-scripts';
        root.appendChild(div);
        return div;
    }

    /** Re-renders the panel body (was renderScripts). No-op until mounted. */
    render(): void {
        const body = this.sections?.body('main');
        if (!body) { return; }
        body.innerHTML = `<div class="script-list">${this.scriptListHtml()}</div>`;
        const list = body.querySelector<HTMLElement>('.script-list');
        if (list) { this.wireScriptList(list); }
    }

    /** Framework header action: refresh rescan (compact control, mounted once). */
    private mountToolbarActions(root: HTMLElement): void {
        const refresh = document.createElement('button');
        refresh.id = 'scripts-refresh';
        refresh.className = 'sb-btn sb-btn-secondary sb-section-action';
        refresh.title = 'Refresh script list';
        refresh.setAttribute('aria-label', 'Refresh script list');
        refresh.textContent = '\u21BB';
        refresh.addEventListener('click', () => this.cb.onRequestList?.());
        root.appendChild(refresh);
    }

    /** Push script list + trust flag (was updateScriptList). */
    setScripts(scripts: ScriptInfo[], trusted: boolean): void {
        this.currentScripts = scripts;
        this.trusted = trusted;
        this.rememberScriptPaths(scripts);
        this.revokeApprovalsForModifiedScripts(scripts);
        this.rebuildScriptList();
    }

    /** If a script file's fingerprint changed since the last push, its capability
        approval is reset (modified script → re-confirm on the next run). */
    private revokeApprovalsForModifiedScripts(scripts: ScriptInfo[]): void {
        for (const s of scripts) {
            const prev = this.fingerprints.get(s.filePath);
            if (prev !== undefined && prev !== s.fingerprint) {
                this.confirmedCaps.delete(s.filePath);
            }
            this.fingerprints.set(s.filePath, s.fingerprint);
        }
    }

    private rememberScriptPaths(scripts: ScriptInfo[]): void {
        for (const s of scripts) {
            if (!this.scriptStatus.has(s.filePath)) { this.scriptStatus.set(s.filePath, null); }
        }
    }

    private rebuildScriptList(): void {
        const body = this.sections?.body('main');
        if (!body) { return; }
        let list = body.querySelector<HTMLElement>('.script-list');
        if (!list) {
            list = document.createElement('div');
            list.className = 'script-list';
            body.innerHTML = '';
            body.appendChild(list);
        }
        list.innerHTML = this.scriptListHtml();
        this.wireScriptList(list);
        this.renderRunStates();
    }

    /** Terminal result for a script (was updateScriptResult → showResult). */
    showResult(
        scriptPath: string, results: ScriptResultValue[] | null | undefined, log: string[] | null | undefined,
        error: string, errorType: string | undefined, pendingWriteCount: number,
        writes?: Array<[number, number]>,
    ): void {
        this.clearRunning();
        this.outputCount = 0;
        this.flushPendingOutput();
        this.setScriptStatus(scriptPath, this.statusForError(error));
        this.updateStatusDot(scriptPath);
        if (writes !== undefined) { this.storedWrites.set(scriptPath, writes); }

        const area = this.resultAreaFor(scriptPath);
        if (!area) { return; }
        this.storeRunRecord(area);
        area.innerHTML = this.scriptResultHtml(scriptPath, results, log, error, errorType as ErrorType, pendingWriteCount, writes) + this.historyRowsHtml(scriptPath);
        const block = area.querySelector('.script-output-block');
        if (block) { block.classList.remove('collapsed'); }
        this.wireCollapse(area);
        this.wireClear(area, scriptPath);
        this.wireWritesActions(area, scriptPath, writes);
    }

    private statusForError(error: string): 'error' | 'success' {
        return error ? 'error' : 'success';
    }

    /** Streamed output line (was updateScriptOutput → appendOutput). The target card is resolved from the running button, matching pre-refactor. */
    appendOutput(_scriptPath: string, text: string): void {
        this.outputCount++;
        if (this.outputCount <= BATCH_THRESHOLD) {
            this.appendRealtime(text);
            return;
        }
        if (!this.batchPath) { this.batchPath = this.runningPathFromButton(); }
        this.outputBuffer.push(text);
        if (this.flushTimer) { clearTimeout(this.flushTimer); }
        this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flushBuffer(); }, 0);
    }

    /** Lazy-init gate (was activateScripts): first activation requests the list; never reset. */
    setTabActive(active: boolean): void {
        if (!active || this.initialized) { return; }
        this.initialized = true;
        this.cb.onRequestList?.();
    }

    // ── Run/cancel state machine (was scriptList.ts) ──────────────

    private setScriptStatus(path: string, status: 'success' | 'error'): void {
        this.scriptStatus.set(path, status);
    }

    private updateStatusDot(path: string): void {
        const st = this.scriptStatus.get(path);
        const dot = document.querySelector(`.script-card[data-path="${cssEscape(path)}"] .sb-status-dot`);
        if (!dot) { return; }
        dot.className = 'sb-status-dot';
        if (st === 'success') { dot.classList.add('ok'); (dot as HTMLElement).title = 'Last run succeeded'; }
        else if (st === 'error') { dot.classList.add('err'); (dot as HTMLElement).title = 'Last run errored'; }
        else { dot.classList.add('idle'); (dot as HTMLElement).title = 'Not yet run'; }
    }

    private clearRunning(): void {
        this.runningPath = null;
        if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
        this.renderRunStates();
    }

    private setRunning(path: string): void {
        this.runningPath = path;
        if (this.pendingTimer) { clearTimeout(this.pendingTimer); }
        this.pendingTimer = setTimeout(() => {
            this.pendingTimer = null;
            this.renderRunStates();
        }, 200);
        this.renderRunStates();
    }

    private runScript(filePath: string): void {
        if (this.runningPath) { return; }
        this.resetOutputState();
        this.storedWrites.delete(filePath);
        // New run auto-presses the prior result block into a one-line collapsed history row
        // before streaming starts, so streamed lines never pollute the stored run.
        const area = this.resultAreaFor(filePath);
        if (area) {
            this.storeRunRecord(area);
            area.innerHTML = this.historyRowsHtml(filePath);
            this.wireCollapse(area);
        }
        this.setRunning(filePath);
        this.cb.onRunScript?.(filePath, this.currentGeneration(), this.currentSelectionRange());
    }

    private currentGeneration(): number {
        return this.cb.getGeneration?.() ?? 0;
    }

    private currentSelectionRange(): { start: number; end: number } | undefined {
        return this.cb.getSelection?.() ?? undefined;
    }

    private cancelScript(filePath: string): void {
        this.runningPath = null;
        if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
        this.renderRunStates();
        this.cb.onCancelScript?.(filePath);
    }

    private scriptListHtml(): string {
        if (this.currentScripts.length === 0) {
            return '<div class="sb-empty">No scripts found in .hexscope/scripts/</div>';
        }
        return this.currentScripts.map(s => this.scriptCardHtml(s)).join('');
    }

    private scriptCardHtml(s: ScriptInfo): string {
        const ext = extLabel(s.name);
        const noTrust = !this.trusted;
        const extTs = ext === 'ts' && !noTrust;
        const attrs = scriptBtnAttrs(s.filePath, noTrust, extTs, this.runningPath);
        const extBadge = ext ? `<span class="script-ext">${esc(ext)}</span>` : '';
        return `
        <div class="script-card sb-card" data-path="${esc(s.filePath)}">
            <div class="script-card-info">
                ${this.statusDot(s.filePath)}
                <span class="script-name" title="${esc(s.filePath)}">${esc(s.name)}</span>
                ${extBadge}
                <button class="script-run-btn sb-btn sb-btn-primary${attrs.btnClass}" data-path="${esc(s.filePath)}" aria-label="Run script"${attrs.btnDisabled}${attrs.btnTitle}>
                    ${this.runIconHtml(s.filePath)}
                </button>
            </div>
            <div class="script-result-area" data-path="${esc(s.filePath)}"></div>
        </div>`;
    }

    private statusDot(path: string): string {
        const st = this.scriptStatus.get(path);
        if (st === 'success') { return '<span class="sb-status-dot ok" title="Last run succeeded"></span>'; }
        if (st === 'error') { return '<span class="sb-status-dot err" title="Last run errored"></span>'; }
        return '<span class="sb-status-dot idle" title="Not yet run"></span>';
    }

    private runIconHtml(path: string): string {
        const isRun = this.runningPath === path;
        const isPending = isRun && this.pendingTimer !== null;
        if (isPending) { return '<span class="script-btn-icon spin"></span>'; }
        if (isRun) { return '<span class="script-btn-icon stop">&#9632;</span>'; }
        return '<span class="script-btn-icon play">&#9654;</span>';
    }

    private wireScriptList(container: HTMLElement): void {
        container.querySelectorAll<HTMLButtonElement>('.script-run-btn:not(.disabled-ts):not(.disabled-trust)').forEach(btn => {
            btn.addEventListener('click', () => this.onRunBtnClick(btn));
        });
    }

    private onRunBtnClick(btn: HTMLButtonElement): void {
        const path = btn.dataset.path;
        if (path === undefined) { return; }
        const script = this.currentScripts.find(s => s.filePath === path);
        if (script && this.unconfirmedCaps(path, script)) {
            this.showCapsConfirm(script);
            return;
        }
        this.toggleScript(path);
    }

    private unconfirmedCaps(path: string, script: ScriptInfo): boolean {
        return script.capabilities.length > 0 && !this.confirmedCaps.has(path);
    }

    private toggleScript(path: string): void {
        if (this.runningPath === path) { this.cancelScript(path); }
        else { this.runScript(path); }
    }

    private hardBlockedBtn(btn: HTMLButtonElement): boolean {
        return btn.classList.contains('disabled-trust') || btn.classList.contains('disabled-ts');
    }

    private anotherScriptRunning(isRun: boolean): boolean {
        return isRun ? false : this.runningPath !== null;
    }

    private updateBtnState(btn: HTMLButtonElement): void {
        const path = btn.dataset.path;
        if (!path) { return; }
        const isRun = this.runningPath === path;
        const otherRunning = this.anotherScriptRunning(isRun);
        btn.classList.toggle('running', isRun);
        const hardBlocked = this.hardBlockedBtn(btn);
        btn.disabled = hardBlocked || otherRunning;
        btn.innerHTML = this.runIconHtml(path);
        btn.setAttribute('aria-label', this.runBtnAria(isRun));
        if (this.keepsInitialTooltip(btn)) { return; }
        btn.title = this.runBtnTitle(isRun, otherRunning);
    }

    private keepsInitialTooltip(btn: HTMLButtonElement): boolean {
        return btn.classList.contains('disabled-ts') || btn.classList.contains('disabled-trust');
    }

    private runBtnAria(isRun: boolean): string {
        return isRun ? 'Cancel script' : 'Run script';
    }

    private runBtnTitle(isRun: boolean, otherRunning: boolean): string {
        if (isRun) { return this.pendingTimer !== null ? 'Running…' : 'Click to cancel'; }
        return otherRunning ? 'A script is already running' : 'Run script';
    }

    private renderRunStates(): void {
        document.querySelectorAll<HTMLButtonElement>('.script-run-btn').forEach(btn => this.updateBtnState(btn));
    }

    // ── Result display + output streaming (was resultDisplay.ts) ──

    private resultAreaFor(scriptPath: string): HTMLElement | null {
        return document.querySelector(`.script-result-area[data-path="${cssEscape(scriptPath)}"]`);
    }

    private runningPathFromButton(): string | null {
        const el = document.querySelector('.script-card .script-run-btn.running');
        return el ? (el as HTMLElement).dataset.path ?? null : null;
    }

    private runningResultArea(): HTMLElement | null {
        const path = this.runningPathFromButton();
        return path ? this.resultAreaFor(path) : null;
    }

    private logAreaHtml(path: string | undefined): string {
        return `<div class="script-output-block" data-path="${cssEscape(path ?? '')}">
        <div class="script-output-hdr" data-collapse>Running</div>
        <div class="script-output-body-wrap"><div class="script-output-log"></div></div></div>`;
    }

    private ensureLogArea(area: HTMLElement): HTMLElement | null {
        let block = area.querySelector<HTMLElement>('.script-output-block:not(.script-run-row)');
        let log = block?.querySelector<HTMLElement>('.script-output-log') ?? null;
        if (!log) {
            area.insertAdjacentHTML('afterbegin', this.logAreaHtml(area.dataset.path));
            block = area.querySelector<HTMLElement>('.script-output-block:not(.script-run-row)');
            log = block?.querySelector<HTMLElement>('.script-output-log') ?? null;
            this.wireCollapse(area);
        }
        return log;
    }

    private logLinesHtml(lines: string[]): string {
        return lines.map(l => `<div>${esc(l)}</div>`).join('');
    }

    private flushArea(path: string | null): HTMLElement | null {
        const p = path || this.runningPathFromButton();
        return p ? this.resultAreaFor(p) : null;
    }

    private flushBuffer(): void {
        if (this.outputBuffer.length === 0) { return; }
        const lines = this.outputBuffer.splice(0);
        const area = this.flushArea(this.batchPath);
        if (!area) { return; }
        const log = this.ensureLogArea(area);
        if (log) {
            log.insertAdjacentHTML('beforeend', this.logLinesHtml(lines));
            this.stickToBottom(log);
        }
    }

    /** Keep a tail-following log scrolled to the bottom when the user is already there. */
    private stickToBottom(log: HTMLElement): void {
        if (log.scrollHeight - log.scrollTop - log.clientHeight < 40) {
            log.scrollTop = log.scrollHeight;
        }
    }

    private appendRealtime(text: string): void {
        const area = this.runningResultArea();
        if (!area) { return; }
        const log = this.ensureLogArea(area);
        if (log) {
            log.insertAdjacentHTML('beforeend', `<div>${esc(text)}</div>`);
            this.stickToBottom(log);
        }
    }

    /** Resets output batching state (was the runStartCallback from resultDisplay). */
    private resetOutputState(): void {
        this.outputCount = 0;
        this.batchPath = null;
        if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
        this.outputBuffer = [];
    }

    private flushPendingOutput(): void {
        if (!this.flushTimer) { return; }
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
        this.flushBuffer();
    }

    private errorBlockHtml(error: string): string {
        return error ? `<div class="script-output-error">${esc(error)}</div>` : '';
    }

    private resultsBlockHtml(results: ScriptResultValue[] | null | undefined): string {
        if (!results || results.length === 0) { return ''; }
        const rows = results.map(r =>
            `<span class="script-result-label">${esc(r.label)}</span><span class="script-result-value">${esc(r.value)}</span>`
        ).join('</div><div class="script-result-row">');
        return `<div class="script-output-body"><div class="script-result-row">${rows}</div></div>`;
    }

    private headerFor(err: string, errType: ErrorType): { icon: string; label: string; cssClass: string } {
        if (!err) { return { icon: '', label: 'Result', cssClass: '' }; }
        return ERROR_HEADERS[errType ?? ''] ?? { icon: '&#9888;', label: 'Error', cssClass: ' script-output-hdr-err' };
    }

    private scriptResultHtml(
        scriptPath: string, results: ScriptResultValue[] | null | undefined, log: string[] | null | undefined,
        err: string, errType: ErrorType, pendingWriteCount: number,
        writes?: Array<[number, number]>,
    ): string {
        const h = this.headerFor(err, errType);
        const logHtml = log ? log.map(l => `<div>${esc(l)}</div>`).join('') : '';
        return `<div class="script-output-block collapsed" data-path="${esc(scriptPath)}">
        <div class="script-output-hdr${h.cssClass}" data-collapse>${h.icon} ${h.label}<button class="script-clear" data-clear title="Clear results" aria-label="Clear results">&#10005;</button></div>
        <div class="script-output-body-wrap">${this.errorBlockHtml(err)}${this.resultsBlockHtml(results)}${writesBlockHtml(writes, pendingWriteCount)}<div class="script-output-log">${logHtml}</div></div></div>`;
    }

    private wireWritesActions(area: HTMLElement, scriptPath: string, writes: Array<[number, number]> | undefined): void {
        if (!writes || writes.length === 0) { return; }
        const writesRow = area.querySelector<HTMLElement>('.script-output-block:not(.script-run-row) .script-output-writes');
        if (!writesRow) { return; }
        const applyBtn = writesRow.querySelector('[data-writes-apply]');
        const discardBtn = writesRow.querySelector('[data-writes-discard]');
        applyBtn?.addEventListener('click', ev => {
            ev.stopPropagation();
            this.cb.onApplyScriptWrites?.(scriptPath, this.storedWrites.get(scriptPath) ?? writes);
        });
        discardBtn?.addEventListener('click', ev => {
            ev.stopPropagation();
            this.storedWrites.delete(scriptPath);
            writesRow.remove();
            this.cb.onDiscardScriptWrites?.(scriptPath);
        });
    }

    private wireCollapse(area: HTMLElement): void {
        area.querySelectorAll('[data-collapse]').forEach(hdr => {
            const el = hdr as HTMLElement;
            if (el.dataset.wired === '1') { return; } // idempotent: ensureLogArea re-wires area while streaming
            el.dataset.wired = '1';
            el.addEventListener('click', () => {
                const block = el.closest('.script-output-block');
                if (block) { block.classList.toggle('collapsed'); }
            });
        });
    }

    // ── Run history (collapsed old runs) ────────────────────────────

    /** The latest result block is a runnable snapshot (not the ephemeral
        streaming block and not an already-collapsed history row). */
    private storableBlock(block: HTMLElement | null): block is HTMLElement {
        return block !== null && !block.classList.contains('script-run-row');
    }

    private isRunningHeader(hdr: HTMLElement): boolean {
        return (hdr.textContent?.trim() ?? '') === 'Running';
    }

    private storableHeader(hdr: HTMLElement | null, path: string | undefined): hdr is HTMLElement {
        return hdr !== null && path !== undefined;
    }

    private nextRunNum(path: string): number {
        const num = (this.runCounter.get(path) ?? 0) + 1;
        this.runCounter.set(path, num);
        return num;
    }

    private runRecordsFor(path: string): RunRecord[] {
        return this.runHistory.get(path) ?? [];
    }

    private hdrHasErrorClass(hdr: HTMLElement): boolean {
        return [...hdr.classList].some(c => c.startsWith('script-output-hdr-err'));
    }

    private hdrErrorClass(hdr: HTMLElement): string {
        return [...hdr.classList].find(c => c.startsWith('script-output-hdr-err')) ?? '';
    }

    private runRecord(block: HTMLElement, path: string, num: number, hdr: HTMLElement): RunRecord {
        return {
            num,
            at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            ok: !this.hdrHasErrorClass(hdr),
            errCls: this.hdrErrorClass(hdr),
            bodyHtml: block.querySelector('.script-output-body-wrap')?.innerHTML ?? '',
        };
    }

    private trimHistory(records: RunRecord[]): void {
        while (records.length > HISTORY_CAP) { records.shift(); }
    }

    /** Gather the runnable result block + its header/path, or null when the
        area has nothing storable yet. */
    private runSnapshot(area: HTMLElement): { path: string; hdr: HTMLElement; block: HTMLElement } | null {
        const block = area.querySelector<HTMLElement>('.script-output-block');
        if (!this.storableBlock(block)) { return null; }
        const hdr = block.querySelector<HTMLElement>('.script-output-hdr');
        const path = area.dataset.path;
        if (this.storableHeader(hdr, path) && path) { return { path, hdr, block }; }
        return null;
    }

    private recordRun(snap: { path: string; hdr: HTMLElement; block: HTMLElement }): void {
        const records = this.runRecordsFor(snap.path);
        records.push(this.runRecord(snap.block, snap.path, this.nextRunNum(snap.path), snap.hdr));
        this.trimHistory(records);
        this.runHistory.set(snap.path, records);
    }

    /** Snapshots the area's current result block into per-path history (skips the
    ephemeral streaming "Running" block and already-collapsed history rows). */
    private storeRunRecord(area: HTMLElement): void {
        const snap = this.runSnapshot(area);
        if (!snap) { return; }
        if (this.isRunningHeader(snap.hdr)) { return; }
        this.recordRun(snap);
    }

    /** Collapsed one-line rows for completed runs, newest first, under the latest block. */
    private historyRowsHtml(path: string): string {
        const records = this.runHistory.get(path) ?? [];
        return [...records].reverse().map(r => `
        <div class="script-output-block collapsed script-run-row" data-path="${esc(path)}">
        <div class="script-output-hdr script-run-hdr${r.errCls ? ' ' + r.errCls : ''}" data-collapse>run #${r.num} · ${esc(r.at)} ${r.ok ? '&#10003;' : '&#10007;'}</div>
        <div class="script-output-body-wrap">${r.bodyHtml}</div></div>`).join('');
    }

    /** Clear-results button only exists on the latest block header. */
    private wireClear(area: HTMLElement, path: string): void {
        area.querySelectorAll<HTMLElement>('[data-clear]').forEach(btn => {
            btn.addEventListener('click', ev => {
                ev.stopPropagation();
                this.clearResults(path);
            });
        });
    }

    private clearResults(path: string): void {
        this.runHistory.delete(path);
        this.storedWrites.delete(path);
        const area = this.resultAreaFor(path);
        if (area) { area.innerHTML = ''; }
        this.scriptStatus.set(path, null);
        this.updateStatusDot(path);
    }

    // ── Run-time capability gate ────────────────────────────────────

    /** Inline confirm before the first run of a capability-bearing script. */
    private showCapsConfirm(script: ScriptInfo): void {
        this.removeCapsConfirm();
        const card = document.querySelector<HTMLElement>(`.script-card[data-path="${cssEscape(script.filePath)}"]`);
        const area = card?.querySelector<HTMLElement>('.script-result-area');
        if (!card || !area) { return; }
        const panel = document.createElement('div');
        panel.className = 'script-caps-confirm';
        const capsHtml = script.capabilities.map(c => esc(c)).join(', ');
        panel.innerHTML = `
            <div class="script-caps-confirm-title">Run ${esc(script.name)}?</div>
            <div class="script-caps-confirm-caps">Requires: ${capsHtml}</div>
            <div class="script-caps-confirm-actions">
                <button class="sb-btn sb-btn-primary" data-caps-run>Run</button>
                <button class="sb-btn" data-caps-cancel>Cancel</button>
            </div>`;
        card.insertBefore(panel, area);
        panel.querySelector('[data-caps-run]')!.addEventListener('click', () => {
            this.confirmedCaps.add(script.filePath);
            this.removeCapsConfirm();
            this.toggleScript(script.filePath);
        });
        panel.querySelector('[data-caps-cancel]')!.addEventListener('click', () => this.removeCapsConfirm());
    }

    private removeCapsConfirm(): void {
        document.querySelectorAll('.script-caps-confirm').forEach(el => el.remove());
    }
}

// ── Pure helpers (module-level; no instance state) ───────────────

/** Escape backslashes for CSS attribute selectors (Windows paths, scripting.md §9.1). */
function cssEscape(path: string): string {
    return path.replace(/\\/g, '\\\\');
}

function extLabel(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx + 1) : '';
}

function btnTitle(noTrust: boolean, extTs: boolean): string {
    if (noTrust) { return ' title="Workspace not trusted"'; }
    if (extTs) { return ' title="TypeScript scripts require esbuild. Use .js or run npm install."'; }
    return ' title="Run script"';
}

function btnClass(path: string, noTrust: boolean, extTs: boolean, runningPath: string | null): string {
    let cls = '';
    if (runningPath === path) { cls += ' running'; }
    if (extTs) { cls += ' disabled-ts'; }
    if (noTrust) { cls += ' disabled-trust'; }
    return cls;
}

function scriptBtnAttrs(path: string, noTrust: boolean, extTs: boolean, runningPath: string | null): { btnClass: string; btnTitle: string; btnDisabled: string } {
    return {
        btnClass: btnClass(path, noTrust, extTs, runningPath),
        btnTitle: btnTitle(noTrust, extTs),
        // Hard-disabled (native attribute) for untrusted workspaces and
        // TypeScript scripts blocked by a missing esbuild — out of the tab order.
        btnDisabled: noTrust || extTs ? ' disabled' : '',
    };
}

function writesBlockHtml(writes: Array<[number, number]> | undefined, count: number): string {
    if (writes === undefined) {
        // Legacy/unknown provider payload: count-only notice (no action row).
        return count > 0 ? `<div class="script-output-writes">&#128190; ${count} byte(s) written (not yet saved)</div>` : '';
    }
    if (writes.length === 0) { return ''; }
    return `<div class="script-output-writes">&#128190; ${writes.length} byte(s) written
        <span class="script-writes-actions">
            <button class="sb-btn sb-btn-primary" data-writes-apply title="Apply these bytes as edits and save" aria-label="Apply and save script writes">Apply &amp; Save</button>
            <button class="sb-btn sb-btn-secondary" data-writes-discard title="Discard these writes" aria-label="Discard script writes">Discard</button>
        </span></div>`;
}
