// ── Integrity profile library logic ──────────────────────────────
// Profile selector/actions wiring, name-form state machine, and the
// profile CRUD + checks persistence flow (split out of IntegrityPanel.ts).
// Functions operate on an IntegrityProfileHost (the panel exposing its
// state + the handful of methods the library needs); DOM reads/writes
// happen here, model/domain state stays host-owned.

import {
    type IntegrityCheckConfig,
    type IntegrityProfile,
} from '../../../../core/integrity';
import { esc, inlineConfirm } from '../../../utils';
import {
    integrityCheckConfigsFromStates,
    integrityCheckSetFromStates,
    type IntegrityCheckState,
    type IntegrityDraft,
} from './integrityCheckModel';
import type { IntegrityCallbacks } from './integrityPanel';

export interface IntegrityProfileHost {
    profiles: IntegrityProfile[];
    selectedProfileId: string;
    profileNameMode: 'create' | 'rename' | null;
    profileError: string;
    checks: IntegrityCheckState[];
    addCheckDraft: IntegrityDraft | null;
    editingCheckId: number | null;
    cb: Pick<IntegrityCallbacks, 'onPersistChecks' | 'onCreateProfile' | 'onUpdateProfile' | 'onRenameProfile' | 'onDeleteProfile'>;
    render(): void;
    newCheck(config?: IntegrityCheckConfig): IntegrityCheckState;
    cancelPendingCalculation(check: IntegrityCheckState): void;
    scheduleIntegrityCalculation(check: IntegrityCheckState): void;
    clearHighlightedCheck(): void;
}

export function wireProfileControls(panel: IntegrityProfileHost): void {
    const select = document.getElementById('integrity-profile-select') as HTMLSelectElement;
    select.addEventListener('change', () => {
        panel.selectedProfileId = select.value;
        setProfileError(panel, '');
        updateProfileButtonState(panel);
    });
    document.getElementById('integrity-profile-apply')?.addEventListener('click', () => applySelectedProfile(panel));
    document.getElementById('integrity-profile-save')?.addEventListener('click', () => saveProfileAs(panel));
    document.getElementById('integrity-profile-update')?.addEventListener('click', () => updateSelectedProfile(panel));
    document.getElementById('integrity-profile-rename')?.addEventListener('click', () => renameSelectedProfile(panel));
    document.getElementById('integrity-profile-delete')?.addEventListener('click', () => deleteSelectedProfile(panel));
    wireProfileNameForm(panel);
    updateProfileButtonState(panel);
}

function wireProfileNameForm(panel: IntegrityProfileHost): void {
    const input = document.getElementById('integrity-profile-name') as HTMLInputElement | null;
    if (!input) { return; }
    document.getElementById('integrity-profile-name-save')?.addEventListener('click', () => submitProfileName(panel));
    document.getElementById('integrity-profile-name-cancel')?.addEventListener('click', () => closeProfileNameForm(panel));
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { submitProfileName(panel); }
        if (event.key === 'Escape') { closeProfileNameForm(panel); }
    });
}

function updateProfileButtonState(panel: IntegrityProfileHost): void {
    const noProfile = !panel.selectedProfileId;
    ['apply', 'rename', 'delete'].forEach(action => {
        const button = document.getElementById(`integrity-profile-${action}`) as HTMLButtonElement | null;
        if (button) { button.disabled = noProfile; }
    });
    const noChecks = panel.checks.length === 0;
    const save = document.getElementById('integrity-profile-save') as HTMLButtonElement | null;
    const update = document.getElementById('integrity-profile-update') as HTMLButtonElement | null;
    if (save) { save.disabled = noChecks; }
    if (update) { update.disabled = noProfile || noChecks; }
}

function activeConfigs(panel: IntegrityProfileHost): IntegrityCheckConfig[] | null {
    if (panel.checks.length === 0) { setProfileError(panel, 'Add at least one integrity check.'); return null; }
    const configs = integrityCheckConfigsFromStates(panel.checks);
    if (!configs.ok) { setProfileError(panel, configs.error); return null; }
    return configs.value;
}

export function persistChecks(panel: IntegrityProfileHost): void {
    const state = integrityCheckSetFromStates(panel.checks);
    if (state.ok) { panel.cb.onPersistChecks?.(state.value); }
}

function applySelectedProfile(panel: IntegrityProfileHost): void {
    const profile = panel.profiles.find(item => item.id === panel.selectedProfileId);
    if (!profile) { return; }
    if (hasUnsavedProfileDraft(panel)) {
        const applyBtn = document.getElementById('integrity-profile-apply') as HTMLElement | null;
        if (applyBtn) {
            inlineConfirm(applyBtn, () => applyProfileChecks(panel, profile), 'Apply profile? Unsaved check edits will be replaced.');
            return;
        }
    }
    applyProfileChecks(panel, profile);
}

function hasUnsavedProfileDraft(panel: IntegrityProfileHost): boolean {
    return panel.addCheckDraft !== null || panel.editingCheckId !== null;
}

function applyProfileChecks(panel: IntegrityProfileHost, profile: IntegrityProfile): void {
    panel.checks.forEach(check => panel.cancelPendingCalculation(check));
    panel.checks = profile.checks.map(check => panel.newCheck(check));
    panel.addCheckDraft = null;
    panel.editingCheckId = null;
    panel.clearHighlightedCheck();
    persistChecks(panel);
    panel.render();
    panel.checks.forEach(check => panel.scheduleIntegrityCalculation(check));
}

function saveProfileAs(panel: IntegrityProfileHost): void {
    if (!activeConfigs(panel)) { return; }
    openProfileNameForm(panel, 'create');
}

function updateSelectedProfile(panel: IntegrityProfileHost): void {
    const current = panel.profiles.find(profile => profile.id === panel.selectedProfileId);
    const checks = activeConfigs(panel);
    if (!current || !checks) { return; }
    panel.cb.onUpdateProfile?.({ ...current, checks });
}

function renameSelectedProfile(panel: IntegrityProfileHost): void {
    const current = panel.profiles.find(profile => profile.id === panel.selectedProfileId);
    if (!current) { return; }
    openProfileNameForm(panel, 'rename');
}

function openProfileNameForm(panel: IntegrityProfileHost, mode: 'create' | 'rename'): void {
    panel.profileNameMode = mode;
    setProfileError(panel, '');
    refreshProfileLibrary(panel);
    document.getElementById('integrity-profile-name')?.focus();
}

function closeProfileNameForm(panel: IntegrityProfileHost): void {
    panel.profileNameMode = null;
    setProfileError(panel, '');
    refreshProfileLibrary(panel);
}

function submitProfileName(panel: IntegrityProfileHost): void {
    const input = document.getElementById('integrity-profile-name') as HTMLInputElement | null;
    if (!input) { return; }
    const name = input.value.trim();
    if (!name) { setProfileError(panel, 'Profile name is required.'); return; }
    submitValidProfileName(panel, name);
}

function submitValidProfileName(panel: IntegrityProfileHost, name: string): void {
    if (panel.profileNameMode === 'create') { createNamedProfile(panel, name); return; }
    if (panel.profileNameMode === 'rename') { renameProfileTo(panel, name); }
}

function createNamedProfile(panel: IntegrityProfileHost, name: string): void {
    const checks = activeConfigs(panel);
    if (!checks) { return; }
    if (profileNameExists(panel, name)) { setProfileError(panel, `A profile named “${name}” already exists.`); return; }
    const id = `integrity_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    panel.selectedProfileId = id;
    panel.profileNameMode = null;
    panel.cb.onCreateProfile?.({ schemaVersion: 1, id, name, checks });
}

function renameProfileTo(panel: IntegrityProfileHost, name: string): void {
    const current = selectedProfile(panel);
    if (!isDistinctProfileName(current, name)) { closeProfileNameForm(panel); return; }
    if (profileNameExists(panel, name, current.id)) { setProfileError(panel, `A profile named “${name}” already exists.`); return; }
    panel.profileNameMode = null;
    panel.cb.onRenameProfile?.(current.id, name);
}

function isDistinctProfileName(current: IntegrityProfile | undefined, name: string): current is IntegrityProfile {
    return !!current && name !== current.name;
}

function selectedProfile(panel: IntegrityProfileHost): IntegrityProfile | undefined {
    return panel.profiles.find(profile => profile.id === panel.selectedProfileId);
}

function deleteSelectedProfile(panel: IntegrityProfileHost): void {
    const current = selectedProfile(panel);
    if (!current) { return; }
    const btn = document.getElementById('integrity-profile-delete') as HTMLElement | null;
    if (btn) {
        inlineConfirm(btn, () => panel.cb.onDeleteProfile?.(current.id));
        return;
    }
    panel.cb.onDeleteProfile?.(current.id);
}

function profileNameExists(panel: IntegrityProfileHost, name: string, exceptId = ''): boolean {
    const normalized = name.toLocaleLowerCase();
    return panel.profiles.some(profile => profile.id !== exceptId && profile.name.toLocaleLowerCase() === normalized);
}

function setProfileError(panel: IntegrityProfileHost, message: string): void {
    panel.profileError = message;
    const error = document.getElementById('integrity-profile-error');
    if (error) { error.textContent = message; }
}

export function refreshProfileLibrary(panel: IntegrityProfileHost): void {
    const current = document.querySelector<HTMLElement>('.integrity-profiles');
    if (!current) { panel.render(); return; }
    current.outerHTML = profileLibraryHtml(panel);
    wireProfileControls(panel);
}

export function profileLibraryHtml(panel: IntegrityProfileHost): string {
    const options = panel.profiles.map(profile =>
        `<option value="${esc(profile.id)}"${profile.id === panel.selectedProfileId ? ' selected' : ''}>${esc(profile.name)}</option>`
    ).join('');
    return `
    <div class="integrity-profiles">
        <select id="integrity-profile-select" class="struct-sel" title="Saved integrity profile">
            <option value="">Saved profiles…</option>${options}
        </select>
        <div class="integrity-profile-actions">
            <button id="integrity-profile-apply" class="struct-btn struct-btn-apply" type="button">Apply</button>
            <button id="integrity-profile-save" class="struct-btn struct-btn-secondary" type="button">Save as</button>
            <button id="integrity-profile-update" class="si-icon-btn" title="Update profile" aria-label="Update profile" type="button">↻</button>
            <button id="integrity-profile-rename" class="si-icon-btn" title="Rename profile" aria-label="Rename profile" type="button">✎</button>
            <button id="integrity-profile-delete" class="si-icon-btn" title="Delete profile" aria-label="Delete profile" type="button">🗑︎</button>
        </div>
        ${profileNameFormHtml(panel)}
        <div id="integrity-profile-error" class="integrity-error" role="alert">${esc(panel.profileError)}</div>
    </div>`;
}

function profileNameFormHtml(panel: IntegrityProfileHost): string {
    if (!panel.profileNameMode) { return ''; }
    return `<div class="integrity-profile-name-form">
    <input id="integrity-profile-name" class="struct-addr-inp" type="text" maxlength="80"
        value="${esc(profileNameValue(panel))}" placeholder="Profile name" autocomplete="off" spellcheck="false">
    <button id="integrity-profile-name-save" class="struct-btn struct-btn-apply" type="button">${profileNameAction(panel)}</button>
    <button id="integrity-profile-name-cancel" class="struct-btn struct-btn-cancel" type="button">Cancel</button>
</div>`;
}

function profileNameValue(panel: IntegrityProfileHost): string {
    if (panel.profileNameMode !== 'rename') { return ''; }
    return panel.profiles.find(profile => profile.id === panel.selectedProfileId)?.name ?? '';
}

function profileNameAction(panel: IntegrityProfileHost): string {
    return panel.profileNameMode === 'rename' ? 'Rename' : 'Save';
}
