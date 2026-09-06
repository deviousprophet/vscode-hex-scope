# Implement: review fixes #1–#5

Source: `prd.md`/`design.md` in this task; findings #1–#5 in the review message.

## Ordered checklist

### #1 — `init` hydrates `S.profileState`
- `src/webview/webviewMessageModel.ts` `applyInitMessage`: normalize + assign
  `S.profileState = msg.profile` (same shape as `applyProfilesStateMessage`).
- Test: `src/test/webview/webviewMessageModel.test.ts` — drive `applyInitMessage`
  with a `profile` field; assert `S.profileState` and `update.profileState`.

### #2 — Struct-deletion confirm + cross-profile cascade
- `src/hexEditorSession.ts`:
  - Export `collectStructDeletionUsage(root, deletedIds)` (registry pin scan →
    `{ pins, profileIds }`) reusing `listProfileRecords`/`readProfileRecord`.
  - Export `stripDeletedStructPins(root, deletedIds)` (rewrite affected profile
    records with pins filtered).
  - Export `applyStructDeletion(root, previousPool, incomingStructs, confirm)` →
    `'applied' | 'declined'` with `confirm(usage)` seam; performs pool write +
    strip on confirm; returns declined without writes.
  - `saveStructs` handler: compute deleted ids, call `applyStructDeletion` with a
    `showWarningMessage`-based confirm; on declined push revert
    (`structsExternalChange(previousStructs)` + `perFileDataChange` with prior
    bound-profile pins). Wrap handler in `enqueuePerFileOp`.
  - `saveStructPins` also wrapped in `enqueuePerFileOp` (ordering).
- Webview: no change needed (existing `applyStructState` cascade + revert works).
- Tests (`src/test/extension/hexScopeStorage.test.ts`): usage scan finds pins
  across profiles; declined → pool untouched + revert payloads; confirmed →
  pool updated + all affected profile pins stripped (multi-profile case).

### #3 — Per-entry migration marker
- `src/hexScopeMigration.ts`:
  - Remove `bindingsTableExists` gate in `ensureMigrationComplete`.
  - `migrateLegacyTree`: per dir, skip when marker `.converted` exists; else
    convert (keep current conversion body) then write marker.
  - Keep memento seeding + marker path for the no-tree case.
- Tests: (a) pre-existing `bindings.json` + unconverted legacy dir → converted;
  (b) marker present → skip (no duplicate profile ordinals).

### #4 — Remove `explicitProfileWrite`
- `src/hexEditorSession.ts`: delete flag + `materializePending` guard →
  `if (!hasWorkspaceFolder) { return null; }` with comment.
- Existing P2 deferred-store tests remain the guard; add nothing brittle.

### #5 — Per-root struct-pool cache
- `src/hexEditorSession.ts`: `workspaceStructPool` → `Map<string, StructDef[]>`
  keyed by `root`; `buildProfileStores` fallback + `loadWorkspaceStructs` use it.
- Test: two roots → independent `empty()` fallbacks.

### Specs/notes (3.3)
- Update `.trellis/spec/frontend/hexscope-storage.md` (migration marker,
  per-root pool), `struct-model.md` (cross-profile deletion), plus the relevant
  component spec if struct deletion UX wording exists.

## Validation

- `npm run check-types`, `npm run lint`
- `cmd /c "npx fallow --format json --quiet 2>nul"` → parse via node; must be
  0/0/0
- `npm test`

## Review gates

- Grep: no `explicitProfileWrite`; no `workspaceStructPool` global reads outside
  the per-root cache.
- Grep: `bindingsTableExists` gone; migration marker written per converted dir.
- `S.profileState` assigned in both `applyInitMessage` and
  `applyProfilesStateMessage`.
- All AC in `prd.md` green.

## Rollback points

- Each fix independent; single-commit revert (plus marker files on disk are
  inert for old code). No format bump.

## Context manifests

- `implement.jsonl`/`check.jsonl`: spec refs (hexscope-storage,
  struct-model, integrity-checks if touched).