# Design — CI green and PR #261 readiness

## Constraints

- Behavior-preserving: this branch is feature-complete; the work is a test-fixture fix plus refactors and PR metadata. No user-visible change, no changelog entry.
- `fallow-fix` rules: refactor source; never add suppressions; never edit `.fallowrc*` or CI; never delete/disable functions; keep behavior identical.
- The public scripting contract `examples/scripts/types/hexscope.d.ts` is ambient (no imports/exports) and is copied into user workspaces (`EXAMPLE_INSTALL_FILES`, `src/core/scripting/examples.ts:22-30`), so it must stay standalone.
- Repo quality contract: full Fallow scan + changed-code audit before PR; required gate `npm run check-types`, `npm run lint`, `npm test`.

## 1. Unit-test fix (test-only)

`src/test/extension/manageScripts.test.ts` uses the hardcoded fixture `'D:\\ws\\hello.js'` in the two delete-flow tests (lines 561 and 586). On POSIX, `path.basename` keeps the backslashes, so the warning names the whole string instead of `hello.js`.

Fix: add one file-level constant built with the existing cross-platform pattern (the file already uses `path.join('D:\\ws', SCRIPTS_DIR_DISPLAY)` at line 382):

```ts
/** Platform-safe fake path whose basename is always `hello.js`. */
const FAKE_HELLO_PATH = path.join('D:\\ws', 'hello.js');
```

Use it at both call sites. Assertions stay identical; no production code changes.

Rejected alternative: teach `deleteOneScript` to split on both separators. Real `scriptPath` values come from `vscode.Uri.fsPath` and are platform-native, so this would add runtime complexity for a test-only artifact.

## 2. Fallow GREEN (behavior-preserving refactor loop)

Loop: `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` → fix one group → re-run; after each group also `npx tsc --noEmit`. Green = `dead-code 0 | complexity 0 | duplication 0` (exit 0).

### Complexity (118 functions; cyclo ≤ 4)

Apply the repo's authoring pattern from `quality-guidelines.md` ("Complexity / CRAP Authoring"): build base objects first and assign optional keys via tiny named helpers instead of chained conditional spreads; extract boolean helpers; split loops with inner conditionals; prefer `filter`/`map`/`some` callbacks.

Work groups, roughly by risk and concentration (counts from the current digest):

1. **`src/core/overlay/overlayNormalization.ts`** (7: `sanitizeInstanceParamSources` 26, `sanitizeInstanceParamValues` 16, `sanitizeInstanceAddressSource` 12, `sanitizeTypeParamDef` 9, `sanitizeParamEntry` 9, `sameParam` 9, `sanitizeParamList`/`same` 5) — extract per-field sanitizers; keep accept/reject and defaulting semantics byte-identical.
2. **`src/core/overlay/overlayCodec.ts`** (6) + **`src/webview/.../overlayPanel/overlayInstancesModel.ts`** (5) — shared param-validation helpers; also removes the cross-file clone group.
3. **Integrity pipeline** — `src/integrityScriptRunner.ts` (`runIntegrityScript` 25, path helpers 5), `src/core/integrity.ts` (3), `src/webview/.../integrityPanel/integrityCalculation.ts` (5), `integrityPanel.ts` (6), `integrityResultRender.ts` (4), `integrityCheckModel.ts`/`integrityHighlight.ts` (1 each) — split the script-check pipeline into prepare/schedule/apply/status helpers.
4. **Scripting core/permissions** — `src/core/scripting/{contracts,scriptRunner,scriptWorker,types}.ts` + `src/scriptPermissions.ts` (13 total): normalization guards (`normalizeBytes` 10, `normalizeScriptValue` 7, `normalizeAddress` 5), role/entry dispatch, grant matching.
5. **`src/instanceAddressRunner.ts`** (5) — per-param/per-instance helpers (also fixes 2 intra-file clone groups).
6. **`src/hexEditorSession.ts`** (5, incl. `confirmScript` 10 and arrow callbacks) — named handler extraction.
7. **`src/webview/components/sidebar/overlayPanel/overlayPanel.ts`** (~35, largest: `rows` 17, `instanceParamCellHtml` 17, `markAddressesStale`/`markParamsStale` 15, `apply*Results` 10, event arrows 10) — extract render/model helpers; if a helper is reusable, move it to a sibling module while keeping the panel's public contract (`component-sidebar-overlay-panel.md`).
8. **Remaining** — `src/webview/hexViewer.ts` (4), `rowRenderer.ts`, `editorFields.ts`, `cPreview.ts` (1 each), `examples/scripts/array-size-from-header.js` (`getSize` 5 — keep the example readable).

### Duplication (11 clone groups)

- 8 intra-file groups (overlayPanel ×3, hexEditorSession ×3, instanceAddressRunner ×2, integrityScriptRunner, overlayNormalization) → extract the repeated block into one helper per group.
- `overlayCodec.ts:126-134` ↔ `overlayInstancesModel.ts:133-139` → one shared param-validation helper in core/overlay.
- `examples/scripts/types/hexscope.d.ts:106-158` ↔ `src/core/scripting/types.ts:87-111` (and `:60-75` ↔ `:68-76`) → the public contract is an ambient, standalone copy by design (line 12 of the file: "Copy of the public surface … keep the two in sync"); imports cannot dedupe it because it must work when copied alone into a workspace.
  Strategy, in order:
  1. Keep both files ambient/standalone and reduce the clone surface by moving internal-only members out of the public mirror where possible (the internal `FetchOptions extends RequestInit` already diverges; check whether the internal interface can be narrowed without breaking internal consumers).
  2. If the token sequence still clones, regroup/reorder the declaration members on the public side into its documented user-facing order (semantics identical for TS users; no API change). Document the reason in the file header.
  3. If a faithful zero is impossible, report it as a verified false positive with evidence (the file is a deliberate public mirror) — per the fallow-fix skill's false-positive rule — and flag it in the task report. Do not add suppressions or config entries.

### Audit gate

Before the PR update, run the quality spec's commands:

```text
npx -y fallow --format json --quiet --explain
npx -y fallow audit --base origin/main --gate all --format json --quiet --explain
```

The changed-code audit must be clean. Full-scan `health.targets` outside the diff are reported, not refactored (fallow-fix skill step 6); in-diff targets are evaluated.

## 3. PR #261 update

- Push `feat/scripting-enhancements` after the green local gate.
- Title (proposal): `feat(scripting): typed role scripts, scoped permissions, and a managed Scripts panel`.
- Body: exactly `## Summary` + `## Main changes` per create-pr rules, condensed from the `[Unreleased]` user-visible outcomes; no testing/bookkeeping text.
- `gh pr edit 261 --title … --body-file .git/PR_BODY.md`, then `gh pr ready 261` (user requested ready-for-review), then read back title/body/state and watch checks.

## Compatibility

- No persisted schema, protocol payload, or public scripting API changes. Refactors preserve function behavior; the test change is fixture-only.
- The ambient `.d.ts` remains ambient and standalone in user workspaces.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| A refactor subtly changes sanitizer/validation behavior | Group-by-group typecheck + full `npm test` before commit; sanitizers are heavily covered by existing suites |
| `overlayPanel.ts` extraction changes DOM wiring | Follow `component-guidelines.md`; keep event delegation/markup contracts; run the webview suites |
| `.d.ts` clone cannot reach zero without suppressions | Documented fallback (verified false-positive report) or declaration regrouping; escalate in the task report |
| Local Fallow (with `node_modules`) diverges from degraded CI | CI after push is the final arbiter (AC4); main passed under the same degraded inputs |
| Large diff makes rollback hard | Refactor groups are file-scoped; revert a group with `git checkout -- <files>` before the commit; final commits stay separable (test vs refactor) |

## Rollback

- Before commit: revert per group (`git checkout -- <paths>`), keep the green groups.
- After commit: `git revert <commit>` for the refactor commit; PR metadata is reversible via `gh pr edit` / `gh pr ready --undo`.
