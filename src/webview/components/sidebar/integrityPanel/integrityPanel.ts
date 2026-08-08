/** Integrity Overlay — UI layer. Self-contained Integrity sidebar panel.
Owns the check list (add/edit/delete, algorithm selection, address/stored-value
inputs, auto-fix toggle), per-check result display (calculated/stored
comparison, copy), and the profile library (select/create/rename/update/delete,
save-as, fix-all). Data is pushed via setters; byte reads go through the
injected readByte accessor; actions report via callbacks. This module never
imports the S global, never posts provider messages, and never touches the
render registry. Pure model helpers live in integrityCheckModel.ts; result
markup in integrityResultRender.ts, calculation scheduling in
integrityCalculation.ts, the profile library in integrityProfiles.ts, and
range/stored highlight derivation in integrityHighlight.ts. */

import {
    formatIntegrityAddress,
    integrityBytesToHex,
    isChecksumAlgorithm,
    mergeIntegrityEdits,
    normalizeIntegrityCheckSet,
    normalizeIntegrityProfiles,
    parseIntegrityAddress,
    validateIntegrityRange,
    type IntegrityAlgorithm,
    type IntegrityCheckConfig,
    type IntegrityCheckSet,
    type IntegrityProfile,
    type IntegrityResult,
} from '../../../../core/integrity';
import { esc } from '../../../utils';
import {
    applyIntegrityDraft,
    blankIntegrityDraft,
    clearIntegrityAutoFixSuppression,
    makeIntegrityCheck,
    type IntegrityCheckState,
    type IntegrityDraft,
    type StoredValueUpdate,
} from './integrityCheckModel';
import {
    ALGORITHM_LABELS,
    algorithmLabel,
    checkCardBodyHtml,
    checkCardClass,
    checkCardHtml,
    checkStatusClass,
    checkStatusLabel,
    isMismatchedCheck,
    resultBodyHtml,
    type IntegrityResultRenderDeps,
} from './integrityResultRender';
import {
    cancelPendingCalculation,
    scheduleIntegrityCalculation,
    type IntegrityCalculationHooks,
} from './integrityCalculation';
import {
    persistChecks,
    profileLibraryHtml,
    refreshProfileLibrary,
    wireProfileControls,
    type IntegrityProfileHost,
} from './integrityProfiles';
import {
    clearHighlight,
    storedValueUpdate,
    syncHighlight,
    type IntegrityHighlightHooks,
} from './integrityHighlight';
import './integrityPanel.css';

const EMPTY_INTEGRITY_CHECK_SET: IntegrityCheckSet = { schemaVersion: 1, checks: [] };
const INTEGRITY_STATUS_SYMBOLS: Record<string, string> = {
    Match: '✓', Mismatch: '✕', Calculated: '∑', Calculating: '…', Error: '!', 'Not configured': '?',
};

type DraftValidation = { ok: true; value: IntegrityDraft } | { ok: false; error: string };
type StoredDraftValidation = { ok: true; value: string } | { ok: false; error: string };

export interface IntegrityHighlight {
    rangeStart: number;
    rangeEnd: number;
    storedStart?: number;
    storedLength?: number;
    status: 'match' | 'mismatch' | 'unverified';
}

export interface IntegrityCallbacks {
    /** Required — host memory adapter for byte reads (keeps memory access host-owned). */
    readByte: (addr: number) => number | undefined;
    /** Auto-fix: write calculated bytes to a stored field → host stages an edit transaction. */
    onStoredValueEdits?: (edits: Array<[number, number]>) => void;
    /** Selection snapshot for the add-check form defaults (was S.selStart/S.selEnd). */
    getSelection?: () => { start: number; end: number } | null;
    /** Shared byte-order source (was S.endian). */
    getEndian?: () => 'le' | 'be';
    /** Copy button → host posts copyText. */
    onCopyText?: (text: string, label: string) => void;
    /** Checks persistence → host posts saveIntegrityChecks. */
    onPersistChecks?: (state: IntegrityCheckSet) => void;
    /** Profile library CRUD → host posts create/update/rename/deleteIntegrityProfile. */
    onCreateProfile?: (profile: IntegrityProfile) => void;
    onUpdateProfile?: (profile: IntegrityProfile) => void;
    onRenameProfile?: (id: string, name: string) => void;
    onDeleteProfile?: (id: string) => void;
    /** Highlight of a check range/stored field → host sets S.integrityHighlight + rerender.memory(). */
    onHighlightChange?: (highlight: IntegrityHighlight | null) => void;
}

export class IntegrityPanel implements IntegrityProfileHost {
    readonly cb: IntegrityCallbacks;
    private _panel: HTMLElement | null = null;
    private nextCheckId = 1;
    profiles: IntegrityProfile[] = [];
    selectedProfileId = '';
    profileError = '';
    private actionError = '';
    profileNameMode: 'create' | 'rename' | null = null;
    addCheckDraft: IntegrityDraft | null = null;
    editingCheckId: number | null = null;
    private highlightedCheckId: number | null = null;
    private initialized = false;
    checks: IntegrityCheckState[] = [];

    constructor(cb: IntegrityCallbacks) {
        this.cb = cb;
    }

    /** Renders the panel into the given root (creates the #s-integrity container). Idempotent. */
    mount(root: HTMLElement): void {
        this._panel = root.id === 's-integrity' ? root : this.ensureIntegrityRoot(root);
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

    /** Re-renders the whole panel (was renderIntegrity). No-op until mounted. */
    render(): void {
        const panel = this._panel;
        if (!panel) { return; }
        panel.innerHTML = this.integrityShellHtml();
        this.wireRenderedIntegrity(panel);
    }

    /** Push profiles + active checks (was setIntegrityProfiles). */
    setProfiles(value: unknown, error = ''): void {
        const payload = this.integrityInitPayload(value);
        this.profiles = normalizeIntegrityProfiles(this.integrityProfileValues(payload, value));
        this.restoreChecks(payload);
        this.profileError = error;
        this.clearMissingSelectedProfile();
        this.refreshProfilesIfRendered();
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
    }

    /** Recalculate all checks against the current bytes (was notifyIntegrityBytesChanged). */
    notifyBytesChanged(): void {
        if (this.initialized) {
            this.checks.forEach(check => this.scheduleIntegrityCalculation(check, true));
        }
    }

    /** Recalculate after pending edits were discarded (was notifyIntegrityEditsDiscarded). */
    notifyEditsDiscarded(): void {
        if (!this.initialized) { return; }
        for (const check of this.checks) {
            check.suppressAutoFixOnNextResult = check.autoFixStoredValue && !!check.storedRaw;
            this.scheduleIntegrityCalculation(check, true);
        }
    }

    /** Re-decode results for the new shared byte order (was notifyIntegrityEndianChanged). */
    notifyEndianChanged(): void {
        this.checks.forEach(check => this.clearAutoFixSuppression(check));
        this.render();
        this.checks.forEach(check => this.scheduleIntegrityCalculation(check, true));
    }

    /** Host pushes the active sidebar tab (lazy-init gate was activateIntegrity). */
    setTabActive(active: boolean): void {
        if (!active || this.initialized) { return; }
        this.initialized = true;
        this.render();
        this.checks.forEach(check => this.scheduleIntegrityCalculation(check));
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
        const selection = this.cb.getSelection?.() ?? null;
        if (selection) {
            draft.startRaw = formatIntegrityAddress(selection.start);
            draft.endRaw = formatIntegrityAddress(selection.end);
        }
        return draft;
    }

    private integrityProfileValues(payload: ReturnType<typeof this.integrityInitPayload>, fallback: unknown): unknown {
        return payload ? payload.profiles : fallback;
    }

    private restoreChecks(payload: ReturnType<typeof this.integrityInitPayload>): void {
        if (payload) { this.setChecks(payload.activeChecks); }
    }

    private clearMissingSelectedProfile(): void {
        if (!this.selectedProfileId) { return; }
        if (!this.profiles.some(profile => profile.id === this.selectedProfileId)) { this.selectedProfileId = ''; }
    }

    private refreshProfilesIfRendered(): void {
        if (document.getElementById('s-integrity')) { this.refreshProfileLibrary(); }
    }

    private integrityInitPayload(value: unknown): { profiles: unknown; activeChecks: unknown } | null {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) { return null; }
        const payload = value as { profiles?: unknown; activeChecks?: unknown };
        return { profiles: payload.profiles, activeChecks: payload.activeChecks };
    }

    private normalizedIntegrityCheckSet(value: unknown): IntegrityCheckSet {
        return normalizeIntegrityCheckSet(value) ?? EMPTY_INTEGRITY_CHECK_SET;
    }

    private cancelCalculations(): void {
        this.checks.forEach(check => this.cancelPendingCalculation(check));
    }

    refreshProfileLibrary(): void {
        refreshProfileLibrary(this);
    }

    // ── Shell render ───────────────────────────────────────────────

    private integrityShellHtml(): string {
        return `
        <div class="integrity-shell">
            <div class="si-hdr-row integrity-hdr-row">
                <span class="sb-hdr">Integrity Checks ${this.integrityBadgeHtml()}</span>
                <button id="integrity-fix-all" class="struct-btn struct-btn-apply" type="button"${this.fixAllDisabledAttr()}>Fix all</button>
                <button id="integrity-add-btn" class="si-add-btn"${this.addCheckDisabledAttr()}>＋ Add</button>
            </div>
            <div id="integrity-action-error" class="integrity-error" role="alert">${esc(this.actionError)}</div>
            ${profileLibraryHtml(this)}
            ${this.addCheckFormHtml()}
            <div id="integrity-check-list">${this.checkCardsHtml()}</div>
        </div>`;
    }

    private fixAllDisabledAttr(): string {
        return this.hasFixableMismatches() ? '' : ' disabled';
    }

    private addCheckDisabledAttr(): string {
        return this.addCheckDraft ? ' disabled' : '';
    }

    private wireRenderedIntegrity(panel: HTMLElement): void {
        this.wireHeaderControls();
        wireProfileControls(this);
        if (this.addCheckDraft) { this.wireCheckForm('add'); }
        this.wireCheckCards(panel);
        this.checks.forEach(check => this.updateCheckCard(check));
    }

    private integrityBadgeHtml(): string {
        return this.checks.length > 0 ? `<span class="sb-badge">${this.checks.length}</span>` : '';
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
            <div class="sa-form-hdr ${presentation.headerClass}">${presentation.title}</div>
            <label class="integrity-form-field"><span>Algorithm</span>
                <select data-draft-control="algorithm" class="struct-sel">${this.algorithmOptionsHtml(draft.algorithm)}</select>
            </label>
            <div class="integrity-form-grid">
                ${this.addressInputHtml('Start address', 'start', draft.startRaw, '08000000')}
                ${this.addressInputHtml('End address (inclusive)', 'end', draft.endRaw, '080000FF')}
            </div>
            <div data-stored-field${isChecksumAlgorithm(draft.algorithm) ? '' : ' hidden'}>
                ${this.addressInputHtml('Stored value address (optional)', 'stored', draft.storedRaw, '08000100')}
            </div>
            <div class="integrity-form-error" data-form-error></div>
            <div class="sa-row sa-btn-row">
                <button class="struct-btn struct-btn-apply" data-form-action="save">${presentation.saveLabel}</button>
                <button class="struct-btn struct-btn-cancel" data-form-action="cancel">Cancel</button>
            </div>
        </div>`;
    }

    private checkFormPresentation(formId: string): {
        formClass: string;
        headerClass: string;
        title: string;
        saveLabel: string;
    } {
        if (formId === 'add') {
            return { formClass: 'integrity-add-form', headerClass: 'sa-form-hdr-new', title: '＋ New Check', saveLabel: 'Add' };
        }
        return { formClass: 'integrity-edit-form', headerClass: 'sa-form-hdr-edit', title: '✎ Edit Check', saveLabel: 'Save' };
    }

    private addressInputHtml(label: string, control: string, value: string, placeholder: string): string {
        return `
        <label class="integrity-form-field"><span>${label}</span>
            <div class="integrity-address-input"><span class="struct-addr-pfx">0x</span>
                <input data-draft-control="${control}" class="struct-addr-inp" type="text" maxlength="8"
                    placeholder="${placeholder}" value="${esc(this.stripHexPrefix(value))}" autocomplete="off" spellcheck="false">
            </div>
        </label>`;
    }

    private algorithmOptionsHtml(selected: IntegrityAlgorithm): string {
        return ALGORITHM_LABELS.map(([value, label]) =>
            `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
    }

    private stripHexPrefix(value: string): string {
        return value.replace(/^0x/i, '');
    }

    private draftFromCheck(check: IntegrityCheckState): IntegrityDraft {
        return { algorithm: check.algorithm, startRaw: check.startRaw, endRaw: check.endRaw, storedRaw: check.storedRaw };
    }

    // ── Header + card wiring ───────────────────────────────────────

    private wireHeaderControls(): void {
        document.getElementById('integrity-fix-all')?.addEventListener('click', () => this.fixAllMismatches());
        document.getElementById('integrity-add-btn')?.addEventListener('click', () => {
            this.addCheckDraft = this.addDraft();
            this.editingCheckId = null;
            this.render();
            document.querySelector<HTMLInputElement>('[data-integrity-form="add"] [data-draft-control="start"]')?.focus();
        });
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
        panel.addEventListener('click', event => this.copyCalculatedValue(event));
        if (this.editingCheckId !== null) { this.wireCheckForm(`edit-${this.editingCheckId}`); }
    }

    private copyCalculatedValue(event: MouseEvent): void {
        const target = this.calculatedCopyTarget(event);
        if (!target) { return; }
        const display = { label: 'Calculated', value: target.result.value };
        this.cb.onCopyText?.(`0x${display.value}`, `${algorithmLabel(target.algorithm)} calculated value`);
    }

    private calculatedCopyTarget(event: MouseEvent): { result: IntegrityResult; algorithm: IntegrityAlgorithm } | null {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-copy-calculated]');
        if (!button) { return null; }
        const check = this.checks.find(item => item.id === Number(button.dataset.checkId));
        if (!check?.result) { return null; }
        return { result: check.result, algorithm: check.algorithm };
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
        this.render();
    }

    private deleteCheck(id: number): void {
        const check = this.checks.find(item => item.id === id);
        if (check) { this.cancelPendingCalculation(check); }
        this.checks = this.checks.filter(item => item.id !== id);
        if (this.editingCheckId === id) { this.editingCheckId = null; }
        if (this.highlightedCheckId === id) { this.clearHighlightedCheck(); }
        persistChecks(this);
        this.render();
    }

    private setAutoFix(id: number, enabled: boolean): void {
        const check = this.checks.find(item => item.id === id);
        if (!check) { return; }
        this.applyAutoFixSetting(check, enabled);
    }

    private applyAutoFixSetting(check: IntegrityCheckState, enabled: boolean): void {
        if (!isChecksumAlgorithm(check.algorithm) || !check.storedRaw) { return; }
        this.clearAutoFixSuppression(check);
        check.autoFixStoredValue = enabled;
        persistChecks(this);
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
        form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')?.addEventListener('change', event => {
            this.updateStoredFieldVisibility(form, (event.target as HTMLSelectElement).value as IntegrityAlgorithm);
        });
    }

    private updateStoredFieldVisibility(form: HTMLElement, algorithm: IntegrityAlgorithm): void {
        const field = form.querySelector<HTMLElement>('[data-stored-field]');
        if (field) { field.hidden = !isChecksumAlgorithm(algorithm); }
    }

    private saveCheckForm(formId: string, form: HTMLElement): void {
        const draft = this.readDraft(form);
        if (!draft.ok) { this.showFormError(form, draft.error); return; }
        if (formId === 'add') { this.saveNewCheck(draft.value); return; }
        this.saveEditedCheck(Number(formId.replace('edit-', '')), draft.value);
    }

    private readDraft(form: HTMLElement): DraftValidation {
        const algorithm = form.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')!.value as IntegrityAlgorithm;
        const startRaw = form.querySelector<HTMLInputElement>('[data-draft-control="start"]')!.value;
        const endRaw = form.querySelector<HTMLInputElement>('[data-draft-control="end"]')!.value;
        const range = validateIntegrityRange(startRaw, endRaw, algorithm);
        if (!range.ok) { return range; }
        const stored = this.readStoredDraft(form, algorithm);
        if (!stored.ok) { return stored; }
        return {
            ok: true,
            value: {
                algorithm,
                startRaw: formatIntegrityAddress(range.value.startAddress),
                endRaw: formatIntegrityAddress(range.value.endAddress),
                storedRaw: stored.value,
            },
        };
    }

    private readStoredDraft(form: HTMLElement, algorithm: IntegrityAlgorithm): StoredDraftValidation {
        if (!isChecksumAlgorithm(algorithm)) { return { ok: true, value: '' }; }
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
        this.applyDraft(check, draft);
        this.checks.push(check);
        this.addCheckDraft = null;
        persistChecks(this);
        this.render();
        this.scheduleIntegrityCalculation(check);
    }

    private saveEditedCheck(id: number, draft: IntegrityDraft): void {
        const check = this.checks.find(item => item.id === id);
        if (!check) { return; }
        this.applyDraft(check, draft);
        if (!check.storedRaw) { check.autoFixStoredValue = false; }
        this.editingCheckId = null;
        persistChecks(this);
        this.render();
        this.syncHighlight();
        this.scheduleIntegrityCalculation(check);
    }

    private applyDraft(check: IntegrityCheckState, draft: IntegrityDraft): void {
        applyIntegrityDraft(check, draft);
    }

    private cancelCheckForm(formId: string): void {
        if (formId === 'add') { this.addCheckDraft = null; }
        else {
            this.editingCheckId = null;
        }
        this.render();
    }

    // ── Calculation scheduling (delegates to integrityCalculation.ts) ──

    private calcHooks(): IntegrityCalculationHooks {
        return {
            readByte: addr => this.cb.readByte(addr),
            endian: () => this.endian(),
            updateCheckCard: check => this.updateCheckCard(check),
            syncHighlight: () => this.syncHighlight(),
            onCalculated: check => this.maybeAutoFix(check),
        };
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
        if (!isMismatchedCheck(check) || !check.expectedBytes || !check.storedBytes) { return ''; }
        return [
            check.algorithm,
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
