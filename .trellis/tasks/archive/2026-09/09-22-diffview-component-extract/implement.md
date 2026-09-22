# Implementation Plan — DiffView component extraction

Status: planning. Do not start until the review gate passes (`task.py start`).

## Preconditions

- Read `prd.md` + `design.md`.
- Read specs in `implement.jsonl` (`component-diff-view`, `component-hex-view`,
  `component-guidelines`, `directory-structure`, `css-guidelines`,
  `quality-guidelines`).
- Baseline must be commit `b767c79` (the latency work) with a clean tracked tree
  (`git status --short` shows only untracked `.trellis/tasks/*`). Do not start on a
  dirty working tree.
- Confirm `npx tsc --noEmit -p .`, `npm run lint`, `npm test` are green on the
  baseline and record the `diffViewer.test.ts` pass count.

## Ordered checklist

1. **Baseline** — run the three gates; record `diffViewer.test.ts` count (parity
   reference for later steps).
2. **Component markup** — create
   `src/webview/components/diffView/diffViewRender.ts`:
   - `renderDiffViewBodyHtml()`: move the two-pane body markup verbatim from
     `diffViewer.ts#renderDiffShellHtml` (lines with `.diff-body`, `.diff-side`,
     `.diff-grid-root#diff-a/b`, `.mem-header#diff-header-a/b`, `.mem-scroll`,
     `.mem-rows#diff-rows-a/b`, `.diff-split`); identical ids/classes/structure.
   - `renderDiffEmptyHtml(message)`: the escaped `renderEmptyGrid` card markup.
   - `diffViewer.ts#renderDiffShellHtml`: summary + `renderDiffViewBodyHtml()` +
     error card.
   - Test: `renderDiffViewBodyHtml` id/class/order assertions; empty markup escaped.
3. **Component controller** — create
   `src/webview/components/diffView/diffView.ts`: `DiffPane`, `DiffViewCallbacks`,
   `DiffView` (`mount`/`reset`/`setCallbacks`/`paintSelection`/`injectHeaders`/
   `setScrollTop`/`setScrollLeft`/`getScrollTop`), owning `viewA`/`viewB` and
   forwarding the five callbacks with the pane argument.
   - Test: mount idempotent + creates both views; each callback forwards its pane;
     `paintSelection` hits both panes; `injectHeaders` fills both headers;
     per-pane scroll get/set; `reset` drops instances; `setCallbacks` swap.
4. **Component CSS** — create `src/webview/components/diffView/diffView.css` with
   `.diff-body`, `.diff-side`, `.diff-split`, `.diff-grid-root`, and
   `.diff-chg`/`.diff-add`/`.diff-del`, moved verbatim from `diff/diff.css`
   (duplicates removed there; `.diff-root`, `.diff-summary`, `.diff-error` and the
   `[hidden]` guards stay). Import `./diffView.css` from `diffView.ts`.
   - Keep the `[hidden]` guard rules where their markup owner lives; verify
     `.diff-body[hidden]` still collapses.
5. **Rewire host** — `src/webview/diff/diffGrid.ts`:
   - `let diffView: DiffView | null`; `mountDiffGrid` constructs + mounts it with
     `hostCallbacks()`; `resetDiffGrid` calls `diffView?.reset()`.
   - Replace every `viewA`/`viewB`/`paneView(...)` call: `paintMirroredSelection`,
     `renderHeaders`, `alignFollowerToDriver`, `mirrorFollowerLeft`,
     `scrollPaneToRow`, `restoreAnchor` → `diffView` methods.
   - Import `DiffPane` from the component; delete the local alias.
   - `renderEmptyGrid` → `renderDiffEmptyHtml`.
   - Leave slice/poll/transform/`repositionPane`/`drawPane`/`rowsId`/
     `scrollContainer`/`sliceKey` untouched.
6. **Update host tests** — `src/test/webview/diffViewer.test.ts`: only import paths
   and any removed-export references; no assertion changes. Re-run the suite and
   match the baseline count.
7. **Spec reconciliation** —
   - `component-diff-view.md`: Layout (new folder + host), Contract (add `DiffView`
     API, `renderDiffViewBodyHtml`/`renderDiffEmptyHtml`), Rules (component owns
     markup/interaction/paint/styles; host owns data/loop/rows DOM), Behaviour
     (composition-root shell), Tests Required (split into
     `components/diffView.test.ts` + host suite), and **remove the anti-pattern**
     claiming diff layout lives only in the host.
   - `directory-structure.md`: add `components/diffView/` to the tree; note the
     component/host split.
   - `component-hex-view.md`: update only if its "diff host reuse" note changes.
8. **Full gate** — `npx tsc --noEmit -p .`; `npm run lint`; `npm test`; then
   `npx -y fallow --format json --quiet --explain` and
   `npx -y fallow audit --base origin/main --gate all --format json --quiet --explain`
   (fix via `/fallow-fix`).
9. **Manual visual check** (webview): open a diff pair — two panes render, splitter,
   headers, selection mirror, scroll sync on/off, compressed large-file mode, error
   card, toolbar; no layout/color change vs baseline.
10. **Finish** — `task.py finish`; leave the commit decision to the user.

## Validation commands

```
npx tsc --noEmit -p .
npm run lint
npm test
npx -y fallow --format json --quiet --explain
npx -y fallow audit --base origin/main --gate all --format json --quiet --explain
```

If the vscode-test host cannot launch, run the jsdom/mocha suites for
`out/test/webview/diffViewer.test.js`, `out/test/webview/components/diffView.test.js`,
and the `diff*` core suites, and state that the vscode-test portion was not run.

## Review gates

- **Gate 1 (this planning gate)**: approve `prd.md` + `design.md` + `implement.md`
  + jsonl manifests before `task.py start`.
- **Gate 2 (after step 3)**: confirm the `DiffView` API + boundary before rewiring
  `diffGrid.ts` (step 5) — the point of no return for the host refactor.
- **Gate 3 (pre-commit)**: full gate green + spec reconciliation + manual visual
  check.

## Rollback points

- After steps 2–4 (component folder + `diffViewer.ts` composition): revert = delete
  `components/diffView/` and restore `renderDiffShellHtml` + `diff.css` rules; host
  untouched.
- After step 5: revert the `diffGrid.ts` host rewiring to the inline `viewA`/`viewB`
  wiring; the component folder can stay unused or be deleted.
- `git diff` should touch: `src/webview/components/diffView/*` (new),
  `src/webview/diff/diffGrid.ts`, `src/webview/diff/diff.css`,
  `src/webview/diffViewer.ts`, `src/test/webview/components/diffView.test.ts` (new),
  `src/test/webview/diffViewer.test.ts`,
  `.trellis/spec/frontend/components/component-diff-view.md`,
  `.trellis/spec/frontend/directory-structure.md`.
