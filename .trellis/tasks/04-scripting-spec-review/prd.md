# Scripting spec review and UI design

## Goal

Review the scripting feature implementation against the code-spec template, fix inconsistencies, and produce a final spec document that accurately describes the delivered feature.

## Requirements (for the spec document)

- R1. Spec must cover all cross-layer contracts: protocol messages, ScriptHost interface, HexScopeAPI surface
- R2. Spec must include validation & error matrix for all API methods
- R3. Spec must include Wrong vs Correct coding examples
- R4. Spec must be reviewed against final source code (not the early draft written during implementation)
- R5. Archived `design.md` decisions must be preserved in the live spec

## UI Design Requirements (scripts tab)

- RD1. Script cards show filename, extension badge (js/ts), and Run button
- RD2. Running state: button shows "Running…", becomes dimmed/disabled
- RD3. Result area embedded inside each script card (not separate section)
- RD4. Re-running the same script replaces its previous result
- RD5. Result block shows: header (script name + success/error icon), key-value results, output log, write notification
- RD6. Scrollable output log with alternating row backgrounds
- RD7. Empty state: "No scripts found in .hexscope/scripts/" with path hint

## Acceptance Criteria

- [ ] `.trellis/spec/frontend/scripting.md` is updated to match final implementation
- [ ] All API signatures, error conditions, and contracts are documented
- [ ] Cross-layer message types are captured in the spec
- [ ] UI component states (empty, loading, result, error) are specced
- [ ] Archived `design.md` decisions are reconciled with the live spec
