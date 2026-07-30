# Hook Guidelines

> This project does not use React hooks. Stateful logic is organized as plain functions operating on the shared `S` state object.

---

## Patterns

- **Shared mutable state:** `S` object in `state.ts` — imported by every module, mutated directly
- **Functions** group stateful logic by domain, e.g. `memory/selection.ts`, `editTransactions.ts`
- **No custom hooks.** No `use*` functions. No component lifecycle.

---

## Stateful logic organization

| File | Responsibility |
|---|---|
| `memory/selection.ts` | Selection range, selected bytes helpers |
| `memory/selectionClick.ts` | Click→selection mapping |
| `memory/dragSelection.ts` | Drag-selection controller |
| `editTransactions.ts` | Undo stack: fillSelectionTransaction, stageIntegrityEdit, undoLastEditTransaction |
| `search/searchEngine.ts` | Search state + execution |
| `sidebar/inspector/` | Inspector panel state + rendering |
| `sidebar/integrity/` | Integrity check state + UI |
| `sidebar/struct/` | Struct overlay state + rendering |

---

## State mutation rules

- `S` is single source of truth — no duplicating data in local variables
- Mutate `S` directly (plain object, no store)
- After mutation, call render functions to reflect changes
- For undoable edits, push prior state onto `S.undoStack` before mutating
