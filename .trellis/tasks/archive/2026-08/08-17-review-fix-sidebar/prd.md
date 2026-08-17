# Fix sidebar code-review findings

## Goal

Resolve the 7 findings from the two-axis code review of `feat/ui-consistency` (Standards: 5, Spec: 2). Small, well-understood fixes; no behavior redesign.

## Requirements

**S1. Copy-feedback token duplication** — `.copied` success flash uses `var(--vscode-testing-iconPassed, #73c991)` hardcoded in both `inspectorPanel.css` and `integrityPanel.css`. Use the repo token `var(--ok)` (already defined in base.css, used by `.sb-status-dot.ok`); ideally one shared rule in sidebar.css. No foreign VS Code testing token.

**S2. Unbounded document click listeners** — `structPanel.ts` mount adds an anonymous `document.addEventListener('click', …)` and `integrityProfiles.ts` `wireProfileMenu` adds one per render with no removal, so full-shell re-mounts stack handlers. Follow the repo pattern (`hideFieldValMenu` bound method + removeEventListener; `scriptsPanel.dispose()`). Use stored bound handlers + explicit removal; getter one-idle guard.

**S3. Redundant popover implementation** — integrity profile menu re-implements open/close/Escape/click-outside/`aria-expanded` already written twice (struct card ⋮ menu, struct field menu). Extract one shared popover/menu helper (e.g. in `sidebar.ts` or a small menu module) and reuse it in all three sites; behavior identical.

**S4. CSS-guidelines spec drift** — `css-guidelines.md` still states `.sb-hdr` survives for the label-form title and documents 9px metadata; the branch deleted `.sb-hdr` and raised the floor to 10px. Reconcile the spec doc with current code.

**S5. Small correctness** — `byteLineParts` returns `{ display, copy, truncated }` but the only consumer doesn't use `truncated`; remove the dead field or use it. `flashCopied` should tolerate rapid re-clicks (clear + reset timeout; no stale text restore after the element was re-rendered).

**S6. Card-menu visual** — struct card ⋮ menu items inherit `.act-btn` base `opacity:0` (visible only via hover/focus-within); make menu items always opaque (they are a popover list, not hover-reveal actions).

**S7. Scripts trust/confirm semantics** — ensure the trust flow is aligned with the capability gate: untrusted workspace (`disabled-trust`, hard `disabled`) vs capability-listing confirmation at first run remain distinct and both work; the first-run confirm fires on capability-bearing scripts regardless of trust, hard-disabled stays for untrusted workspace. Update tests if needed.

## Acceptance Criteria

- [ ] No hardcoded success color outside shared token; copy flash uses a single shared rule.
- [ ] `document.addEventListener` in sidebar panels is removed on teardown/deterministic; no listener stacking across re-mounts (add test if cheap).
- [ ] One popover/menu implementation reused by struct card menu, struct field menu, integrity profile menu; no third/fourth copy.
- [ ] `css-guidelines.md` matches current sidebar CSS reality (no `.sb-hdr`, metadata floor 10px).
- [ ] `byteLineParts` has no dead field; `flashCopied` handles rapid clicks/re-renders cleanly.
- [ ] Card menu items render at full opacity without hover.
- [ ] Scripts trust→hard-disabled and capability→first-run-confirm behave per contract; suite covers both.
- [ ] `npm run check-types`, `npm run lint`, `npm test` green.

## Out of scope

- Any new visual design, rework, or feature.
- Standards findings already covered by tooling (lint/type).
- Re-running the full two-axis review.