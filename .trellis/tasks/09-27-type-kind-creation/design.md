# Design — Type-kind creation and pure-struct trim

## Boundaries

- **Core migration** (`src/core/structCodec.ts`): convert legacy inline
  bit-field containers into standalone bit-field types.
- **Pool normalization** (`src/core/structNormalization.ts`): call the
  migration so host reads and `saveStructs` receive the migrated form.
- **Type editor** (`src/webview/components/sidebar/structPanel/structPanel.ts`):
  kind chooser, trimmed pure-struct form, bit-field form reuse, enum seam.
- **Styles** (`structPanel.css`): field-grid column change.
- **Specs**: struct panel component, struct model, storage/state, display.

## Model / contract

Already landed by the reusable bit-field child:

- `StructDef.kind?: 'struct' | 'bitfield' | 'enum'` (absent = `'struct'`).
- `kind: 'bitfield'` def: `baseType` + `bitFields` + `fields: []`.
- `StructFieldType` includes `'bitfield'`; refs via `type: 'bitfield'` +
  `refStructId`.
- A materialize seam resolves references to the inline form at decode / size /
  C boundaries.

This child adds:

- The `'enum'` kind value (enum form owned by the enum child).
- `migrateInlineBitFields(defs): { defs; changed }` in `structCodec.ts`.

## Migration

```
for each def with kind !== 'bitfield':
  for each field f:
    if isBitFieldContainer(f):                     // unsigned type + bitFields[]
      sig = baseType + JSON(children)
      def = reuseOrCreate(sig, nameHint = f.name)  // pool-wide dedupe
      field = { ...f, type: 'bitfield', refStructId: def.id,
                bitFields: undefined, bitFieldsCollapsed: undefined }
append generated defs to the pool (discovery order)
```

- Signature = base unsigned type + ordered `{name, bitWidth}` list.
- Generated def id `migrated_bitfield_<n>` (lowest unused); name from the first
  matching field's name, sanitized unique.
- Preserved on the referencing field: `count`, `endian`, `allocation`, `name`,
  `hidden`. Cleared: `bitFields`, `bitFieldsCollapsed`.
- Idempotent: already-`type:'bitfield'` fields and `kind:'bitfield'` defs are
  untouched; a second run produces `changed === false`.
- Byte-identical: the materialized migrated pool equals the original inline
  form, so decode/size/C are unchanged.
- Wire into `normalizeStructDefsValue`: run after identity dedupe; OR its
  `changed` into the returned flag so self-heal writes once.

## Creation flow

- Panel state `_choosingKind: boolean`. The Types `+ Add` header action sets it
  and re-renders the Types body as a kind picker with three tiles.
- Picking a tile clears `_choosingKind` and sets `_editingType` with the kind's
  seed draft:
  - struct: `{ id, name:'', packed:false, fields:[{name:'field0',type:'uint32',count:1}] }`
  - bitfield: `{ id, name:'', kind:'bitfield', baseType:'uint32', fields:[], bitFields:[{name:'bit0',bitWidth:1}] }`
  - enum: `{ id, name:'', kind:'enum', ... }` (seeded by the enum child)
- Cancel from the picker returns to the list; `_editingType` stays null.
- `editorHtml(draft, existing)` dispatches on `draft.kind`: `'bitfield'` ->
  `bitFieldDefEditorHtml`, `'enum'` -> `enumEditorHtml` (seam), else
  `structEditorHtml`.
- The standalone `#sm-add-bitfield-btn` header action is removed.

### Enum seam (owned by the enum child)

- This child renders the Enum tile and dispatches `kind:'enum'` drafts to
  `enumEditorHtml` / `wireEnumDefEditor`.
- Until the enum child lands its form, `enumEditorHtml` returns a short
  placeholder ("Enum editor provided by the enum feature"); the enum child
  replaces that body. Ordering is written in both prds.

## Pure-struct form trim

- `structEditorHtml` field grid headers: `Type | Ptr | Name | Hide | Endian |
  [ ] | move | del` (drop `Alloc` and `Bits`).
- `fieldRowHtml`: drop the alloc select/placeholder cell and the bit-field
  toggle cell. Keep type, pointer, name, hidden, endian, array, move, delete.
- `.se-struct-default-row`: drop the struct-level `Alloc` select (keep
  `packed` + `Endian` + label + hide placeholder).
- CSS: 10-column templates -> 8-column; remove dead alloc/bit-cell rules.
- Remove struct-row bit-child / alloc read paths
  (`readEditorBitFields`, `applyEditorBitFields`, `clearBitFieldChildren`,
  struct-row `readAllocationOverride`). Keep allocation decode/render for
  instances.
- Legacy inline containers never appear in the editor because migration
  converts them at load.

## Bit-field form

- Reuse the landed `bitFieldDefEditorHtml` / `wireBitFieldDefEditor`: name +
  base width + child rows, no struct fields, no nesting. Reachable only via the
  chooser.

## Compatibility

- Old pools with inline bit-fields: migrated on first read, self-healed once.
- Old pools already using reusable types: unchanged (`changed === false`).
- `_bitFieldAllocation` (global decode toggle) unchanged.

## Risks / tradeoffs

- Migration rewrites user files (one self-heal write). Accepted; byte-identical
  on decode.
- Removing struct-row `Alloc` while instance rendering still honours
  struct-level allocation: legacy struct-level allocation stays honoured for
  decode, just not editable in the plain-struct form. Note in spec.
- Chooser + trimmed grid is a markup change; the struct-panel test suite must
  be updated (grid column counts, no bit toggle, chooser flow).

## Rollback

Revert the edit set. Migration is one-directional but byte-identical on decode;
pre-migration files are recoverable from VCS.

## Deliberate simplifications

`ponytail:` kind is immutable after creation; no "convert kind" action. Add
only if users ask.
