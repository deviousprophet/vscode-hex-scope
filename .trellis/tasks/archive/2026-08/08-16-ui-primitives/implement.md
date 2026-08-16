# ui-primitives — Execution plan

## Checklist (in order)

1. Add `--muted-fg` / `--info-fg` tokens to `base.css` tokens block.
2. Append `.sb-btn*`, `.sb-input`, `.sb-select`, `.sb-card*`, `.sb-status-dot*` primitives to `components/sidebar/sidebar.css` (additive block at end, clearly commented as shared primitives).
3. Copy `.compact-tabs` rule verbatim into `base.css` (shared utilities section). Confirm identical selectors/properties.
4. Delete `src/webview/styles/sidebar.css`.
5. Edit `hexEditorSession.ts:780` cssFiles → remove `'sidebar'`.
6. Refresh specs: `css-guidelines.md` (drop `styles/sidebar.css` + dead `.scripts-toolbar::before`; add primitives to Button Standards; add "Sidebar primitives" subsection documenting the set), `component-sidebar.md`, `directory-structure.md`.
7. Verify: `rg --files src/webview/styles` shows no `sidebar.css`; grep confirms `.compact-tabs` present exactly once (base.css) and absent from components except usage; `hexEditorSession.ts` list without sidebar.

## Validation commands

- `npm run check-types`
- `npm run lint`
- `npm test`  (715 webview tests must stay green — primitives are additive/unused)
- Manual in VS Code Extension Development Host: sidebar endian tabs, Struct bit-order tabs, SearchBar endian toggle all render identically to before.

## Risk / rollback

- Risk: `.compact-tabs` orphaned if `base.css` behind `styles/sidebar.css` in the cssFiles order — but both are `<link>` in head; relocation is within the same commit, no intermediate build. Order in `cssFiles` (`base` first) already loads tokens before others.
- Rollback: `git revert` of the primitives commit restores everything; panel children must not merge until primitives is merged anyway.

## Gates before `task.py start`

- prd/design/implement reviewed and approved in final summary.
- Sub-agents: inline platform — `implement.jsonl`/`check.jsonl` skipped (per workflow).