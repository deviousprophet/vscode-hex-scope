/** Scripts Panel — self-contained sidebar panel for the script runner.
Owns the full `#s-scripts` shell: toolbar (title/count/refresh), script cards
(name/ext/capability badges/status dot/run-cancel state machine), embedded
result areas (output streaming with batching, collapse/expand, error-type
headers, writes-pending notice), and all UI state (`currentScripts`, `trusted`,
`scriptStatus`, `runningPath`, `pendingTimer`, output batching state). Data is
pushed via setters; actions report via callbacks. This module never imports the
S global, never posts provider messages, and never touches the render registry. */

import { esc } from '../../utils';
import './ScriptsPanel.css';

export interface ScriptInfo {
    name: string;
    filePath: string;
    capabilities: string[];
}

export interface ScriptsCallbacks {
    /** Host posts requestScriptList (first activation + refresh rescan). */
    onRequestList?: () => void;
    /** Run: host posts runScript with document generation + current selection. */
    onRunScript?: (scriptPath: string, generation: number, selectionRange?: { start: number; end: number }) => void;
    /** Cancel: host posts cancelScript. */
    onCancelScript?: (scriptPath: string) => void;
    /** Selection snapshot for the run payload (was currentSelectionRange). */
    getSelection?: () => { start: number; end: number } | null;
    /** Document generation for the run payload (was S.documentGeneration). */
    getGeneration?: () => number;
}

type ScriptStatus = 'success' | 'error' | null;
type ErrorType = 'compile' | 'runtime' | 'timeout' | 'cancel' | undefined;
type ScriptResultValue = { label: string; value: string };

const BATCH_THRESHOLD = 100;

const ERROR_HEADERS: Record<string, { icon: string; label: string; cssClass: string }> = {
    compile: { icon: '&#9888;', label: 'Compile Error', cssClass: ' script-output-hdr-err-compile' },
    runtime: { icon: '&#128308;', label: 'Script Error', cssClass: ' script-output-hdr-err' },
    timeout: { icon: '&#9201;', label: 'Timeout', cssClass: ' script-output-hdr-err-timeout' },
    cancel: { icon: '&#9632;', label: 'Cancelled', cssClass: ' script-output-hdr-err-cancel' },
};

export class ScriptsPanel {
    private readonly cb: ScriptsCallbacks;
    private _panel: HTMLElement | null = null;
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

    constructor(cb: ScriptsCallbacks = {}) {
        this.cb = cb;
    }

    /** Renders the panel into the given root (creates the #s-scripts container). Idempotent. */
    mount(root: HTMLElement): void {
        this._panel = root.id === 's-scripts' ? root : this.ensureScriptsRoot(root);
        this.render();
    }

    private ensureScriptsRoot(root: HTMLElement): HTMLElement {
        const existing = root.querySelector<HTMLElement>('#s-scripts');
        if (existing) { return existing; }
        const div = document.createElement('div');
        div.id = 's-scripts';
        root.appendChild(div);
        return div;
    }

    /** Re-renders the whole panel shell (was renderScripts). No-op until mounted. */
    render(): void {
        const panel = this._panel;
        if (!panel) { return; }
        panel.innerHTML = `
        <div class="sb-hdr script-toolbar">
            <span class="script-toolbar-title">Scripts</span>
            <span class="sb-badge" id="scripts-count"></span>
            <button class="script-refresh-btn" id="scripts-refresh" title="Refresh script list">&#8635;</button>
        </div>
        <div class="sb-body">
            <div class="script-list">${this.scriptListHtml()}</div>
        </div>`;
        this.updateScriptCount();
        panel.querySelector('#scripts-refresh')?.addEventListener('click', () => {
            this.cb.onRequestList?.();
        });
        const list = panel.querySelector<HTMLElement>('.script-list');
        if (list) { this.wireScriptList(list); }
    }

    /** Push script list + trust flag (was updateScriptList). */
    setScripts(scripts: ScriptInfo[], trusted: boolean): void {
        this.currentScripts = scripts;
        this.trusted = trusted;
        this.rememberScriptPaths(scripts);
        this.updateScriptCount();
        this.rebuildScriptList();
    }

    private rememberScriptPaths(scripts: ScriptInfo[]): void {
        for (const s of scripts) {
            if (!this.scriptStatus.has(s.filePath)) { this.scriptStatus.set(s.filePath, null); }
        }
    }

    private rebuildScriptList(): void {
        const panel = this._panel;
        if (!panel) { return; }
        let list = panel.querySelector<HTMLElement>('.script-list');
        if (!list) {
            list = document.createElement('div');
            list.className = 'script-list';
            const body = panel.querySelector('.sb-body');
            if (body) { body.innerHTML = ''; body.appendChild(list); }
        }
        list.innerHTML = this.scriptListHtml();
        this.wireScriptList(list);
    }

    /** Terminal result for a script (was updateScriptResult → showResult). */
    showResult(scriptPath: string, results: ScriptResultValue[] | null | undefined, log: string[] | null | undefined, error: string, errorType: string | undefined, pendingWriteCount: number): void {
        this.clearRunning();
        this.outputCount = 0;
        this.flushPendingOutput();
        this.setScriptStatus(scriptPath, error ? 'error' : 'success');
        this.updateStatusDot(scriptPath);

        const area = this.resultAreaFor(scriptPath);
        if (!area) { return; }
        area.innerHTML = this.scriptResultHtml(scriptPath, results, log, error, errorType as ErrorType, pendingWriteCount);
        const block = area.querySelector('.script-output-block');
        if (block) { block.classList.remove('collapsed'); }
        this.wireCollapse(area);
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
        const dot = document.querySelector(`.script-card[data-path="${cssEscape(path)}"] .script-dot`);
        if (!dot) { return; }
        dot.className = 'script-dot';
        if (st === 'success') { dot.classList.add('dot-ok'); (dot as HTMLElement).title = 'Last run succeeded'; }
        else if (st === 'error') { dot.classList.add('dot-err'); (dot as HTMLElement).title = 'Last run errored'; }
        else { dot.classList.add('dot-idle'); (dot as HTMLElement).title = 'Not yet run'; }
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

    private updateScriptCount(): void {
        const panel = this._panel;
        if (!panel) { return; }
        const el = panel.querySelector<HTMLElement>('#scripts-count');
        if (el) { el.textContent = String(this.currentScripts.length); el.hidden = this.currentScripts.length === 0; }
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
        const caps = s.capabilities.length > 0 ? capBadges(s.capabilities) : '';
        return `
        <div class="script-card" data-path="${esc(s.filePath)}">
            <div class="script-card-info">
                ${this.statusDot(s.filePath)}
                <span class="script-name" title="${esc(s.filePath)}">${esc(s.name)}</span>
                ${extBadge}${caps}
                <button class="script-run-btn${attrs.btnClass}" data-path="${esc(s.filePath)}"${attrs.btnTitle}>
                    ${this.runIconHtml(s.filePath)}
                </button>
            </div>
            <div class="script-result-area" data-path="${esc(s.filePath)}"></div>
        </div>`;
    }

    private statusDot(path: string): string {
        const st = this.scriptStatus.get(path);
        if (st === 'success') { return '<span class="script-dot dot-ok" title="Last run succeeded"></span>'; }
        if (st === 'error') { return '<span class="script-dot dot-err" title="Last run errored"></span>'; }
        return '<span class="script-dot dot-idle" title="Not yet run"></span>';
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
            btn.addEventListener('click', () => {
                const path = btn.dataset.path;
                if (!path) { return; }
                if (this.runningPath === path) { this.cancelScript(path); }
                else { this.runScript(path); }
            });
        });
    }

    private updateBtnState(btn: HTMLButtonElement): void {
        const path = btn.dataset.path;
        if (!path) { return; }
        const isRun = this.runningPath === path;
        btn.classList.toggle('running', isRun);
        btn.innerHTML = this.runIconHtml(path);
        btn.title = isRun ? (this.pendingTimer !== null ? 'Running…' : 'Click to cancel') : '';
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
        let log = area.querySelector('.script-output-log') as HTMLElement | null;
        if (!log) {
            area.innerHTML = this.logAreaHtml(area.dataset.path);
            log = area.querySelector('.script-output-log') as HTMLElement | null;
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
        if (log) { log.insertAdjacentHTML('beforeend', this.logLinesHtml(lines)); }
    }

    private appendRealtime(text: string): void {
        const area = this.runningResultArea();
        if (!area) { return; }
        const log = this.ensureLogArea(area);
        if (log) { log.insertAdjacentHTML('beforeend', `<div>${esc(text)}</div>`); }
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

    private scriptResultHtml(scriptPath: string, results: ScriptResultValue[] | null | undefined, log: string[] | null | undefined, err: string, errType: ErrorType, pendingWriteCount: number): string {
        const h = this.headerFor(err, errType);
        const logHtml = log ? log.map(l => `<div>${esc(l)}</div>`).join('') : '';
        return `<div class="script-output-block collapsed" data-path="${esc(scriptPath)}">
        <div class="script-output-hdr${h.cssClass}" data-collapse>${h.icon} ${h.label}</div>
        <div class="script-output-body-wrap">${this.errorBlockHtml(err)}${this.resultsBlockHtml(results)}${writesBlockHtml(pendingWriteCount)}<div class="script-output-log">${logHtml}</div></div></div>`;
    }

    private wireCollapse(area: HTMLElement): void {
        area.querySelectorAll('[data-collapse]').forEach(hdr => {
            hdr.addEventListener('click', () => {
                const block = (hdr as HTMLElement).closest('.script-output-block');
                if (block) { block.classList.toggle('collapsed'); }
            });
        });
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

function capBadges(capabilities: string[]): string {
    return capabilities.map(c => {
        const label = c === 'exec' ? '⚡ exec' : c === 'network' ? '🌐 net' : c;
        return `<span class="script-cap">${esc(label)}</span>`;
    }).join('');
}

function btnTitle(noTrust: boolean, extTs: boolean): string {
    if (noTrust) { return ' title="Workspace not trusted"'; }
    if (extTs) { return ' title="TypeScript scripts require esbuild. Use .js or run npm install."'; }
    return '';
}

function btnClass(path: string, noTrust: boolean, extTs: boolean, runningPath: string | null): string {
    let cls = '';
    if (runningPath === path) { cls += ' running'; }
    if (extTs) { cls += ' disabled-ts'; }
    if (noTrust) { cls += ' disabled-trust'; }
    return cls;
}

function scriptBtnAttrs(path: string, noTrust: boolean, extTs: boolean, runningPath: string | null): { btnClass: string; btnTitle: string } {
    return { btnClass: btnClass(path, noTrust, extTs, runningPath), btnTitle: btnTitle(noTrust, extTs) };
}

function writesBlockHtml(count: number): string {
    if (count <= 0) { return ''; }
    return `<div class="script-output-writes">&#128190; ${count} byte(s) written (not yet saved)</div>`;
}
