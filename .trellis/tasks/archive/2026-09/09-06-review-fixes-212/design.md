# Design: review fixes #1–#5

## #1 — `init` must hydrate `S.profileState`

`applyInitMessage` (webviewMessageModel.ts) returns `profileState: msg.profile`
but never assigns `S.profileState`; only `applyProfilesStateMessage` does. A
fresh open sends only `init` → dropdown reads module default
`{ profiles: [], current: null, boundFileCount: 0 }`.

**Fix:** in `applyInitMessage`, normalize + assign `S.profileState = msg.profile`
(reuse the same shape as `applyProfilesStateMessage`), then return
`profileState` so `applyProfileStateUpdate` re-renders. Add a model test driving
`applyInitMessage` and asserting `S.profileState` + returned update.

## #2 — Struct deletion must confirm + cascade across registry profiles

Webview struct delete currently strips pins locally and posts `saveStructs` +
`saveStructPins`; only the open file's bound profile is cleaned. Pool is
workspace-wide → other profiles can dangle.

**Fix (host-side intercept in `saveStructs`):**
1. Compute `deletedIds` = previous pool ids − incoming ids.
2. `collectStructDeletionUsage(root, deletedIds)` → `{ pins, profileCount }`
   scanning every registry profile (`listProfileRecords` → `readProfileRecord`)
   whose `pins[].structId ∈ deletedIds`. Pins in the *current* bound profile are
   still on disk at this point (webview posts `saveStructs` before
   `saveStructPins`, both serialized via `enqueuePerFileOp`), so they count —
   matching the requirement "1+ pins reference it anywhere".
3. Usage 0 → proceed unchanged.
4. Usage > 0 → `vscode.window.showWarningMessage` naming pin count + affected
   profile count, modal, "Delete" confirm.
   - Declined → no writes; push `structsExternalChange(previousStructs)` and
     `perFileDataChange(pins: previousBoundPins)` to revert the webview.
   - Confirmed → write pool (incoming), then `stripDeletedStructPins(root,
     deletedIds)` rewrites every affected profile record with its pins filtered
     (the bound profile included — idempotent with the webview's later
     `saveStructPins`). No cross-panel broadcast needed (other files reload on
     open).
5. `saveStructs` and `saveStructPins` both go through `enqueuePerFileOp` so the
   usage scan is deterministic.
6. Testable seam: exported `applyStructDeletion(root, pool, incoming, confirm):
   Promise<'applied'|'declined'>` takes a `confirm` closure (fake in tests);
   `collectStructDeletionUsage`/`stripDeletedStructPins` also exported.

## #3 — Per-entry legacy-migration completion marker

`ensureMigrationComplete` treats `bindings.json` existing as "done", so a
pre-existing binding from an unrelated file permanently suppresses conversion of
a remaining legacy tree.

**Fix:** drop the `bindingsTableExists` gate entirely. Per-converted-dir marker:
- `migrateLegacyTree` loops `firmware_profiles/<n>` dirs; skip dirs containing a
  marker file (`.converted`, written with `vscode.workspace.fs.writeFile`);
  convert the rest (structs → pool, index+integrity → registry profile +
  binding), then write the marker per dir.
- Same-process `migratedRoots` set stays (cheap, in-memory).
- Idempotence preserved by the marker (no duplicate `nextOrdinal` profiles on
  restart) withOUT depending on `bindings.json`.
- Regression tests: (a) pre-existing `bindings.json` + an unconverted legacy dir
  → dir is still converted; (b) rerun after markers → no duplicates, `bindings.json`
  untouched.

## #4 — Remove the vestigial `explicitProfileWrite` flag

Real explicit flows (`newProfile`, `selectProfile`) write directly and rebuild
bound stores (`buildProfileStores(pid)`), so the deferred resolver is irrelevant
afterward. The flag only ever guarded the *unbound* out-of-workspace path, which
is exactly the non-explicit case.

**Fix:** delete `explicitProfileWrite`; the `materializePending` guard becomes
`if (!hasWorkspaceFolder) { return null; }` with a comment that explicit actions
bypass this and rebuild bound stores. Add an assertion in the existing P2
suite (out-of-workspace non-explicit write stays in-memory) — it already covers
the survived contract; note the session harness gap.

## #5 — Per-root struct-pool fallback

`workspaceStructPool` is a module global shared across sessions.

**Fix:** `const structPoolCache = new Map<string, StructDef[]>()` keyed by
`root`; `buildProfileStores` fallback `[...(structPoolCache.get(root) ?? [])]`;
`loadWorkspaceStructs` stores per root. Add an extension test with two roots →
independent fallbacks.

## Shared invariants

- No storage-format bump; hosts+webview ship together.
- Deferred/no-write-on-open, silent external auto-apply, binding lifecycle
  tests unchanged.
- Staging: exclude `.trellis/tasks/**` + `firmware_profile.md` from commits.