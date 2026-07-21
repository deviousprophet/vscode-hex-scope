# Scripting spec design follow-up

## Goal

Review and solidify the scripting feature's code-spec documentation that was created during implementation (`.trellis/spec/frontend/scripting.md`). Ensure all design decisions, contracts, and API surfaces are accurately captured so future sessions can build on this work without rediscovering context.

## What was delivered in the implementation phase

- `src/core/scripting/` — runner, compiler, API modules, type definitions
- `src/scriptHost.ts` — VS Code host adapter
- `src/webview/sidebar/scripts/` — sidebar UI
- Protocol messages, commands, CSS
- 24 unit tests
- `docs/SCRIPTING.md` — user-facing guide
- `.trellis/spec/frontend/scripting.md` — initial code-spec (created during implementation)

## What needs review

1. Does `.trellis/spec/frontend/scripting.md` accurately reflect the final implementation? (It was written early and may be stale)
2. Are all cross-layer contracts (protocol messages, ScriptHost interface, HexScopeAPI surface) documented with the right level of detail?
3. Are there missing sections per the code-spec template (validation matrix, test requirements, wrong vs correct)?
4. Should the `design.md` from the task archive be merged into the live spec?

## Acceptance Criteria

- [ ] `.trellis/spec/frontend/scripting.md` is reviewed against the final source code
- [ ] Any gaps between spec and implementation are documented or the spec is updated
- [ ] Cross-layer contracts are complete and accurate
- [ ] Archived `design.md` key decisions are preserved in the live spec
