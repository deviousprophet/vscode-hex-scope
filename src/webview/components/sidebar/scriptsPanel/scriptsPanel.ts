/** Scripts Panel — self-contained sidebar panel for the script runner.
Owns the full `#s-scripts` shell: framework section header (title/count/refresh
action), script cards (name/ext/capability badges/status dot/run-cancel state
machine), the inline per-command permission prompt, the revocable permission
list (script + session + workspace grants), and embedded result areas (output
streaming with batching, collapse/expand, error-type headers, writes notice).
Data is pushed via setters; actions report via callbacks. This module never
imports the S global, never posts provider messages, and never touches the
render registry. */

import { esc } from '../../../utils';
import { fileName } from '../../../../core/pathName';
import type { ScriptInfo } from '../../../../core/scripting/types';
import type {
    ScriptCapabilityGrant,
    ScriptGrantScope,
    ScriptGrantView,
    ScriptPermissionScope,
} from '../../../../webviewProtocol';
import { SidebarSections } from '../sidebar';
import { PermissionPrompt, type ScriptPermissionRequest } from './permissionPrompt';
import './scriptsPanel.css';

export type { ScriptInfo } from '../../../../core/scripting/types';

export interface ScriptsCallbacks {
    /** Host posts requestScriptList (first activation + refresh rescan). */
    onRequestList?: () => void;
    /** Run: host posts runScript with document generation + current selection. */
    onRunScript?: (scriptPath: string, generation: number, selectionRange?: { start: number; end: number }) => void;
    /** Cancel: host posts cancelScript. */
    onCancelScript?: (scriptPath: string) => void;
    /** Open the script file in the editor; independent of run state. */
    onOpenScript?: (scriptPath: string) => void;
    /** Inline permission decision: host posts scriptPermissionResponse. */
    onScriptPermissionDecision?: (
        requestId: number,
        decision: 'allow' | 'deny',
        scope: ScriptPermissionScope,
        capability: ScriptCapabilityGrant,
    ) => void;
    /** Revoke one grant: host posts revokeScriptPermission with its scope. */
    onRevokeScriptPermission?: (scope: ScriptGrantScope, scriptPath: string, capability: ScriptCapabilityGrant) => void;
    /** Bulk revoke: one script (scriptPath) or one scope class (workspace/session); host posts revokeAllScriptPermissions. */
    onRevokeAllScriptPermissions?: (scope?: ScriptGrantScope, scriptPath?: string) => void;
    /** Copy the bundled example catalog: host posts addExampleScripts (or runs the command). */
    onAddExampleScripts?: () => void;
    /** Selection snapshot for the run payload (was currentSelectionRange). */
    getSelection?: () => { start: number; end: number } | null;
    /** Document generation for the run payload (was S.documentGeneration). */
    getGeneration?: () => number;
}

type ScriptStatus = 'success' | 'error' | null;
type ErrorType = 'compile' | 'runtime' | 'timeout' | 'cancel' | 'contract' | undefined;
type ScriptResultValue = { label: string; value: string };
/** What a script can do: run (`action`), feed a destination (`provider`), both, or neither. */
type ScriptKind = 'action' | 'provider' | 'both' | 'unknown';
/** List grouping: runnable scripts first, role providers second. */
type ScriptGroupKey = 'actions' | 'providers';
/** One completed run of a script, kept collapsed in the result area (run history). */
type RunRecord = { num: number; at: string; ok: boolean; errCls: string; bodyHtml: string };

const BATCH_THRESHOLD = 100;
/** Max collapsed run rows kept per script card; older rows dropped (design: cap 5 + clear affordance). */
const HISTORY_CAP = 5;
/** Armed bulk-revoke buttons disarm after this long without a confirming click. */
const CONFIRM_RESET_MS = 4000;

const ERROR_HEADERS: Record<string, { icon: string; label: string; cssClass: string }> = {
    compile: { icon: '&#9888;', label: 'Compile Error', cssClass: ' script-output-hdr-err-compile' },
    runtime: { icon: '&#128308;', label: 'Script Error', cssClass: ' script-output-hdr-err' },
    timeout: { icon: '&#9201;', label: 'Timeout', cssClass: ' script-output-hdr-err-timeout' },
    cancel: { icon: '&#9632;', label: 'Cancelled', cssClass: ' script-output-hdr-err-cancel' },
    contract: { icon: '&#9888;', label: 'Contract Error', cssClass: ' script-output-hdr-err-contract' },
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
    /** Every stored grant (script + session + workspace) shown in the Permissions section (host-owned). */
    private permissionGrants: ScriptGrantView[] = [];
    /** Session-local expanded state of the Permissions section (reveals bulk revoke actions). */
    private permissionsExpanded = false;
    /** Armed two-step confirm timers; cleared on dispose so no callback touches a dead DOM. */
    private readonly confirmTimers = new Set<ReturnType<typeof setTimeout>>();
    /** Session-local group collapse state (Actions / Providers); presentation only. */
    private readonly collapsedGroups = new Set<ScriptGroupKey>();
    /** Inline per-command approval surface (one prompt at a time). */
    private readonly prompt: PermissionPrompt;

    constructor(cb: ScriptsCallbacks = {}) {
        this.cb = cb;
        this.prompt = new PermissionPrompt({
            onDecision: (requestId, decision, scope, capability) =>
                this.cb.onScriptPermissionDecision?.(requestId, decision, scope, capability),
        });
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
        for (const timer of this.confirmTimers) { clearTimeout(timer); }
        this.confirmTimers.clear();
        this.prompt.dispose();
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
        this.renderPermissions();
    }

    /** Framework header actions: add the bundled examples, then rescan (compact controls, mounted once). */
    private mountToolbarActions(root: HTMLElement): void {
        root.appendChild(this.toolbarButton(
            'scripts-add-examples', 'Add example scripts', '+', () => this.cb.onAddExampleScripts?.(),
        ));
        root.appendChild(this.toolbarButton(
            'scripts-refresh', 'Refresh script list', '\u21BB', () => this.cb.onRequestList?.(),
        ));
    }

    private toolbarButton(id: string, label: string, glyph: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.id = id;
        btn.className = 'sb-btn sb-btn-secondary sb-section-action';
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.textContent = glyph;
        btn.addEventListener('click', onClick);
        return btn;
    }

    /** Push script list + trust flag (was updateScriptList). */
    setScripts(scripts: ScriptInfo[], trusted: boolean): void {
        this.currentScripts = scripts;
        this.trusted = trusted;
        this.rememberScriptPaths(scripts);
        this.rebuildScriptList();
    }

    /** Inline per-command approval request from the host (one prompt at a time). */
    showPermissionRequest(request: ScriptPermissionRequest): void {
        this.prompt.show(request);
    }

    /** Every stored grant for the revocable Permissions section (host-owned list). */
    setPermissionGrants(grants: ScriptGrantView[]): void {
        this.permissionGrants = Array.isArray(grants) ? grants : [];
        this.renderPermissions();
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
        // Grouping/sorting is presentation-only: keep each card's result block
        // (and its run history/event wiring) attached by path across the rebuild.
        const preservedAreas = this.captureResultAreas(list);
        list.innerHTML = this.scriptListHtml();
        this.restoreResultAreas(list, preservedAreas);
        this.wireScriptList(list);
        this.renderPermissions();
        this.renderRunStates();
    }

    /** Collect non-empty result areas so a re-render can move them to the new card. */
    private captureResultAreas(list: HTMLElement): Map<string, HTMLElement> {
        const areas = new Map<string, HTMLElement>();
        list.querySelectorAll<HTMLElement>('.script-result-area').forEach(area => {
            const path = area.dataset.path;
            if (path && area.childElementCount > 0) { areas.set(path, area); }
        });
        return areas;
    }

    private restoreResultAreas(list: HTMLElement, areas: Map<string, HTMLElement>): void {
        areas.forEach((oldArea, path) => {
            const fresh = list.querySelector<HTMLElement>(`.script-result-area[data-path="${cssEscape(path)}"]`);
            fresh?.replaceWith(oldArea);
        });
    }

    /** Terminal result for a script (was updateScriptResult → showResult). */
    showResult(
        scriptPath: string, results: ScriptResultValue[] | null | undefined, log: string[] | null | undefined,
        error: string, errorType: string | undefined, pendingWriteCount: number,
        discardedWriteCount = 0,
    ): void {
        if (this.prompt.isOpenFor(scriptPath)) { this.prompt.close(); }
        this.clearRunning();
        this.outputCount = 0;
        this.flushPendingOutput();
        this.setScriptStatus(scriptPath, this.statusForError(error));
        this.updateStatusDot(scriptPath);

        const area = this.resultAreaFor(scriptPath);
        if (!area) { return; }
        this.storeRunRecord(area);
        area.innerHTML = this.scriptResultHtml(
            scriptPath, results, log, error, errorType as ErrorType, pendingWriteCount, discardedWriteCount,
        ) + this.historyRowsHtml(scriptPath);
        const block = area.querySelector('.script-output-block');
        if (block) { block.classList.remove('collapsed'); }
        this.wireCollapse(area);
        this.wireClear(area, scriptPath);
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
        if (this.prompt.isOpenFor(filePath)) { this.prompt.close(); }
        this.runningPath = null;
        if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
        this.renderRunStates();
        this.cb.onCancelScript?.(filePath);
    }

    private scriptListHtml(): string {
        if (this.currentScripts.length === 0) {
            return `<div class="sb-empty script-empty">
        <div>No scripts found in .hexscope/scripts/</div>
        <button type="button" class="sb-btn sb-btn-secondary script-add-examples" data-add-examples
            title="Copy the bundled example scripts into .hexscope/scripts/">Add example scripts</button>
    </div>`;
        }
        const { actions, providers } = this.groupedScripts();
        const groups: string[] = [];
        if (actions.length > 0) { groups.push(this.scriptGroupHtml('actions', 'Actions', actions)); }
        if (providers.length > 0) { groups.push(this.scriptGroupHtml('providers', 'Providers', providers)); }
        return groups.join('');
    }

    /** Actions first; role-only providers second; alphabetical inside each group. */
    private groupedScripts(): { actions: ScriptInfo[]; providers: ScriptInfo[] } {
        const actions: ScriptInfo[] = [];
        const providers: ScriptInfo[] = [];
        for (const script of this.currentScripts) {
            if (scriptKind(script) === 'provider') { providers.push(script); }
            else { actions.push(script); }
        }
        actions.sort(byName);
        providers.sort(byName);
        return { actions, providers };
    }

    private scriptGroupHtml(key: ScriptGroupKey, label: string, scripts: ScriptInfo[]): string {
        const collapsed = this.collapsedGroups.has(key);
        const bodyId = `script-group-${key}`;
        return `
        <div class="script-group${collapsed ? ' collapsed' : ''}" data-group="${key}">
            <button type="button" class="script-group-hdr" data-group-toggle="${key}"
                aria-expanded="${collapsed ? 'false' : 'true'}" aria-controls="${bodyId}">
                <span class="script-group-label">${label}</span>
                <span class="script-group-count">${scripts.length}</span>
            </button>
            <div class="script-group-body" id="${bodyId}">
                ${scripts.map(s => this.scriptCardHtml(s)).join('')}
            </div>
        </div>`;
    }

    private scriptCardHtml(s: ScriptInfo): string {
        const kind = scriptKind(s);
        const runnable = isRunnableKind(kind);
        return `
        <div class="script-card sb-card" data-path="${esc(s.filePath)}" data-kind="${kind}">
            <div class="script-card-info">
                ${cardLeadHtml(kind, s.filePath, this.scriptStatus)}
                <span class="script-name" title="${esc(s.filePath)}">${esc(s.name)}</span>
                ${roleBadgesHtml(s.roles)}
                ${capBadgesHtml(s.capabilities)}
                ${unknownHintHtml(kind)}
                ${extBadgeHtml(s.name)}
                ${openButtonHtml(s)}
                ${runnable ? this.runButtonHtml(s) : ''}
            </div>
            ${runnable ? `<div class="script-result-area" data-path="${esc(s.filePath)}"></div>` : ''}
        </div>`;
    }

    private runButtonHtml(s: ScriptInfo): string {
        const noTrust = !this.trusted;
        const extTs = extLabel(s.name) === 'ts' && !noTrust;
        const attrs = scriptBtnAttrs(s.filePath, noTrust, extTs, this.runningPath);
        return `<button class="script-run-btn sb-btn sb-btn-primary${attrs.btnClass}" data-path="${esc(s.filePath)}" aria-label="Run script"${attrs.btnDisabled}${attrs.btnTitle}>
                    ${this.runIconHtml(s.filePath)}
                </button>`;
    }

    private runIconHtml(path: string): string {
        const isRun = this.runningPath === path;
        const isPending = isRun && this.pendingTimer !== null;
        if (isPending) { return '<span class="script-btn-icon spin"></span>'; }
        if (isRun) { return '<span class="script-btn-icon stop">&#9632;</span>'; }
        return '<span class="script-btn-icon play">&#9654;</span>';
    }

    private wireScriptList(container: HTMLElement): void {
        container.querySelectorAll<HTMLButtonElement>('[data-add-examples]').forEach(btn => {
            btn.addEventListener('click', () => this.cb.onAddExampleScripts?.());
        });
        container.querySelectorAll<HTMLButtonElement>('[data-group-toggle]').forEach(btn => {
            btn.addEventListener('click', () => this.toggleGroup(btn));
        });
        container.querySelectorAll<HTMLButtonElement>('.script-open-btn').forEach(btn => {
            btn.addEventListener('click', ev => {
                ev.stopPropagation();
                const path = btn.dataset.path;
                if (path !== undefined) { this.cb.onOpenScript?.(path); }
            });
        });
        container.querySelectorAll<HTMLButtonElement>('.script-run-btn:not(.disabled-ts):not(.disabled-trust)').forEach(btn => {
            btn.addEventListener('click', () => this.onRunBtnClick(btn));
        });
    }

    /** Toggle a group in place: CSS hides the body, so result areas and wiring survive. */
    private toggleGroup(btn: HTMLButtonElement): void {
        const key = btn.dataset.groupToggle as ScriptGroupKey | undefined;
        const group = btn.closest<HTMLElement>('.script-group');
        if (!key || !group) { return; }
        const collapsed = !group.classList.contains('collapsed');
        group.classList.toggle('collapsed', collapsed);
        this.rememberGroupCollapsed(key, collapsed);
        btn.setAttribute('aria-expanded', String(!collapsed));
    }

    private rememberGroupCollapsed(key: ScriptGroupKey, collapsed: boolean): void {
        if (collapsed) { this.collapsedGroups.add(key); return; }
        this.collapsedGroups.delete(key);
    }

    private onRunBtnClick(btn: HTMLButtonElement): void {
        const path = btn.dataset.path;
        if (path === undefined) { return; }
        this.toggleScript(path);
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
        err: string, errType: ErrorType, pendingWriteCount: number, discardedWriteCount: number,
    ): string {
        const h = this.headerFor(err, errType);
        const logHtml = log ? log.map(l => `<div>${esc(l)}</div>`).join('') : '';
        return `<div class="script-output-block collapsed" data-path="${esc(scriptPath)}">
        <div class="script-output-hdr${h.cssClass}" data-collapse>${h.icon} ${h.label}<button class="script-clear" data-clear title="Clear results" aria-label="Clear results">&#10005;</button></div>
        <div class="script-output-body-wrap">${this.errorBlockHtml(err)}${this.resultsBlockHtml(results)}${writesBlockHtml(pendingWriteCount, discardedWriteCount)}<div class="script-output-log">${logHtml}</div></div></div>`;
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
        const area = this.resultAreaFor(path);
        if (area) { area.innerHTML = ''; }
        this.scriptStatus.set(path, null);
        this.updateStatusDot(path);
    }

    // ── Permission list (revocable: script, session, workspace) ─────

    private permissionsHtml(): string {
        if (this.permissionGrants.length === 0) { return ''; }
        const rows = this.permissionGrants.map(grant => this.permissionRowHtml(grant)).join('');
        return `<div class="script-perms-section${this.permissionsExpanded ? ' expanded' : ''}">
            <div class="script-perms-title">
                <span>Permissions</span>
                <button type="button" class="sb-btn sb-btn-secondary script-perms-manage" data-perms-manage
                    aria-expanded="${this.permissionsExpanded}" title="Show bulk revoke actions">Manage</button>
            </div>${rows}
            <div class="script-perms-bulk">
                <div class="script-perms-hint">Script grants drop when the file changes or is deleted; session-wide grants last until VS Code restarts.</div>
                <button type="button" class="sb-btn sb-btn-secondary script-perm-bulk-btn" data-revoke-all-workspace
                    title="Revoke every workspace grant">Revoke all workspace</button>
                <button type="button" class="sb-btn sb-btn-secondary script-perm-bulk-btn" data-revoke-all-session
                    title="Revoke every session-wide grant">Revoke all session</button>
            </div>
        </div>`;
    }

    /** One grant row: scope chip, script (or "All scripts"), capability, Revoke, and per-script bulk All. */
    private permissionRowHtml(grant: ScriptGrantView): string {
        const sessionWide = grant.scope === 'session';
        const name = sessionWide ? 'All scripts' : fileName({ fsPath: grant.scriptPath });
        const ability = grantLabel(grant.capability);
        const bulk = this.revocableForScript(grant) ? `
                <button type="button" class="sb-btn sb-btn-secondary script-perm-all" data-revoke-all
                    title="Revoke every permission for this script" aria-label="Revoke all permissions for ${esc(name)}">All</button>` : '';
        return `
            <div class="script-perm-row" data-path="${esc(grant.scriptPath)}" data-cap="${esc(grant.capability)}" data-scope="${esc(grant.scope)}">
                <span class="script-perm-scope" title="${esc(scopeTitle(grant.scope))}">${esc(scopeLabel(grant.scope))}</span>
                <span class="script-perm-name" title="${esc(sessionWide ? 'All scripts' : grant.scriptPath)}">${esc(name)}</span>
                <span class="script-perm-ability">${esc(ability)}</span>
                <button type="button" class="sb-btn sb-btn-secondary script-perm-revoke" data-revoke
                    title="Revoke this permission" aria-label="Revoke ${esc(ability)} for ${esc(name)}">Revoke</button>${bulk}
            </div>`;
    }

    /** Per-row "All" only matters when the script has 2+ non-session grants (revokes script + workspace). */
    private revocableForScript(grant: ScriptGrantView): boolean {
        if (grant.scope === 'session') { return false; }
        return this.permissionGrants.filter(g => g.scope !== 'session' && g.scriptPath === grant.scriptPath).length > 1;
    }

    /** Re-render the Permissions section in place (never touches result areas). */
    private renderPermissions(): void {
        const body = this.sections?.body('main');
        if (!body) { return; }
        body.querySelector('.script-perms-section')?.remove();
        const sectionHtml = this.permissionsHtml();
        if (!sectionHtml) { return; }
        const list = body.querySelector('.script-list');
        if (!list) { return; }
        list.insertAdjacentHTML('beforebegin', sectionHtml);
        this.wirePermissions(body);
    }

    private wirePermissions(body: HTMLElement): void {
        const section = body.querySelector<HTMLElement>('.script-perms-section');
        if (!section) { return; }
        section.querySelectorAll<HTMLElement>('[data-perms-manage]').forEach(btn => {
            btn.addEventListener('click', () => this.togglePermissionsExpanded(section, btn));
        });
        section.querySelectorAll<HTMLElement>('.script-perm-row').forEach(row => this.wirePermissionRow(row));
        section.querySelectorAll<HTMLElement>('[data-revoke-all]').forEach(btn => {
            const scriptPath = btn.closest<HTMLElement>('.script-perm-row')?.dataset.path;
            if (scriptPath) { this.wireConfirm(btn, 'All', () => this.cb.onRevokeAllScriptPermissions?.(undefined, scriptPath)); }
        });
        section.querySelectorAll<HTMLElement>('[data-revoke-all-workspace]').forEach(btn => {
            this.wireConfirm(btn, 'Revoke all workspace', () => this.cb.onRevokeAllScriptPermissions?.('workspace'));
        });
        section.querySelectorAll<HTMLElement>('[data-revoke-all-session]').forEach(btn => {
            this.wireConfirm(btn, 'Revoke all session', () => this.cb.onRevokeAllScriptPermissions?.('session'));
        });
    }

    /** "Manage" toggles the bulk-revoke footer without rebuilding the section. */
    private togglePermissionsExpanded(section: HTMLElement, btn: HTMLElement): void {
        const expanded = !section.classList.contains('expanded');
        section.classList.toggle('expanded', expanded);
        this.permissionsExpanded = expanded;
        btn.setAttribute('aria-expanded', String(expanded));
    }

    private wirePermissionRow(row: HTMLElement): void {
        const grant = grantFromRow(row.dataset);
        if (!grant) { return; }
        row.querySelector<HTMLElement>('[data-revoke]')?.addEventListener('click', () => this.revokeGrant(grant));
    }

    private revokeGrant(grant: ScriptGrantView): void {
        this.cb.onRevokeScriptPermission?.(grant.scope, grant.scriptPath, grant.capability);
    }

    /** Two-step confirm: the first click arms the button, the second click revokes. */
    private wireConfirm(btn: HTMLElement, label: string, onConfirm: () => void): void {
        let armed = false;
        const reset = (): void => {
            armed = false;
            btn.classList.remove('confirm');
            btn.textContent = label;
        };
        btn.addEventListener('click', () => {
            if (!armed) {
                armed = true;
                btn.classList.add('confirm');
                btn.textContent = 'Confirm?';
                const timer = setTimeout(() => {
                    this.confirmTimers.delete(timer);
                    if (btn.isConnected) { reset(); }
                }, CONFIRM_RESET_MS);
                this.confirmTimers.add(timer);
                return;
            }
            reset();
            onConfirm();
        });
    }
}

// ── Pure helpers (module-level; no instance state) ───────────────

/** Job-language label for a `@script` role chip (raw role stays in `data-role`). */
function roleLabel(role: string): string {
    if (role === 'address') { return 'Instance address'; }
    if (role === 'size') { return 'Array size'; }
    if (role === 'integrity') { return 'Integrity check'; }
    return role;
}

/** Role count that tolerates legacy payloads omitting `roles`. */
function roleCount(s: ScriptInfo): number {
    return s.roles?.length ?? 0;
}

/** A run entry is exported; absent metadata keeps role-less scripts runnable (old payloads). */
function hasRunEntry(s: ScriptInfo): boolean {
    if (s.hasRun !== undefined) { return s.hasRun; }
    return roleCount(s) === 0;
}

/** What the card can do; unknown = neither a `run` export nor a role was detected. */
function scriptKind(s: ScriptInfo): ScriptKind {
    const hasRoles = roleCount(s) > 0;
    if (hasRunEntry(s)) { return hasRoles ? 'both' : 'action'; }
    return hasRoles ? 'provider' : 'unknown';
}

function isRunnableKind(kind: ScriptKind): boolean {
    return kind === 'action' || kind === 'both';
}

function byName(a: ScriptInfo, b: ScriptInfo): number {
    return a.name.localeCompare(b.name);
}

function roleBadgesHtml(roles: ScriptInfo['roles'] | undefined): string {
    return (roles ?? []).map(role =>
        `<span class="script-role" data-role="${esc(role)}" title="Used as: ${esc(roleLabel(role))}">${esc(roleLabel(role))}</span>`
    ).join('');
}

function capBadgesHtml(capabilities: string[]): string {
    return capabilities.map(cap =>
        `<span class="script-cap" title="Requires approval: ${esc(cap)}">${esc(cap)}</span>`
    ).join('');
}

function extBadgeHtml(name: string): string {
    const ext = extLabel(name);
    return ext ? `<span class="script-ext">${esc(ext)}</span>` : '';
}

function unknownHintHtml(kind: ScriptKind): string {
    if (kind !== 'unknown') { return ''; }
    return `<span class="script-inspect-hint" title="No 'run' export detected. Open the file to inspect its exports, or add an explicit '@entry run' header.">Inspect exports</span>`;
}

/** Status dot for a runnable card (provider/unknown cards show no run status). */
function statusDotHtml(status: ScriptStatus): string {
    if (status === 'success') { return '<span class="sb-status-dot ok" title="Last run succeeded"></span>'; }
    if (status === 'error') { return '<span class="sb-status-dot err" title="Last run errored"></span>'; }
    return '<span class="sb-status-dot idle" title="Not yet run"></span>';
}

/** Leading card marker: run status for runnable cards, a warning for unknown exports. */
function cardLeadHtml(kind: ScriptKind, path: string, statuses: ReadonlyMap<string, ScriptStatus>): string {
    if (kind === 'unknown') {
        return '<span class="script-warn" title="No run export detected" aria-hidden="true">&#9888;</span>';
    }
    return isRunnableKind(kind) ? statusDotHtml(statuses.get(path) ?? null) : '';
}

function openButtonHtml(s: ScriptInfo): string {
    return `<button class="script-open-btn sb-btn sb-btn-secondary" data-path="${esc(s.filePath)}"
                    title="Open ${esc(s.name)}" aria-label="Open ${esc(s.name)}">&#9998;</button>`;
}

/** Escape backslashes for CSS attribute selectors (Windows paths, scripting.md §9.1). */
function cssEscape(path: string): string {
    return path.replace(/\\/g, '\\\\');
}

function extLabel(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx + 1) : '';
}

/** Permission label for a grant row. */
function grantLabel(capability: ScriptCapabilityGrant): string {
    return capability === '*' ? 'all non-exec' : capability;
}

/** User-facing scope chip for a grant row (prompt wording mirrors these lifetimes). */
function scopeLabel(scope: ScriptGrantScope): string {
    if (scope === 'workspace') { return 'Workspace'; }
    if (scope === 'session') { return 'This session'; }
    return 'This script';
}

/** Permission row dataset → grant view; null when a required attribute is missing. */
function grantFromRow(data: DOMStringMap): ScriptGrantView | null {
    const { path, cap, scope } = data;
    if (!path || !cap || !scope) { return null; }
    return { scriptPath: path, capability: cap as ScriptCapabilityGrant, scope: scope as ScriptGrantScope };
}

/** Lifetime tooltip for a scope chip. */
function scopeTitle(scope: ScriptGrantScope): string {
    if (scope === 'workspace') { return 'This script in this workspace — persists across restarts'; }
    if (scope === 'session') { return 'Every script — until VS Code restarts'; }
    return 'This script — until VS Code restarts or the script changes';
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

/** Informational writes notice. Approved writes auto-save on success, so there
    is no action control; a failed run reports that nothing was kept. */
function writesBlockHtml(pendingWriteCount: number, discardedWriteCount: number): string {
    if (discardedWriteCount > 0) {
        return `<div class="script-output-writes script-output-writes-discarded">&#128190; ${discardedWriteCount} byte(s) written, discarded &mdash; nothing was saved</div>`;
    }
    return pendingWriteCount > 0
        ? `<div class="script-output-writes">&#128190; ${pendingWriteCount} byte(s) written &mdash; saving</div>`
        : '';
}
