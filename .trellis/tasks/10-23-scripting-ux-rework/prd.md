# Rework scripting UX

## Goal

Organize the scripting feature around user jobs instead of implementation primitives. Run scripts,
role providers, creation, permissions, and feedback should each have a clear surface so users do
not discover the contract through an error.

## Source requirements

| ID | Requirement |
|----|-------------|
| R1 | Role-only scripts must not offer a failing Run action; runnable actions and role providers must be distinguishable and ordered predictably. |
| R2 | Script permissions must match their labels: session grants last for the workspace session, and all scopes are visible and revocable in one place. |
| R3 | Users can create a script or a role template without opening a firmware file, and can install examples selectively. |
| R4 | Approved writes explain what changed, and the panel scales to many scripts with details, search/filtering, and live discovery. |
| R5 | Scripts connect to the Integrity and Overlay surfaces that use them, with clickable filenames, context actions, and last-run state. |

## Task map

| Child task | Deliverable | Priority | Ordering |
|------------|-------------|----------|----------|
| `10-23-script-role-actions` | Role-only cards lose Run, gain a purposeful action, and the list orders actions before providers | P1 | First; fixes the observed “must export run” confusion |
| `10-23-script-permission-lifetime` | Workspace-session grants and a complete revocable permission center | P1 | Independent; can run alongside role actions |
| `10-23-script-workspace-management` | Manage Scripts entry point, create-from-template, selective example install, actionable pickers | P2 | Needs the role/provider model |
| `10-23-script-feedback-scale` | Write summary, script details, search/filter, live rescan, TypeScript decision | P2 | Needs details surface and role metadata |
| `10-23-script-integration-polish` | Used-by links, clickable names, context menus, last-run metadata | P3 | Last; depends on provider metadata from earlier children |

Dependencies are written here and in each child `prd.md`; the tree carries no ordering.

## Cross-child acceptance criteria

- [x] A new user can tell an action script from a provider script without reading the docs.
- [x] Clicking any primary card action is meaningful for that script kind; no primary action
      produces “must export run” for a provider.
- [x] A permission label always matches its actual lifetime and revoke path.
- [x] A user can create, open, test, and delete a script from the scripting UI without knowing
      the `.hexscope/scripts` path.
- [x] Approved writes report what changed and how to undo it.
- [x] The panel remains usable with 20+ scripts.
- [x] Existing profiles, role exports, and `run` scripts remain compatible.
- [x] `check-types`, `check-examples`, `lint`, and the full test suite pass.

## Non-goals

- A new sandbox, permission model, or script runtime.
- A marketplace or remote script gallery.
- Replacing the existing integrity/overlay engines.
- Making role scripts writable.
- Supporting scripts outside the workspace.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Separate **Actions** (runnable) from **Providers** (role scripts) in the panel | The current flat list hides a fundamental contract difference |
| D2 | Provider-only cards never show Run | The current action fails by design and teaches the wrong model |
| D3 | Session grants use a workspace/host-lifetime store, not a per-editor store | The label and docs promise “until VS Code restarts” |
| D4 | Creation is template-first and available outside a hex file | Users should not need a firmware document to edit scripts |
| D5 | Write results summarize the affected range and undo path | Single-confirmation auto-save needs visible consequences |
| D6 | TypeScript support is decided explicitly in the feedback child | The current “disabled Run” dead end needs a product answer |

## Branch

This rework continues on the open scripting feature branch so the changes stay in one review
unit. It does not create a second PR.

## Done when

All five child deliverables are archived, the parent integration review confirms the cross-child
criteria, and the scripting docs/specs describe the new action/provider model.
