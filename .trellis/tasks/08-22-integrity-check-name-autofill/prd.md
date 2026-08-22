# Integrity check: name field + smarter address autofill

## Goal
Integrity checks get an optional custom name (fallback to algorithm label) and
the new-check form autofills start/end addresses from the hex selection or the
whole file.

## Requirements

### Autofill (add-check form)
- Start/end prefilled from current hex selection when present (existing behavior).
- When no selection: prefill full-file range — first mapped address to last
  mapped address (covers every byte in the hex data).
- When no selection and file empty/unmappable: leave both blank.
- Autofill only ever prefills — user can edit freely before saving.

### Name field
- Optional single-line text input in both add and edit check forms,
  label "Check name (optional)".
- Max 40 chars (input enforces; normalize hard-caps).
- Empty name allowed; duplicates allowed.
- Card title shows the custom name; without a name it falls back to the
  algorithm label (e.g. "CRC32/ISO-HDLC").
- Range/stored summary meta line is unchanged.

### Persistence
- Name persists per check across profile save/apply and app reload
  (`IntegrityCheckConfig.name?`).
- Backward compatible: old saved checks (no name) load fine and render
  algorithm label. `schemaVersion` stays 1 (optional additive field).

### Scope
- Integrity checks only. Profiles already have names — no change there.

### Header button height
- Integrity header "Fix all" and "＋ Add" buttons must render the same height.
  Cause: `.sb-btn-add` uses `padding: 5px 8px` vs base `.sb-btn` `2px 8px`
  (sidebar.css:209), so Add is ~6px taller; header row top-aligns.

### Profile selection label
- Header row: static "Profile" label (left) + "Fix all" / "＋ Add" buttons (right)
  on the same line.
- Below: profile dropdown (full width) + ⋮ action menu button.
- Dropdown has no "Saved profiles…" placeholder; disabled when no profiles.
- Selecting a profile in the dropdown **auto-applies** it. When it would
  overwrite checks that differ from the profile, or an unsaved add/edit form
  is open, an inline-confirm popover gates the apply.
- ⋮ menu = Update / Rename / Delete (Apply removed). "Save as…" is a visible
  compact button beside the ⋮ (most common action out of the menu).
- Conflicting auto-apply: cancelling the confirm **reverts** the dropdown to
  the previously selected profile (no lying "selected ≠ applied" state).
- No profiles: select disabled + muted hint "No profiles yet — add a check,
  then Save as…".
- On load, when no session selection exists and profiles exist, the first
  profile is preselected WITHOUT auto-apply — so Rename/Delete/Update are
  enabled immediately on a lone (or first) profile after a reload.

## Acceptance Criteria

- [ ] Add-check form: start/end prefilled from hex selection when present.
- [ ] Add-check form: no selection → prefilled full-file range.
- [ ] Add-check form: empty file → both fields blank.
- [ ] Add and edit forms both have optional name input (max 40 chars).
- [ ] Save with empty name works; card title shows algorithm label.
- [ ] Save with name → card title shows custom name.
- [ ] Duplicate names across checks are allowed.
- [ ] Named check persists through profile save/apply and reload.
- [ ] Integrity header "Fix all" and "＋ Add" buttons same height, aligned.
- [ ] Header row shows "Profile" label; Fix all/＋ Add right-aligned same line.
- [ ] Profile dropdown below (full width) + ⋮ menu; no placeholder option; disabled when no profiles.
- [ ] Selecting a profile auto-applies it (confirm popover when checks differ / form open).
- [ ] ⋮ menu = Update / Rename / Delete; "Save as…" visible button beside ⋮.
- [ ] Cancelling the apply confirm reverts the dropdown to the prior profile.
- [ ] Lone/first profile preselected on load (no auto-apply); Rename/Delete/Update enabled.
- [ ] `npm run check-types` and `npm run lint` pass.
- [ ] Integrity check model/panel webview unit tests pass.