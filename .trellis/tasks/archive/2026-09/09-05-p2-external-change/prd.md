# P2: External-change false-positive on out-of-workspace files (#7)

## Goal

Confirm the intermittent "File changed externally. Reloading..." false-positive
(and the "disabled with no message" variant) on out-of-workspace HEX files does
not reproduce under the P0/P1 storage rework, and leave a regression guard so it
cannot silently return.

Child of `09-05-firmware-profile-rework`. **Ordering:** after P0 + P1 (both
archived) — P0 removed eager `.hexscope/` sibling creation for out-of-workspace
opens and P1 further defers watcher attachment until profile materialization.

## Context — why this likely vanished

`firmware_profile.md` P2 (#7) notes the suspected trigger was a filesystem event
from writing into the out-of-workspace `.hexscope/` sibling folder
(profile/schema seeding) being misattributed by VS Code's watcher to the
neighboring hex file. After P0+P1:

- Opening an out-of-workspace file never creates `.hexscope/` at all → no
  sibling writes to misattribute.
- The per-file profile watcher is attached only once a profile dir exists
  (deferred materialization) → no watcher during a fresh open.
- The `onExternalChange` handler + 200 ms `reloadTimer` debounce and the
  1 s self-write horizon are unchanged.

## Requirements

- R1: Opening several out-of-workspace hex files in sequence (no edits, no
  profile action) produces no spurious `externalChange`/`externalChangeError`
  message to the webview and no disabled-editor state.
- R2: A regression guard exists — either a test or an executable manual repro
  script — covering out-of-workspace open-without-write.
- R3: No behavior change to genuine external-edit auto-apply.

## Constraints

- No new user-facing prompts (preserves silent auto-apply contract).
- If a real repro of #7 is found, escalate as a defect (P2 becomes fix task);
  if not reproducible, document and close as verified-resolved.

## Acceptance Criteria

- [ ] Out-of-workspace open+close (multiple files) triggers zero fs writes and
      zero spurious external-change messages.
- [ ] Regression guard committed (test or repro script).
- [ ] Existing external-edit auto-apply tests still pass.

## Notes

- Source: issue #212, req 7; `firmware_profile.md` lines ~255-277.
- Lightweight task — PRD-only acceptable; add design/implement only if a real
  defect surfaces.