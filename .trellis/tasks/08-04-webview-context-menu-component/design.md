# Design â€” ContextMenu component (rework)

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
[Copy asâ€¦]            ctx-submenu                    (Decimal/Binary/raw/arrays/Base64/C Array single)
[Analyze]             ctx-submenu -> Sum/XOR/CRC-8/16/32   (multi only)
[Go address]          ctx-row data-cmd=go-address, preview "0xâ€¦.  LE", disabled-hint when invalid; only when len===4
[Select all]          ctx-row data-cmd=select-all
[Select segment]      ctx-row data-cmd=select-segment
[Create label] REMOVED - deferred to label-feature rework (08-04-webview-label-feature)
[Patch / Fill]        ctx-row data-sub=fill (edit mode only): Zero/Erased flash/Custom input
â”€â”€â”€â”€â”€â”€â”€â”€
```
- All labels/previews escaped. Go address preview: `0x` + 8-hex target, endian badge.
- Disabled (invalid go-address, or when !selectionActive) items render with class and are inert.

## Interaction (controller class)

- `mount()` doc-delegated: click-outside â†’ hide; Escape â†’ hide; hover on `.ctx-has-sub` â†’ show submenu (reuse/absorb `wireHoverSubmenus`); click `.ctx-row[data-cmd]` â†’ `onCommand(cmd)` (stopPropagation so menu doesn't dismiss).
custom-fill input: Enter applies, Escape dismisses, stopPropagation on keydown; `.ctx-fill-invalid` toggle on invalid.
- `show(x,y,state)`: no-op if `!selectionActive`; sets `#ctx-menu` innerHTML + `display:block` + `positionContextMenu(el,x,y)`.

## Host wiring (hexViewer.ts)

2. `showCtxMenu(x,y)` â†’ `contextMenu.show(x,y,{ selectionActive, len, bytes, editMode, endian: S.endian, goAddress: computeGoAddress(len) })`.
3. `computeGoAddress(len, bytes, endian)`: null unless len===4; address = LE/BE uint32; valid = byte at target mapped (`getByte(address) !== undefined`).
4. `onCommand('copy-hex')` â†’ `handleCtxCommand('copy-hex')` etc. via existing `contextCommandResult` (map new cmd â†’ existing underlying cmd).
5. New cmds: `go-address` â†’ `scrollTo(goAddress.address)` + select target; `select-all` â†’ select whole document; `select-segment` â†’ select containing segment (found via `S.segmentIndex`); done via `updateByteSelection`.

## CSS

- `styles/context-menu.css` deleted; removed from static link list in `hexEditorSession.ts`.

## Copy/command mapping

New top-level cmd names map to existing `contextCommands.ts` cmd args (copy-hex â†’ 'hex', copy-ascii â†’ 'ascii', copy-c-array â†’ 'c-array'); Analyze/CRC, patch/fill unchanged. Formatting logic untouched (byte-tools).

## Tests

- Existing `webview.test.ts` context-menu assertions updated to new cmd mapping (copy-hex etc.) â€” but `contextCommandResult` format outputs remain testable standalone.

## Rollback
- Rework is bigger than pure extraction: host command mapping + new actions. One commit; `git revert` restores old two-file menu + host wiring.
