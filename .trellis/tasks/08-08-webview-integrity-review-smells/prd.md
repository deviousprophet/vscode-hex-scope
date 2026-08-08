# Fix IntegrityPanel review smells

## Goal

Clean up three code smells found in the final two-axis code review of the Integrity panel extraction (PR branch `feat/webview-integrity-component`, commits `532f869` + `3af10bc`). Behavior-preserving; zero functional or user-visible change.

## Requirements

1. **Dead branch in `checkStatusLabel`** (`src/webview/components/Integrity/IntegrityPanel.ts` ~L807-812): collapse
   ```ts
   if (check.result) { return this.completedCheckStatus(check); }
   return this.completedCheckStatus(check);
   ```
   to a single `return this.completedCheckStatus(check);`. Both branches are identical and `completedCheckStatus` already returns `'Not configured'` when `!check.result`, so the `if (check.result)` gate is fully dead.
2. **Data clumps `{ address: number; expected: Uint8Array }`** recurs 4× (`fixableChecks` return + element type, `fixableCheckEdits` param, `storedValueUpdate` return, `updateStoredValue`). Bundle into an exported type `StoredValueUpdate` defined in `src/webview/components/Integrity/integrityCheckModel.ts` (the pure model already owns stored-value semantics). Component imports it; all four sites use it. No behavior change.
3. **Speculative dead field `calculatedDisplay` always returns `title: ''`**. Remove the `title` field from the return type and remove the `title=""` attribute from the `<code>` markup it feeds. Update the component spec `.trellis/spec/frontend/components/component-sidebar-integrity-panel.md` to note the empty `title` attr was dropped (dead markup; parity rule exception for zero-value empty attribute).

## Acceptance Criteria

- [ ] `checkStatusLabel` is a single delegation to `completedCheckStatus`; a fresh (no-result) check still renders status `'Not configured'`.
- [ ] `StoredValueUpdate` exported from `integrityCheckModel.ts`; all 4 `{ address, expected }` sites typed with it; component + model compile and existing model tests pass unchanged.
- [ ] `calculatedDisplay` returns `{ label, value }`; no `title=""` in calculated `<code>` markup; component spec updated.
- [ ] Tests: `src/test/webview/components/integrity.test.ts` gains (a) a fresh-check status label `'Not configured'` assertion, and (b) a stored-mismatch auto-fix / fix-all assertion verifying edit-pair output after the type extraction (mirroring existing test style). No new test needed for the dead-field removal.
- [ ] `npm run lint`, `npm run check-types`, `npm run compile-tests`, webview mocha suite (components + webview parity), and `npm test` all green.

## Notes

- Scope is exactly the 3 smells. Deliberately excluded (documented during planning): the ~20 global `document.getElementById`/`querySelector` calls in the component (spec-mandated single-instance ids; no multi-instance need yet) and `setCallbacks` absence vs the template contract — both are acceptable current-state judgement calls, not defects.
- Branch strategy: new branch off `main` after the integrity PR (`#…`) merges; own follow-up PR. Do NOT append to `feat/webview-integrity-component`.
- Source of truth for the smells: final code review of `main..feat/webview-integrity-component` (Standards axis findings). Archived `design.md` for the extraction is a historical record and must NOT be rewritten (it is missing `getEndian`; live spec `component-sidebar-integrity-panel.md` is authoritative).
