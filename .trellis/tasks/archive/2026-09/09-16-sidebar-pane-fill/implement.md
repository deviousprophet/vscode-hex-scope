# Implementation Plan — Fix sidebar section body void + premature scrollbar

## Pre-flight

- [ ] `trellis-before-dev` to load frontend specs (css-guidelines, sidebar, struct-panel)
- [ ] Working tree clean at `207a9b6`

## Steps

### 1 — `sidebar.css`: add no-transition rule

- [ ] Add `.sb-pane-view.no-transition .sb-pane { transition: none !important; }` after the existing `.sb-pane-view.dragging` rule.

### 2 — `sidebar.ts`: toggle no-transition during layout

- [ ] Add private `collapseAnimating = false` field to `SidebarSections`.
- [ ] In `setCollapsed`: set `this.collapseAnimating = true` before `this.layout()`, reset after.
- [ ] In `layout()`: add `this.paneView.classList.add('no-transition')` before `applyAllocation` loop when `!this.collapseAnimating`. Remove via `requestAnimationFrame` after `paintSashStates()`.

### 3 — `structPanel.css`: remove unreliable min-height

- [ ] Remove `min-height: 100%;` from `.si-editor-wrap` (keep `display: flex; flex-direction: column;`).

### 4 — Tests

- [ ] Existing struct/inspector/sidebar mocha suites pass unchanged (parity gate).
- [ ] No new tests needed — layout timing is a browser-level concern; AC5 manual gate covers it.

## Validation Commands

```bash
npm run check-types
node_modules\.bin\tsc.cmd -p . --outDir out
node_modules\.bin\mocha.cmd --ui tdd --require out/test/webview/cssImportHook.js "out/test/webview/**/*.test.js"
node_modules\.bin\mocha.cmd --ui tdd out/test/core/struct.test.js
npx fallow --format json --quiet
```

## Review Gates

- During `trellis-check`: run `/code-review` on the final diff.
- AC5 manual gate (owner-run): open `%TEMP%\sidebar-fill.html` fixture in Chrome, confirm no void, no premature scrollbar, collapse animation preserved.

## Risk Files

| File | Risk |
|---|---|
| `src/webview/components/sidebar/sidebar.css` | New CSS rule — must not affect collapse animation |
| `src/webview/components/sidebar/sidebar.ts` | layout() + setCollapsed flag — must preserve collapse animation |
| `src/webview/components/sidebar/structPanel/structPanel.css` | min-height removal — struct editor fill behavior changes |

## Rollback

- Remove `.no-transition` CSS rule, remove JS flag/toggle, restore `.si-editor-wrap` CSS.

## Completion = AC1–AC10 green + validation commands clean + /code-review passed.
