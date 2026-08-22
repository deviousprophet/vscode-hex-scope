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
import { closeMenuPopup, toggleMenuPopup, wireMenuPopup } from '../sidebar';
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
        const prev = panel.selectedProfileId;
        panel.selectedProfileId = select.value;
        setProfileError(panel, '');
        applySelectedProfile(panel, prev);
    });
    wireProfileMenu();
    document.getElementById('integrity-profile-save')?.addEventListener('click', () => saveProfileAs(panel));
    document.getElementById('integrity-profile-update')?.addEventListener('click', () => updateSelectedProfile(panel));
    document.getElementById('integrity-profile-rename')?.addEventListener('click', () => renameSelectedProfile(panel));
    document.getElementById('integrity-profile-delete')?.addEventListener('click', () => deleteSelectedProfile(panel));
    wireProfileNameForm(panel);
    updateProfileButtonState(panel);
}

/** ⋮ popover menu: shared open/close, Escape, click-outside, aria state (sidebar.ts). */
function wireProfileMenu(): void {
    const button = document.getElementById('integrity-profile-menu-btn') as HTMLButtonElement | null;
    const pop = document.getElementById('integrity-profile-menu-pop');
    if (!button || !pop) { return; }
    wireMenuPopup(pop, {
        button,
        root: button.closest('.integrity-profile-menu') ?? undefined,
        focusFirst: '.integrity-profile-menu-item:not(:disabled)',
    });
    button.addEventListener('click', event => {
        event.stopPropagation();
        toggleMenuPopup(pop);
    });
    pop.addEventListener('click', event => {
        if ((event.target as HTMLElement).closest('.integrity-profile-menu-item')) {
            closeMenuPopup(pop);
        }
    });
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
    ['rename', 'delete'].forEach(action => {
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

function applySelectedProfile(panel: IntegrityProfileHost, prevId: string): void {
    const profile = panel.profiles.find(item => item.id === panel.selectedProfileId);
    if (!profile) { return; }
    if (confirmProfileApply(panel, profile, prevId)) { return; }
    applyProfileChecks(panel, profile);
}

/** Show the overwrite confirmation; true when it took over the click. Cancelling
    (No/outside/Escape) reverts the dropdown to the previously selected profile. */
function confirmProfileApply(panel: IntegrityProfileHost, profile: IntegrityProfile, prevId: string): boolean {
    if (!hasUnsavedProfileDraft(panel) && !wouldOverwriteChangedChecks(panel, profile)) { return false; }
    const anchor = document.getElementById('integrity-profile-select') as HTMLElement | null;
    if (!anchor) { return false; }
    inlineConfirm(
        anchor,
        () => applyProfileChecks(panel, profile),
        'Apply profile? Current checks will be replaced.',
        () => revertProfileSelection(panel, prevId),
    );
    return true;
}

/** Dropdown reverted to the previously selected profile — no change event fired. */
function revertProfileSelection(panel: IntegrityProfileHost, prevId: string): void {
    panel.selectedProfileId = prevId;
    const select = document.getElementById('integrity-profile-select') as HTMLSelectElement | null;
    if (select) { select.value = prevId; }
}

function hasUnsavedProfileDraft(panel: IntegrityProfileHost): boolean {
    return panel.addCheckDraft !== null || panel.editingCheckId !== null;
}

/** True when applying `profile` would silently overwrite configured-but-different checks. */
function wouldOverwriteChangedChecks(panel: IntegrityProfileHost, profile: IntegrityProfile): boolean {
    const state = integrityCheckSetFromStates(panel.checks);
    if (!state.ok) { return panel.checks.length > 0; }
    if (state.value.checks.length === 0) { return false; } // nothing configured: normal first apply
    return !configsEqual(state.value.checks, profile.checks);
}

function configsEqual(a: IntegrityCheckConfig[], b: IntegrityCheckConfig[]): boolean {
    return a.length === b.length && a.every((ca, i) => sameCheck(ca, b[i]));
}

function sameCheck(a: IntegrityCheckConfig, b: IntegrityCheckConfig): boolean {
    return sameRange(a, b) && sameStored(a, b);
}

function sameRange(a: IntegrityCheckConfig, b: IntegrityCheckConfig): boolean {
    return a.algorithm === b.algorithm
        && a.startAddress === b.startAddress
        && a.endAddress === b.endAddress;
}

function sameStored(a: IntegrityCheckConfig, b: IntegrityCheckConfig): boolean {
    return (a.storedAddress ?? 0) === (b.storedAddress ?? 0)
        && a.autoFixStoredValue === b.autoFixStoredValue;
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
    const disabled = panel.profiles.length === 0 ? ' disabled' : '';
    const emptyHint = panel.profiles.length === 0
        ? '<div class="sb-empty integrity-profile-empty">No profiles yet — add a check, then Save as…</div>'
        : '';
    return `
    <div class="integrity-profiles">
        <div class="integrity-profile-row">
            <select id="integrity-profile-select" class="sb-select" title="Saved integrity profile"${disabled}>
                ${options}
            </select>
            <button id="integrity-profile-save" class="sb-btn sb-btn-secondary" type="button"
                title="Save current checks as a new profile">Save as…</button>
            <div class="integrity-profile-menu">
                <button id="integrity-profile-menu-btn" class="sb-btn sb-btn-secondary" type="button"
                    title="Profile actions" aria-label="Profile actions" aria-haspopup="menu" aria-expanded="false">⋮</button>
                <div id="integrity-profile-menu-pop" class="integrity-profile-menu-pop" role="menu" hidden>
                    <button id="integrity-profile-update" class="integrity-profile-menu-item" type="button" role="menuitem">Update</button>
                    <button id="integrity-profile-rename" class="integrity-profile-menu-item" type="button" role="menuitem">Rename</button>
                    <button id="integrity-profile-delete" class="integrity-profile-menu-item" type="button" role="menuitem">Delete</button>
                </div>
            </div>
        </div>
        ${emptyHint}
        ${profileNameFormHtml(panel)}
        <div id="integrity-profile-error" class="integrity-error" role="alert">${esc(panel.profileError)}</div>
    </div>`;
}

function profileNameFormHtml(panel: IntegrityProfileHost): string {
    if (!panel.profileNameMode) { return ''; }
    return `<div class="integrity-profile-name-form">
    <input id="integrity-profile-name" class="sb-input" type="text" maxlength="80"
        value="${esc(profileNameValue(panel))}" placeholder="Profile name" autocomplete="off" spellcheck="false">
    <button id="integrity-profile-name-save" class="sb-btn sb-btn-primary" type="button">${profileNameAction(panel)}</button>
    <button id="integrity-profile-name-cancel" class="sb-btn sb-btn-secondary" type="button">Cancel</button>
</div>`;
}

function profileNameValue(panel: IntegrityProfileHost): string {
    if (panel.profileNameMode !== 'rename') { return ''; }
    return panel.profiles.find(profile => profile.id === panel.selectedProfileId)?.name ?? '';
}

function profileNameAction(panel: IntegrityProfileHost): string {
    return panel.profileNameMode === 'rename' ? 'Rename' : 'Save';
}
