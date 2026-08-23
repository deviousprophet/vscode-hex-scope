// ── File Profiles sidebar panel ─────────────────────────────────
// Team-shared File Profiles: list + active indicator + select/apply +
// save-as (name + integrity binding) + rename/delete. Component owns all
// panel markup + form UI state; data is pushed via setters, actions
// report via callbacks. Never reads/writes the `S` global, never posts
// provider messages.

import { esc, inlineConfirm } from '../../../utils';
import type { IntegrityProfile } from '../../../../core/integrity';
import type { FileProfile } from '../../../../core/workspaceConfigModel';
import type { StructPin } from '../../../../core/types';
import { SidebarSections } from '../sidebar';
import './fileProfilesPanel.css';

export interface FileProfilesCallbacks {
    onSelect: (id: string | null) => void;
    onCreate: (name: string, integrityProfileId: string | null) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    getPins: () => StructPin[];
    getEndian: () => 'le' | 'be';
}

type ProfileFormMode = 'create' | 'rename' | null;

export class FileProfilesPanel {
    private _panel: HTMLElement | null = null;
    private sections: SidebarSections | null = null;
    private profiles: FileProfile[] = [];
    private activeFileProfileId: string | null = null;
    private integrityProfiles: IntegrityProfile[] = [];
    private errorMessage = '';
    private formMode: ProfileFormMode = null;
    private formTargetId: string | null = null;

    constructor(private readonly cb: FileProfilesCallbacks) {}

    /** Renders the panel into the given root (creates the #s-file-profiles container). Idempotent. */
    mount(root: HTMLElement): void {
        this._panel = root.id === 's-file-profiles' ? root : this.ensureRoot(root);
        this._panel.innerHTML = '';
        this.sections = new SidebarSections(this._panel, 'fileprofiles', [
            { id: 'main', label: 'File Profile' },
        ]);
        this.render();
    }

    private ensureRoot(root: HTMLElement): HTMLElement {
        const existing = root.querySelector<HTMLElement>('#s-file-profiles');
        if (existing) { return existing; }
        const div = document.createElement('div');
        div.id = 's-file-profiles';
        root.appendChild(div);
        return div;
    }

    /** Re-renders the whole panel body. No-op until mounted. */
    render(): void {
        const body = this.sections?.body('main');
        if (!body) { return; }
        body.innerHTML = this.bodyHtml();
        this.wireRendered(body);
    }

    /** Push profile list + active selection; integrity profiles may be refreshed together. */
    setProfiles(profiles: FileProfile[], activeId: string | null, integrityProfiles?: IntegrityProfile[]): void {
        this.profiles = Array.isArray(profiles) ? profiles : [];
        this.activeFileProfileId = activeId;
        if (integrityProfiles) { this.integrityProfiles = integrityProfiles; }
        if (this.activeFileProfileId && !this.profiles.some(profile => profile.id === this.activeFileProfileId)) {
            this.activeFileProfileId = null;
        }
        this.errorMessage = '';
        if (document.getElementById('s-file-profiles')) { this.render(); }
    }

    /** Push a profile-list error (keeps the list; renders the message). */
    setError(error: string): void {
        this.errorMessage = error;
        if (document.getElementById('s-file-profiles')) { this.render(); }
    }

    /** Host pushes the active sidebar tab (lazy-init gate). */
    setTabActive(active: boolean): void {
        if (!active) { return; }
        this.render();
    }

    private bodyHtml(): string {
        const options = ['<option value="">None</option>']
            .concat(this.profiles.map(profile =>
                `<option value="${esc(profile.id)}"${profile.id === this.activeFileProfileId ? ' selected' : ''}>${esc(profile.name)}</option>`,
            ))
            .join('');
        const hasProfiles = this.profiles.length > 0;
        const activeProfile = this.profiles.find(profile => profile.id === this.activeFileProfileId) ?? null;
        const hint = activeProfile
            ? `${activeProfile.pins.length} pins · ${activeProfile.endian.toUpperCase()}`
                + (activeProfile.integrityProfileId ? ' · integrity profile' : '')
            : '';
        const bindingOptions = ['<option value="">(none)</option>']
            .concat(this.integrityProfiles.map(profile => `<option value="${esc(profile.id)}">${esc(profile.name)}</option>`))
            .join('');
        const form = this.formMode === null ? '' : `
        <div class="fp-name-form">
            <input id="fp-name" class="sb-input" type="text" maxlength="40" placeholder="Profile name"
                   aria-label="Profile name" spellcheck="false" autocomplete="off"
                   value="${esc(this.formMode === 'rename' ? (activeProfile?.name ?? '') : '')}">
            ${this.formMode === 'create' ? `
            <label class="fp-binding-label" for="fp-binding">Referenced integrity profile</label>
            <select id="fp-binding" class="sb-select" aria-label="Referenced integrity profile">${bindingOptions}</select>` : ''}
            <div class="fp-form-btns">
                <button id="fp-confirm" class="sb-btn sb-btn-primary" type="button">${this.formMode === 'create' ? 'Create' : 'Rename'}</button>
                <button id="fp-cancel" class="sb-btn sb-btn-secondary" type="button">Cancel</button>
            </div>
        </div>`;
        return `
        <div class="fp-row">
            <select id="fp-select" class="sb-select" aria-label="File profile"${hasProfiles ? '' : ' disabled'}>
                ${options}
            </select>
        </div>
        <div class="fp-hint">${hint ? esc(hint) : ''}</div>
        ${form}
        <div class="fp-actions">
            <button id="fp-save-as" class="sb-btn sb-btn-add" type="button">Save as…</button>
            <button id="fp-rename" class="sb-btn" type="button"${hasProfiles && this.activeFileProfileId ? '' : ' disabled'}>Rename</button>
            <button id="fp-delete" class="sb-btn" type="button"${hasProfiles && this.activeFileProfileId ? '' : ' disabled'}>Delete</button>
        </div>
        <div id="fp-error" class="sb-fp-error"${this.errorMessage ? '' : ' hidden'}>${esc(this.errorMessage)}</div>
        ${hasProfiles ? '' : '<p class="sb-empty">No team profiles yet — capture struct pins, byte order, and an integrity profile to share them.</p>'}`;
    }

    private wireRendered(body: HTMLElement): void {
        const select = body.querySelector<HTMLSelectElement>('#fp-select');
        select?.addEventListener('change', () => {
            this.errorMessage = '';
            const id = select.value || null;
            this.activeFileProfileId = id;
            this.cb.onSelect(id);
        });
        body.querySelector('#fp-save-as')?.addEventListener('click', () => this.openForm('create', null));
        body.querySelector('#fp-rename')?.addEventListener('click', () => {
            if (this.activeFileProfileId) { this.openForm('rename', this.activeFileProfileId); }
        });
        body.querySelector('#fp-delete')?.addEventListener('click', () => {
            if (!this.activeFileProfileId) { return; }
            const anchor = body.querySelector<HTMLElement>('#fp-delete');
            if (!anchor) { return; }
            inlineConfirm(anchor, () => this.cb.onDelete(this.activeFileProfileId!));
        });
        body.querySelector('#fp-confirm')?.addEventListener('click', () => {
            const input = body.querySelector<HTMLInputElement>('#fp-name');
            const name = input?.value.trim() ?? '';
            if (!name) {
                this.errorMessage = 'Profile name is required.';
                this.render();
                return;
            }
            if (this.formMode === 'create') {
                const binding = body.querySelector<HTMLSelectElement>('#fp-binding');
                this.formMode = null;
                this.cb.onCreate(name, binding?.value || null);
            } else if (this.formMode === 'rename' && this.formTargetId) {
                this.formMode = null;
                this.cb.onRename(this.formTargetId, name);
            }
        });
        body.querySelector('#fp-cancel')?.addEventListener('click', () => this.closeForm());
    }

    private openForm(mode: Exclude<ProfileFormMode, null>, targetId: string | null): void {
        this.formMode = mode;
        this.formTargetId = mode === 'rename' ? targetId : null;
        this.errorMessage = '';
        this.render();
    }

    private closeForm(): void {
        this.formMode = null;
        this.formTargetId = null;
        this.errorMessage = '';
        this.render();
    }
}