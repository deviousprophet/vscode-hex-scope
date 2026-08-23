# Implement — File Profiles for Team-Shared Configuration

Complex task. Ordered checklist; each step leaves the tree green.

## Validation commands
- `npm run check-types`
- `npm run lint`
- `npm test` (vscode-test host, 822+ tests baseline)
- `npm run compile`

## Checklist

### A. Core config module
- [x] A1. New `src/core/workspaceConfig.ts`: `WorkspaceConfig`/`FileProfile`/`FileScopeConfig` types, `schemaVersion`, normalizers, `mergeWorkspaceAndGlobal`, workspace-relative path keying, load + atomic save. → delivered as `src/core/workspaceConfigModel.ts` (pure) + `src/workspaceConfigStore.ts` (vscode FS adapter).
- [x] A2. Auto-migration: seed config from globals + current doc state; guard on absence; self-write horizon. (session `loadOrMigrateWorkspaceConfig`)
- [x] A3. Unit tests: `src/test/core/workspaceConfigModel.test.ts`.

### B. Session wiring (host, hexEditorSession.ts)
- [x] B1. Resolve config at `postInit`.
- [x] B2. Redirect write handlers to write-through; scratch checks + active-profile pins stay machine-local.
- [x] B3. FileSystemWatcher on `.hexscope/config.json` → reload + rebroadcast.
- [x] B4. Active profile selection: `hexScope.activeProfile.<uri>` read/write; apply posts pins/endian/checks.
- [x] B5. Webview messages: profile list/apply/create/rename/delete (+ protocol).
- [x] B6. Host-behavior coverage via core + message-model + panel test suites (no HexEditorSession harness exists).

### C. Sidebar File Profiles panel (webview)
- [x] C1. `fileProfilesPanel.ts` + `fileProfilesPanel.css`.
- [x] C2. Wired into `sidebar.ts` descriptor seam.
- [x] C3. `src/test/webview/components/sidebar/fileProfilesPanel/fileProfilesPanel.test.ts`.

### D. Integration / finish
- [x] D1. Full pass: `npm run check-types && npm run lint && npm test` — 971 passing, exit 0.
- [x] D2. Spec docs update. → `workspace-config.md` (new), `component-sidebar-file-profiles-panel.md` (new), index.md, directory-structure.md, state-management.md, editor-lifecycle.md updated.
- [x] D3. `task.py start` review approved by user — approved; task in_progress.

## Risky files / rollback points
- `src/hexEditorSession.ts` — session persistence hub; edit in-place but each handler redirect isolated. Rollback: delete `.hexscope/config.json` (globals untouched).
- `src/webviewProtocol.ts` / `webviewMessageModel.ts` — protocol additions are additive-only.
- `postInit` ordering — changing load order can break init payload shape; keep `ProviderToWebviewMessage` compatible.

## Follow-up checks before start
- [ ] prd.md passed convergence pass
- [ ] design.md + implement.md reviewed
- [ ] Final planning summary approved by user in a separate turn
- [ ] implement.jsonl / check.jsonl curated (done)