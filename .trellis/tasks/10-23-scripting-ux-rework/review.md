# Integration review: scripting UX rework

Reviewed on 2026-10-23 against branch `feat/scripting-enhancements` with all five child
deliverables archived and the delete-closure work landed.

## Cross-child acceptance criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | A new user can tell an action script from a provider script without reading the docs | Met | Panel groups **Actions** / **Providers** with counts; job-language chips (`Instance address` / `Array size` / `Integrity check`); provider cards have no Run control; unknown cards show an `Inspect exports` hint. Component spec "Kinds and grouping"; `scriptsPanel.test.ts` kinds/grouping suites |
| 2 | Clicking any primary card action is meaningful for that script kind; no primary action produces "must export run" for a provider | Met | Provider/unknown Run control is structurally absent (spec D37), verified by `provider-only cards render Open and job-language chips, never a Run control`; both-kind cards keep Run; provider testing lives in the destination panel by design |
| 3 | A permission label always matches its actual lifetime and revoke path | Met | Prompt labels state the host lifetime (`until VS Code restarts` for both in-memory scopes; `across restarts` for workspace); the permission center lists every script/session/workspace grant with per-row and bulk revoke; docs/SCRIPTING.md permissions table; `scriptPermissions.test.ts` + panel permission suites. The earlier ambiguous "until the editor closes" wording was corrected during the permission-lifetime task |
| 4 | A user can create, open, test, and delete a script from the scripting UI without knowing the `.hexscope/scripts` path | Met | **Create**: `＋ New` split button / empty-state create / `Manage Scripts` templates. **Open**: script-name button + Open actions. **Test**: action Run in the panel; providers via destination Refresh (design). **Delete** (closed in this parent): `Delete a script…` in the manager and `Delete` in the card context menu, modal confirm, grant revocation, rescan. `manageScripts.test.ts` delete flow + panel context-menu tests |
| 5 | Approved writes report what changed and how to undo it | Met | Write summary: mapped range, byte count, before/after (first/last + count above 8 bytes), `Ctrl+Z` guidance, distinct `failed` state; `scriptSaveFailed` correlation. Panel write-summary suite + `editing-save-external-change.md` contract |
| 6 | The panel remains usable with 20+ scripts | Met | Collapsible counts groups, compact search + kind filter (hide/show, no re-render), details on demand, debounced live rescan; filter suite preserves result areas/history/permissions |
| 7 | Existing profiles, role exports, and `run` scripts remain compatible | Met | No schema change; additive protocol only, with tolerant defaults (legacy `hasRun`, legacy `compilerAvailable` = blocked, pre-scope `revokeScriptPermission` → workspace); full suite green |
| 8 | `check-types`, `check-examples`, `lint`, and the full test suite pass | Met | `npm test` (incl. pretest gates) and Fallow changed-code audits green through every child closure and this parent closure |

## Done-when confirmation

- All five child deliverables archived: `script-role-actions`, `script-permission-lifetime`,
  `script-workspace-management`, `script-feedback-scale`, `script-integration-polish`.
- This review confirms the cross-child criteria above; the one criterion no child owned (delete)
  was closed as parent direct work with tests.
- The scripting docs/specs describe the new action/provider model: `docs/SCRIPTING.md` and
  `.trellis/spec/frontend/scripting.md` (D30–D51) plus the three component specs.

## Deferred (out of scope, recorded)

- Renaming scripts (the child deferred it; delete now exists, rename can follow).
- Cross-workspace usage, marketplace, provider Run from the manager (needs a parsed document).
