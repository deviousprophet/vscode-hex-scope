# ui-primitives — Technical Design

## Where primitives live

`components/sidebar/sidebar.css` is the home — it already owns the shared `.sb-section/.sb-hdr/.sb-body` collapsible pattern used by all four panels (`component-sidebar.md` spec confirms: "shared section pattern"). Adding `.sb-*` primitives there keeps the shared sidebar vocabulary in one file; panels import it transitively via `sidebar.ts` (already loads `./sidebar.css`).

Exception: `.compact-tabs` moves to `base.css`, because it is **not** sidebar-scoped (used by `searchBar.ts:47` and `structPanel.ts:1465` too). `base.css` is the shared/global file.

## Primitive set

| primitive | source role(s) folded | spec |
|---|---|---|
| `.sb-btn` | base shared | `display:inline-flex; align-items:center; gap:4px; border-radius:3px; font-size:10px; font-weight:600; font-family:var(--font-ui); cursor:pointer; transition: background .1s, border-color .1s, color .1s;` |
| `.sb-btn-primary` | `.lf-save`, `.struct-btn-apply`, `.script-run-btn` | `background:var(--btn-bg); color:var(--btn-fg); border:1px solid transparent;` hover `--btn-hover` |
| `.sb-btn-secondary` | `.lf-cancel`, `.struct-btn-cancel`, `.struct-btn-secondary`, `.si-icon-btn` | `background:transparent; color:var(--addr-fg); border:1px solid var(--border);` hover: `color:var(--fg); border-color:var(--fg)` |
| `.sb-btn-danger` | `.struct-btn-danger`, `.sfe-del-btn:hover` states | red-tinted: `color:rgba(255,120,120,1); border:1px solid rgba(255,80,80,.45); background:rgba(255,80,80,.14);` hover deepen |
| `.sb-btn-add` | `.lf-add-btn`, `.si-add-btn`, `.struct-add-field-btn`, `.script-refresh-btn` | one dashed-accent spec: `background:transparent; color:var(--high-color); border:1px dashed rgba(134,180,212,.28); border-radius:3px;` hover solid border |
| `.sb-input` | `.lf-input`, `.struct-addr-inp`, `.se-name-inp`, `.sa-name-inp`, `.sfe-*-inp` | `background:var(--input-bg); color:var(--input-fg); border:1px solid var(--input-bdr); border-radius:3px; padding:3px 6px; font-size:11px; font-family:var(--font-editor);` focus `--focus-bdr` |
| `.sb-select` | `.lf-mode`, `.struct-sel`, `.sfe-type-sel` | native input tokens, `--focus-bdr` focus |
| `.sb-card` `.sb-card-hdr` `.sb-card-info` | `.si-card`, `.script-card`, `.si-card-hdr`, `.si-card-info`(+integrity variants, `.integrity-card-*` | `border:1px solid var(--border); border-radius:4px;` headers `cursor:pointer; user-select:none;` hover `--hover-bg` |
| `.sb-status-dot` | `.script-dot` (+ integrity status circle as documented deviation) | `width:8px;height:8px;border-radius:50%;` `.ok`→`var(--ok)`, `.err`→`var(--err)`, `.idle`→`var(--addr-fg)` dimmed |

## Token fixes

`--muted-fg` / `--info-fg` undefined today (`structPanel.css:449`, `scriptsPanel.css:105`). Add real values to `base.css` tokens block rather than fixing call sites: `--muted-fg: var(--addr-fg); --info-fg: var(--high-color);`. Backward compatible — existing selectors keep working; panel children then migrate onto primitives.

## Ordering & compatibility

- Child is strictly additive: no `<style>` tags, no markup edits, no selector removal from panel CSS files. Primitives ship unused → refresh render is zero-risk. Verified by existing 715 webview tests staying green.
- `.compact-tabs` relocation: verbatim rule copy to `base.css`; delete `styles/sidebar.css`; remove `'sidebar'` from `hexEditorSession.ts:780` `cssFiles`. Rule must be absent from two places at once (add-then-delete across the same commit) so no intermediate build loses styling.
- `layout.css` remains (owns `#main-area` two-pane rules, referenced at `styles/layout.css`).
- Rollback: single git revert restores `styles/sidebar.css` + `cssFiles` + spec edits; primitives in `sidebar.css` are harmless-additive.

## Spec refresh targets

- `css-guidelines.md`: stale table rows `styles/sidebar.css` / `components/sidebar/`; dead `.scripts-toolbar::before` note; add primitives to Button Standards + new "Sidebar primitives" subsection.
- `component-sidebar.md` + `directory-structure.md`: reflect sidebar shell owning shared primitives, `styles/sidebar.css` gone.