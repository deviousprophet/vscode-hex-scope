# Component Spec — File Profiles Panel

## Scope / Trigger

Owns `src/webview/components/sidebar/fileProfilesPanel/fileProfilesPanel.ts` + `fileProfilesPanel.css`: the sidebar **Profiles** tab — the team-shared File Profile picker. A File Profile bundles struct pins + endianness + a reference to a shared integrity profile; the panel lists them, shows the active selection, and offers select/apply, save-as (capture the current session as a new shared profile), rename, and delete. The component owns panel markup, the profile-list/form UI state, and the save-as/rename form machine. It never reads/writes the `S` global and never posts provider messages: data is pushed via setters, session snapshot is pulled via injected accessors, and actions report via callbacks.

Host (`hexViewer.ts`) owns: the "Profiles" sidebar panel descriptor, profile persistence messages (`selectFileProfile`/`createFileProfile`/`renameFileProfile`/`deleteFileProfile`), applied-state wiring (`S.structPins`/`S.endian`), and pushing integrity-profile data (for the save-as binding dropdown).

## Layout

```text
src/webview/components/sidebar/fileProfilesPanel/
    fileProfilesPanel.ts        interaction controller: mount/render/setProfiles/setError/setTabActive; #fp-select + #fp-name-form state machine
    fileProfilesPanel.css       colocated rules (.fp-row, .fp-hint, .fp-name-form, .fp-actions, .sb-fp-error)
src/webview/hexViewer.ts        host wiring (panel descriptor, callbacks, S-based assemblers)
src/test/webview/components/sidebar/fileProfilesPanel/fileProfilesPanel.test.ts   (mocha + jsdom)
```

Sidebar shell (`sidebar.ts` + `sidebar.css`) owns the tab/section primitives; `SidebarSections` is reused for the single "File Profile" section. Core model (`src/core/workspaceConfigModel.ts`) owns `FileProfile` shapes and normalization.

## Contract

```typescript
interface FileProfilesCallbacks {
    onSelect: (id: string | null) => void;                 // dropdown choice → host posts selectFileProfile
    onCreate: (name: string, integrityProfileId: string | null) => void; // host assembles pins/endian from S
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
    getPins: () => StructPin[];                            // current session pin snapshot (for save-as)
    getEndian: () => 'le' | 'be';
}

class FileProfilesPanel {
    constructor(cb: FileProfilesCallbacks);
    mount(root: HTMLElement): void;                        // creates #s-file-profiles container; idempotent
    render(): void;
    setProfiles(profiles: FileProfile[], activeId: string | null, integrityProfiles?: IntegrityProfile[]): void;
    setError(error: string): void;
    setTabActive(active: boolean): void;
}
```

## Rules

- Component holds only UI/transient state: `profiles`, `activeFileProfileId`, the cached `integrityProfiles` binding list, `errorMessage`, and the `formMode`/`formTargetId` form machine. Persistent/domain state (the config file, the active selection) lives in the host.
- Reads no `S`, writes no `S`; session snapshot pulled via `getPins`/`getEndian`, actions report via callbacks.
- `setProfiles` re-validates `activeId` against the pushed list (unknown → null), clears the error, and renders only when mounted (`#s-file-profiles` present).
- `setTabActive(true)` reproduces the integrity-panel lazy-init gate: first tab activation renders.
- Save-as is "capture current session": the host builds `createFileProfile` from `S.structPins`/`S.endian` at confirm time; the panel only sends the chosen name + integrity binding.
- Delete uses the shared `inlineConfirm` popover (`Yes`/`No`) anchored to the Delete button; on `Yes` → `onDelete(id)`.
- Untrusted text escaped with `esc()` (profile names, hints) — hint text may echo a user-defined profile name.
- Markup follows the `.sb-*` primitive conventions (`.sb-select`, `.sb-btn`, `.sb-empty`, compact `.sb-btn` heights).

## Behaviour

- Empty library renders a disabled selector with only "None", a hint paragraph, and an active "Save as…" button.
- Populated library renders `None` + one option per profile; the active profile is `selected`.
- Hint line under the selector summarizes the active profile: "N pins · BE/LE[ · integrity profile]".
- `None` selection posts `onSelect(null)`; a profile selection posts `onSelect(id)`; stale profiles surfaced only via `setProfiles`/`setError` from the host.
- "Save as…" opens the create form: name input + "Referenced integrity profile" dropdown of shared integrity profiles. Confirm with empty name → inline error, no callback; confirm with name → form closes, `onCreate(name, bindingId | null)`.
- "Rename" opens the rename form prefilled with the active profile's name; confirm → `onRename(id, name)`.
- "Delete" on the active profile anchors the inline-confirm; Yes → `onDelete(id)`.
- `setError` renders the message with the list/form state intact.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty profile list | Selector disabled (None only) + empty-state hint; Save-as enabled |
| Unknown active id pushed | `setProfiles` nulls the active selection |
| Empty save-as name | Inline error "Profile name is required."; form stays open; no callback |
| Delete without active profile | Button disabled |
| Duplicate-name profile (host-side) | Host rejects via `fileProfiles` error → `setError` shows it; list unchanged |
| Not yet mounted / before first activation | `render` no-ops; `setProfiles` defers until mounted |
| No integrity profiles | Binding dropdown shows only "(none)" |

## Tests Required

`src/test/webview/components/sidebar/fileProfilesPanel/fileProfilesPanel.test.ts` (mocha + jsdom + cssImportHook): mount + empty state (disabled selector, hint), idempotent re-mount, list/options/active-selection render + hint, select → `onSelect(id)` and None → `onSelect(null)`, save-as form (open, binding options, empty-name inline block, valid create → `onCreate`), rename prefill + `onRename`, delete confirm popover → `onDelete`, `setError` render.

## Anti-patterns

- Importing `S`, `state.ts`, `postProviderMessage`, or `workspaceConfigModel` from the component.
- Component assembling the create payload from `S` directly (must use injected `getPins`/`getEndian`).
- Host writing panel DOM directly.
- Unescaped profile names in options/hints.