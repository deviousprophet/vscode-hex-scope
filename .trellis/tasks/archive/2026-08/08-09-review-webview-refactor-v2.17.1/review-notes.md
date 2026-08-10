# Two-axis review notes — v2.17.1..HEAD webview component refactor

- Range: v2.17.1 (d1340a7) .. HEAD (76ab523) — 40 commits, 244 files, +20.8k/−11.3k.
- Issue #151 acceptance: no functional/visual change EXCEPT declared intended changes
  (ASCII toggle #153, edit-button #153, ASCII-state #154, Ctrl+Z #154, record layout polish #156,
  ContextMenu rework #157, endian-wipe fix #160, resizer persistence #160, lazy-mount #160,
  fallow split #161, panels #163/164/166/167, camelCase #170). #148 diff feature fully reverted (#150).
- Verified: tsc clean, 336 webview tests pass, protocol/state byte-identical, #148 revert clean,
  component no-S/no-postMessage/no-domain contract respected, CSS no lost rules.

## STANDARDS AXIS — 6 findings (2 documented-standard, 4 smells)
- H1 (hard) hexViewer.ts:141-178 highlightHexAddress/onClearHighlightHex write HexView cell DOM via
  [data-addr] querySelectorAll — violates component-hex-view.md:131/96 + template:46. Pre-existing debt;
  needs paintStructHighlight(addrs, cls).
- H2 (borderline-hard) hexViewRender.ts:149,156 unescaped cell.hex/cell.char/cls in innerHTML — safe only
  because sole host pre-escapes (memoryGrid.ts:319); latent injection for a 2nd host.
- B1 (dup) hexViewer.ts:480/1158/1169/1178 four near-identical refresh-after-edit bodies.
- B2 (god-module) hexViewer.ts 1256 lines holds record virtualization + context-menu action math;
  documented as host per specs but drifting.
- B3 (long file) structPanel.ts 4910 lines vs sibling panels split 5-6 modules.
- B4 contextMenu.ts:18 imports contextCommands.ts (feature module) — only component to do so.

## SPEC/REGRESSION AXIS — 5 findings
- B1 CONFIRMED regression: memory grid lost window-resize listener (old memoryView.ts:341; zero resize
  listeners at HEAD). Stale vscrollState.containerHeight → wrong slice after webview resize until scroll.
- B2 likely: S.searchMode/searchEndianness no longer track UI live (searchBar.ts:152-162 vs old
  searchControls.ts:39-50); memoryGrid.getNeedleLen() reads stale mode between control change and search.
- B3 minor: hexEditorSession.ts:781 emits dead link styles/integrity.css (moved to component) — 404, no style lost.
- C1: hexViewer.ts:483/1161/1171/1182 memRerender() unconditional; old gated on currentView==='memory'.
- C3/C4 minor: context-menu single-byte Copy ASCII always visible now (old hid non-printables);
  search query survives full re-renders (improvement, undeclared).

## Top action items (if fixing later)
1. Restore window resize → refreshMemoryScrollPosition in memory grid host (B1 regression).
2. Re-sync S.searchMode/searchEndianness on control change or stop reading them for needle width.
3. Remove dead 'integrity' entry from cssFiles list (hexEditorSession.ts:781).
4. Extract shared refreshAfterLocalEdit for applyFill/undoLastEdit/integrity edits; gate memRerender on memory view.
5. Move struct-highlight to a HexView paintStructHighlight method (closes H1 + spec tension).
