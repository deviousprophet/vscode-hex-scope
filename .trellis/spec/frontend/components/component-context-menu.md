# Component Spec — ContextMenu

> Built from `component-template.md`. Owns the right-click context menu as a self-contained presentational component (reworked UX).

## Scope / Trigger

Owns `src/webview/components/contextMenu/contextMenu.ts` + `contextMenu.css`: the byte-selection context menu (menu markup, positioning at cursor, dismiss, submenu + custom-fill inline-input behavior). Host owns command execution (`handleCtxCommand`) + new actions (go-address, select-all, select-segment). Create-label is deferred to a future label rework (not part of this component).

Boundary rule: the component owns menu markup, positioning, dismiss, submenu + transient input behavior, and styles. It never reads/writes `S`, never posts provider messages, never executes commands — it reports via `onCommand`.

## Layout

```text
src/webview/components/contextMenu/
    contextMenu.ts    pure render fns + class ContextMenu (mount/show/hide)
    contextMenu.css   context-menu rules (moved from styles/context-menu.css + new go/disabled rules)
src/webview/hexViewer.ts    host wiring (cmd dispatch + go-address/select actions)
src/test/webview/components/contextMenu.test.ts   (mocha + jsdom)
```

## Contract

```typescript
interface ContextMenuState {
    selectionActive: boolean;
    len: number;
    bytes: number[];
    editMode: boolean;
    endian: 'le' | 'be';
    goAddress: { address: number; valid: boolean } | null;   // null = len !== 4
}

interface ContextMenuCallbacks {
    onCommand?: (cmd: string) => void;
}

export function renderContextMenuHtml(state: ContextMenuState): string;  // pure
export class ContextMenu {
    constructor(cb?: ContextMenuCallbacks);
    mount(): void;                   // idempotent doc-delegated: click-outside dismiss, Escape, hover-submenu
    show(x: number, y: number, state: ContextMenuState): void;   // no-op if !selectionActive
    hide(): void;
}
```

## Rules

- **Report-only:** every row click → `onCommand(cmd)` (stopPropagation so menu doesn't dismiss); component never executes commands, never touches `S`, never posts.
- **Layout:** direct Copy Hex (`copy-hex`), Copy ASCII (`copy-ascii`), Copy C Array (`copy-c-array`, multi only); submenus Copy as… (raw/binary/arrays/Base64/Decimal), Analyze (Sum/XOR/CRC-8/16/32, multi only), Patch/Fill (edit mode only). Single-byte variant: Copy Hex, Copy ASCII **only when the byte is printable** (`formatAsciiByte(b) !== '.'`), Copy as…(Decimal/Binary), Patch — NO Analyze, NO Go address.
- **Go address:** only when `len===4`, follows `S.endian` (host-computed), preview `0x… + endian`; invalid (unmapped) row is `.ctx-disabled` inert + `title="Not mapped"` tooltip (no inline hint).
- **Copy cmd normalization:** direct cmds `copy-hex`/`copy-ascii`/`copy-c-array` are normalized by host `contextCommandResult` (`copy-c-array → c-array`); Analyze/fill cmds unchanged.
- **Interaction:** doc-delegated mount; click-outside → hide; Escape → hide; hover `.ctx-has-sub` → submenu (reuse `wireHoverSubmenus`); custom-fill input Enter applies / Escape dismisses / `.ctx-fill-invalid` on invalid (`.ctx-fill-apply` button). Inline inputs stopPropagation on click/mousedown.
- **Keyboard/ARIA:** `#ctx-menu` has `role="menu"`; rows are `role="menuitem" tabindex="-1"` (disabled rows `aria-disabled`), separators `role="separator"`. `show()` focuses the first enabled row; ArrowUp/ArrowDown move focus among enabled rows (disabled/submenu-input rows skipped); Enter/Space runs the focused command, or on a `.ctx-has-sub` row opens its submenu and focuses the first enabled item inside; Escape hides. The host opens the menu on the grid `ContextMenu` key / Shift+F10. `show()` records the previously focused element; `hide()` restores focus to it (when still connected) so keyboard control returns to the triggering grid/sidebar row instead of the body.
- **Positioning:** `positionContextMenu` from `utils.ts` (viewport-edge flips).
- Markup byte-identical to pre-refactor menu classes (`.ctx-*`); all labels/previews escaped via `esc()`.
- Zero `S` import; no command logic; no size math beyond host-fed layout.

## Behaviour

- Menu opens only when `selectionActive`; header shows "N bytes selected" (+ "✏ Editing" badge in edit mode).
- Copy/analyze/fill outputs unchanged — formatting lives in `core/byteTools` (`formatCopyCommand`/`formatAnalyzeCommand`), command mapping in `contextCommands.ts`. Fill presets carry their value as a companion `.ctx-hint` (`Zero`/`Erased flash` etc.) beside the action label.
- Single-byte menu excludes Analyze (low signal) and Go address (needs 4 bytes).

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| `!selectionActive` | `show` no-op. |
| Go address, len !== 4 | Row omitted. |
| Go address unmapped | Row `.ctx-disabled`, inert, `title="Not mapped"`; `onCommand` not fired. |
| Custom fill invalid hex | `.ctx-fill-invalid`, input refocused, no command. |
| Click outside / Escape | Menu hides. |
| Hover submenu row | Submenu shown. |

## Tests Required

`src/test/webview/components/contextMenu.test.ts` (mocha + jsdom + cssImportHook): render layout variants (multi/single-byte/editMode/goAddress valid+invalid), interaction (onCommand on direct cmd, click-outside/Escape hide, hover-submenu, fill invalid toggle), copy cmd normalization wire (`contextCommandResult('copy-hex'…)` → copyText). Existing `webview.test.ts` context-menu assertions pass (updated cmd mapping).

## Anti-patterns

- Component importing `S`/`state.ts` or posting provider messages.
- Component executing commands (must report via `onCommand`).
- Inline "Not mapped" hint (decided: title tooltip only).
- Duplicating `positionContextMenu`/`wireHoverSubmenus` (reuse from `utils.ts`).
- Adding create-label before the label rework task.
