/** Integrity Overlay — UI layer. Self-contained Integrity sidebar panel.
Owns the check list (add/edit/delete, algorithm selection, address/stored-value
inputs, auto-fix toggle), per-check result display (calculated/stored
comparison, copy), and the Fix-all action. Data is pushed via setters; byte
reads go through the injected readByte accessor; actions report via callbacks.
This module never imports the S global, never posts provider messages, and
never touches the render registry. Pure model helpers live in
integrityCheckModel.ts; result markup in integrityResultRender.ts, calculation
scheduling in integrityCalculation.ts, and range/stored highlight derivation
in integrityHighlight.ts. */

import {
    formatIntegrityAddress,
    integrityBytesToHex,
    integrityScriptName,
    mergeIntegrityEdits,
    normalizeIntegrityCheckSet,
    parseIntegrityAddress,
    validateIntegrityAddressRange,
    type IntegrityAlgorithm,
    type IntegrityCheckConfig,
    type IntegrityCheckKind,
    type IntegrityCheckSet,
    type IntegrityValidation,
} from '../../../../core/integrity';
import type { ScriptInfo, ScriptRole } from '../../../../core/scripting/types';
import { esc, flashCopied } from '../../../utils';
import { showToast } from '../../toast';
import {
    applyIntegrityDraft,
    blankIntegrityDraft,
    clearIntegrityAutoFixSuppression,
    integrityCheckSetFromStates,
    makeIntegrityCheck,
    type IntegrityCheckState,
    type IntegrityDraft,
    type StoredValueUpdate,
} from './integrityCheckModel';
import {
    ALGORITHM_LABELS,
    calculatedCopyLabel,
    calculatedCopyValue,
    checkCardBodyHtml,
    checkCardClass,
    checkCardHtml,
    checkStatusClass,
    checkStatusLabel,
    checkTitle,
    isMismatchedCheck,
    resultBodyHtml,
    type IntegrityResultRenderDeps,
} from './integrityResultRender';
import {
    applyIntegrityScriptError,
    applyIntegrityScriptResult,
    cancelPendingCalculation,
    scheduleIntegrityCalculation,
    type IntegrityCalculationHooks,
    type IntegrityScriptOutcome,
    type IntegrityScriptRunPayload,
} from './integrityCalculation';
import {
    clearHighlight,
    storedValueUpdate,
    syncHighlight,
    type IntegrityHighlightHooks,
} from './integrityHighlight';
import { SidebarSections } from '../sidebar';
import './integrityPanel.css';

const EMPTY_INTEGRITY_CHECK_SET: IntegrityCheckSet = { schemaVersion: 1, checks: [] };
const INTEGRITY_STATUS_SYMBOLS: Record<string, string> = {
    Match: '✓', Mismatch: '✕', Verified: '✓', Failed: '✕', Stale: '↻',
    Calculated: '∑', Calculating: '…', Error: '!', 'Not configured': '–',
};

type DraftValidation = { ok: true; value: IntegrityDraft } | { ok: false; error: string };
type StoredDraftValidation = { ok: true; value: string } | { ok: false; error: string };

/** A host response applies only to the check still waiting on that request id. */
function isCurrentScriptRequest(
    check: IntegrityCheckState | undefined,
    msg: IntegrityScriptResultMessage,
): check is IntegrityCheckState {
    if (!check) { return false; }
    return check.requestId === msg.requestId;
}

/** A discarded-edit refresh pauses auto-fix only when a stored field could be rewritten. */
function suppressesAutoFix(check: IntegrityCheckState): boolean {
    return check.autoFixStoredValue && Boolean(check.storedRaw);
}

/** A script check with a usable path (the only kind with an open-script action). */
function isScriptCheck(check: IntegrityCheckState): boolean {
    return check.kind === 'script' && Boolean(check.scriptPath);
}

/** Draft kind from the form's algorithm select (the `script` sentinel selects script mode). */
function selectedKind(form: HTMLElement): IntegrityCheckKind {
    return draftAlgorithmValue(form) === 'script' ? 'script' : 'builtin';
}

/** Built-in algorithm from the form select; script mode keeps the default. */
function selectedAlgorithm(form: HTMLElement, kind: IntegrityCheckKind): IntegrityAlgorithm {
    return (kind === 'builtin' ? draftAlgorithmValue(form) : 'crc32-iso-hdlc') as IntegrityAlgorithm;
}

function draftAlgorithmValue(form: HTMLElement): string {
    return form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')!.value;
}

/** Trimmed script-path input; empty when the control is absent. */
function scriptPathValue(form: HTMLElement): string {
    const input = form.querySelector<HTMLInputElement>('[data-draft-control="scriptPath"]');
    return input ? input.value.trim() : '';
}

/** Kind-specific identity half of the auto-fix mismatch key. */
function checkIdentityValue(check: IntegrityCheckState): string {
    return check.kind === 'builtin' ? check.algorithm : check.scriptPath;
}

export interface IntegrityHighlight {
    rangeStart: number;
    rangeEnd: number;
    storedStart?: number;
    storedLength?: number;
    status: 'match' | 'mismatch' | 'unverified';
}

/** One discovered script offered by the add/edit form's script picker. */
type IntegrityScriptOption = Pick<ScriptInfo, 'name' | 'roles'> & { relativePath: string };

/** One configured script check exposed to the host for used-by derivation. */
export interface IntegrityScriptUsageRef {
    /** Runtime check id (assigned by the panel); `selectCheck` takes it back. */
    checkId: number;
    /** Authored (workspace-relative) script path; kept even when no scan resolves it. */
    scriptPath: string;
    /** Card title: custom check name, else the script file name. */
    label: string;
}

/** Host request for one script check run (the panel owns the ids). */
export interface IntegrityScriptRunRequest extends IntegrityScriptRunPayload {
    requestId: number;
    checkId: number;
}

/** Host result pushed back for a script check run. */
export interface IntegrityScriptResultMessage {
    requestId: number;
    checkId: number;
    generation: number;
    result?: IntegrityScriptOutcome;
    error?: string;
}

export interface IntegrityCallbacks {
    /** Required — host memory adapter for byte reads (keeps memory access host-owned). */
    readByte: (addr: number) => number | undefined;
    /** Auto-fix: write calculated bytes to a stored field → host stages an edit transaction. */
    onStoredValueEdits?: (edits: Array<[number, number]>) => void;
    /** Selection snapshot for the add-check form defaults (was S.selStart/S.selEnd). */
    getSelection?: () => { start: number; end: number } | null;
    /** Full-file mapped range for add-check defaults when no selection (null when unmappable/empty). */
    getDataRange?: () => { start: number; end: number } | null;
    /** Shared byte-order source (was S.endian). */
    getEndian?: () => 'le' | 'be';
    /** Copy button → host posts copyText. */
    onCopyText?: (text: string, label: string) => void;
    /** Checks persistence → host posts saveIntegrityChecks. */
    onPersistChecks?: (state: IntegrityCheckSet) => void;
    /** Highlight of a check range/stored field → host sets S.integrityHighlight + rerender.memory(). */
    onHighlightChange?: (highlight: IntegrityHighlight | null) => void;
    /** Script check run → host posts runIntegrityScript. */
    onScriptCheckRequest?: (request: IntegrityScriptRunRequest) => void;
    /** Open-script action → host opens the file in the normal editor. */
    onOpenScript?: (scriptPath: string) => void;
    /** Script picker discovery → host posts requestScriptList. */
    onRequestScriptList?: () => void;
    /** Empty script picker → host creates the role template. */
    onCreateScript?: (role: ScriptRole) => void;
    /** Empty script picker → host reveals `.hexscope/scripts`. */
    onOpenScriptsFolder?: () => void;
    /** Pending edits (same shape as saveEdits) for a host script run. */
    getPendingEdits?: () => Array<[number, number]>;
    /** Document generation; stale script responses are discarded and re-requested. */
    getGeneration?: () => number;
}

export class IntegrityPanel {
    readonly cb: IntegrityCallbacks;
    private _panel: HTMLElement | null = null;
    private sections: SidebarSections | null = null;
    private nextCheckId = 1;
    private nextScriptRequestId = 1;
    private actionError = '';
    addCheckDraft: IntegrityDraft | null = null;
    editingCheckId: number | null = null;
    /** Last-focused address field in the open add/edit form (drives hex-selection refill). */
    private formLastFocused: 'start' | 'end' | null = null;
    private highlightedCheckId: number | null = null;
    private initialized = false;
    private availableScripts: IntegrityScriptOption[] = [];
    private scriptsTrusted = true;
    checks: IntegrityCheckState[] = [];

    constructor(cb: IntegrityCallbacks) {
        this.cb = cb;
    }

    /** Renders the panel into the given root (creates the #s-integrity container). Idempotent. */
    mount(root: HTMLElement): void {
        this._panel = root.id === 's-integrity' ? root : this.ensureIntegrityRoot(root);
        this._panel.innerHTML = '';
        this.sections = new SidebarSections(this._panel, 'integrity', [
            { id: 'main', label: 'Integrity Checks', mountActions: r => this.mountAddCheckAction(r) },
        ]);
        this.render();
    }

    private ensureIntegrityRoot(root: HTMLElement): HTMLElement {
        const existing = root.querySelector<HTMLElement>('#s-integrity');
        if (existing) { return existing; }
        const div = document.createElement('div');
        div.id = 's-integrity';
        root.appendChild(div);
        return div;
    }

    /** Re-renders the whole panel body (was renderIntegrity). No-op until mounted. */
    render(): void {
        const body = this.sections?.body('main');
        if (!body) { return; }
        body.innerHTML = this.integrityBodyHtml();
        this.wireRenderedIntegrity(body);
        this.syncAddButton();
    }

    /** Header add action state: disabled while the add form is open (listener stays mounted once). */
    private syncAddButton(): void {
        const add = this._panel?.querySelector<HTMLButtonElement>('#integrity-add-btn');
        if (!add) { return; }
        add.disabled = this.addCheckDraft !== null;
    }

    /** Integrity Checks header action: the single add entry point (reachable while collapsed). */
    private mountAddCheckAction(root: HTMLElement): void {
        const add = document.createElement('button');
        add.id = 'integrity-add-btn';
        add.className = 'sb-btn sb-btn-add sb-section-action';
        add.textContent = '\uff0b Add';
        add.title = 'Add check';
        add.setAttribute('aria-label', 'Add check');
        add.addEventListener('click', () => {
            this.sections?.setCollapsed('main', false);
            this.addCheckDraft = this.addDraft();
            this.editingCheckId = null;
            this.formLastFocused = null;
            this.render();
            document.querySelector<HTMLInputElement>('[data-integrity-form="add"] [data-draft-control="start"]')?.focus();
        });
        root.appendChild(add);
    }

    /** Push active checks (was setIntegrityChecks). */
    setChecks(value: unknown): void {
        const saved = this.normalizedIntegrityCheckSet(value);
        this.cancelCalculations();
        this.checks = saved.checks.map(check => this.newCheck(check));
        this.addCheckDraft = null;
        this.editingCheckId = null;
        this.highlightedCheckId = null;
        this.clearHighlight();
        if (this.initialized) { this.render(); }
    }

    /**
     * Byte change → built-ins recalculate; script results are marked stale
     * instead of re-run (run scripts stay explicit: activation/open/save/refresh).
     */
    notifyBytesChanged(): void {
        if (!this.initialized) { return; }
        for (const check of this.checks) {
            if (check.kind === 'script') { this.markScriptStale(check); }
            else { this.scheduleIntegrityCalculation(check, true); }
        }
        this.syncHighlight();
    }

    /** Recalculate after pending edits were discarded (was notifyIntegrityEditsDiscarded). */
    notifyEditsDiscarded(): void {
        if (!this.initialized) { return; }
        for (const check of this.checks) {
            this.refreshAfterEditsDiscarded(check);
        }
        this.syncHighlight();
    }

    private refreshAfterEditsDiscarded(check: IntegrityCheckState): void {
        if (check.kind === 'script') { this.markScriptStale(check); return; }
        check.suppressAutoFixOnNextResult = suppressesAutoFix(check);
        this.scheduleIntegrityCalculation(check, true);
    }

    /** Re-decode results for the new shared byte order (was notifyIntegrityEndianChanged). */
    notifyEndianChanged(): void {
        this.checks.forEach(check => this.clearAutoFixSuppression(check));
        this.render();
        this.checks.forEach(check => {
            if (check.kind === 'builtin') { this.scheduleIntegrityCalculation(check, true); }
        });
    }

    /** Document saved → script checks re-run against the now-saved bytes. */
    notifyDocumentSaved(): void {
        if (!this.initialized) { return; }
        for (const check of this.checks) {
            if (check.kind === 'script') { this.scheduleIntegrityCalculation(check, true); }
        }
    }

    /** Fresh document (init) → re-run every check against the new bytes. */
    notifyDocumentOpened(): void {
        if (!this.initialized) { return; }
        this.render();
        this.checks.forEach(check => this.scheduleIntegrityCalculation(check));
    }

    /** Host pushes the active sidebar tab (lazy-init gate was activateIntegrity). */
    setTabActive(active: boolean): void {
        if (!active || this.initialized) { return; }
        this.initialized = true;
        this.cb.onRequestScriptList?.();
        this.render();
        this.checks.forEach(check => this.scheduleIntegrityCalculation(check));
    }

    /** Host pushes the discovered script list (from the shared requestScriptList scan). */
    setAvailableScripts(
        scripts: ReadonlyArray<Pick<ScriptInfo, 'name' | 'roles'> & { relativePath?: string }>,
        trusted: boolean,
    ): void {
        this.scriptsTrusted = trusted;
        this.availableScripts = scripts
            .filter(script => script.roles.includes('integrity'))
            .map(script => ({
                name: script.name,
                relativePath: script.relativePath ?? script.name,
                roles: script.roles,
            }));
        if (this.addCheckDraft || this.editingCheckId !== null) { this.render(); }
    }

    /** Host pushes a completed script check run. */
    acceptScriptResult(msg: IntegrityScriptResultMessage): void {
        const check = this.checks.find(item => item.id === msg.checkId);
        if (!isCurrentScriptRequest(check, msg)) { return; }
        check.requestId = 0;
        if (this.isStaleGeneration(msg)) {
            this.scheduleIntegrityCalculation(check, true);
            return;
        }
        this.applyScriptMessage(check, msg);
    }

    /** Apply one host script message; failures and missing results settle as errors. */
    private applyScriptMessage(check: IntegrityCheckState, msg: IntegrityScriptResultMessage): void {
        const hooks = this.calcHooks();
        if (msg.error) { applyIntegrityScriptError(check, check.token, msg.error, hooks); return; }
        if (!msg.result) { applyIntegrityScriptError(check, check.token, 'Script returned no result.', hooks); return; }
        applyIntegrityScriptResult(check, check.token, msg.result, hooks);
    }

    /** A result for an older document generation is stale; refresh instead of applying. */
    private isStaleGeneration(msg: IntegrityScriptResultMessage): boolean {
        return msg.generation !== (this.cb.getGeneration?.() ?? 0);
    }

    /** Byte change while a script run is in flight: drop it and mark the row stale. */
    private markScriptStale(check: IntegrityCheckState): void {
        if (check.calculating) {
            check.token++;
            check.requestId = 0;
            check.calculating = false;
        }
        if (check.result || check.error) { check.stale = true; }
        this.updateCheckCard(check);
    }

    // ── Host used-by links (Scripts panel) ─────────────────────────

    /** Every configured script check with its runtime id (host derives used-by links from these). */
    scriptUsages(): IntegrityScriptUsageRef[] {
        return this.checks
            .filter(check => check.kind === 'script' && check.scriptPath.trim() !== '')
            .map(check => ({ checkId: check.id, scriptPath: check.scriptPath.trim(), label: checkTitle(check) }));
    }

    /** Host used-by link: highlight one check and reveal its card (scrolls it into view). */
    selectCheck(id: number): void {
        if (!this.checks.some(check => check.id === id)) { return; }
        this.highlightedCheckId = id;
        this.render();
        this.syncHighlight();
        this.scrollCheckCardIntoView(id);
    }

    private scrollCheckCardIntoView(id: number): void {
        const card = this._panel?.querySelector<HTMLElement>(`.integrity-card[data-check-id="${id}"]`);
        if (card && typeof card.scrollIntoView === 'function') { card.scrollIntoView({ block: 'nearest' }); }
    }

    // ── Shared byte-order source ───────────────────────────────────

    private endian(): 'le' | 'be' {
        return this.cb.getEndian?.() ?? 'le';
    }

    // ── Check state helpers ────────────────────────────────────────

    newCheck(config?: IntegrityCheckConfig): IntegrityCheckState {
        return makeIntegrityCheck(this.nextCheckId++, config);
    }

    private addDraft(): IntegrityDraft {
        const draft = blankIntegrityDraft();
        const selection = this.selectionSnapshot();
        if (selection) { return this.draftWithRange(draft, selection.start, selection.end); }
        const range = this.dataRangeSnapshot();
        if (range) { this.draftWithRange(draft, range.start, range.end); }
        return draft;
    }

    private selectionSnapshot(): { start: number; end: number } | null {
        return this.cb.getSelection?.() ?? null;
    }

    private dataRangeSnapshot(): { start: number; end: number } | null {
        return this.cb.getDataRange?.() ?? null;
    }

    private draftWithRange(draft: IntegrityDraft, start: number, end: number): IntegrityDraft {
        draft.startRaw = formatIntegrityAddress(start);
        draft.endRaw = formatIntegrityAddress(end);
        return draft;
    }

    private normalizedIntegrityCheckSet(value: unknown): IntegrityCheckSet {
        return normalizeIntegrityCheckSet(value) ?? EMPTY_INTEGRITY_CHECK_SET;
    }

    private cancelCalculations(): void {
        this.checks.forEach(check => this.cancelPendingCalculation(check));
    }

    /** Persist the current checks into the bound file profile via saveIntegrityChecks. */
    private persistChecks(): void {
        const state = integrityCheckSetFromStates(this.checks);
        if (state.ok) { this.cb.onPersistChecks?.(state.value); }
    }

    // ── Shell render ───────────────────────────────────────────────

    private integrityBodyHtml(): string {
        return `
        <div class="integrity-shell">
            <div class="integrity-hdr-row">
                <div class="integrity-hdr-actions">
                    <button id="integrity-fix-all" class="sb-btn sb-btn-primary" type="button"${this.fixAllDisabledAttr()}>Fix all</button>
                </div>
            </div>
            <div id="integrity-action-error" class="integrity-error" role="alert">${esc(this.actionError)}</div>
            ${this.addCheckFormHtml()}
            <div id="integrity-check-list">${this.checkCardsHtml()}</div>
        </div>`;
    }

    private fixAllDisabledAttr(): string {
        return this.hasFixableMismatches() ? '' : ' disabled';
    }

    private wireRenderedIntegrity(panel: HTMLElement): void {
        this.wireBodyControls();
        if (this.addCheckDraft) { this.wireCheckForm('add'); }
        this.wireCheckCards(panel);
        this.checks.forEach(check => this.updateCheckCard(check));
    }

    private addCheckFormHtml(): string {
        return this.addCheckDraft ? this.checkFormHtml('add', this.addCheckDraft) : '';
    }

    private checkCardsHtml(): string {
        if (this.checks.length === 0) {
            return '<div class="sb-empty integrity-empty">No integrity checks configured.</div>';
        }
        return this.checks.map(check => checkCardHtml(
            check,
            checkCardClass(check.id, this.highlightedCheckId),
            checkCardBodyHtml(check, this.editingCheckId, c => this.checkFormHtml(`edit-${c.id}`, this.draftFromCheck(c))),
        )).join('');
    }

    private checkFormHtml(formId: string, draft: IntegrityDraft): string {
        const presentation = this.checkFormPresentation(formId);
        return `
        <div class="integrity-check-form ${presentation.formClass}" data-integrity-form="${formId}">
            <div class="integrity-form-hdr ${presentation.headerClass}">${presentation.title}</div>
            <label class="integrity-form-field"><span>Check name (optional)</span>
                <input data-draft-control="name" class="sb-input" type="text" maxlength="40"
                    placeholder="e.g. Flash checksum" value="${esc(draft.name)}" autocomplete="off" spellcheck="false">
            </label>
            <label class="integrity-form-field"><span>Algorithm</span>
                <select data-draft-control="algorithm" class="sb-select">${this.algorithmOptionsHtml(draft)}</select>
            </label>
            ${this.scriptFieldHtml(draft)}
            <div class="integrity-form-grid">
                ${this.addressInputHtml('Start address', 'start', draft.startRaw, '08000000')}
                ${this.addressInputHtml('End address (inclusive)', 'end', draft.endRaw, '080000FF')}
            </div>
            <div data-stored-field>
                ${this.addressInputHtml('Stored value address (optional)', 'stored', draft.storedRaw, '08000100')}
            </div>
            <div class="integrity-form-error" data-form-error></div>
            <div class="integrity-form-actions">
                <button class="sb-btn sb-btn-primary" data-form-action="save">${presentation.saveLabel}</button>
                <button class="sb-btn sb-btn-secondary" data-form-action="cancel">Cancel</button>
            </div>
        </div>`;
    }

    /** Script picker + fallback path input, shown when the kind select is `script`. */
    private scriptFieldHtml(draft: IntegrityDraft): string {
        const isScript = draft.kind === 'script';
        return `
            <div class="integrity-script-field" data-script-field${isScript ? '' : ' hidden'}>
                <label class="integrity-form-field"><span>Integrity script</span>
                    <select data-draft-control="script-pick" class="sb-select">${this.scriptOptionsHtml(draft.scriptPath)}</select>
                </label>
                <label class="integrity-form-field"><span>Script path (relative to workspace)</span>
                    <input data-draft-control="scriptPath" class="sb-input" type="text"
                        placeholder=".hexscope/scripts/verify-integrity.js" value="${esc(draft.scriptPath)}"
                        autocomplete="off" spellcheck="false">
                </label>
                ${this.scriptEmptyActionsHtml()}
                <div class="integrity-script-hint">${this.scriptPickerHint()}</div>
            </div>`;
    }

    /** Empty picker: a real create action and the folder reveal instead of a dead option. */
    private scriptEmptyActionsHtml(): string {
        if (this.availableScripts.length > 0) { return ''; }
        return `
                <div class="integrity-script-empty-actions">
                    <button type="button" class="sb-btn sb-btn-add integrity-create-script" data-create-script="integrity"
                        title="Create an integrity script" aria-label="Create an integrity script">\uff0b Add</button>
                    <button type="button" class="sb-btn sb-btn-secondary integrity-open-folder" data-open-scripts-folder>Open scripts folder</button>
                </div>`;
    }

    private scriptOptionsHtml(selectedPath: string): string {
        if (this.availableScripts.length === 0) {
            // Dead picker: a disabled placeholder plus the create/open actions below it.
            return '<option value="" disabled selected>\u2014 No integrity scripts found \u2014</option>';
        }
        const options = ['<option value="">— Select a discovered script —</option>'];
        for (const script of this.availableScripts) {
            const selected = script.relativePath === selectedPath ? ' selected' : '';
            options.push(`<option value="${esc(script.relativePath)}"${selected}>${esc(script.name)}</option>`);
        }
        return options.join('');
    }

    private scriptPickerHint(): string {
        if (!this.scriptsTrusted) { return 'Workspace is not trusted: script checks will not run.'; }
        if (this.availableScripts.length === 0) {
            return 'No scripts tagged @script integrity were found. Create one, or enter a path to run one anyway.';
        }
        return 'Only scripts tagged @script integrity are listed; a path can be typed for unscanned scripts.';
    }

    private checkFormPresentation(formId: string): {
        formClass: string;
        headerClass: string;
        title: string;
        saveLabel: string;
    } {
        if (formId === 'add') {
            return { formClass: 'integrity-add-form', headerClass: 'integrity-form-hdr-new', title: '＋ Add check', saveLabel: 'Add' };
        }
        return { formClass: 'integrity-edit-form', headerClass: 'integrity-form-hdr-edit', title: '✎ Edit Check', saveLabel: 'Save' };
    }

    private addressInputHtml(label: string, control: string, value: string, placeholder: string): string {
        return `
        <label class="integrity-form-field"><span>${label}</span>
            <div class="integrity-address-input"><span class="integrity-addr-pfx">0x</span>
                <input data-draft-control="${control}" class="sb-input" type="text" maxlength="8"
                    placeholder="${placeholder}" value="${esc(this.stripHexPrefix(value))}" autocomplete="off" spellcheck="false">
            </div>
        </label>`;
    }

    private algorithmOptionsHtml(draft: IntegrityDraft): string {
        const selectedValue = draft.kind === 'script' ? 'script' : draft.algorithm;
        const options = ALGORITHM_LABELS.map(([value, label]) =>
            `<option value="${value}"${value === selectedValue ? ' selected' : ''}>${label}</option>`);
        options.push(`<option value="script"${selectedValue === 'script' ? ' selected' : ''}>Script</option>`);
        return options.join('');
    }

    private stripHexPrefix(value: string): string {
        return value.replace(/^0x/i, '');
    }

    private draftFromCheck(check: IntegrityCheckState): IntegrityDraft {
        return {
            kind: check.kind,
            algorithm: check.algorithm,
            scriptPath: check.scriptPath,
            name: check.name,
            startRaw: check.startRaw,
            endRaw: check.endRaw,
            storedRaw: check.storedRaw,
        };
    }

    // ── Header + card wiring ───────────────────────────────────────

    /** Body-only controls (the section header actions are mounted once). */
    private wireBodyControls(): void {
        document.getElementById('integrity-fix-all')?.addEventListener('click', () => this.fixAllMismatches());
    }

    private wireCheckCards(panel: HTMLElement): void {
        panel.querySelectorAll<HTMLElement>('[data-check-toggle]').forEach(header => {
            header.addEventListener('click', event => {
                if ((event.target as HTMLElement).closest('.act-btn, .integrity-auto-fix')) { return; }
                const card = header.closest<HTMLElement>('[data-check-id]');
                if (!card || this.editingCheckId === Number(card.dataset.checkId)) { return; }
                this.toggleHighlightedCheck(Number(card.dataset.checkId));
            });
        });
        panel.addEventListener('change', event => {
            const toggle = (event.target as HTMLElement).closest<HTMLInputElement>('[data-auto-fix]');
            if (toggle) { this.setAutoFix(Number(toggle.dataset.checkId), toggle.checked); }
        });
        panel.querySelectorAll<HTMLElement>('.integrity-card .act-btn-edit').forEach(button => {
            button.addEventListener('click', () => this.editCheck(Number(button.dataset.checkId)));
        });
        panel.querySelectorAll<HTMLElement>('.integrity-card .act-btn-del').forEach(button => {
            button.addEventListener('click', () => this.deleteCheck(Number(button.dataset.checkId)));
        });
        panel.querySelectorAll<HTMLElement>('.integrity-card [data-script-refresh]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                this.refreshScriptCheck(Number(button.dataset.checkId));
            });
        });
        panel.querySelectorAll<HTMLElement>('.integrity-card [data-script-open]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                this.openScriptCheck(Number(button.dataset.checkId));
            });
        });
        panel.addEventListener('click', event => this.copyCalculatedValue(event));
        if (this.editingCheckId !== null) { this.wireCheckForm(`edit-${this.editingCheckId}`); }
    }

    private notifyCopied(check: IntegrityCheckState): void {
        const text = calculatedCopyValue(check);
        if (!text) { return; }
        this.cb.onCopyText?.(text, calculatedCopyLabel(check));
    }

    private copyCalculatedValue(event: MouseEvent): void {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-copy-calculated]');
        if (!button) { return; }
        const check = this.checks.find(item => item.id === Number(button.dataset.checkId));
        if (!check?.result) { return; }
        this.notifyCopied(check);
        showToast('Copied ✓', { x: event.clientX, y: event.clientY });
        flashCopied(button);
    }

    private refreshScriptCheck(id: number): void {
        const check = this.checks.find(item => item.id === id);
        if (!check || check.kind !== 'script') { return; }
        this.scheduleIntegrityCalculation(check, true);
    }

    private openScriptCheck(id: number): void {
        const check = this.scriptCheck(id);
        if (check) { this.cb.onOpenScript?.(check.scriptPath); }
    }

    /** The configured script check with this id, if any. */
    private scriptCheck(id: number): IntegrityCheckState | undefined {
        const check = this.checks.find(item => item.id === id);
        return check && isScriptCheck(check) ? check : undefined;
    }

    private toggleHighlightedCheck(id: number): void {
        if (this.highlightedCheckId === id) { this.clearHighlightedCheck(); }
        else { this.highlightedCheckId = id; }
        this.render();
        this.syncHighlight();
    }

    private editCheck(id: number): void {
        this.addCheckDraft = null;
        this.editingCheckId = id;
        this.formLastFocused = null;
        this.render();
    }

    private deleteCheck(id: number): void {
        const check = this.checks.find(item => item.id === id);
        if (check) { this.cancelPendingCalculation(check); }
        this.checks = this.checks.filter(item => item.id !== id);
        if (this.editingCheckId === id) { this.editingCheckId = null; }
        if (this.highlightedCheckId === id) { this.clearHighlightedCheck(); }
        this.persistChecks();
        this.render();
    }

    private setAutoFix(id: number, enabled: boolean): void {
        const check = this.checks.find(item => item.id === id);
        if (!check) { return; }
        this.applyAutoFixSetting(check, enabled);
    }

    private applyAutoFixSetting(check: IntegrityCheckState, enabled: boolean): void {
        if (!check.storedRaw) { return; }
        this.clearAutoFixSuppression(check);
        check.autoFixStoredValue = enabled;
        this.persistChecks();
        this.fixEnabledMismatch(check, enabled);
    }

    private fixEnabledMismatch(check: IntegrityCheckState, enabled: boolean): void {
        if (!enabled) { return; }
        if (isMismatchedCheck(check)) { this.updateStoredValue(check); }
    }

    // ── Fix all ────────────────────────────────────────────────────

    private fixableChecks(): Array<{ check: IntegrityCheckState; update: StoredValueUpdate }> {
        const fixable: Array<{ check: IntegrityCheckState; update: StoredValueUpdate }> = [];
        for (const check of this.checks) {
            if (!isMismatchedCheck(check)) { continue; }
            const update = storedValueUpdate(check);
            if (update) { fixable.push({ check, update }); }
        }
        return fixable;
    }

    private hasFixableMismatches(): boolean {
        return this.checks.some(check => isMismatchedCheck(check));
    }

    private fixAllMismatches(): void {
        const fixable = this.fixableChecks();
        const edits = mergeIntegrityEdits(fixable.map(item => this.fixableCheckEdits(item)));
        if (!edits.ok) { this.setActionError(edits.error); return; }
        if (edits.value.length === 0) { return; }
        this.setActionError('');
        fixable.forEach(item => this.clearAutoFixSuppression(item.check));
        this.cb.onStoredValueEdits?.(edits.value);
        this.applyStoredWrites(fixable);
        this.syncHighlight();
    }

    private applyStoredWrites(fixable: Array<{ check: IntegrityCheckState; update: StoredValueUpdate }>): void {
        for (const item of fixable) {
            item.check.storedBytes = Uint8Array.from(item.update.expected);
            this.updateCheckCard(item.check);
        }
    }

    private fixableCheckEdits(item: { check: IntegrityCheckState; update: StoredValueUpdate }): Array<[number, number]> {
        return Array.from(item.update.expected, (value, offset) => [item.update.address + offset, value]);
    }

    private setActionError(message: string): void {
        this.actionError = message;
        const error = document.getElementById('integrity-action-error');
        if (error) { error.textContent = message; }
    }

    // ── Check forms ────────────────────────────────────────────────

    private wireCheckForm(formId: string): void {
        const form = document.querySelector<HTMLElement>(`[data-integrity-form="${formId}"]`);
        if (!form) { return; }
        form.querySelector('[data-form-action="save"]')?.addEventListener('click', () => this.saveCheckForm(formId, form));
        form.querySelector('[data-form-action="cancel"]')?.addEventListener('click', () => this.cancelCheckForm(formId));
        form.querySelector<HTMLInputElement>('[data-draft-control="start"]')?.addEventListener('focus', () => { this.formLastFocused = 'start'; });
        form.querySelector<HTMLInputElement>('[data-draft-control="end"]')?.addEventListener('focus', () => { this.formLastFocused = 'end'; });
        form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')?.addEventListener('change', () => this.syncFormKind(form));
        form.querySelector<HTMLSelectElement>('[data-draft-control="script-pick"]')?.addEventListener('change', event => {
            const select = event.target as HTMLSelectElement;
            const path = form.querySelector<HTMLInputElement>('[data-draft-control="scriptPath"]');
            if (path && select.value) { path.value = select.value; }
        });
        form.querySelector<HTMLElement>('[data-create-script]')?.addEventListener('click', () => {
            const role = form.querySelector<HTMLElement>('[data-create-script]')?.dataset.createScript as ScriptRole | undefined;
            if (role) { this.cb.onCreateScript?.(role); }
        });
        form.querySelector<HTMLElement>('[data-open-scripts-folder]')?.addEventListener('click', () => {
            this.cb.onOpenScriptsFolder?.();
        });
        this.syncFormKind(form);
    }

    /** Swap the algorithm/script controls when the kind select is `script`. */
    private syncFormKind(form: HTMLElement): void {
        const select = form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]');
        const field = form.querySelector<HTMLElement>('[data-script-field]');
        if (!select || !field) { return; }
        field.hidden = select.value !== 'script';
    }

    private saveCheckForm(formId: string, form: HTMLElement): void {
        const draft = this.readDraft(form);
        if (!draft.ok) { this.showFormError(form, draft.error); return; }
        if (formId === 'add') { this.saveNewCheck(draft.value); return; }
        this.saveEditedCheck(Number(formId.replace('edit-', '')), draft.value);
    }

    private readDraft(form: HTMLElement): DraftValidation {
        const kind = selectedKind(form);
        const nameDraft = this.readDraftName(form);
        if (!nameDraft.ok) { return nameDraft; }
        const fields = this.readDraftFields(form, kind);
        if (!fields.ok) { return fields; }
        return { ok: true, value: { kind, name: nameDraft.name, ...fields.value } };
    }

    private readDraftFields(
        form: HTMLElement,
        kind: IntegrityCheckKind,
    ): { ok: true; value: Omit<IntegrityDraft, 'kind' | 'name'> } | { ok: false; error: string } {
        const range = this.readRangeDraft(form);
        if (!range.ok) { return range; }
        const stored = this.readStoredDraft(form);
        if (!stored.ok) { return stored; }
        const scriptPath = this.readScriptPathDraft(form, kind);
        if (!scriptPath.ok) { return scriptPath; }
        return {
            ok: true,
            value: {
                algorithm: selectedAlgorithm(form, kind),
                scriptPath: scriptPath.value,
                startRaw: formatIntegrityAddress(range.value.startAddress),
                endRaw: formatIntegrityAddress(range.value.endAddress),
                storedRaw: stored.value,
            },
        };
    }

    private readRangeDraft(form: HTMLElement): IntegrityValidation<{ startAddress: number; endAddress: number }> {
        const startRaw = form.querySelector<HTMLInputElement>('[data-draft-control="start"]')!.value;
        const endRaw = form.querySelector<HTMLInputElement>('[data-draft-control="end"]')!.value;
        return validateIntegrityAddressRange(startRaw, endRaw);
    }

    private readScriptPathDraft(
        form: HTMLElement,
        kind: IntegrityCheckKind,
    ): { ok: true; value: string } | { ok: false; error: string } {
        if (kind !== 'script') { return { ok: true, value: '' }; }
        const path = scriptPathValue(form);
        return path
            ? { ok: true, value: path }
            : { ok: false, error: 'Script path is required.' };
    }

    private readDraftName(form: HTMLElement): { ok: true; name: string } | { ok: false; error: string } {
        const name = (form.querySelector<HTMLInputElement>('[data-draft-control="name"]')?.value ?? '').trim();
        if (name.length > 40) { return { ok: false, error: 'Check name must be 40 characters or fewer.' }; }
        return { ok: true, name };
    }

    private readStoredDraft(form: HTMLElement): StoredDraftValidation {
        const raw = form.querySelector<HTMLInputElement>('[data-draft-control="stored"]')!.value;
        if (!raw.trim()) { return { ok: true, value: '' }; }
        const parsed = parseIntegrityAddress(raw, 'Stored value');
        if (!parsed.ok) { return parsed; }
        return { ok: true, value: formatIntegrityAddress(parsed.value) };
    }

    private showFormError(form: HTMLElement, message: string): void {
        const error = form.querySelector<HTMLElement>('[data-form-error]');
        if (error) { error.textContent = message; }
    }

    private saveNewCheck(draft: IntegrityDraft): void {
        const check = this.newCheck();
        this.formLastFocused = null;
        this.applyDraft(check, draft);
        this.checks.push(check);
        this.addCheckDraft = null;
        this.persistChecks();
        this.render();
        this.scheduleIntegrityCalculation(check);
    }

    private saveEditedCheck(id: number, draft: IntegrityDraft): void {
        const check = this.checks.find(item => item.id === id);
        if (!check) { return; }
        this.formLastFocused = null;
        this.applyDraft(check, draft);
        if (!check.storedRaw) { check.autoFixStoredValue = false; }
        this.editingCheckId = null;
        this.persistChecks();
        this.render();
        this.syncHighlight();
        this.scheduleIntegrityCalculation(check);
    }

    private applyDraft(check: IntegrityCheckState, draft: IntegrityDraft): void {
        applyIntegrityDraft(check, draft);
    }

    private cancelCheckForm(formId: string): void {
        this.formLastFocused = null;
        if (formId === 'add') { this.addCheckDraft = null; }
        else {
            this.editingCheckId = null;
        }
        this.render();
    }

    /**
     * Hex-view selection change → live-refill the open add/edit form (parity
     * with the label form): the last-focused address field receives the fill.
     * - End focused → fill end only.
     * - Otherwise (start or none) → fill start + end.
     * Fires only here, never on keystrokes; a null selection leaves values as-is.
     */
    notifySelectionChanged(): void {
        const fields = this.openAddressFields();
        if (!fields) { return; }
        const selection = this.currentSelection();
        if (!selection) { return; }
        const endValue = this.stripHexPrefix(formatIntegrityAddress(selection.end));
        if (this.formLastFocused === 'end') { this.fillAddressEnd(fields.endEl, endValue); return; }
        this.fillAddressFields(fields.startEl, fields.endEl, selection, endValue);
    }

    private currentSelection(): { start: number; end: number } | null {
        return this.cb.getSelection?.() ?? null;
    }

    private hasOpenCheckForm(): boolean {
        return this.addCheckDraft !== null || this.editingCheckId !== null;
    }

    private openAddressFields(): { startEl: HTMLInputElement | null; endEl: HTMLInputElement | null } | null {
        if (!this.hasOpenCheckForm()) { return null; }
        const form = document.querySelector<HTMLElement>(
            '[data-integrity-form="add"], [data-integrity-form^="edit-"]',
        );
        if (!form) { return null; }
        return {
            startEl: form.querySelector<HTMLInputElement>('[data-draft-control="start"]'),
            endEl: form.querySelector<HTMLInputElement>('[data-draft-control="end"]'),
        };
    }

    private fillAddressFields(startEl: HTMLInputElement | null, endEl: HTMLInputElement | null, selection: { start: number; end: number }, endValue: string): void {
        if (startEl) { startEl.value = this.stripHexPrefix(formatIntegrityAddress(selection.start)); }
        if (endEl) { endEl.value = endValue; }
    }

    private fillAddressEnd(endEl: HTMLInputElement | null, value: string): void {
        if (endEl) { endEl.value = value; }
    }

    // ── Calculation scheduling (delegates to integrityCalculation.ts) ──

    private calcHooks(): IntegrityCalculationHooks {
        return {
            readByte: addr => this.cb.readByte(addr),
            endian: () => this.endian(),
            updateCheckCard: check => this.updateCheckCard(check),
            syncHighlight: () => this.syncHighlight(),
            onCalculated: check => this.maybeAutoFix(check),
            getPendingEdits: () => this.cb.getPendingEdits?.() ?? [],
            getGeneration: () => this.cb.getGeneration?.() ?? 0,
            startScriptRun: (check, payload) => this.startScriptRun(check, payload),
        };
    }

    private startScriptRun(check: IntegrityCheckState, payload: IntegrityScriptRunPayload): void {
        const requestId = ++this.nextScriptRequestId;
        check.requestId = requestId;
        this.cb.onScriptCheckRequest?.({ requestId, checkId: check.id, ...payload });
    }

    scheduleIntegrityCalculation(check: IntegrityCheckState, preserveResult = false): void {
        scheduleIntegrityCalculation(check, preserveResult, this.calcHooks());
    }

    cancelPendingCalculation(check: IntegrityCheckState): void {
        cancelPendingCalculation(check);
    }

    // ── Card paint ─────────────────────────────────────────────────

    private updateCheckCard(check: IntegrityCheckState): void {
        const card = document.querySelector<HTMLElement>(`.integrity-card[data-check-id="${check.id}"]`);
        if (!card) { return; }
        this.updateCheckCardStatus(card, check);
        this.updateCheckCardBody(card, check);
        this.updateFixAllControl();
    }

    private updateCheckCardStatus(card: HTMLElement, check: IntegrityCheckState): void {
        const status = card.querySelector<HTMLElement>('[data-check-status]');
        if (!status) { return; }
        const label = checkStatusLabel(check);
        status.className = `integrity-card-status ${checkStatusClass(check)}`;
        status.textContent = INTEGRITY_STATUS_SYMBOLS[label] ?? label;
        status.title = label;
        status.setAttribute('aria-label', label);
    }

    private updateCheckCardBody(card: HTMLElement, check: IntegrityCheckState): void {
        const body = card.querySelector<HTMLElement>('[data-check-body]');
        if (!body) { return; }
        body.innerHTML = resultBodyHtml(check, this.renderDeps());
    }

    private renderDeps(): IntegrityResultRenderDeps {
        return {
            endian: () => this.endian(),
            isAutoFixSuppressed: check => this.isAutoFixSuppressed(check),
        };
    }

    private updateFixAllControl(): void {
        const button = document.getElementById('integrity-fix-all') as HTMLButtonElement | null;
        if (button) { button.disabled = !this.hasFixableMismatches(); }
    }

    // ── Auto fix ───────────────────────────────────────────────────

    private updateStoredValue(check: IntegrityCheckState): void {
        const update = storedValueUpdate(check);
        if (!update) { return; }
        this.cb.onStoredValueEdits?.(Array.from(update.expected, (byte, offset) => [update.address + offset, byte]));
        check.storedBytes = update.expected;
        this.updateCheckCard(check);
        this.syncHighlight();
    }

    private maybeAutoFix(check: IntegrityCheckState): void {
        if (!check.autoFixStoredValue) { return; }
        const mismatch = this.autoFixMismatchKey(check);
        if (!mismatch) { this.clearAutoFixSuppression(check); return; }
        if (this.consumeAutoFixSuppression(check, mismatch)) { return; }
        this.clearAutoFixSuppression(check);
        this.updateStoredValue(check);
    }

    private consumeAutoFixSuppression(check: IntegrityCheckState, mismatch: string): boolean {
        if (check.suppressAutoFixOnNextResult) {
            check.suppressAutoFixOnNextResult = false;
            check.suppressedAutoFixMismatch = mismatch;
            this.updateCheckCard(check);
            return true;
        }
        return check.suppressedAutoFixMismatch === mismatch;
    }

    private isAutoFixSuppressed(check: IntegrityCheckState): boolean {
        const mismatch = this.autoFixMismatchKey(check);
        return !!mismatch && check.suppressedAutoFixMismatch === mismatch;
    }

    private autoFixMismatchKey(check: IntegrityCheckState): string {
        if (!isMismatchedCheck(check)) { return ''; }
        if (!check.expectedBytes || !check.storedBytes) { return ''; }
        return [
            check.kind,
            checkIdentityValue(check),
            check.startRaw,
            check.endRaw,
            check.storedRaw,
            this.endian(),
            integrityBytesToHex(check.expectedBytes),
            integrityBytesToHex(check.storedBytes),
        ].join('|');
    }

    private clearAutoFixSuppression(check: IntegrityCheckState): void {
        clearIntegrityAutoFixSuppression(check);
    }

    // ── Highlight (delegates to integrityHighlight.ts) ─────────────

    private highlightHooks(): IntegrityHighlightHooks {
        return { onHighlightChange: highlight => this.cb.onHighlightChange?.(highlight) };
    }

    private syncHighlight(): void {
        syncHighlight(this.checks, this.highlightedCheckId, this.highlightHooks());
    }

    clearHighlightedCheck(): void {
        this.highlightedCheckId = null;
        clearHighlight(this.highlightHooks());
    }

    private clearHighlight(): void {
        clearHighlight(this.highlightHooks());
    }
}
