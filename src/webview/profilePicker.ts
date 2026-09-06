// ── Profile picker (toolbar dropdown + actions menu) ──────────────
// Host-adjacent, stateless module extracted from hexViewer.ts (review
// finding R1 — shotgun surgery). Renders the `#profile-picker` dropdown,
// owns the ⋮ actions menu wiring, and the shared-profile switch toast.
// Host keeps the `#profile-picker` shell, delegates `profilesState` /
// `activateProfilePicker` handlers here, and calls render()/seed() on UI
// setup and re-render invalidation.

import { S } from './state';
import { postProviderMessage } from './vscodeApi';
import { esc } from './utils';
import { showToast } from './components/toast';
import { menuController } from './components/menuController/menuController';
import { applyProviderMessageToModel } from './webviewMessageModel';
import type { ProfileSummary, ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';

type WebviewMessage = ProviderToWebviewMessage;
type WebviewMessageByType<T extends WebviewMessage['type']> = Extract<WebviewMessage, { type: T }>;

/** The four profile actions exposed through the ⋮ menu (D5: typed bridge). */
type ProfileAction = 'saveProfile' | 'duplicateProfile' | 'renameProfile' | 'deleteProfile';

/** Menu command → provider message (the controller closes the menu). */
const PROFILE_ACTION_MESSAGES: Record<ProfileAction, WebviewToProviderMessage> = {
    saveProfile: { type: 'saveProfile' },
    duplicateProfile: { type: 'duplicateProfile' },
    renameProfile: { type: 'renameProfile' },
    deleteProfile: { type: 'deleteProfile' },
};

function isProfileAction(cmd: string): cmd is ProfileAction {
    return cmd in PROFILE_ACTION_MESSAGES;
}

/** Last bound profile id seen by the webview; seeds the switch-detection
 *  for the shared-profile toast (open never toasts). */
let lastProfileCurrent: string | null = null;

/** Toolbar profile dropdown (always rendered) + actions menu. */
function render(): void {
    const host = document.getElementById('profile-picker');
    if (!host) { return; }
    const { profiles, current, boundFileCount } = S.profileState;
    const currentName = profileNameFor(profiles, current);
    const optionsHtml = profileDropdownOptions(profiles, current).join('');
    const bound = current !== null;
    const title = profileSelectTitle(currentName, bound, boundFileCount);
    host.innerHTML = `
        <label class="profile-label" for="profile-select" title="Select the annotation profile bound to this file">Profile</label>
        <select id="profile-select" class="profile-select" aria-label="Profile" title="${esc(title)}">
            ${optionsHtml}
        </select>
        <button id="profile-actions-btn" class="sb-btn sb-btn-secondary" type="button"
            title="Profile actions" aria-label="Profile actions" aria-haspopup="menu" aria-expanded="false">⋮</button>`;
    const select = host.querySelector('#profile-select') as HTMLSelectElement;
    select.value = current ?? '';
    if (isSeparatorValue(select.value)) { select.value = ''; }
    select.addEventListener('change', () => onProfileSelect(select, current));
    wireProfileActions();
}

/** Seed the switch-detection baseline (open never toasts for the current profile). */
function seed(): void {
    lastProfileCurrent = S.profileState.current;
}

function handleProfilesState(msg: WebviewMessageByType<'profilesState'>): void {
    // Model apply first so the toast reads fresh state. The only host effect
    // this message triggers is the dropdown re-render — done inline here.
    applyProviderMessageToModel(msg);
    render();
    const { profiles, current, boundFileCount } = S.profileState;
    // One transient toast when the user switches to a shared profile (never
    // on open, never repeated for the same profile).
    if (current !== null && current !== lastProfileCurrent && boundFileCount > 1) {
        showToast(`Shared profile "${profileNameFor(profiles, current)}" used by ${boundFileCount} files`);
    }
    lastProfileCurrent = current;
}

function handleActivatePicker(_msg: WebviewMessageByType<'activateProfilePicker'>): void {
    const select = document.getElementById('profile-select') as HTMLSelectElement | null;
    if (select) {
        select.focus();
        select.showPicker?.();
    }
}

function profileNameFor(profiles: ProfileSummary[], current: string | null): string {
    return profiles.find(p => p.id === current)?.name ?? 'No Profile';
}

function profileDropdownOptions(profiles: ProfileSummary[], current: string | null): string[] {
    const noProfileAttr = current === null ? ' disabled' : '';
    return [
        `<option value="" data-kind="none"${noProfileAttr}>No Profile</option>`,
        '<option value="__sep__" disabled>────────</option>',
        ...profiles.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`),
        '<option value="__sep2__" disabled>────</option>',
        '<option value="__new__">+ New Profile…</option>',
    ];
}

function isSeparatorValue(value: string): boolean {
    return value === '__sep__' || value === '__sep2__';
}

function onProfileSelect(select: HTMLSelectElement, current: string | null): void {
    const v = select.value;
    if (v === '__new__') { handleNewProfile(select, current); return; }
    if (isSeparatorValue(v)) { resetSelectToCurrent(select, current); return; }
    postProviderMessage({ type: 'selectProfile', profileId: selectionProfileId(v) });
}

function handleNewProfile(select: HTMLSelectElement, current: string | null): void {
    // VS Code webviews block window.prompt; the name is asked host-side via
    // vscode.window.showInputBox (hexEditorSession newProfile handler).
    postProviderMessage({ type: 'newProfile', name: null });
    resetSelectToCurrent(select, current);
}

function resetSelectToCurrent(select: HTMLSelectElement, current: string | null): void {
    select.value = current ?? '';
}

function selectionProfileId(value: string): string | null {
    return value === '' ? null : value;
}

/** Select tooltip: shared-profile state surfaces here (R9 — persistent hint removed). */
function profileSelectTitle(currentName: string, bound: boolean, boundFileCount: number): string {
    if (!bound) { return 'No profile bound to this file'; }
    return boundFileCount > 1 ? `${currentName} · shared by ${boundFileCount} files` : currentName;
}

/** Profile actions menu rows (shared menu presentation); disabled when no profile is bound. */
function profileActionsHtml(bound: boolean): string {
    const dis = bound ? '' : ' menu-disabled';
    const row = (cmd: ProfileAction, label: string) =>
        `<div class="menu-item${dis}" data-cmd="${cmd}" role="menuitem" tabindex="-1"><span class="menu-label">${label}</span></div>`;
    return `<div class="menu-header">Profile actions</div>
        ${row('saveProfile', 'Save')}
        ${row('duplicateProfile', 'Save as…')}
        ${row('renameProfile', 'Rename')}
        ${row('deleteProfile', 'Delete')}`;
}

/** Wire the ⋮ toggle to the shared menu component (internal #menu, positioned at
 *  the button). The toggle stops propagation so the opening click is not seen by
 *  the controller's document-level dismissal listener. */
function wireProfileActions(): void {
    const btn = document.getElementById('profile-actions-btn') as HTMLButtonElement | null;
    if (!btn) { return; }
    btn.addEventListener('click', event => {
        event.stopPropagation();
        const r = btn.getBoundingClientRect();
        menuController.show(r.left, r.bottom + 4, {
            innerHTML: profileActionsHtml(S.profileState.current !== null),
            emit: handleProfileAction,
        });
    });
}

/** Menu command → provider message (the controller closes the menu). */
function handleProfileAction(cmd: string): void {
    if (!isProfileAction(cmd)) { return; }
    postProviderMessage(PROFILE_ACTION_MESSAGES[cmd]);
}

/** Module surface consumed by hexViewer.ts. */
export const profilePicker = {
    render,
    seed,
    handleProfilesState,
    handleActivatePicker,
};