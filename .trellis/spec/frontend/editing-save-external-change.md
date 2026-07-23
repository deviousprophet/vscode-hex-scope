# Editing, Save, and External Change Code-Spec

## Scenario: Stage byte patches safely and reconcile file changes

### 1. Scope / Trigger

Applies to edit mode, `appModel`, `editTransactions`, edit controls, `HexEditorSession` save handling, format serializers, file watcher messages, external-change UI, reload, repair, and discard behavior.

### 2. Signatures

```typescript
function stageIntegrityEditTransaction(edits: Array<[number, number]>): boolean;
function fillSelectionTransaction(range: SelectionRange | null, fill: number): void;
function undoLastEditTransaction(): boolean;
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
- Integrity Auto fix/Fix all enters through the same transaction owner, so it is undoable and updates all byte consumers.
- Save sends a stable list of edits to the extension host. Host serializes through the current document format, recomputes affected record checksums, writes, reparses, then returns `savedEdits`.
- `savedEdits` replaces parsed memory and clears edits/undo only after host success.
- Pending changes update Memory, Inspector, structs, search reads, integrity calculations, dirty bar, and edit controls through the shared accessor/invalidation path.
- External file changes lock editing. With no local edits, offer reload; with local edits, show conflict choice. Parse-error changes use error UI and optional checksum repair.
- Direct-typing (keyboard-based single-byte editing) uses a capture-phase `keydown` listener on `document`. Enters the same transaction path as fills (`S.edits`, `S.undoStack`).
- Nibble buffer is module-level state in `hexViewer.ts`. First hex keypress stores the nibble and updates cell text in-place. Second hex keypress combines into a full byte and applies the edit.
- Key filtering: only fires when `S.editMode && !S.lockedDueToExternalChange && singleByteSelected() && activeElement not inside #search-box or #ctx-menu`.
- `clearNibbleBuffer` is wired into `onByteDown`, `updateByteSelection`, `undoLastEdit`, and Escape handler to prevent stale buffer leaks.
- `advanceSel` uses segment-based scan: checks if `addr+1` is in the same segment, otherwise finds the next segment's start address.
- Partial nibble on click-away (Q3-A) is silently discarded — no edit is applied.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| No selection / invalid fill byte | No transaction. |
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
- Good: external change during local edits leaves both decision context and local overlay available until user chooses.
- Bad: mutate `parseResult.segments` when typing, making discard impossible.
- Bad: clear dirty state when posting `saveEdits` before host confirms success.

### 6. Tests Required

- Transactions: one-byte, fill range, multi-edit integrity transaction, duplicate/conflict, undo, empty/no-op, unmapped target.
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
