# Implement — Storage Rework

Context order: jsonl -> prd.md -> design.md.

Validation: `npm run compile` (check-types + lint + esbuild), `npm run test` (vscode-test).

## Checklist

1. **[store]** `src/hexScopeStorage.ts` (host adapter; `src/core/` must not import `vscode` — directory-structure.md)
   - `resolveHexScopeRoot(uri)` (scripts-equivalent; single implementation).
   - `perFileDataPath(root, uri)` / `perFileLocalPath(root, uri)` → `data`/`local/<rel>.json`.
   - `readJson`/`writeJson` via `vscode.workspace.fs`; `corrupt` vs `missing` distinction.
   - `JsonStore<T>`: cache, debounce(400ms) per slot, load/mutate/flush/dispose, self-heal write-back only on parse-ok+changed, corrupt→empty+once-warn+no overwrite.
   - gitignore seeding (once per root, on first successful write under `.hexscope/`).
   - Watcher attach: global `structs.json`/`integrity.json` + per-file `data/`/`local/`; self-write horizon; debounced reload → onReload callback.
2. **[session]** Wire `hexEditorSession.ts`
   - Replace `loadStructs`/`loadIntegrityProfiles`/`loadIntegrityChecks`/`loadEndian` + `postInit` reads with stores (keep normalization call sites).
   - Replace `saveLabels`/`saveStructs`/`saveStructPins`/`saveIntegrityChecks`/`saveEndian`/`updateLabelVisibility`/`reorderLabel` with store mutate.
   - `saveIntegrityProfiles` → store mutate + existing broadcast.
   - Serialize dataStore label ops in-session (promise chain) to avoid lost updates.
   - Dispose: flush all slots, dispose watchers.
   - Remove all Memento key constants.
3. **[webview protocol]** New messages:
   - `structsExternalChange` (prompt) + `reloadDataAccepted` handler.
   - `perFileDataChange` (auto-apply).
   - Integrity reuses existing `integrityProfiles` broadcast.
4. **[webview]** `webviewMessageModel.ts`/`state.ts`: reducers for the new messages; struct-panel `editingStructId` guard + confirm-reload dialog mirroring hex externalChange/reloadAccepted UX (`externalChange.test.ts` pattern).
5. **[migration]** `migrateLegacyData(root, uri, context)` before first `postInit`: read → normalize → write via stores (self-write-marked) → hard-delete all old keys incl. legacy variants; skip file writes when target exists; defensive key deletion always; once-per-root in-memory guard.
6. **[docs]** Update `docs/SCRIPTING.md` (or add `docs/HEXSCOPE_STORAGE.md`) documenting full `.hexscope/` layout.
7. **[spec]** Update `.trellis/spec/frontend/state-management.md` "Persistence Scope" section (Memento split → on-disk scope).
8. **[tests]**
   - New `src/test/extension/hexScopeStorage.test.ts` (read/corrupt/self-heal/missing/debounce/gitignore-once) — extension-host suite since the module imports `vscode`.
   - Extend `src/test/core/providerUtils.test.ts`: migrate pipeline → file writes + key deletion (fake context doubles).
   - Webview message reducer tests for new messages; watcher-conflict test mirroring hex-file external-change test.

## Gates

- After step 2: `npm run check-types` green.
- After step 4: `npm run lint` green.
- After step 8: full `npm run compile` + `npm run test` green.
- Verify no lingering `globalState`/`workspaceState` reads in session storage paths (grep).

## Rollback points

- After step 1,2: revert commits; behavior identical except no persistence. Memento cleanup only happens in step 5 — keep migration last among behavior changes for auditable blast radius.