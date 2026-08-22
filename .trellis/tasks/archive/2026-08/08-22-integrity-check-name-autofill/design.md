# Design — integrity check name + autofill

## Data flow (name persistence round-trip)

```
form (add/edit) → draft.name → applyDraft → state.name
  → integrityCheckConfigFromState → config.name        (webview → host persistChecks)
  → host stores IntegrityCheckSet (payload as-is)
  → init payload → normalizeIntegrityCheckSet → normalizeIntegrityCheck → state.name
  → checkCardHtml title = state.name || algorithmLabel(state.algorithm)
```

## Contracts

### `IntegrityCheckConfig` (src/core/integrity.ts)
- Add optional `name?: string`.
- `normalizeIntegrityCheck`: carry name via `normalizeCheckName(raw.name)` —
  trim; empty or `> 40` chars → drop field (treat as unnamed). Old saved
  checks without `name` load unchanged. `schemaVersion` stays `1`
  (optional additive field; old loaders ignore unknown key).

### `IntegrityCheckState` / `IntegrityDraft` (integrityCheckModel.ts)
- Add `name: string` (default `''`) to both.
- `blankIntegrityDraft`, `draftFromIntegrityConfig`, `applyIntegrityDraft`,
  `integrityCheckConfigFromState` carry it. `makeIntegrityCheck` spreads draft.

### Form (integrityPanel.ts)
- `checkFormHtml`: name input above Algorithm — label "Check name (optional)",
  `maxlength="40"`, `autocomplete="off"`, value from draft.name.
- `IntegrityDraft` name saved via existing `data-draft-control` wiring.
- Edit form reuses same form (name editable).

### Autofill (integrityPanel.ts `addDraft`)
1. Selection present (`getSelection`) → prefill start/end (existing).
2. Else `getDataRange?.()` → prefill that range.
3. Else both blank.

### New callback + wiring (hexViewer.ts)
- `IntegrityCallbacks.getDataRange?: () => { start: number; end: number } | null`
- Wired from `S.parseResult?.segments`: min `startAddress`, max
  `startAddress + data.length - 1`; empty/missing → null.
- Scripts-style defensive `?.()` — unset callback = no autofill, no crash.

### Card title (integrityResultRender.ts)
- `checkCardHtml` title: `check.name || algorithmLabel(check.algorithm)` (esc).

## Header button height
- Root cause: `.sb-btn-add` `padding: 5px 8px` overrides `.sb-btn` `2px 8px`
  (sidebar.css:189/209); header Add ends ~6px taller than Fix all.
- Fix (scoped, additive): `integrityPanel.css`
  `.integrity-hdr-row .sb-btn-add { padding: 2px 8px; }` — matches sibling
  primary height, keeps dashed accent look. Full-width row-filler Add usages
  (labels/struct) untouched.

## Profile label row
- `.integrity-hdr-row` becomes `justify-content: space-between`: static
  "Profile" `<label for="integrity-profile-select">` on the left; Fix all /
  ＋ Add right-aligned (existing buttons).
- Below, `.integrity-profiles` column: select (full width) + ⋮ trigger —
  dropped the active-name label entirely.
- No placeholder `<option value="">Saved profiles…`; when `profiles` empty →
  select `disabled` (+ no options).
- Select `change` → `applySelectedProfile`. Conflicting case (checks differ or
  unsaved form): `confirmProfileApply` re-anchored from `#integrity-profile-apply`
  to `#integrity-profile-select` (`inlineConfirm` is anchor-agnostic — standalone
  popover); safe case applies instantly.
- Menu items: Save as / Rename / Update / Delete; Apply removed (auto-apply
  covers it); `updateProfileButtonState` drops `'apply'`.
- Reload/restore of a persisted `selectedProfileId` preselects the option
  WITHOUT auto-apply (checks were persisted separately). [per Q5]
- `setProfiles` → `preselectFirstProfile`: when no selection yet and profiles
  exist, set `selectedProfileId = profiles[0].id` (drop-in for missing
  persisted selection). No change event fires → no auto-apply. Fixes the lone-
  profile case where Rename/Delete/Update stayed disabled until manual select.
- Apply confirm `onCancel` (`inlineConfirm(anchor, onConfirm, msg, onCancel?)`,
  new optional param in `webview/utils.ts`) reverts `selectedProfileId` +
  `select.value` to `prevId` captured in the change handler — dropdown never
  lies after a cancelled conflicting apply.
- "Save as…" is a visible `.sb-btn-secondary` button in `.integrity-profile-row`
  (next to select); ⋮ menu holds Update / Rename / Delete only. Empty library →
  muted `.sb-empty` hint "No profiles yet — add a check, then Save as…".

## Compatibility
- Additive only. No host-side changes (stores config payload opaque).
- Rollback: drop field / revert — safe both directions.

## Files touched
- `src/core/integrity.ts`
- `src/webview/components/sidebar/integrityPanel/integrityProfiles.ts`
- `src/webview/components/sidebar/integrityPanel/integrityCheckModel.ts`
- `src/webview/components/sidebar/integrityPanel/integrityPanel.ts`
- `src/webview/components/sidebar/integrityPanel/integrityResultRender.ts`
- `src/webview/hexViewer.ts`
- `src/webview/components/sidebar/integrityPanel/integrityPanel.css`
- tests: `src/test/webview/integrityCheckModel.test.ts`,
  `src/test/webview/components/sidebar/integrityPanel/integrityPanel.test.ts`