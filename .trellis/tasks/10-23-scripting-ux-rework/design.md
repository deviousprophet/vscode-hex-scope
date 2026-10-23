# Design: scripting UX rework

## User jobs

1. Discover what scripts can do.
2. Create or open a script without hunting the filesystem.
3. Run an action and read its result.
4. Attach a provider to an integrity check, an instance address, or an array size.
5. Understand and revoke a permission.
6. Recover from a contract, compile, or save error.
7. Do all of this before opening any firmware file.

The current panel is organized around `run`, roles, and capabilities. This design organizes it
around the first two objects a user actually manipulates: **Actions** and **Providers**.

## Object model

```ts
type ScriptKind = 'action' | 'provider';
```

- **Action**: exports `run`. Primary action: Run.
- **Provider**: declares one or more `@script` roles. Primary action: Open / Use. No Run.
- **Both**: exports `run` and at least one role. Appears in Actions with a provider badge, and
  in Providers as a usage source. Do not duplicate the card; one card can expose both actions.

Classification belongs to scan metadata, not the renderer:

```ts
interface ScriptInfo {
    // ...existing
    hasRun: boolean;
    roles: ScriptRole[];
}
```

Detection: a source-level export scan for `run` (same patterns accepted by the runner:
`export function run`, `export const run`, `module.exports = { run }`, `exports.run =`). If the
scan is uncertain, allow an explicit `@entry run` header tag; without either, treat it as a
provider when roles exist, otherwise as an unknown script with an Open/Inspect action. Never
render a Run button for a known provider-only file.

## Information architecture

```
Scripts                         [+ New] [Refresh]
─────────────────────────────────────────────────
ACTIONS (3)
  hello.js            Run  Open
  verify-crc.js       Run  Open
  write-pattern.js    Run  Open   write
PROVIDERS (3)
  follow-pointer.js   address      Open
  array-size...js     size         Open
  verify-integrity.js integrity    Open
─────────────────────────────────────────────────
Permissions (2)                              Manage
```

- Collapsible `Actions` and `Providers` sections, with counts.
- Actions first. Within a section, keep a stable catalog-first order for shipped examples, then
  alphabetical for user scripts. Persist the user's chosen sort/filter.
- A compact type filter/search appears when the list exceeds a threshold (for example 8 scripts).
- Cards remain one row, but the name is a link to open the file. Role chips use job language:
  `address` → `Instance address`, `size` → `Array size`, `integrity` → `Integrity check`.
- Provider cards show the destinations that use them (`Used by Integrity · 2`, `Used by
  Config @ 0x08000000`) once that metadata is available.

## Card actions by kind

| Kind | Primary | Secondary | Forbidden |
|------|---------|-----------|-----------|
| Action | Run / Cancel | Open, result collapse | — |
| Provider | Open | Used by, Refresh resolution | Run |
| Both | Run / Cancel | Open, provider chips | — |

Provider testing happens in the destination panel (Integrity refresh, Overlay refresh), because
address/size providers need an instance/parameter context that the script card does not have.
A generic Test button would fabricate a context and teach the wrong thing. The card can deep-link
to the destination instead.

## Creation and discovery

A **New script** split button with templates:

- Blank action script (`run` + result)
- Integrity check (both exports)
- Instance address (`getAddress`)
- Array size (`getSize`)

Each template opens the new file immediately with the correct header tag, JSDoc types, and a
comment naming the placeholder to adapt. The existing example catalog remains under
**Browse examples**, but installation becomes selective: a dialog lists the six examples with
checkboxes and a copy-only note. “Add all examples” stays as a secondary action.

A workspace command **`HexScope: Manage Scripts`** opens a QuickPick (or a small panel) with:

- Actions and Providers grouped
- Open / Run / Show usages / Reveal in Explorer
- New script templates
- Manage permissions

This command does not require an open hex document. The in-editor Scripts panel remains the
primary surface when a document exists.

## Permissions

One store per workspace session, not per editor instance:

```ts
Map<workspaceRoot, ScriptGrantStore>
```

The store owns script, session, and workspace grants. The permission center lists every entry
with scope, capability, script, and a revoke action. Prompt copy mirrors the actual lifetime.
Workspace grants remain in `workspaceState`; session grants die when the extension host exits;
script grants are fingerprint-bound. `exec` never persists.

## Feedback

- After a successful write run, show a compact summary: address range, byte count, before/after
  values, and `Ctrl+Z` to undo.
- A save failure is a distinct state, not “saving.”
- Contract errors include an **Open script** action and the failing entry name.
- Provider resolution states in Overlay/Integrity link back to the script and offer Refresh.
- A script details surface (expandable card or small popover) shows roles, capabilities, exported
  entries, fingerprint, active grants, and usages.

## Lifecycle and scale

- Watch `.hexscope/scripts/` for add/change/delete and rescan with a short debounce; keep manual
  Refresh.
- Preserve result areas across rescans by path.
- Sorting and filtering are presentation-only; the host metadata stays canonical.
- Provider usage is derived from the current profile (integrity checks and type instances), not
  persisted into the script.

## Compatibility and rollout

- No protocol removal: keep `runScript`, `openScript`, and role messages; add metadata and
  optional messages.
- Existing actions and providers keep working; no profile migration.
- `ScriptInfo` gains `hasRun`; older payloads default to a conservative unknown state.
- Rollout follows the child order: role actions, permission lifetime, creation/management,
  feedback/scale, integration polish.

## Risks

| Risk | Mitigation |
|------|------------|
| Export scan misclassifies a script | Conservative patterns + explicit `@entry run` override + Inspect action |
| Two sections add height | Collapsible sections, compact rows, filter when large |
| Provider “Used by” requires scanning profiles | Derive lazily from the bound profile; no persistence |
| Workspace manager duplicates the panel | It manages files and templates; the panel remains the run surface |
| TS decision expands scope | Decide in the feedback child; do not bundle a compiler in this rework |
