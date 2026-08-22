# Implement — integrity check name + autofill

## Checklist (ordered)

1. `src/core/integrity.ts` — add `name?: string` to `IntegrityCheckConfig`;
   carry through `normalizeIntegrityCheck` via trim/40-cap helper.
2. `integrityCheckModel.ts` — add `name` to `IntegrityDraft` +
   `IntegrityCheckState`; propagate in `blankIntegrityDraft`,
   `draftFromIntegrityConfig`, `applyIntegrityDraft`,
   `integrityCheckConfigFromState`.
3. `integrityPanel.ts` — name input (maxlength 40) in `checkFormHtml`;
   `addDraft()` fallback to `getDataRange?.()` when no selection.
4. `hexViewer.ts` — wire `getDataRange` from `S.parseResult?.segments`
   (min start / max end, null when none).
5. `integrityResultRender.ts` — card title = `check.name || algorithmLabel`.
5b. `integrityPanel.css` — `.integrity-hdr-row .sb-btn-add { padding: 2px 8px; }`
    so header Add matches Fix all height.
5c. `integrityProfiles.ts` + css — profile label row: selector full-width in
    column flex; `.integrity-profile-row` = label + ⋮ menu trigger; label from
    `selectedProfileId` (muted "No profile" when none).
6. Tests — add cases: name round-trips config→normalize→state; empty name →
   algorithm label; 41-char name dropped; `getDataRange` fallback; duplicate
   names OK.

## Validation

- `npm run check-types`
- `npm run lint`
- Integrity webview/model unit tests (existing test files above)
- Manual (extension host): add check w/ selection, without selection, empty
  name, named check → reload window → name persists; profile save/apply.

## Review gates

- Before `task.py start`: re-read `implement.md`; confirm acceptance criteria
  in `prd.md` all testable.
- Rollback: revert working tree; field is additive-safe both directions.