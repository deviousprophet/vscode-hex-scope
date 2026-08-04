# Design — ContextMenu component (rework)

## Component contract

```ts
// src/webview/components/ContextMenu/ContextMenu.ts

interface ContextMenuState {
    selectionActive: boolean;
    len: number;
    bytes: number[];
    editMode: boolean;
    endian: 'le' | 'be';
    /** Precomputed go-address: target address + whether mapped. null = not applicable (len !== 4). */
    goAddress: { address: number; valid: boolean } | null;
}

interface ContextMenuCallbacks {
    onCommand?: (cmd: string) => void;
    onCreateLabel?: (name: string, address: number) => void;
}

export function renderContextMenuHtml(state: ContextMenuState): string;  // pure
export class ContextMenu {
    constructor(cb?: ContextMenuCallbacks);
    setCallbacks(cb: ContextMenuCallbacks): void;
    mount(): void;                   // idempotent doc-delegated: click-outside dismiss, Escape, hover-submenu
    show(x: number, y: number, state: ContextMenuState): void;   // render + position at cursor; no-op if !selectionActive
    hide(): void;
}
```

## Rendering (pure renderContextMenuHtml)

Menu structure per decision:
```
[Copy Hex]            ctx-row data-cmd=copy-hex      (direct)
[Copy ASCII]          ctx-row data-cmd=copy-ascii    (direct)
[Copy C Array]        ctx-row data-cmd=create-c-array(direct, multi only)
[Copy as…]            ctx-submenu                    (Decimal/Binary/raw/arrays/Base64/C Array single)
[Analyze]             ctx-submenu -> Sum/XOR/CRC-8/16/32   (multi only)
[Go address]          ctx-row data-cmd=go-address, preview "0x….  LE", disabled-hint when invalid; only when len===4
[Select all]          ctx-row data-cmd=select-all
[Select segment]      ctx-row data-cmd=select-segment
[Create label]        ctx-row -> inline name input (Enter apply → onCreateLabel, Escape close)
[Patch / Fill]        ctx-row data-sub=fill (edit mode only): Zero/Erased flash/Custom input
────────
ctx-sep grouping: Copy group, Analyze, Interaction(Go/Select/Label), Patch.
```
- Single-byte variant: Copy Hex, Copy ASCII, Copy as…(Decimal/Binary), Patch. NO Analyze, NO Go address (len!=4), Select/Label still shown.
- All labels/previews escaped. Go address preview: `0x` + 8-hex target, endian badge.
- Disabled (invalid go-address, or when !selectionActive) items render with class and are inert.

## Interaction (controller class)

- `mount()` doc-delegated: click-outside → hide; Escape → hide; hover on `.ctx-has-sub` → show submenu (reuse/absorb `wireHoverSubmenus`); click `.ctx-row[data-cmd]` → `onCommand(cmd)` (stopPropagation so menu doesn't dismiss).
- Inline inputs (create-label name, custom fill): Enter applies, Escape dismisses, stopPropagation on keydown; input focus on open; `.ctx-fill-invalid` toggle on invalid.
- `show(x,y,state)`: no-op if `!selectionActive`; sets `#ctx-menu` innerHTML + `display:block` + `positionContextMenu(el,x,y)`.
- Component holds no persistent state beyond mounted flag; command/label execution always via callbacks.

## Host wiring (hexViewer.ts)

1. `const contextMenu = new ContextMenu({ onCommand, onCreateLabel })`; `contextMenu.mount()`.
2. `showCtxMenu(x,y)` → `contextMenu.show(x,y,{ selectionActive, len, bytes, editMode, endian: S.endian, goAddress: computeGoAddress(len) })`.
3. `computeGoAddress(len, bytes, endian)`: null unless len===4; address = LE/BE uint32; valid = byte at target mapped (`getByte(address) !== undefined`).
4. `onCommand('copy-hex')` → `handleCtxCommand('copy-hex')` etc. via existing `contextCommandResult` (map new cmd → existing underlying cmd).
5. New cmds: `go-address` → `scrollTo(goAddress.address)` + select target; `select-all` → select whole document; `select-segment` → select containing segment (found via `S.segmentIndex`); done via `updateByteSelection`.
6. `onCreateLabel(name,address)` → existing label creation flow (sidebar) + rerender labels.

## CSS

- `src/webview/components/ContextMenu/ContextMenu.css` = `context-menu.css` rules moved verbatim. New layout additions (go-address preview row, label input row, disabled state) get rules consistent with existing `.ctx-*` language/tokens.
- `styles/context-menu.css` deleted; removed from static link list in `hexEditorSession.ts`.

## Copy/command mapping

New top-level cmd names map to existing `contextCommands.ts` cmd args (copy-hex → 'hex', copy-ascii → 'ascii', copy-c-array → 'c-array'); Analyze/CRC, patch/fill unchanged. Formatting logic untouched (byte-tools).

## Tests

- `src/test/webview/components/context-menu.test.ts` (mocha + jsdom + css-import-hook): render per layout (direct items, Copy as…, Analyze multi-only, Go address 4B + preview + valid-gate + endian, Select all/segment, Create label inline, Patch edit-only), single-byte variant (no Analyze/no Go), interaction (click command → onCommand, click-outside/Escape hide, hover submenu, label inline Enter → onCreateLabel, fill invalid toggle).
- Existing `webview.test.ts` context-menu assertions updated to new cmd mapping (copy-hex etc.) — but `contextCommandResult` format outputs remain testable standalone.

## Rollback
- Rework is bigger than pure extraction: host command mapping + new actions. One commit; `git revert` restores old two-file menu + host wiring.