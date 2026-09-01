# Design — user-activated "edit selected bytes" session

## Problem

Multi-byte selection blocks typing (guard). Approach A was approved, then refined: the user must **explicitly activate** the guard via a context-menu item, opening a delimited session that confines keyboard edits to the selected range. Bypassing the guard implicitly (typed byte walks the whole segment) is rejected.

## Scope / Boundaries

- **In scope**: `hexViewer.ts` typing+event path, hex context-menu command registration (`contextCommands.ts` / MenuController), SELECTION chip feedback, session state + commit.
- **Untouched**: `editTransactions.ts`, paste, fill, copy, undo/redo mechanics, save, Inspector/byte tools, record view. Paste keeps filling the selection (DEC9). Session exits reuse `flushSessionUndo`/`discardSessionUndo` over `stageIntegrityEdit` (undo snapshot) → one undo entry).

## Model

Two independent editing paths coexist:

| Path | Condition | Target | Advance | Selection |
|---|---|---|---|---|
| single-byte typing (legacy) | no session, `selEnd === selStart` | `selStart` | `advanceSel` (unbounded) | collapses as today |
| selection session | active | `selEditSession.cursor` | mapped byte `≤ S.selEnd` | preserved while active |

`selEditSession.cursor` starts at `S.selStart` each activation (DEC7). Multi-byte selection **without** a session keeps today's inert typing (R1).

## Staging (live) vs Commit

- Each full typed byte stages into `S.edits` **immediately** (`stageSessionByte` in `editSelection.ts`: `stageIntegrityEdit` + record first-seen prior in the session undo snapshot) and triggers `refreshAfterLocalEdit()` — grid shows the value + dirty underline at once (parity with single-byte `applyTypedEdit`).
- The session does NOT push undo entries while typing; `selEditSession.undo` accumulates one snapshot per address (`Map<addr, firstPrior>`), keeping last-write semantics for range-end re-edits.
- Exit (`commitSelectedBytesSession`): `flushSessionUndo` pushes the snapshot as ONE `S.undoStack` transaction. Abort (`discardSelectedBytesSession`, Cancel/new doc): `discardSessionUndo` reverts via `restoreEditedBytes`, no undo entry, refreshed grid.
- Affordance: `paintSelEdit({start,end})` tints the active range `.sel-edit` (amber, distinct from selection); repainted after each `memRerender` since paint classes are wiped on full reloads.

## Session State (module-level in `hexViewer.ts`)

```typescript
let selEditSession: {
    start: number;                      // range start (for range tint + chip count)
    cursor: number;                     // next byte typing will target
    undo: Map<number, number>;          // first prior value per edited addr (session snapshot)
    end: number;                        // S.selEnd snapshot at activation
} | null = null;
```

- **Activation** (menu command): require Edit Mode on + not locked + current range with ≥2 mapped bytes (else the item is disabled, never invoked). Snapshot `{start: range.start, cursor: range.start, undo: new Map(), end: range.end}`; SELECTION chip → "SELECTION · N B"; paint `.sel-edit` range tint.
- **Typing** (hex column): gate is `isEditBlocked() || no session`; nibble buffer targets `session.cursor`; full byte → `stageSessionByte` (stages into `S.edits` live, records first prior) + `refreshAfterLocalEdit()` (rerender repaints `.sel-edit`), then `session.cursor = advanceWithinRange(...) ?? session.cursor` (stay on last byte at range end, R5-re-edit rule).
- **Typing** (ASCII column): same target/cursor rules, char code as value.
- **Exit / commit** (Escape, or any selection change — DEC8): discard partial nibble; `flushSessionUndo(session.undo)` pushes the accumulated snapshot as ONE undo transaction, then `refreshAfterLocalEdit()`; clear session; hide chip + clear `.sel-edit` tint. Escape does **not** clear the selection (deviation from current `handleEditEscape`; session branch only). **Abort** (Cancel / new document): `discardSessionUndo` reverts staged bytes, no undo entry.
- **Single-byte path unchanged**: when no session, existing `onEditKeydown`/`advanceSel` logic untouched.

## Pure Module: `src/webview/editSelection.ts`

```typescript
/** Next mapped address strictly after `addr` inside `[start,end]`; null when none. */
export function advanceWithinRange(addr: number, end: number, isMapped: (a: number) => boolean): number | null;

// Session staging (S-side, live) — imports S, mirrors editTransactions testability
export function stageSessionByte(undo: Map<number, number>, addr: number, value: number): boolean;
export function flushSessionUndo(undo: Map<number, number>): void;
export function discardSessionUndo(undo: Map<number, number>): void;
```

- Dependency-free of DOM globals → unit-testable in `webview.test.ts` (pattern: `editTransactions.ts`).
- `isMapped` injected by caller (`getByte(a) !== undefined`).
- Mapped-byte count for menu enable (`len >= 2`) comes from `selectedBytes().length` — no separate helper.

## Context Menu Integration

- Register command in the hex context-menu command list (`contextCommands.ts`), e.g. `data-cmd="edit-selected-bytes"`, label "Edit selected bytes".
- **Visibility**: rendered only while Edit Mode is on, inside the same Patch / Fill edit-action group (hidden entirely when edit mode off); single-byte and 1-mapped-gap selections omit the row (menu built at open time from current state).
- **Enable**: disabled + tooltip only when the file is externally locked (reuse `.menu-disabled`).
- Verify against `.trellis/spec/frontend/components/component-menu-controller.md` before wiring.

## Toolbar Affordance

Show a sibling toolbar chip `SELECTION · N B` (static mapped-bytes activation count); hide on commit/exit. Save/Cancel stay in normal content flow; chip insertion reflows them slightly (accepted - no right-pinning).

## Edge Cases

- **Range over gap/unmapped**: `advanceWithinRange` / `countMappedInRange` skip unmapped; only mapped bytes edited (R8). Menu item stays available when ≥2 mapped bytes exist even if the quoted range includes gaps.
- **Typing past range end**: cursor freezes on last byte; further typing re-edits it; nothing outside range (AC5).
- **Nibble mid-flight on exit**: stale single nibble discarded silently (DEC3) — `clearNibbleBuffer()` on commit path.
- **Selection change mid-session**: `updateByteSelection` and grid-arrow handlers end+commit the session before applying the new selection (DEC8).
- **Undo of committed session**: one txn (DEC6); undo restores all bytes atomically via existing machinery.
- **New activation**: restarts `cursor` at `S.selStart` and opens a fresh transaction; prior committed session unaffected.
- **Escape**: session branch only — exits+commits, keeps selection; legacy single-byte Escape behavior (`handleEditEscape`) unchanged when no session.

## Compatibility / Rollback

- Webview-internal only; no message/protocol/persistence change.
- Reverts cleanly: revert branch. Old behavior = inert multi-byte typing returns; single-byte path untouched by the change.

## Operational Notes

- Locate CURRENT context-menu command registration for the hex view first (which selector/menu the memory view opens) — `contextCommands.ts` may not be the only site.
- `hexViewer.ts` has import-time side effects; do not import from tests. All new logic in `editSelection.ts`.
- File-load / view-switch reset must clear `selEditSession` alongside `selStart`/`selEnd`.