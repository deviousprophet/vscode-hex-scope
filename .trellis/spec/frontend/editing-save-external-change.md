# Editing, Save, and External Change Code-Spec

## Scenario: Stage byte patches safely and reconcile file changes

### 1. Scope / Trigger

Applies to edit mode, `appModel`, `editTransactions`, edit controls, `HexEditorSession` save handling, format serializers, file watcher messages, external-change UI, reload, repair, and discard behavior.

### 1a. Intentional deviation: `.hexscope/` profile files are silent auto-apply

External edits to `.hexscope/firmware_profiles/*/{index,structs,integrity}.json` do **not** follow the hex-file external-change contract below. They are hosted silently: the profile watcher (`attachProfileWatcher`) → per-slot debounced reload (`JsonStore.scheduleReload`) → re-read + re-normalize → re-broadcast to the webview (`structsExternalChange` / `perFileDataChange` / `integrityProfiles`). No prompt, no lock, no conflict dialog, no repair/discard UI anywhere; the self-write horizon ignores host-issued writes so save/self-heal never re-triggers the watcher.

The rest of this spec — the lock/conflict/repair/discard contract — is **unchanged** and applies **only to the firmware document** (the hex/srec file itself).

### 2. Signatures

```typescript
function stageIntegrityEditTransaction(edits: Array<[number, number]>): boolean;
function fillSelectionTransaction(range: SelectionRange | null, fill: number): void;
function undoLastEditTransaction(): boolean;
function redoLastEditTransaction(): boolean;
function clearEditModel(): void;
function hasUnsavedEdits(): boolean;
export function getOriginalByte(addr: number): number | undefined;

// Direct-typing editing (hexViewer.ts local state)
let nibbleBuffer: string | null;           // first hex nibble waiting for second
let nibbleBufferAddr: number | null;        // address the first nibble targets
function clearNibbleBuffer(): void;          // reset buffer, restore cell text
function showNibblePreview(el: HTMLElement, char: string): void;
function applyTypedEdit(addr: number, value: number): void;
function advanceSel(addr: number): void;
function onEditKeydown(e: KeyboardEvent): void;

// Selection-edit session (context-menu "Edit selected bytes")
function beginSelectedBytesSession(): void;             // menu launcher
function commitSelectedBytesSession(): void;            // exit: one grouped undo
function stageSessionByte(undo: Map<number, number>, addr: number, value: number): boolean;
function flushSessionUndo(undo: Map<number, number>): void;   // push session snapshot as ONE txn
function discardSessionUndo(undo: Map<number, number>): void; // revert staged bytes, no undo entry
function restoreEditedBytes(prev: Array<[number, number]>): void;
function advanceWithinRange(addr: number, end: number, isMapped: (a: number) => boolean): number | null;

type WebviewToProviderMessage =
    | { type: 'saveEdits'; edits: Array<[number, number]> }
    | { type: 'reloadAccepted' }
    | { type: 'repairAndReload' }
    | ...;
```

### 3. Contracts

- Pending edits are an address-to-byte overlay; original parsed bytes remain immutable until a successful save/reload.
- Every user action that changes multiple bytes is one transaction. Undo restores the full prior values atomically.
- Edit values are bytes (`0..255`) and target only mapped addresses.
- Fill-selection uses the normalized inclusive selection range.
- Fill applies per-byte with `stageIntegrityEdit` semantics: skip addresses whose current value already equals `fillVal`; if `fillVal` equals the byte's original value but a prior edit changed it, revert by removing the `S.edits` entry. Undo still records the prior current value for every byte actually changed.
- Integrity Auto fix/Fix all enters through the same transaction owner, so it is undoable and updates all byte consumers.
- Save sends a stable list of edits to the extension host. Host splices only the edited data-record lines via `buildSplicePlan` (minimal line scan, owner records rebuilt + checksum recomputed), writes the file **positionally** (only the patch byte ranges via `node:fs` fd) when the plan is ASCII/same-length safe — otherwise the whole patched text — folds bytes into in-memory segments — **no full materialize, no reparse, no segment rebuild** — then returns `savedEdits`.
- `savedEdits` is light (`{ generation }`): webview folds its own `S.edits` into local segment bytes, clears only the overlay, and **keeps undo/redo stacks + edit mode** — Ctrl+Z after save restores pre-edit bytes (dirty returns; Ctrl+S persists). Legacy payloads with `parseResult` still do the full reload path (backward compatible).
- Self-writes never surface as external changes: every host write (save, repair) stamps `lastSelfWriteAt`; the file watcher ignores events within a 1 s horizon (replaces the old one-shot `suppressReload`, which a multi-event watcher could slip past).
- Pending changes update Memory, Inspector, structs, search reads, integrity calculations, dirty bar, and edit controls through the shared accessor/invalidation path.
- External file changes lock editing. With no local edits, offer reload; with local edits, show conflict choice. Parse-error changes use error UI and optional checksum repair.
- Direct-typing (keyboard-based single-byte editing) uses a capture-phase `keydown` listener on `document`. Enters the same transaction path as fills (`S.edits`, `S.undoStack`).
- Nibble buffer is module-level state in `hexViewer.ts`. First hex keypress stores the nibble and updates cell text in-place. Second hex keypress combines into a full byte and applies the edit.
- Key filtering: fires when `S.editMode && !S.lockedDueToExternalChange && activeElement not inside #search-box`. Multi-byte-range typing is inert unless a selection-edit session is active; single-byte selection keeps the legacy `singleByteSelected()` walk (`advanceSel`). The menu controller intercepts nav/escape keys capture-phase; grid shortcuts no longer check the menu by id.
- `clearNibbleBuffer` is wired into `onByteDown`, `updateByteSelection`, `undoLastEdit`, and Escape handler to prevent stale buffer leaks.
- `advanceSel` uses segment-based scan: checks if `addr+1` is in the same segment, otherwise finds the next segment's start address.
- Partial nibble on click-away (Q3-A) is silently discarded — no edit is applied.
- Decoded-text (char-cell) editing: when `S.lastClickColumn === 'char'` and a printable ASCII key is pressed in edit mode, the byte is replaced directly with the char code via `applyTypedEdit()`. Skips the nibble buffer. Inside a selection-edit session the same rule stages via the session cursor instead.
- Selection-edit session: hex context-menu `edit-selected` — rendered **only in edit mode**, placed in the same Patch / Fill edit-action group (hidden entirely when edit mode is off), and only for ≥2 mapped selected bytes (single-byte / 1-mapped-gap selections omit the row; disabled with tooltip when the file is locked) — calls `beginSelectedBytesSession` — requires edit mode + not externally locked. While active, typing targets `selEditSession.cursor` (starts at selection start), walks mapped bytes inside the range via `advanceWithinRange`, and leaves the selection highlighted; a typed byte lands on each successive selected byte and typing cannot modify anything outside the range (re-edits the last byte at the range end). Gaps/unmapped bytes inside the range are skipped.
- Session staging is LIVE: each full typed byte enters `S.edits` immediately via `stageSessionByte` (first-seen prior value recorded in the session undo snapshot; an unchanged value stages nothing), then `refreshAfterLocalEdit()` rerenders the grid — typed values + dirty underline appear while typing, exactly like single-byte editing. The active range is tinted `.sel-edit` (paint-based, repainted after every rerender), distinct from plain selection.
- Session exit: Escape or any selection-modifying input (`updateByteSelection`, grid arrows, click-outside, struct selection, search-result navigation) — also record-view switch and edit discard. `commitSelectedBytesSession` calls `flushSessionUndo`, pushing the accumulated snapshot as **one** `S.undoStack` transaction (Ctrl+Z restores the whole session), keeps the selection, and restores the toolbar pill; a partially-typed nibble is discarded silently. `discardSelectedBytesSession` (`handleInitMessage` / toolbar Discard `cancelEdits`) reverts staged bytes via `discardSessionUndo` without any undo entry.
- Session feedback: `setSectionEdit(active, count)` shows a **sibling** toolbar chip `#tb-seledit-chip` ("SELECTION · N B", static mapped-bytes count at activation) next to the unchanged EDITING pill while a session runs; hidden on commit.
- Paste (`onCopyPasteKeydown`, Ctrl+V / Cmd+V) reads clipboard via `navigator.clipboard.readText()`, applies hex-first parsing via `parsePasteText()` (fallback to raw ASCII), then enters through `stageIntegrityEditTransaction()` for undo support. Aborts if `isEditBlocked()` or no selection. Clears nibble buffer before paste.
- Copy (`onCopyPasteKeydown`, Ctrl+C / Cmd+C) formats selected bytes via `formatCopyCommand()` using `'hex'` or `'ascii'` format depending on `S.lastClickColumn`.
- `S.lastClickColumn` is set on `mousedown` on hex/char cells, cleared on new file load (`applyInitialState`).

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| No selection / invalid fill byte | No transaction. |
| Fill byte equals byte's current value | No edit entry, no undo entry, byte stays clean — dirty bar unchanged. |
| Fill byte equals byte's original value after prior edit | Revert: remove the `S.edits` entry, byte clean. |
| Fill byte differs from byte's current value | Stage edit with prior current value recorded for undo. |
| Edit transaction includes unmapped address | Skip that entry; apply mapped changes; return `false` only when no byte changed. Never create phantom memory. |
| Multiple updates target same address in one integrity fix | Compatible duplicates merge; conflicting values reject atomically. |
| Save write/reparse fails | Keep pending edits and surface error; do not pretend saved. |
| External change while clean | Lock, offer reload, then replace model on acceptance. |
| External change while dirty | Preserve local edits until explicit decision; show conflict UI. |
| External content has checksum errors | Clear unsafe stale edits, lock, show counts and repair option. |
| Discard/refresh | Clear edits and undo history together; notify integrity state. |

### 5. Good/Base/Bad Cases

- Base: edit one mapped byte -> dirty state -> save -> checksum-correct rewritten record -> `savedEdits` -> clean state.
- Good: Fix all stages one atomic transaction; one undo restores every affected stored checksum byte.
- Good: fill byte equal to byte's current value records no edit entry and no undo entry; fill byte equal to byte's original value after a prior edit reverts the entry.
- Good: external change during local edits leaves both decision context and local overlay available until user chooses.
- Bad: mutate `parseResult.segments` when typing, making discard impossible.
- Bad: clear dirty state when posting `saveEdits` before host confirms success.

### 6. Tests Required

- Transactions: one-byte, fill range, multi-edit integrity transaction, duplicate/conflict, undo, empty/no-op, unmapped target. Fill: assert no edit/undo entry when byte already equals fill value; assert revert (entry removed) when fill restores original value; assert undo records prior current value of the byte actually changed.
- Serialization: edits across records, unchanged no-edit input, checksum update, whitespace/EOL/non-data preservation for both formats.
- Model: `savedEdits` clear/rebuild invalidations; external change lock/conflict/error/repair transitions.
- DOM: edit controls, dirty bar, conflict/error banners, disabled actions while locked.

### 7. Wrong vs Correct

#### Wrong

```typescript
S.edits.set(address, value);
S.undo.push([address]); // each byte independently
postProviderMessage({ type: 'saveEdits', edits: [...S.edits] });
clearEditModel(); // before host confirmation
```

#### Correct

Stage one validated transaction, keep overlay until `savedEdits`, then let `appModel` clear/rebuild state and explicit invalidations update consumers.
