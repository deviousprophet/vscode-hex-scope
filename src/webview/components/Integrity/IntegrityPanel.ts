/** Integrity Overlay — UI layer. Self-contained Integrity sidebar panel.
Owns the check list (add/edit/delete, algorithm selection, address/stored-value
inputs, auto-fix toggle), per-check result display (calculated/stored
comparison, copy), and the profile library (select/create/rename/update/delete,
save-as, fix-all). Data is pushed via setters; byte reads go through the
injected readByte accessor; actions report via callbacks. This module never
imports the S global, never posts provider messages, and never touches the
render registry. Pure model helpers live in integrityCheckModel.ts. */

import {
    calculateIntegrity,
    collectIntegrityBytesAsync,
    formatIntegrityAddress,
    integrityBytesEqual,
    integrityBytesToHex,
    integrityBytesToValueHex,
    integrityValueToBytes,
    isChecksumAlgorithm,
    mergeIntegrityEdits,
    normalizeIntegrityCheckSet,
    normalizeIntegrityProfiles,
    parseIntegrityAddress,
    readStoredIntegrityBytes,
    type IntegrityAlgorithm,
    type IntegrityCheckConfig,
    type IntegrityCheckSet,
    type IntegrityProfile,
    type IntegrityRequest,
    type IntegrityResult,
    type IntegrityStoredField,
    validateIntegrityRange,
} from '../../../core/integrity';
import { actionBtnsHtml, esc, formatHexHtml } from '../../utils';
import {
    applyIntegrityDraft,
    blankIntegrityDraft,
    clearIntegrityAutoFixSuppression,
    clearIntegrityCheckResult,
    draftFromIntegrityConfig,
    integrityCheckConfigFromState,
    integrityCheckConfigsFromStates,
    integrityCheckSetFromStates,
    makeIntegrityCheck,
    type IntegrityCheckState,
    type IntegrityDraft,
    type StoredValueUpdate,
} from './integrityCheckModel';
import './IntegrityPanel.css';

const DEBOUNCE_MS = 250;
const ALGORITHM_LABELS: ReadonlyArray<readonly [IntegrityAlgorithm, string]> = [
    ['crc16-ccitt-false', 'CRC16/CCITT-FALSE'],
    ['crc32-iso-hdlc', 'CRC32/ISO-HDLC'],
    ['md5', 'MD5'],
    ['sha-1', 'SHA-1'],
    ['sha-256', 'SHA-256'],
    ['sha-512', 'SHA-512'],
];
const EMPTY_INTEGRITY_CHECK_SET: IntegrityCheckSet = { schemaVersion: 1, checks: [] };
const INTEGRITY_STATUS_SYMBOLS: Record<string, string> = {
    Match: '✓', Mismatch: '✕', Calculated: '∑', Calculating: '…', Error: '!', 'Not configured': '?',
};

type PreparedCheck = { request: IntegrityRequest; storedField?: IntegrityStoredField };
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

export class IntegrityPanel {
    private readonly cb: IntegrityCallbacks;
    private _panel: HTMLElement | null = null;
    private nextCheckId = 1;
    private profiles: IntegrityProfile[] = [];
    private selectedProfileId = '';
    private profileError = '';
    private actionError = '';
    private profileNameMode: 'create' | 'rename' | null = null;
    private addCheckDraft: IntegrityDraft | null = null;
    private editingCheckId: number | null = null;
    private highlightedCheckId: number | null = null;
    private initialized = false;
    private checks: IntegrityCheckState[] = [];

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

    private newCheck(config?: IntegrityCheckConfig): IntegrityCheckState {
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

    private refreshProfileLibrary(): void {
        const current = document.querySelector<HTMLElement>('.integrity-profiles');
        if (!current) { this.render(); return; }
        current.outerHTML = this.profileLibraryHtml();
        this.wireProfileControls();
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
            ${this.profileLibraryHtml()}
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
        this.wireProfileControls();
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
        return this.checks.map(check => this.checkCardHtml(check)).join('');
    }

    private profileLibraryHtml(): string {
        const options = this.profiles.map(profile =>
            `<option value="${esc(profile.id)}"${profile.id === this.selectedProfileId ? ' selected' : ''}>${esc(profile.name)}</option>`
        ).join('');
        return `
        <div class="integrity-profiles">
            <select id="integrity-profile-select" class="struct-sel" title="Saved integrity profile">
                <option value="">Saved profiles…</option>${options}
            </select>
            <div class="integrity-profile-actions">
                <button id="integrity-profile-apply" class="struct-btn struct-btn-apply" type="button">Apply</button>
                <button id="integrity-profile-save" class="struct-btn struct-btn-secondary" type="button">Save as</button>
                <button id="integrity-profile-update" class="si-icon-btn" title="Update profile" type="button">↻</button>
                <button id="integrity-profile-rename" class="si-icon-btn" title="Rename profile" type="button">✎</button>
                <button id="integrity-profile-delete" class="si-icon-btn" title="Delete profile" type="button">🗑︎</button>
            </div>
            ${this.profileNameFormHtml()}
            <div id="integrity-profile-error" class="integrity-error" role="alert">${esc(this.profileError)}</div>
        </div>`;
    }

    private profileNameFormHtml(): string {
        if (!this.profileNameMode) { return ''; }
        return `<div class="integrity-profile-name-form">
        <input id="integrity-profile-name" class="struct-addr-inp" type="text" maxlength="80"
            value="${esc(this.profileNameValue())}" placeholder="Profile name" autocomplete="off" spellcheck="false">
        <button id="integrity-profile-name-save" class="struct-btn struct-btn-apply" type="button">${this.profileNameAction()}</button>
        <button id="integrity-profile-name-cancel" class="struct-btn struct-btn-cancel" type="button">Cancel</button>
    </div>`;
    }

    private profileNameValue(): string {
        if (this.profileNameMode !== 'rename') { return ''; }
        return this.profiles.find(profile => profile.id === this.selectedProfileId)?.name ?? '';
    }

    private profileNameAction(): string {
        return this.profileNameMode === 'rename' ? 'Rename' : 'Save';
    }

    private checkCardHtml(check: IntegrityCheckState): string {
        return `
        <div class="${this.checkCardClass(check.id)}" data-check-id="${check.id}">
            <div class="si-card-hdr" data-check-toggle>
                <span class="integrity-card-status" data-check-status></span>
                <div class="integrity-card-info">
                    <div class="integrity-card-title">${esc(this.algorithmLabel(check.algorithm))}</div>
                    <div class="integrity-card-meta">${esc(this.checkRangeSummary(check))}</div>
                </div>
                ${actionBtnsHtml(`data-check-id="${check.id}"`, `data-check-id="${check.id}"`)}
            </div>
            ${this.checkCardBodyHtml(check)}
        </div>`;
    }

    private checkCardClass(id: number): string {
        const selected = this.highlightedCheckId === id ? ' integrity-card-selected' : '';
        return `si-card integrity-card si-expanded${selected}`;
    }

    private autoFixToggleHtml(check: IntegrityCheckState): string {
        const checked = check.autoFixStoredValue ? ' checked' : '';
        const paused = this.isAutoFixSuppressed(check);
        const title = paused
            ? 'Auto fix paused for this discarded mismatch. Toggle off and on or use Fix all to re-apply.'
            : 'Automatically stage mismatched stored values';
        return `<label class="integrity-auto-fix${paused ? ' paused' : ''}" title="${title}">
        <input type="checkbox" data-auto-fix data-check-id="${check.id}"${checked}>
        <span class="integrity-auto-fix-label">Auto fix</span>
        <span class="integrity-auto-fix-track" aria-hidden="true"><span class="integrity-auto-fix-knob"></span></span>
    </label>`;
    }

    private isMismatchedCheck(check: IntegrityCheckState): boolean {
        return !check.calculating && this.hasComparableStoredValue(check) &&
            !integrityBytesEqual(check.expectedBytes, check.storedBytes);
    }

    private checkCardBodyHtml(check: IntegrityCheckState): string {
        if (this.editingCheckId === check.id) { return this.checkFormHtml(`edit-${check.id}`, this.draftFromCheck(check)); }
        return '<div class="integrity-card-body" data-check-body></div>';
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

    private algorithmLabel(algorithm: IntegrityAlgorithm): string {
        return ALGORITHM_LABELS.find(([value]) => value === algorithm)?.[1] ?? algorithm;
    }

    private checkRangeSummary(check: IntegrityCheckState): string {
        const range = check.startRaw && check.endRaw ? `${check.startRaw}–${check.endRaw}` : 'Not configured';
        return check.storedRaw ? `${range} · stored ${check.storedRaw}` : range;
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
        const display = this.calculatedDisplay(target.result);
        this.cb.onCopyText?.(`0x${display.value}`, `${this.algorithmLabel(target.algorithm)} calculated value`);
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
        this.persistChecks();
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
        this.persistChecks();
        this.fixEnabledMismatch(check, enabled);
    }

    private fixEnabledMismatch(check: IntegrityCheckState, enabled: boolean): void {
        if (!enabled) { return; }
        if (this.isMismatchedCheck(check)) { this.updateStoredValue(check); }
    }

    // ── Fix all ────────────────────────────────────────────────────

    private fixableChecks(): Array<{ check: IntegrityCheckState; update: StoredValueUpdate }> {
        const fixable: Array<{ check: IntegrityCheckState; update: StoredValueUpdate }> = [];
        for (const check of this.checks) {
            if (!this.isMismatchedCheck(check)) { continue; }
            const update = this.storedValueUpdate(check);
            if (update) { fixable.push({ check, update }); }
        }
        return fixable;
    }

    private hasFixableMismatches(): boolean {
        return this.checks.some(check => this.isMismatchedCheck(check));
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
        this.persistChecks();
        this.render();
        this.scheduleIntegrityCalculation(check);
    }

    private saveEditedCheck(id: number, draft: IntegrityDraft): void {
        const check = this.checks.find(item => item.id === id);
        if (!check) { return; }
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
        if (formId === 'add') { this.addCheckDraft = null; }
        else {
            this.editingCheckId = null;
        }
        this.render();
    }

    // ── Calculation scheduling ─────────────────────────────────────

    private scheduleIntegrityCalculation(check: IntegrityCheckState, preserveResult = false): void {
        const token = ++check.token;
        this.cancelPendingCalculation(check);
        if (preserveResult) { check.error = ''; }
        else { this.clearCheckResult(check); }
        const prepared = this.prepareIntegrityRequest(check);
        if (!prepared) { this.updateCheckCard(check); return; }
        check.calculating = true;
        if (!check.result) { check.meta = `Calculating ${this.formatByteCount(this.preparedByteCount(prepared))}…`; }
        this.updateCheckCard(check);
        check.timer = window.setTimeout(() => {
            check.timer = null;
            void this.calculateAndRender(check, token, prepared);
        }, DEBOUNCE_MS);
    }

    private cancelPendingCalculation(check: IntegrityCheckState): void {
        if (check.timer !== null) { window.clearTimeout(check.timer); }
        check.timer = null;
    }

    private clearCheckResult(check: IntegrityCheckState): void {
        clearIntegrityCheckResult(check);
    }

    private prepareIntegrityRequest(check: IntegrityCheckState): PreparedCheck | null {
        if (this.isUnconfiguredCheck(check)) {
            check.meta = 'Not configured';
            return null;
        }
        const range = validateIntegrityRange(check.startRaw, check.endRaw, check.algorithm);
        if (!range.ok) { check.error = range.error; return null; }
        const stored = this.parseStoredField(check);
        if (!stored.ok) { check.error = stored.error; return null; }
        return { request: range.value, storedField: stored.value };
    }

    private isUnconfiguredCheck(check: IntegrityCheckState): boolean {
        return !check.startRaw && !check.endRaw;
    }

    private parseStoredField(check: IntegrityCheckState): { ok: true; value?: IntegrityStoredField } | { ok: false; error: string } {
        if (!isChecksumAlgorithm(check.algorithm)) { return { ok: true, value: undefined }; }
        if (!check.storedRaw) { return { ok: true, value: undefined }; }
        const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
        if (!stored.ok) { return stored; }
        return { ok: true, value: { startAddress: stored.value, byteLength: this.integrityOutputByteLength(check.algorithm) } };
    }

    private integrityOutputByteLength(algorithm: IntegrityAlgorithm): number {
        return { 'crc16-ccitt-false': 2, 'crc32-iso-hdlc': 4, md5: 16, 'sha-1': 20, 'sha-256': 32, 'sha-512': 64 }[algorithm];
    }

    private preparedByteCount(prepared: PreparedCheck): number {
        const total = prepared.request.endAddress - prepared.request.startAddress + 1;
        return total - (prepared.storedField ? this.overlapByteCount(prepared.request, prepared.storedField) : 0);
    }

    private overlapByteCount(request: IntegrityRequest, field: IntegrityStoredField): number {
        const start = Math.max(request.startAddress, field.startAddress);
        const end = Math.min(request.endAddress, field.startAddress + field.byteLength - 1);
        return Math.max(0, end - start + 1);
    }

    private async calculateAndRender(check: IntegrityCheckState, token: number, prepared: PreparedCheck): Promise<void> {
        const readByte = this.cb.readByte;
        const bytes = await collectIntegrityBytesAsync(prepared.request, readByte, prepared.storedField);
        if (!bytes.ok) { this.applyCurrentError(check, token, bytes.error); return; }
        try {
            const result = await calculateIntegrity(prepared.request.algorithm, bytes.value);
            this.applyCalculatedResultIfCurrent(check, token, result, prepared.storedField, readByte);
        } catch (error) {
            this.applyCurrentError(check, token, error instanceof Error ? error.message : 'Integrity calculation failed.');
        }
    }

    private applyCurrentError(check: IntegrityCheckState, token: number, error: string): void {
        if (token !== check.token) { return; }
        check.calculating = false;
        check.error = error;
        this.updateCheckCard(check);
        this.syncHighlight();
    }

    private applyCalculatedResultIfCurrent(
        check: IntegrityCheckState,
        token: number,
        result: IntegrityResult,
        storedField: IntegrityStoredField | undefined,
        readByte: (address: number) => number | undefined,
    ): void {
        if (token !== check.token) { return; }
        check.result = result;
        check.expectedBytes = integrityValueToBytes(result.value, this.endian());
        check.storedBytes = null;
        check.calculating = false;
        check.meta = this.formatByteCount(result.byteCount);
        if (storedField) {
            const stored = readStoredIntegrityBytes(storedField, readByte);
            if (!stored.ok) { check.error = stored.error; this.updateCheckCard(check); return; }
            check.storedBytes = stored.value;
        }
        this.updateCheckCard(check);
        this.maybeAutoFix(check);
        this.syncHighlight();
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
        const label = this.checkStatusLabel(check);
        status.className = `integrity-card-status ${this.checkStatusClass(check)}`;
        status.textContent = INTEGRITY_STATUS_SYMBOLS[label] ?? label;
        status.title = label;
        status.setAttribute('aria-label', label);
    }

    private updateCheckCardBody(card: HTMLElement, check: IntegrityCheckState): void {
        const body = card.querySelector<HTMLElement>('[data-check-body]');
        if (!body) { return; }
        body.innerHTML = this.resultBodyHtml(check);
    }

    private updateFixAllControl(): void {
        const button = document.getElementById('integrity-fix-all') as HTMLButtonElement | null;
        if (button) { button.disabled = !this.hasFixableMismatches(); }
    }

    private checkStatusLabel(check: IntegrityCheckState): string {
        if (check.error) { return 'Error'; }
        if (check.calculating) { return 'Calculating'; }
        return this.completedCheckStatus(check);
    }

    private completedCheckStatus(check: IntegrityCheckState): string {
        if (!check.result) { return 'Not configured'; }
        if (!this.hasComparableStoredValue(check)) { return 'Calculated'; }
        return integrityBytesEqual(check.expectedBytes, check.storedBytes) ? 'Match' : 'Mismatch';
    }

    private hasComparableStoredValue(check: IntegrityCheckState): check is IntegrityCheckState & {
        expectedBytes: Uint8Array;
        storedBytes: Uint8Array;
    } {
        return !!check.storedBytes && !!check.expectedBytes;
    }

    private checkStatusClass(check: IntegrityCheckState): string {
        return this.checkStatusLabel(check).toLocaleLowerCase().replace(' ', '-');
    }

    private resultBodyHtml(check: IntegrityCheckState): string {
        if (check.error) { return `<div class="integrity-error">${esc(check.error)}</div>`; }
        if (check.result) { return this.calculatedResultBodyHtml(check, check.result); }
        if (check.calculating) { return this.pendingResultBodyHtml(check); }
        return this.emptyResultBodyHtml(check.meta);
    }

    private emptyResultBodyHtml(meta: string): string {
        return `<div class="integrity-card-empty">${esc(meta || 'No result yet.')}</div>`;
    }

    private pendingResultBodyHtml(check: IntegrityCheckState): string {
        const stored = this.hasStoredChecksum(check) ? this.pendingStoredResultHtml(check) : '';
        return `
        <div class="integrity-comparison${this.singleComparisonClass(stored)}">
            <div class="integrity-value-pane calculated pending">
                <div class="integrity-value-hdr">
                    <span>Calculated</span>
                    <button class="integrity-copy-btn" type="button" title="Copy calculated value" aria-label="Copy calculated value" disabled>⧉</button>
                </div>
                <code>${formatHexHtml('0x—')}</code>
            </div>
            ${stored}
        </div>
        <div class="integrity-result-meta">${esc(check.meta)}</div>`;
    }

    private pendingStoredResultHtml(check: IntegrityCheckState): string {
        return `<div class="integrity-value-pane stored unverified pending">
        <div class="integrity-value-hdr"><span>Stored (${this.endian().toUpperCase()})</span>${this.autoFixToggleHtml(check)}</div>
        <code>${formatHexHtml('0x—')}</code>
    </div>`;
    }

    private calculatedResultBodyHtml(check: IntegrityCheckState, result: IntegrityResult): string {
        const stored = this.storedResultHtml(check);
        const display = this.calculatedDisplay(result);
        return `
        <div class="integrity-comparison${this.singleComparisonClass(stored)}">
            <div class="integrity-value-pane calculated">
                <div class="integrity-value-hdr">
                    <span>${display.label}</span>
                    <button class="integrity-copy-btn" type="button" data-copy-calculated data-check-id="${check.id}" title="Copy calculated value" aria-label="Copy calculated value">⧉</button>
                </div>
                <code>${formatHexHtml(`0x${display.value}`)}</code>
            </div>
            ${stored}
        </div>
        <div class="integrity-result-meta">${esc(check.meta)}</div>`;
    }

    private calculatedDisplay(
        result: IntegrityResult,
    ): { label: string; value: string } {
        return { label: 'Calculated', value: result.value };
    }

    private hasStoredChecksum(check: IntegrityCheckState): boolean {
        return isChecksumAlgorithm(check.algorithm) && !!check.storedRaw;
    }

    private singleComparisonClass(storedHtml: string): string {
        return storedHtml ? '' : ' integrity-comparison-single';
    }

    private storedResultHtml(check: IntegrityCheckState): string {
        if (!isChecksumAlgorithm(check.algorithm) || !check.storedBytes) { return ''; }
        const state = this.highlightStatus(check);
        const raw = integrityBytesToHex(check.storedBytes);
        const value = integrityBytesToValueHex(check.storedBytes, this.endian());
        return `<div class="integrity-value-pane stored ${state}">
        <div class="integrity-value-hdr"><span>Stored (${this.endian().toUpperCase()})</span>${this.autoFixToggleHtml(check)}</div>
        <code title="Raw bytes: 0x${raw}">${formatHexHtml(`0x${value}`)}</code>
    </div>`;
    }

    // ── Auto fix ───────────────────────────────────────────────────

    private updateStoredValue(check: IntegrityCheckState): void {
        const update = this.storedValueUpdate(check);
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
        if (!this.isMismatchedCheck(check) || !check.expectedBytes || !check.storedBytes) { return ''; }
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

    // ── Highlight ──────────────────────────────────────────────────

    private syncHighlight(): void {
        const check = this.checks.find(item => item.id === this.highlightedCheckId);
        if (!check) { this.clearHighlight(); return; }
        const highlight = this.highlightForCheck(check);
        if (!highlight) { this.clearHighlight(); return; }
        this.cb.onHighlightChange?.(highlight);
    }

    private highlightForCheck(check: IntegrityCheckState): IntegrityHighlight | null {
        const range = validateIntegrityRange(check.startRaw, check.endRaw, check.algorithm);
        if (!range.ok) { return null; }
        const highlight: IntegrityHighlight = {
            rangeStart: range.value.startAddress,
            rangeEnd: range.value.endAddress,
            status: this.highlightStatus(check),
        };
        this.addStoredHighlight(highlight, check);
        return highlight;
    }

    private addStoredHighlight(highlight: IntegrityHighlight, check: IntegrityCheckState): void {
        if (!this.hasStoredChecksum(check)) { return; }
        const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
        if (!stored.ok) { return; }
        highlight.storedStart = stored.value;
        highlight.storedLength = this.integrityOutputByteLength(check.algorithm);
    }

    private highlightStatus(check: IntegrityCheckState): 'match' | 'mismatch' | 'unverified' {
        if (!this.hasComparableStoredValue(check)) { return 'unverified'; }
        return integrityBytesEqual(check.expectedBytes, check.storedBytes) ? 'match' : 'mismatch';
    }

    private clearHighlightedCheck(): void {
        this.highlightedCheckId = null;
        this.clearHighlight();
    }

    private clearHighlight(): void {
        this.cb.onHighlightChange?.(null);
    }

    private storedValueUpdate(check: IntegrityCheckState): StoredValueUpdate | null {
        if (!check.expectedBytes) { return null; }
        if (!check.storedRaw) { return null; }
        const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
        if (!stored.ok) { return null; }
        return { address: stored.value, expected: Uint8Array.from(check.expectedBytes) };
    }

    private formatByteCount(byteCount: number): string {
        return `${byteCount.toLocaleString()} byte${byteCount === 1 ? '' : 's'}`;
    }

    // ── Profile library ────────────────────────────────────────────

    private wireProfileControls(): void {
        const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
        select.addEventListener('change', () => {
            this.selectedProfileId = select.value;
            this.setProfileError('');
            this.updateProfileButtonState();
        });
        document.getElementById('integrity-profile-apply')?.addEventListener('click', () => this.applySelectedProfile());
        document.getElementById('integrity-profile-save')?.addEventListener('click', () => this.saveProfileAs());
        document.getElementById('integrity-profile-update')?.addEventListener('click', () => this.updateSelectedProfile());
        document.getElementById('integrity-profile-rename')?.addEventListener('click', () => this.renameSelectedProfile());
        document.getElementById('integrity-profile-delete')?.addEventListener('click', () => this.deleteSelectedProfile());
        this.wireProfileNameForm();
        this.updateProfileButtonState();
    }

    private wireProfileNameForm(): void {
        const input = document.getElementById('integrity-profile-name') as HTMLInputElement | null;
        if (!input) { return; }
        document.getElementById('integrity-profile-name-save')?.addEventListener('click', () => this.submitProfileName());
        document.getElementById('integrity-profile-name-cancel')?.addEventListener('click', () => this.closeProfileNameForm());
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { this.submitProfileName(); }
            if (event.key === 'Escape') { this.closeProfileNameForm(); }
        });
    }

    private updateProfileButtonState(): void {
        const noProfile = !this.selectedProfileId;
        ['apply', 'rename', 'delete'].forEach(action => {
            const button = document.getElementById(`integrity-profile-${action}`) as HTMLButtonElement | null;
            if (button) { button.disabled = noProfile; }
        });
        const noChecks = this.checks.length === 0;
        const save = document.getElementById('integrity-profile-save') as HTMLButtonElement | null;
        const update = document.getElementById('integrity-profile-update') as HTMLButtonElement | null;
        if (save) { save.disabled = noChecks; }
        if (update) { update.disabled = noProfile || noChecks; }
    }

    private activeConfigs(): IntegrityCheckConfig[] | null {
        if (this.checks.length === 0) { this.setProfileError('Add at least one integrity check.'); return null; }
        const configs = integrityCheckConfigsFromStates(this.checks);
        if (!configs.ok) { this.setProfileError(configs.error); return null; }
        return configs.value;
    }

    private persistChecks(): void {
        const state = integrityCheckSetFromStates(this.checks);
        if (state.ok) { this.cb.onPersistChecks?.(state.value); }
    }

    private applySelectedProfile(): void {
        const profile = this.profiles.find(item => item.id === this.selectedProfileId);
        if (!profile) { return; }
        this.checks.forEach(check => this.cancelPendingCalculation(check));
        this.checks = profile.checks.map(check => this.newCheck(check));
        this.addCheckDraft = null;
        this.editingCheckId = null;
        this.clearHighlightedCheck();
        this.persistChecks();
        this.render();
        this.checks.forEach(check => this.scheduleIntegrityCalculation(check));
    }

    private saveProfileAs(): void {
        if (!this.activeConfigs()) { return; }
        this.openProfileNameForm('create');
    }

    private updateSelectedProfile(): void {
        const current = this.profiles.find(profile => profile.id === this.selectedProfileId);
        const checks = this.activeConfigs();
        if (!current || !checks) { return; }
        this.cb.onUpdateProfile?.({ ...current, checks });
    }

    private renameSelectedProfile(): void {
        const current = this.profiles.find(profile => profile.id === this.selectedProfileId);
        if (!current) { return; }
        this.openProfileNameForm('rename');
    }

    private openProfileNameForm(mode: 'create' | 'rename'): void {
        this.profileNameMode = mode;
        this.setProfileError('');
        this.refreshProfileLibrary();
        document.getElementById('integrity-profile-name')?.focus();
    }

    private closeProfileNameForm(): void {
        this.profileNameMode = null;
        this.setProfileError('');
        this.refreshProfileLibrary();
    }

    private submitProfileName(): void {
        const input = document.getElementById('integrity-profile-name') as HTMLInputElement | null;
        if (!input) { return; }
        const name = input.value.trim();
        if (!name) { this.setProfileError('Profile name is required.'); return; }
        this.submitValidProfileName(name);
    }

    private submitValidProfileName(name: string): void {
        if (this.profileNameMode === 'create') { this.createNamedProfile(name); return; }
        if (this.profileNameMode === 'rename') { this.renameProfileTo(name); }
    }

    private createNamedProfile(name: string): void {
        const checks = this.activeConfigs();
        if (!checks) { return; }
        if (this.profileNameExists(name)) { this.setProfileError(`A profile named “${name}” already exists.`); return; }
        const id = `integrity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.selectedProfileId = id;
        this.profileNameMode = null;
        this.cb.onCreateProfile?.({ schemaVersion: 1, id, name, checks });
    }

    private renameProfileTo(name: string): void {
        const current = this.selectedProfile();
        if (!this.isDistinctProfileName(current, name)) { this.closeProfileNameForm(); return; }
        if (this.profileNameExists(name, current.id)) { this.setProfileError(`A profile named “${name}” already exists.`); return; }
        this.profileNameMode = null;
        this.cb.onRenameProfile?.(current.id, name);
    }

    private isDistinctProfileName(current: IntegrityProfile | undefined, name: string): current is IntegrityProfile {
        return !!current && name !== current.name;
    }

    private selectedProfile(): IntegrityProfile | undefined {
        return this.profiles.find(profile => profile.id === this.selectedProfileId);
    }

    private deleteSelectedProfile(): void {
        const current = this.selectedProfile();
        if (!current) { return; }
        this.cb.onDeleteProfile?.(current.id);
    }

    private profileNameExists(name: string, exceptId = ''): boolean {
        const normalized = name.toLocaleLowerCase();
        return this.profiles.some(profile => profile.id !== exceptId && profile.name.toLocaleLowerCase() === normalized);
    }

    private setProfileError(message: string): void {
        this.profileError = message;
        const error = document.getElementById('integrity-profile-error');
        if (error) { error.textContent = message; }
    }
}
