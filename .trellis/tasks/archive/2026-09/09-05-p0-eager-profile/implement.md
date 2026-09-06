# P0 Implement: Defer profile creation until first write

Source: `firmware_profile.md` P0 section; `src/hexEditorSession.ts:408-524`,
`src/hexScopeStorage.ts` (`JsonStore` 312-417, `createProfile` 216, `findProfile`
173, `resolveHexScopeRoot` 132).

## Ordered checklist

1. **`src/hexScopeStorage.ts` — lazy JsonStore**
   - Extend `JsonStoreOptions` with optional `lazyDir?: () => Promise<string | null>`.
   - In `load()`/`applyFallback`, `get()` and `writeNow()`/`writePendingNow()`: when
     `lazyDir` set and dir unresolved, reads return `empty()` in memory; writes
     resolve dir — `null` → stay in-memory (no disk), else materialize profile
     dir (reuse `createProfile`) then write JSON.
2. **`src/hexEditorSession.ts` — deferred open**
   - `openProfileStores()`: when `findProfile(root, relPath)` returns null, do NOT
     `createProfile`. Build stores in deferred mode (one shared `resolveDir`),
     attach no profile watcher until a dir exists.
   - Ensure all write handlers (`saveLabels`, `saveStructs`, `saveStructPins`,
     `saveIntegrityChecks`, `saveEndian`, integrity CRUD, label ops) trigger
     materialization via first `set()`, serialized by `enqueuePerFileOp`.
   - Out-of-workspace: `resolveDir` returns null (stay in-memory) unless explicit
     save/profile action — track an "explicit" flag.
3. **Remove `createProfile` from read paths** — grep confirms none remain in
   `postInit`/`loadCurrentIndex`/`loadIntegrityProfiles`/`onExternalChange`.
4. **Tests** — add to `src/test/extension/hexScopeStorage.test.ts` (+ session-level
   if harness exists):
   - open+close no-edits → no profile dir / no `index.json` on disk;
   - first `saveLabels` → creates `firmware_profiles/profiles_1/index.json` with
     `relPath` set;
   - out-of-workspace open+close → no sibling `.hexscope/`;
   - out-of-workspace non-explicit write stays in-memory (no disk).
5. **Validation**
   - `npm run check-types`
   - `npm run lint`
   - `npm test` (extension test suite)
6. **P2 note** — after P0, re-test #7 (external-change false positive); P0 removing
   eager `.hexscope/` sibling creation may clear it.

## Review gates

- No `createProfile` on read-only path (grep).
- Backward compat: pre-existing `firmware_profiles/*` still load (deferred mode
  only when `findProfile` null).
- All AC in `prd.md` green.

## Rollback points

- Each step independently revertible; storage layout untouched so rollback = undo
  lazy branch + restore `createProfile` on open.

## Context manifests

- `implement.jsonl` / `check.jsonl`: spec/research refs (see files).
