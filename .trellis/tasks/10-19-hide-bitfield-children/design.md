# Design — Hide individual bit-field children

## Boundaries

- `src/core/types.ts` — `BitFieldChild.hidden?: boolean`.
- `src/core/struct/structNormalization.ts` (+ `structBitChildren.ts`) — preserve
  `hidden`, drop an explicit `false`.
- `schemas/structs.schema.json` — `hidden` on `bitFieldChild`.
- `src/webview/components/sidebar/structPanel/structEditorFields.ts` — the child
  row markup (`childFieldRowHtml`) gains a hidden checkbox.
- `src/webview/components/sidebar/structPanel/structPanel.ts` — read the
  checkbox (`readEditorBitFieldChild`) and wire its change.
- `src/webview/components/sidebar/structPanel/structRowRenderer.ts` — filter bit
  child rows in the bit-unit body by the container's hidden child names.
- Specs: `struct-model.md`, `struct-instance-display.md`,
  `component-sidebar-struct-panel.md`.
- Tests: `structNormalization.test.ts`, `struct.test.ts`,
  `schemaValidation.test.ts`, `structPanel.test.ts`.

## Model

```ts
interface BitFieldChild { name: string; bitWidth: number; refStructId?: string; hidden?: boolean; }
```

Def-level (PRD D1): the flag lives on the reusable bit-field type's child, so it
applies to every usage. Legacy inline containers carry the same field shape.

## Normalization

- `sanitizeBitChild` already rebuilds a child to drop a dangling `refStructId`.
  Extend the same "drop only when false, keep identity otherwise" pattern for
  `hidden` (mirror `normalizeOptionalFieldFlags`): absent or `true` → same
  reference; explicit `false` → key removed.
- `withoutBitChildRef` (pin-safe strip) must preserve `hidden` when it drops
  `refStructId` — it already spreads `...rest`, so `hidden` survives; add a test.

## Schema (R7)

Add `"hidden": { "type": "boolean" }` to `definitions.bitFieldChild.properties`.
No `data`/`schemaVersion` change (R8) — additive optional key.

## Editor (R2)

- `childFieldRowHtml` (shared child-row markup) gains a hidden checkbox cell
  (class e.g. `.sfe-bf-child-hidden`) with `checked` from `child.hidden`.
- `wireBitFieldDefChildRows` wires a `change` listener → `syncBitFieldDefDraft` +
  `refreshEditorPreview`.
- `readEditorBitFieldChild` reads the checkbox → `hidden: checked || undefined`.

## Render filter (R3, R4)

The bit-unit body renders child rows via `renderBitUnitLeafRows` /
`renderBitUnitArrayElements`. To hide a child:

1. Resolve the container's declared field from the group path
   (`ctx.def` + `group.baseName`, via `resolveStructFieldByPath`), then read its
   child list (inline `bitFields`, or the referenced `kind:'bitfield'` def's
   `bitFields`).
2. Collect the names where `hidden === true` (skip when the toggle is on).
3. Drop matching rows from `unitRows` before rendering.

- The container header (value + binary) is unchanged — only child rows drop
  (PRD D2).
- Applies per element for bit-unit arrays (same filter on each element's rows).
- Decode/offsets/C preview are untouched (filter is render-only), satisfying R4.

## Compatibility / rollback

Additive optional key; old pools and profiles load unchanged. No migration, no
version bump. Revert = revert the edit set.

## Deliberate simplifications

`ponytail:` def-level hiding only (no per-usage override); reuse the existing
`Show hidden` toggle and the field-level hidden plumbing.
