# Hex diff external-change reload

Parent: `09-21-hex-diff-review-followups`. Deliverable: handle external changes to either compared
file in the diff editor — watch both URIs, re-read/re-parse the changed side, and reload, reusing the
hex view's external-change banner mechanism (C6, R8).

## Goal

When a compared file changes on disk while the diff tab is open, the diff must reflect the new bytes
instead of showing stale content. Reuse the single-file editor's external-change behaviour and the
`ExternalChange` banner component rather than inventing a diff-only path.

## Confirmed facts

- The diff loads once: `DiffEditorPanel.open` reads/parses both sides on the webview `ready` message
  and posts a single `diffInit` (`src/diff/diffEditorPanel.ts:41-97`, `:83-96`). It registers **no**
  file watcher, so a later external edit is invisible until the tab is reopened.
- Hex-view mechanism to reuse:
  - Watcher: `vscode.workspace.createFileSystemWatcher` on the file's dir + basename, with a
    `SELF_WRITE_HORIZON_MS = 1000` self-write guard and a 200 ms debounce; re-reads and
    `parseCompactSource`, then posts `externalChange` (parseResult/labels/generation) or
    `externalChangeError` (checksum/malformed + `canQuickRepair`) — `src/hexEditorSession.ts:802-866`.
  - Wire: `webviewProtocol.ts:54-56` (`externalChange`, `externalChangeError`); `reloadAccepted`
    (`:76`).
  - Model appliers: `webviewMessageModel.ts:241-274`; host apply flow
    `src/webview/hexViewer.ts:1168-1177` (`applyExternalChangeAndUnlock`).
  - Banner component: `src/webview/components/externalChange/externalChange.ts`
    (`showConflict`/`showReload`/`showError`/`clearAll`/`clearError`).
- The `ExternalChange` component imports `IncomingFile` from `src/webview/appModel.ts:8`, which
  imports `./state` (`S`). The diff bundle is isolated from `S`/appModel, so reuse needs that type
  dependency decoupled (the component only passes `incoming` back to its `onReload` callback and never
  inspects it).
- The diff is read-only: no unsaved edits, so the conflict/unsaved-edit banner path does not apply —
  only the reload banner (and the error banner) matter.

## Requirements

- R1 — `DiffEditorPanel` watches both compared files and, on external change/create, re-reads and
  re-parses the changed side, recomputes `computeByteDiff`, and refreshes the open webview.
- R2 — Reuse the hex-view `ExternalChange` component for the reload and error banners; do not fork a
  diff-only banner. Decouple the component's `IncomingFile` dependency (or widen it) so the isolated
  diff bundle can import it without pulling in `state.ts`/`S`.
- R3 — Reload UX: a reload affordance vs silent auto-reload (see Open Question O1). Recommendation:
  banner-and-click (parity with the hex view, and avoids yanking the view under the user mid-compare),
  with the accept action re-reading and re-diffing.
- R4 — An externally-broken file (checksum/malformed) shows the error banner with the same actions as
  the hex view: `Quick Repair & reload` when `malformedLines === 0`, else `View in text editor`; the
  diff compares the repaired content after a successful repair.
- R5 — Reload must not lose the user's place gratuitously: define whether scroll position, selection,
  active search matches, and view mode survive a reload (see design; prefer preserving what still
  resolves against the new rows).
- R6 — Handle either side changing independently, and both changing (coalesce), without corrupting the
  row model or leaving a stale side.
- R7 — No regression to `diffProgress`/loading-card behavior or the existing read/parse split; keep
  `check-types`, `lint`, `test`, and the `fallow` gate green.

## Acceptance Criteria

- [ ] AC1 — With the diff tab open, editing compared file A on disk surfaces an external-change
  affordance; accepting it re-reads and re-parses A, recomputes the diff, and the grid + summary
  reflect the new bytes (R1, R3).
- [ ] AC2 — Same for compared file B (R1, R6).
- [ ] AC3 — An externally-broken file shows the error banner; `Quick Repair & reload` (checksum-only)
  reloads repaired content; malformed input offers `View in text editor` (R4).
- [ ] AC4 — The reload/error banner is the reused `ExternalChange` component (hex-view markup/ids), not
  a forked diff banner (R2).
- [ ] AC5 — No conflict/unsaved-edit banner is shown (the diff is read-only) (R2).
- [ ] AC6 — Reload preserves the view state chosen in R5 (or resets it consistently), with a test (R5).
- [ ] AC7 — `npm run check-types`, `npm run lint`, `npm test`,
  `npx -y fallow audit --base origin/main --gate all` all pass (R7).

## Out of Scope

- Editing/saving files from the diff view; it stays read-only.
- Persisting diff state; touching `.hexscope/` from the diff panel.
- Diffing more than two files.

## Decisions (resolved 2026-09-22)

- **D1 — Banner-and-click reload.** External changes surface the reused `ExternalChange` reload banner;
  the host eagerly re-parses the changed side (parity with `hexEditorSession.ts:818-860`) and re-diffs
  on the user's click. Silent auto-reload is rejected. View state on reload follows the R5 table in
  `design.md` (preserve view mode + scroll; reset selection + search).

## Dependencies

- **Blocked by `hex-diff-surface-correctness`** (archived 2026-09-22) — its `diffEditorPanel.ts` /
  `diffGrid.ts` changes are the base this child builds on.
- Shares `src/diff/diffEditorPanel.ts` with `hex-diff-r7-label-context`; sequence those two so only one
  is in flight (write the ordering here, not implied by tree position).
- Reuses `src/webview/components/externalChange/*` — that component's type decoupling may also touch
  the single-file host; keep its existing behavior/tests unchanged (parity gate).

## Notes

- Complex child — `design.md` and `implement.md` are required before `task.py start`.
- Finding C6 is user-reported (not from the two-axis review); keep the Standards/Spec axes separate and
  label it Spec-axis.
