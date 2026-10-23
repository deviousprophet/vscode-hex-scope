/** Scripts Panel — self-contained sidebar panel for the script runner.
Owns the full `#s-scripts` shell: framework section header (title/count/refresh
action), the New split button, the filter bar (search + kind chips), script cards
(name button/ext/role chips/capability badges/used-by chip/status dot/run-cancel
state machine, the expandable details row with used-by links, the TypeScript
action row), the card context menu (Open/Copy path/Reveal/Delete/Details/
Permissions), the inline per-command permission prompt, the revocable
permission list (script + session + workspace grants), and embedded result
areas (output streaming with batching, collapse/expand, error-type headers,
writes notice, and the write summary line).
Data is pushed via setters; actions report via callbacks. This module never
imports the S global, never posts provider messages, and never touches the
render registry. */

import { esc } from '../../../utils';
import { fileName } from '../../../../core/pathName';
import { SCRIPT_TEMPLATES, type ScriptTemplateId } from '../../../../core/scripting/templates';
import type { ScriptInfo } from '../../../../core/scripting/types';
import type {
    ScriptCapabilityGrant,
    ScriptGrantScope,
    ScriptGrantView,
    ScriptPermissionScope,
} from '../../../../webviewProtocol';
import { menuController } from '../../menuController/menuController';
import { SidebarSections } from '../sidebar';
import { PermissionPrompt, type ScriptPermissionRequest } from './permissionPrompt';
import type { ScriptUsageKind, ScriptUsageRef } from './scriptUsages';
import './scriptsPanel.css';

export type { ScriptInfo } from '../../../../core/scripting/types';
export type { ScriptUsageRef } from './scriptUsages';

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
    /** Selective example install: host posts browseExampleScripts (checked catalog rows only). */
    onBrowseExampleScripts?: () => void;
    /** Bulk example install (New menu's "Add all examples"): host posts addExampleScripts. */
    onAddExampleScripts?: () => void;
    /** Create a script from a template; without a template the host asks which one. */
    onCreateScript?: (template?: ScriptTemplateId) => void;
    /** Copy a script's absolute path to the clipboard (host posts copyText). */
    onCopyPath?: (scriptPath: string) => void;
    /** Reveal a script in the Explorer (host posts revealScript). */
    onRevealScript?: (scriptPath: string) => void;
    /** Delete a script (host confirms + unlinks + revokes grants + rescans). */
    onDeleteScript?: (scriptPath: string) => void;
    /** Create a runnable `.js` copy of a TypeScript script (host posts convertScriptToJs). */
    onCreateJsVersion?: (scriptPath: string) => void;
    /** Open the bundled scripting guide (host posts openScriptingGuide). */
    onOpenScriptingGuide?: () => void;
    /** Used-by link: host reveals the destination (Integrity check / Overlay instance). */
    onSelectUsage?: (usage: ScriptUsageRef) => void;
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
/** Kind chips narrowing the list (presentation only; hide/show, never re-render). */
type KindFilter = 'all' | 'actions' | 'providers';
/** Terminal outcome of a run, kept per script for the details row + status tooltip. */
type LastRunState = 'success' | 'error' | 'timeout' | 'cancel' | 'contract';
type LastRunRecord = { at: string; state: LastRunState };
/** One completed run of a script, kept collapsed in the result area (run history). */
type RunRecord = { num: number; at: string; ok: boolean; errCls: string; bodyHtml: string };
/** One used-by entry plus its index in the panel's `usages` array (stable click payload). */
type UsageEntry = { usage: ScriptUsageRef; index: number };
/** Lifecycle of approved script writes: staged → saving → saved/failed. */
export type ScriptWriteStatus = 'saving' | 'saved' | 'failed';
/** One script run's write lifecycle, shown as a compact line in the result block. */
export interface ScriptWriteSummary {
    scriptPath: string;
    /** Staged/mapped writes as [address, byte]; `before` holds the pre-write bytes at the same addresses. */
    writes: Array<[number, number]>;
    before: Array<[number, number]>;
    status: ScriptWriteStatus;
    /** Save-failure detail (status `failed` only). */
    error?: string;
}

const BATCH_THRESHOLD = 100;
/** Max collapsed run rows kept per script card; older rows dropped (design: cap 5 + clear affordance). */
const HISTORY_CAP = 5;
/** Armed bulk-revoke buttons disarm after this long without a confirming click. */
const CONFIRM_RESET_MS = 4000;
/** Full before/after byte preview cap; longer ranges show the first/last byte only. */
const WRITE_PREVIEW_MAX = 8;

/** Kind chips narrowing the list (All keeps the full Actions + Providers view). */
const KIND_FILTERS: ReadonlyArray<{ id: KindFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'actions', label: 'Actions' },
    { id: 'providers', label: 'Providers' },
];

const LAST_RUN_LABELS: Record<LastRunState, string> = {
    success: 'Succeeded',
    error: 'Error',
    timeout: 'Timeout',
    cancel: 'Cancelled',
    contract: 'Contract error',
};

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
    /** Outside-click closer for the New template chooser (attached only while open). */
    private menuDocHandler: ((event: Event) => void) | null = null;
    /** Host-reported esbuild availability; absent payloads keep `.ts` blocked (legacy default). */
    private compilerAvailable = false;
    /** Session-local text filter (presentation only; cards hide, results survive). */
    private filterQuery = '';
    /** Session-local kind chip; `all` keeps both groups. */
    private kindFilter: KindFilter = 'all';
    /** Session-local expanded details rows, keyed by script path. */
    private readonly expandedDetails = new Set<string>();
    /** Last terminal run per script path (timestamp + state); details row + status tooltip only. */
    private readonly lastRun = new Map<string, LastRunRecord>();
    /** Current write lifecycle line; one script runs at a time, correlated by path. */
    private writeSummary: ScriptWriteSummary | null = null;
    /** Host-derived used-by links (bound-profile usages; transient, never persisted). */
    private usages: ScriptUsageRef[] = [];

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
        this.setNewMenu(false);
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
        body.innerHTML = `${this.newBarHtml()}${this.filterBarHtml()}<div class="script-list">${this.scriptListHtml()}</div>`;
        this.wireNewBar(body);
        this.wireFilterBar(body);
        const list = body.querySelector<HTMLElement>('.script-list');
        if (list) { this.wireScriptList(list); }
        this.syncFilterBar();
        this.applyFilter();
        this.renderPermissions();
    }

    // ── Filter bar (search + kind chips, presentation only) ────────

    /** Compact filter bar above the list; hidden while the empty state shows. */
    private filterBarHtml(): string {
        const chips = KIND_FILTERS.map(filter =>
            `<button type="button" class="script-kind-chip${filter.id === this.kindFilter ? ' active' : ''}"
                data-kind-filter="${filter.id}" aria-pressed="${filter.id === this.kindFilter}">${filter.label}</button>`
        ).join('');
        return `
        <div class="script-filter-bar"${this.currentScripts.length === 0 ? ' hidden' : ''}>
            <input type="search" class="script-filter-input" placeholder="Filter scripts" aria-label="Filter scripts" value="${esc(this.filterQuery)}">
            <div class="script-kind-chips" role="group" aria-label="Filter by kind">${chips}</div>
        </div>`;
    }

    private wireFilterBar(body: HTMLElement): void {
        const input = body.querySelector<HTMLInputElement>('.script-filter-input');
        input?.addEventListener('input', () => {
            this.filterQuery = input.value;
            this.applyFilter();
        });
        body.querySelectorAll<HTMLButtonElement>('[data-kind-filter]').forEach(btn => {
            btn.addEventListener('click', () => this.setKindFilter(btn.dataset.kindFilter as KindFilter | undefined));
        });
    }

    private setKindFilter(filter: KindFilter | undefined): void {
        if (!filter || filter === this.kindFilter) { return; }
        this.kindFilter = filter;
        this._panel?.querySelectorAll<HTMLElement>('[data-kind-filter]').forEach(btn => {
            const active = btn.dataset.kindFilter === filter;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', String(active));
        });
        this.applyFilter();
    }

    /** Hide/show cards for the current query + chip; never re-renders, so results and history survive. */
    private applyFilter(): void {
        const list = this.sections?.body('main')?.querySelector<HTMLElement>('.script-list');
        if (!list) { return; }
        for (const card of list.querySelectorAll<HTMLElement>('.script-card')) {
            card.hidden = !this.cardVisible(card);
        }
        this.syncGroupVisibility(list);
        this.syncNoMatch(list);
    }

    private cardVisible(card: HTMLElement): boolean {
        const script = this.currentScripts.find(s => s.filePath === card.dataset.path);
        if (!script) { return true; }
        return matchesKind(script, this.kindFilter) && matchesQuery(script, this.filterQuery);
    }

    private syncGroupVisibility(list: HTMLElement): void {
        for (const group of list.querySelectorAll<HTMLElement>('.script-group')) {
            group.hidden = group.querySelector('.script-card:not([hidden])') === null;
        }
    }

    private syncNoMatch(list: HTMLElement): void {
        const noMatch = list.querySelector<HTMLElement>('.script-no-match');
        if (!noMatch) { return; }
        noMatch.hidden = this.currentScripts.length === 0 || list.querySelector('.script-card:not([hidden])') !== null;
    }

    private syncFilterBar(): void {
        const bar = this._panel?.querySelector<HTMLElement>('.script-filter-bar');
        if (bar) { bar.hidden = this.currentScripts.length === 0; }
    }

    // ── New split button + template chooser ────────────────────────

    /** New split button: primary opens the host template picker; the caret lists templates in place. */
    private newBarHtml(): string {
        const options = SCRIPT_TEMPLATES.map(template =>
            `<button type="button" class="script-new-option" role="menuitem" data-template="${esc(template.id)}"
                title="${esc(template.description)}">${esc(template.name)}</button>`
        ).join('');
        return `
        <div class="script-new-bar">
            <span class="script-new-split">
                <button type="button" id="scripts-new" class="sb-btn sb-btn-secondary script-new-btn"
                    title="Create a script from a template">\uFF0B New</button>
                <button type="button" id="scripts-new-menu" class="sb-btn sb-btn-secondary script-new-caret"
                    aria-haspopup="true" aria-expanded="false" title="New script or example" aria-label="New script or example">\u25BE</button>
            </span>
            <div class="script-new-popup" role="menu" hidden>${options}
                <div class="script-new-sep" role="separator"></div>
                <button type="button" class="script-new-option" role="menuitem" data-example-action="browse"
                    title="Copy selected bundled examples">Browse examples\u2026</button>
                <button type="button" class="script-new-option" role="menuitem" data-example-action="all"
                    title="Copy the whole bundled catalog">Add all examples</button>
            </div>
        </div>`;
    }

    private wireNewBar(body: HTMLElement): void {
        body.querySelector('#scripts-new')?.addEventListener('click', () => this.cb.onCreateScript?.());
        body.querySelector('#scripts-new-menu')?.addEventListener('click', () => this.toggleNewMenu());
        body.querySelectorAll<HTMLElement>('.script-new-option[data-template]').forEach(option => {
            option.addEventListener('click', () => {
                this.setNewMenu(false);
                this.cb.onCreateScript?.(option.dataset.template as ScriptTemplateId | undefined);
            });
        });
        const exampleActions: Record<string, () => void> = {
            browse: () => this.cb.onBrowseExampleScripts?.(),
            all: () => this.cb.onAddExampleScripts?.(),
        };
        body.querySelectorAll<HTMLElement>('[data-example-action]').forEach(row => {
            const action = exampleActions[row.dataset.exampleAction ?? ''];
            if (!action) { return; }
            row.addEventListener('click', () => {
                this.setNewMenu(false);
                action();
            });
        });
    }

    private toggleNewMenu(): void {
        const popup = this._panel?.querySelector<HTMLElement>('.script-new-popup');
        this.setNewMenu(Boolean(popup?.hidden));
    }

    private setNewMenu(open: boolean): void {
        const popup = this._panel?.querySelector<HTMLElement>('.script-new-popup');
        const caret = this._panel?.querySelector<HTMLElement>('#scripts-new-menu');
        if (popup) { popup.hidden = !open; }
        caret?.setAttribute('aria-expanded', String(open));
        this.syncMenuDocListener(open, popup ?? null, caret ?? null);
    }

    /** Close the chooser when the user clicks anywhere outside it. */
    private syncMenuDocListener(open: boolean, popup: HTMLElement | null, caret: HTMLElement | null): void {
        if (!open) {
            this.detachMenuDocListener();
            return;
        }
        if (!this.menuListenerReady(popup, caret)) { return; }
        this.menuDocHandler = this.outsideMenuHandler(popup, caret);
        document.addEventListener('click', this.menuDocHandler);
    }

    /** Drop the outside-click listener (no-op when the chooser never opened). */
    private detachMenuDocListener(): void {
        if (!this.menuDocHandler) { return; }
        document.removeEventListener('click', this.menuDocHandler);
        this.menuDocHandler = null;
    }

    /** The chooser has both anchors and no listener is attached yet. */
    private menuListenerReady(popup: HTMLElement | null, caret: HTMLElement | null): popup is HTMLElement {
        return popup !== null && caret !== null && this.menuDocHandler === null;
    }

    /** Outside-click close: clicks inside the chooser (or its caret) keep it open. */
    private outsideMenuHandler(popup: HTMLElement, caret: HTMLElement | null): (event: Event) => void {
        return event => {
            if (this.menuContains(event.target, popup, caret)) { return; }
            this.setNewMenu(false);
        };
    }

    /** True when the click landed inside the chooser popup or its caret. */
    private menuContains(target: EventTarget | null, popup: HTMLElement, caret: HTMLElement | null): boolean {
        const node = target as Node | null;
        if (!node) { return false; }
        return popup.contains(node) || Boolean(caret?.contains(node));
    }

    /** Framework header actions: the list refresh (compact controls, mounted once). */
    private mountToolbarActions(root: HTMLElement): void {
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

    /** Push script list + trust flag (+ host esbuild availability; absent = unavailable). */
    setScripts(scripts: ScriptInfo[], trusted: boolean, compilerAvailable = false): void {
        this.currentScripts = scripts;
        this.trusted = trusted;
        this.compilerAvailable = compilerAvailable;
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

    /** Host-derived used-by links (bound-profile usages; transient, never persisted). */
    setUsages(usages: ScriptUsageRef[]): void {
        this.usages = Array.isArray(usages) ? usages : [];
        this.syncUsages();
    }

    /** One card's used-by entries with their index in `usages` (stable click payload). */
    private usageEntriesFor(scriptPath: string): UsageEntry[] {
        const entries: UsageEntry[] = [];
        this.usages.forEach((usage, index) => {
            if (usage.scriptPath === scriptPath) { entries.push({ usage, index }); }
        });
        return entries;
    }

    /** Refresh every rendered card's used-by chip + details cell in place (results survive). */
    private syncUsages(): void {
        const list = this.sections?.body('main')?.querySelector<HTMLElement>('.script-list');
        if (!list) { return; }
        list.querySelectorAll<HTMLElement>('.script-card').forEach(card => {
            const path = card.dataset.path;
            if (!path) { return; }
            const entries = this.usageEntriesFor(path);
            this.syncUsageChip(card, entries);
            this.syncDetailsUsages(card, entries);
        });
    }

    private syncUsageChip(card: HTMLElement, entries: UsageEntry[]): void {
        const chip = card.querySelector<HTMLElement>('[data-usage-chip]');
        if (!chip) { return; }
        chip.hidden = entries.length === 0;
        chip.textContent = entries.length > 0 ? `Used by ${entries.length}` : '';
        if (entries.length > 0) { chip.title = usageListTitle(entries); }
        else { chip.removeAttribute('title'); }
    }

    private syncDetailsUsages(card: HTMLElement, entries: UsageEntry[]): void {
        const cell = card.querySelector<HTMLElement>('[data-details-usages]');
        if (!cell) { return; }
        const usagesHtml = usagesValueHtml(entries);
        if (cell.innerHTML === usagesHtml) { return; } // unchanged: keep focus/wiring intact
        cell.innerHTML = usagesHtml;
        this.wireUsageButtons(cell);
    }

    private wireUsageButtons(container: HTMLElement): void {
        container.querySelectorAll<HTMLElement>('[data-usage-idx]').forEach(btn => {
            btn.addEventListener('click', () => this.reportUsage(btn));
        });
    }

    /** Used-by link click: report the derived usage so the host can reveal the destination. */
    private reportUsage(btn: HTMLElement): void {
        const usage = this.usages[Number(btn.dataset.usageIdx)];
        if (usage) { this.cb.onSelectUsage?.(usage); }
    }

    private rememberScriptPaths(scripts: ScriptInfo[]): void {
        for (const s of scripts) {
            if (!this.scriptStatus.has(s.filePath)) { this.scriptStatus.set(s.filePath, null); }
        }
    }

    private rebuildScriptList(): void {
        const body = this.sections?.body('main');
        if (!body) { return; }
        const list = body.querySelector<HTMLElement>('.script-list');
        if (!list) { this.render(); return; }
        // Grouping/sorting is presentation-only: keep each card's result block
        // (and its run history/event wiring) attached by path across the rebuild.
        const preservedAreas = this.captureResultAreas(list);
        list.innerHTML = this.scriptListHtml();
        this.restoreResultAreas(list, preservedAreas);
        this.wireScriptList(list);
        this.syncFilterBar();
        this.applyFilter();
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
        this.recordLastRun(scriptPath, error, errorType as ErrorType);
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

    /** Per-script terminal state for the details row + status tooltip (panel-local). */
    private recordLastRun(scriptPath: string, error: string, errorType: ErrorType): void {
        this.lastRun.set(scriptPath, {
            at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            state: lastRunStateFor(error, errorType),
        });
        this.syncDetailsLastRun(scriptPath);
    }

    /** Refresh one card's details "Last run" cell in place (the row is not rebuilt per result). */
    private syncDetailsLastRun(scriptPath: string): void {
        const card = document.querySelector(`.script-card[data-path="${cssEscape(scriptPath)}"]`);
        const cell = card?.querySelector<HTMLElement>('[data-details-last-run]');
        if (cell) { cell.textContent = lastRunText(this.lastRun.get(scriptPath)); }
    }

    // ── Write summary (script-write lifecycle line) ───────────────

    /** Host staged approved bytes for a script run; render the `saving` line now. */
    showWriteSummary(summary: ScriptWriteSummary): void {
        this.writeSummary = summary;
        this.syncWriteSummaryDom();
    }

    /** The correlated save succeeded (host posted savedEdits). */
    markWritesSaved(): void {
        if (this.writeSummary?.status !== 'saving') { return; }
        this.writeSummary.status = 'saved';
        this.syncWriteSummaryDom();
    }

    /** The correlated save failed (host posted scriptSaveFailed for this path). */
    markWritesFailed(scriptPath: string, message: string): void {
        const summary = this.writeSummary;
        if (!summary || summary.status !== 'saving' || summary.scriptPath !== scriptPath) { return; }
        summary.status = 'failed';
        summary.error = message;
        this.syncWriteSummaryDom();
    }

    /** Drop a script's write summary (new run consumes it; the snapshot keeps the old line). */
    private clearWriteSummaryFor(path: string): void {
        if (this.writeSummary?.scriptPath === path) { this.writeSummary = null; }
    }

    /** Re-render the summary line inside the card's latest result block, in place. */
    private syncWriteSummaryDom(): void {
        const summary = this.writeSummary;
        if (!summary) { return; }
        const card = document.querySelector(`.script-card[data-path="${cssEscape(summary.scriptPath)}"]`);
        const body = card?.querySelector<HTMLElement>('.script-output-block:not(.script-run-row) .script-output-body-wrap');
        if (!body) { return; }
        body.querySelector('.script-write-summary')?.remove();
        body.insertAdjacentHTML('afterbegin', writeSummaryHtml(summary));
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
        if (st === 'success') { dot.classList.add('ok'); (dot as HTMLElement).title = lastRunTitle('Last run succeeded', this.lastRun.get(path)); }
        else if (st === 'error') { dot.classList.add('err'); (dot as HTMLElement).title = lastRunTitle('Last run errored', this.lastRun.get(path)); }
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
        // The prior write summary is consumed with the prior result (its snapshot keeps the line).
        this.clearWriteSummaryFor(filePath);
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
        <button type="button" class="sb-btn sb-btn-secondary script-create" data-create-script
            title="Create a script from a template">Create script</button>
        <button type="button" class="sb-btn sb-btn-secondary script-browse-examples" data-browse-examples
            title="Copy selected bundled examples">Browse examples\u2026</button>
    </div>`;
        }
        const { actions, providers } = this.groupedScripts();
        const groups: string[] = [];
        if (actions.length > 0) { groups.push(this.scriptGroupHtml('actions', 'Actions', actions)); }
        if (providers.length > 0) { groups.push(this.scriptGroupHtml('providers', 'Providers', providers)); }
        return `${groups.join('')}<div class="script-no-match" hidden>No scripts match the filter</div>`;
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
        const entries = this.usageEntriesFor(s.filePath);
        return `
        <div class="script-card sb-card" data-path="${esc(s.filePath)}" data-kind="${kind}">
            <div class="script-card-info">
                ${cardLeadHtml(kind, s.filePath, this.scriptStatus, this.lastRun)}
                ${nameButtonHtml(s)}
                ${roleBadgesHtml(s.roles)}
                ${capBadgesHtml(s.capabilities)}
                ${usageChipHtml(entries)}
                ${unknownHintHtml(kind)}
                ${extBadgeHtml(s.name)}
                ${openButtonHtml(s)}
                ${runnable ? this.runButtonHtml(s) : ''}
                ${this.detailsToggleHtml(s.filePath)}
            </div>
            ${this.tsHelpHtml(s)}
            ${this.detailsHtml(s, entries)}
            ${runnable ? `<div class="script-result-area" data-path="${esc(s.filePath)}"></div>` : ''}
        </div>`;
    }

    private runButtonHtml(s: ScriptInfo): string {
        const noTrust = !this.trusted;
        const extTs = this.tsBlocked(s.name, noTrust);
        const attrs = scriptBtnAttrs(s.filePath, noTrust, extTs, this.runningPath);
        return `<button class="script-run-btn sb-btn sb-btn-primary${attrs.btnClass}" data-path="${esc(s.filePath)}" aria-label="Run script"${attrs.btnDisabled}${attrs.btnTitle}>
                    ${this.runIconHtml(s.filePath)}
                </button>`;
    }

    /** `.ts` Run is blocked only when the host reports no esbuild (legacy payloads default to blocked). */
    private tsBlocked(name: string, noTrust: boolean = !this.trusted): boolean {
        return extLabel(name) === 'ts' && !noTrust && !this.compilerAvailable;
    }

    // ── Details row (expandable; derived data, no persistence) ────

    /** Card chevron toggling the details row; session-local expanded state by path. */
    private detailsToggleHtml(path: string): string {
        const expanded = this.expandedDetails.has(path);
        return `<button type="button" class="script-details-toggle" data-details-toggle
                    aria-expanded="${expanded}" title="${expanded ? 'Hide' : 'Show'} script details"
                    aria-label="Toggle script details">&#9662;</button>`;
    }

    /** Expandable card row: roles, capabilities, used-by links, entries, fingerprint, last run, grants, actions. */
    private detailsHtml(s: ScriptInfo, entries: UsageEntry[]): string {
        const grants = activeGrantCount(this.permissionGrants, s.filePath);
        const expanded = this.expandedDetails.has(s.filePath);
        return `
        <div class="script-details" data-details${expanded ? '' : ' hidden'}>
            <div class="script-details-grid">
                <span class="script-details-label">Roles</span><span class="script-details-value">${esc(roleListText(s.roles))}</span>
                <span class="script-details-label">Capabilities</span><span class="script-details-value">${esc(capListText(s.capabilities))}</span>
                <span class="script-details-label">Used by</span><span class="script-details-value" data-details-usages>${usagesValueHtml(entries)}</span>
                <span class="script-details-label">Entries</span><span class="script-details-value">${esc(entryListText(s))}</span>
                <span class="script-details-label">Fingerprint</span><span class="script-details-value" title="${esc(s.fingerprint)}">${esc(fingerprintShort(s.fingerprint))}</span>
                <span class="script-details-label">Last run</span><span class="script-details-value" data-details-last-run>${esc(lastRunText(this.lastRun.get(s.filePath)))}</span>
                <span class="script-details-label">Active grants</span><span class="script-details-value" data-details-grants>${grants}</span>
            </div>
            <div class="script-details-actions">
                <button type="button" class="sb-btn sb-btn-secondary script-details-btn" data-details-open title="Open ${esc(s.name)}">Open</button>
                <button type="button" class="sb-btn sb-btn-secondary script-details-btn" data-details-copy title="Copy the script path">Copy path</button>
                <button type="button" class="sb-btn sb-btn-secondary script-details-btn" data-details-reveal title="Reveal in Explorer">Reveal</button>
                <button type="button" class="sb-btn sb-btn-secondary script-details-btn" data-details-manage${grants === 0 ? ' hidden' : ''}
                    title="Expand the Permissions section">Manage permissions</button>
            </div>
        </div>`;
    }

    /** Actionable TypeScript row replacing the silent disabled-Run dead end. */
    private tsHelpHtml(s: ScriptInfo): string {
        if (!this.tsBlocked(s.name)) { return ''; }
        return `
        <div class="script-ts-help">
            <span class="script-ts-note" title="The extension never bundles esbuild; TypeScript is an advanced local-dev path.">TypeScript needs esbuild, which is not bundled.</span>
            <button type="button" class="sb-btn sb-btn-secondary script-ts-btn" data-ts-guide
                title="Open the scripting guide's TypeScript section">Open setup guide</button>
            <button type="button" class="sb-btn sb-btn-secondary script-ts-btn" data-ts-convert
                title="Create a .js copy next to the script (never overwrites)">Create JavaScript version</button>
        </div>`;
    }

    private runIconHtml(path: string): string {
        const isRun = this.runningPath === path;
        const isPending = isRun && this.pendingTimer !== null;
        if (isPending) { return '<span class="script-btn-icon spin"></span>'; }
        if (isRun) { return '<span class="script-btn-icon stop">&#9632;</span>'; }
        return '<span class="script-btn-icon play">&#9654;</span>';
    }

    private wireScriptList(container: HTMLElement): void {
        container.querySelectorAll<HTMLButtonElement>('[data-browse-examples]').forEach(btn => {
            btn.addEventListener('click', () => this.cb.onBrowseExampleScripts?.());
        });
        container.querySelectorAll<HTMLButtonElement>('[data-create-script]').forEach(btn => {
            btn.addEventListener('click', () => this.cb.onCreateScript?.());
        });
        container.querySelectorAll<HTMLButtonElement>('[data-group-toggle]').forEach(btn => {
            btn.addEventListener('click', () => this.toggleGroup(btn));
        });
        container.querySelectorAll<HTMLButtonElement>('[data-open-name]').forEach(btn => {
            btn.addEventListener('click', () => this.reportPath(btn, path => this.cb.onOpenScript?.(path)));
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
        container.querySelectorAll<HTMLElement>('.script-card').forEach(card => {
            card.addEventListener('contextmenu', ev => this.onCardContextMenu(card, ev));
            card.addEventListener('keydown', ev => this.onCardKeydown(card, ev));
        });
        this.wireUsageButtons(container);
        container.querySelectorAll<HTMLButtonElement>('[data-details-toggle]').forEach(btn => {
            btn.addEventListener('click', () => this.toggleDetails(btn));
        });
        container.querySelectorAll<HTMLButtonElement>('[data-details-open]').forEach(btn => {
            btn.addEventListener('click', () => this.reportPath(btn, path => this.cb.onOpenScript?.(path)));
        });
        container.querySelectorAll<HTMLButtonElement>('[data-details-copy]').forEach(btn => {
            btn.addEventListener('click', () => this.reportPath(btn, path => this.cb.onCopyPath?.(path)));
        });
        container.querySelectorAll<HTMLButtonElement>('[data-details-reveal]').forEach(btn => {
            btn.addEventListener('click', () => this.reportPath(btn, path => this.cb.onRevealScript?.(path)));
        });
        container.querySelectorAll<HTMLButtonElement>('[data-details-manage]').forEach(btn => {
            btn.addEventListener('click', () => this.revealPermissions());
        });
        container.querySelectorAll<HTMLButtonElement>('[data-ts-guide]').forEach(btn => {
            btn.addEventListener('click', () => this.cb.onOpenScriptingGuide?.());
        });
        container.querySelectorAll<HTMLButtonElement>('[data-ts-convert]').forEach(btn => {
            btn.addEventListener('click', () => this.reportPath(btn, path => this.cb.onCreateJsVersion?.(path)));
        });
    }

    /** Run a callback with the script path of the card containing `el` (no-op when detached). */
    private reportPath(el: Element, report: (path: string) => void): void {
        const path = this.cardPath(el);
        if (path) { report(path); }
    }

    private cardPath(el: Element): string | undefined {
        return el.closest<HTMLElement>('.script-card')?.dataset.path;
    }

    /** Toggle one card's details row in place (session-local expanded state by path). */
    private toggleDetails(btn: HTMLElement): void {
        const path = this.cardPath(btn);
        const details = btn.closest<HTMLElement>('.script-card')?.querySelector<HTMLElement>('.script-details');
        if (!path || !details) { return; }
        this.setDetailsOpen(path, details.hidden !== false);
    }

    /** Open/close one card's details row in place and remember the expanded state. */
    private setDetailsOpen(path: string, open: boolean): void {
        const card = document.querySelector<HTMLElement>(`.script-card[data-path="${cssEscape(path)}"]`);
        const details = card?.querySelector<HTMLElement>('.script-details');
        const toggle = card?.querySelector<HTMLElement>('[data-details-toggle]');
        if (details) { details.hidden = !open; }
        if (toggle) {
            toggle.setAttribute('aria-expanded', String(open));
            toggle.title = `${open ? 'Hide' : 'Show'} script details`;
        }
        this.rememberDetailsOpen(path, open);
    }

    private rememberDetailsOpen(path: string, open: boolean): void {
        if (open) { this.expandedDetails.add(path); return; }
        this.expandedDetails.delete(path);
    }

    // ── Card context menu (shared MenuController; report-only commands) ──

    /** Right-click entry point: open the card menu at the pointer. */
    private onCardContextMenu(card: HTMLElement, ev: Event): void {
        ev.preventDefault();
        const mouse = ev as MouseEvent;
        this.openCardMenu(card, mouse.clientX, mouse.clientY);
    }

    /** Shift+F10 / ContextMenu opens the same menu at the card's corner (grid convention). */
    private onCardKeydown(card: HTMLElement, ev: Event): void {
        const key = ev as KeyboardEvent;
        if (!isCardMenuKey(key)) { return; }
        ev.preventDefault();
        const [x, y] = cardMenuAnchor(card);
        this.openCardMenu(card, x, y);
    }

    /** Card context menu: Open, Copy path, Reveal in Explorer, Show details, Manage permissions, Delete. */
    private openCardMenu(card: HTMLElement, x: number, y: number): void {
        const path = card.dataset.path;
        if (!path) { return; }
        menuController.show(x, y, {
            innerHTML: this.cardMenuHtml(path),
            emit: cmd => this.runCardMenuCommand(path, cmd),
        });
    }

    private cardMenuHtml(path: string): string {
        const manage = this.manageMenuRowHtml(path);
        return [
            menuRowHtml('script-open', 'Open'),
            menuRowHtml('script-copy', 'Copy path'),
            menuRowHtml('script-reveal', 'Reveal in Explorer'),
            menuSeparatorHtml(),
            menuRowHtml('script-details', 'Show details'),
            menuSeparatorHtml(),
            manage,
            menuSeparatorHtml(),
            menuRowHtml('script-delete', 'Delete'),
        ].join('');
    }

    /** Manage permissions is a disabled row until the card has an active grant. */
    private manageMenuRowHtml(path: string): string {
        if (activeGrantCount(this.permissionGrants, path) > 0) {
            return menuRowHtml('script-permissions', 'Manage permissions');
        }
        return disabledMenuRowHtml('Manage permissions', 'No active grants');
    }

    private runCardMenuCommand(path: string, cmd: string): void {
        if (this.reportCardMenuCommand(path, cmd)) { return; }
        this.runCardMenuLocalCommand(path, cmd);
    }

    /** Host-reported commands (Open/Copy/Reveal); false when the command is panel-local. */
    private reportCardMenuCommand(path: string, cmd: string): boolean {
        const report = CARD_MENU_REPORTS.get(cmd);
        if (!report) { return false; }
        report(this.cb, path);
        return true;
    }

    /** Panel-local commands: Show details (expand the row) and Manage permissions. */
    private runCardMenuLocalCommand(path: string, cmd: string): void {
        if (cmd === 'script-details') { this.setDetailsOpen(path, true); return; }
        if (cmd === 'script-permissions') { this.revealPermissions(); }
    }

    /** Expand the Permissions section and bring it into view (details action). */
    private revealPermissions(): void {
        const section = this._panel?.querySelector<HTMLElement>('.script-perms-section');
        if (!section) { return; }
        if (!section.classList.contains('expanded')) {
            section.classList.add('expanded');
            this.permissionsExpanded = true;
            section.querySelector<HTMLElement>('[data-perms-manage]')?.setAttribute('aria-expanded', 'true');
        }
        if (typeof section.scrollIntoView === 'function') { section.scrollIntoView(); }
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
        <div class="script-output-body-wrap">${this.errorBlockHtml(err)}${this.resultsBlockHtml(results)}${this.writesNoticeHtml(scriptPath, pendingWriteCount, discardedWriteCount)}<div class="script-output-log">${logHtml}</div></div></div>`;
    }

    /** The write summary owns the outcome when approved bytes were staged; otherwise the plain notice. */
    private writesNoticeHtml(scriptPath: string, pendingWriteCount: number, discardedWriteCount: number): string {
        const summary = this.writeSummary;
        if (summary?.scriptPath === scriptPath) { return writeSummaryHtml(summary); }
        return writesBlockHtml(pendingWriteCount, discardedWriteCount);
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
        this.clearWriteSummaryFor(path);
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
        this.syncDetailsGrants();
        const sectionHtml = this.permissionsHtml();
        if (!sectionHtml) { return; }
        const list = body.querySelector('.script-list');
        if (!list) { return; }
        list.insertAdjacentHTML('beforebegin', sectionHtml);
        this.wirePermissions(body);
    }

    /** Details rows derived from host-pushed grants: per-card count + the manage action. */
    private syncDetailsGrants(): void {
        this._panel?.querySelectorAll<HTMLElement>('.script-card').forEach(card => {
            const path = card.dataset.path;
            if (!path) { return; }
            const count = activeGrantCount(this.permissionGrants, path);
            const cell = card.querySelector<HTMLElement>('[data-details-grants]');
            if (cell) { cell.textContent = String(count); }
            const manage = card.querySelector<HTMLElement>('[data-details-manage]');
            if (manage) { manage.hidden = count === 0; }
        });
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
function statusDotHtml(status: ScriptStatus, lastRun: LastRunRecord | undefined): string {
    if (status === 'success') { return `<span class="sb-status-dot ok" title="${esc(lastRunTitle('Last run succeeded', lastRun))}"></span>`; }
    if (status === 'error') { return `<span class="sb-status-dot err" title="${esc(lastRunTitle('Last run errored', lastRun))}"></span>`; }
    return '<span class="sb-status-dot idle" title="Not yet run"></span>';
}

/** Status tooltip with the last run time when one was recorded. */
function lastRunTitle(base: string, lastRun: LastRunRecord | undefined): string {
    return lastRun ? `${base} \u00b7 ${lastRun.at}` : base;
}

/** Leading card marker: run status for runnable cards, a warning for unknown exports. */
function cardLeadHtml(
    kind: ScriptKind, path: string, statuses: ReadonlyMap<string, ScriptStatus>,
    lastRuns: ReadonlyMap<string, LastRunRecord>,
): string {
    if (kind === 'unknown') {
        return '<span class="script-warn" title="No run export detected" aria-hidden="true">&#9888;</span>';
    }
    return isRunnableKind(kind) ? statusDotHtml(statuses.get(path) ?? null, lastRuns.get(path)) : '';
}

function openButtonHtml(s: ScriptInfo): string {
    return `<button class="script-open-btn sb-btn sb-btn-secondary" data-path="${esc(s.filePath)}"
                    title="Open ${esc(s.name)}" aria-label="Open ${esc(s.name)}">&#9998;</button>`;
}

/** The script name is the primary open affordance (the pencil stays as a secondary one). */
function nameButtonHtml(s: ScriptInfo): string {
    return `<button type="button" class="script-name" data-open-name title="${esc(s.filePath)}"
                    aria-label="Open ${esc(s.name)}">${esc(s.name)}</button>`;
}

/** Card-level used-by count chip; the details row carries the clickable labels. */
function usageChipHtml(entries: UsageEntry[]): string {
    const count = entries.length;
    const title = count > 0 ? ` title="${esc(usageListTitle(entries))}"` : '';
    return `<span class="script-usage-chip" data-usage-chip${count > 0 ? '' : ' hidden'}${title}>${count > 0 ? `Used by ${count}` : ''}</span>`;
}

/** Details cell content: one clickable link per usage, or `None`. */
function usagesValueHtml(entries: UsageEntry[]): string {
    if (entries.length === 0) { return 'None'; }
    return entries.map(usageButtonHtml).join('');
}

function usageButtonHtml(entry: UsageEntry): string {
    const kind = usageKindLabel(entry.usage.kind);
    return `<button type="button" class="script-usage-link" data-usage-idx="${entry.index}"
                    title="${esc(`${kind}: ${entry.usage.label}`)}">${esc(entry.usage.label)}<span class="script-usage-kind">${esc(kind)}</span></button>`;
}

/** Tooltip line for the card chip: one `kind: label` pair per usage. */
function usageListTitle(entries: UsageEntry[]): string {
    return entries.map(entry => `${usageKindLabel(entry.usage.kind)}: ${entry.usage.label}`).join('; ');
}

/** Job-language label for a usage kind (shares the role vocabulary). */
function usageKindLabel(kind: ScriptUsageKind): string {
    return roleLabel(kind);
}

/** Card-menu commands that report through a host callback (path = the acted-on script). */
const CARD_MENU_REPORTS = new Map<string, (cb: ScriptsCallbacks, path: string) => void>([
    ['script-open', (cb, path) => cb.onOpenScript?.(path)],
    ['script-copy', (cb, path) => cb.onCopyPath?.(path)],
    ['script-reveal', (cb, path) => cb.onRevealScript?.(path)],
    ['script-delete', (cb, path) => cb.onDeleteScript?.(path)],
]);

/** Shift+F10 / ContextMenu opens a card menu (matches the hex grid convention). */
function isCardMenuKey(ev: KeyboardEvent): boolean {
    return ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10');
}

/** Anchor for the keyboard-opened card menu: the card's bottom-left corner (+8px). */
function cardMenuAnchor(card: HTMLElement): [number, number] {
    const rect = cardMenuRect(card);
    return rect ? [rect.left + 8, rect.bottom] : [8, 0];
}

/** Card viewport rect (guarded: jsdom has no layout engine). */
function cardMenuRect(card: HTMLElement): DOMRect | null {
    return typeof card.getBoundingClientRect === 'function' ? card.getBoundingClientRect() : null;
}

function menuRowHtml(cmd: string, label: string): string {
    return `<div class="menu-item" data-cmd="${cmd}" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${esc(label)}</span></div>`;
}

function disabledMenuRowHtml(label: string, hint: string): string {
    return `<div class="menu-item menu-disabled" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${esc(label)}</span><span class="menu-hint">${esc(hint)}</span></div>`;
}

function menuSeparatorHtml(): string {
    return '<div class="menu-sep"></div>';
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

/** Terminal states that keep their own label; any other error reports the generic `error`. */
const TERMINAL_RUN_STATES: ReadonlySet<string> = new Set(['timeout', 'cancel', 'contract']);

/** Terminal state for the details row + status tooltip (panel-local). */
function lastRunStateFor(error: string, errorType: ErrorType): LastRunState {
    if (!error) { return 'success'; }
    const type = errorType ?? '';
    return TERMINAL_RUN_STATES.has(type) ? type as LastRunState : 'error';
}

function lastRunText(lastRun: LastRunRecord | undefined): string {
    return lastRun ? `${lastRun.at} · ${LAST_RUN_LABELS[lastRun.state]}` : 'Not run yet';
}

/** Job-language role list for the details row. */
function roleListText(roles: ScriptInfo['roles'] | undefined): string {
    return roles && roles.length > 0 ? roles.map(roleLabel).join(', ') : 'None';
}

function capListText(capabilities: string[]): string {
    return capabilities.length > 0 ? capabilities.join(', ') : 'None';
}

/** Role → runner entries for the details row; unknown roles contribute nothing. */
const ROLE_ENTRIES: Record<string, readonly string[]> = {
    address: ['getAddress'],
    size: ['getSize'],
    integrity: ['getIntegrityValue', 'verifyIntegrity'],
};

/** Entries the runner invokes for this script, derived from the same scan metadata the card sorts by. */
function entriesFor(s: ScriptInfo): string[] {
    const runEntry = hasRunEntry(s) ? ['run'] : [];
    return [...runEntry, ...(s.roles ?? []).flatMap(roleEntries)];
}

function roleEntries(role: string): readonly string[] {
    return ROLE_ENTRIES[role] ?? [];
}

function entryListText(s: ScriptInfo): string {
    const entries = entriesFor(s);
    return entries.length > 0 ? entries.join(', ') : 'None detected';
}

/** Short fingerprint for the details row; the full value stays in the title. */
function fingerprintShort(fingerprint: string): string {
    if (!fingerprint) { return 'Unknown'; }
    return fingerprint.length > 8 ? `${fingerprint.slice(0, 8)}\u2026` : fingerprint;
}

/** Grants affecting one script: its own rows plus every session-wide grant. */
function activeGrantCount(grants: ScriptGrantView[], scriptPath: string): number {
    return grants.filter(grant => grant.scope === 'session' || grant.scriptPath === scriptPath).length;
}

function matchesQuery(s: ScriptInfo, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) { return true; }
    return s.name.toLowerCase().includes(q) || s.filePath.toLowerCase().includes(q);
}

/** `actions` also covers both-kind and unknown cards — they live in the Actions group. */
function matchesKind(s: ScriptInfo, filter: KindFilter): boolean {
    if (filter === 'all') { return true; }
    const isProvider = scriptKind(s) === 'provider';
    return filter === 'providers' ? isProvider : !isProvider;
}

function hexByte(value: number): string {
    return value.toString(16).toUpperCase().padStart(2, '0');
}

/** Mapped writes as a range: first address, last address, byte count. */
function writeRangeText(writes: Array<[number, number]>): { start: number; end: number; count: number } {
    let start = Number.MAX_SAFE_INTEGER;
    let end = -1;
    for (const [addr] of writes) {
        start = Math.min(start, addr);
        end = Math.max(end, addr);
    }
    return { start, end, count: writes.length };
}

function hexAddress(addr: number): string {
    return `0x${addr.toString(16)}`;
}

function addrRangeText(range: { start: number; end: number }): string {
    const start = hexAddress(range.start);
    return range.start === range.end ? start : `${start}\u2013${hexAddress(range.end)}`;
}

/** Before/after byte preview: full pairs when short, first/last byte when long. */
function bytePreview(values: Array<[number, number]>): string {
    const sorted = [...values].sort((a, b) => a[0] - b[0]);
    if (sorted.length === 0) { return 'none'; }
    if (sorted.length > WRITE_PREVIEW_MAX) {
        return `${hexByte(sorted[0][1])} \u2026 ${hexByte(sorted[sorted.length - 1][1])}`;
    }
    return sorted.map(pair => hexByte(pair[1])).join(' ');
}

/** One compact line for the write lifecycle: range, bytes, before/after, and the undo path. */
function writeSummaryHtml(summary: ScriptWriteSummary): string {
    if (summary.status === 'failed') { return failedWriteSummaryHtml(summary); }
    return activeWriteSummaryHtml(summary);
}

/** Failed save: distinct from `saving`, names the reason, and never promises undo. */
function failedWriteSummaryHtml(summary: ScriptWriteSummary): string {
    const reason = summary.error ? `: ${esc(summary.error)}` : '';
    return `<div class="script-write-summary script-write-summary-failed" data-path="${esc(summary.scriptPath)}">&#128190; Write of ${writeRangeSentence(summary)} failed &mdash; nothing was saved${reason}</div>`;
}

/** Saving/saved line: byte preview plus the Ctrl+Z guidance once the save lands. */
function activeWriteSummaryHtml(summary: ScriptWriteSummary): string {
    const saved = summary.status === 'saved';
    const verb = saved ? 'Saved' : 'Saving';
    const undo = saved ? ' &middot; Ctrl+Z to undo' : '';
    return `<div class="script-write-summary script-write-summary-${summary.status}" data-path="${esc(summary.scriptPath)}">&#128190; ${verb} ${writeRangeSentence(summary)} &middot; before ${esc(bytePreview(summary.before))} &middot; after ${esc(bytePreview(summary.writes))}${undo}</div>`;
}

function writeRangeSentence(summary: ScriptWriteSummary): string {
    const range = writeRangeText(summary.writes);
    return `${range.count} byte(s) at ${esc(addrRangeText(range))}`;
}
