# Design — Hide struct fields in the instance view

## Boundaries

- **Data model / persistence** (`src/core/types.ts`,
  `schemas/structs.schema.json`, `normalizeStructField`): add an optional
  boolean.
- **Type editor** (`src/webview/components/sidebar/structPanel/structPanel.ts`):
  add the checkbox and read/write it.
- **Instance view render**: filter fields before building rows.
- **Toggle state**: persisted per profile in the bound `ProfileRecord`.

## Contract

- `StructField.hidden?: boolean` — absent/false means visible.
- Schema: add `"hidden": { "type": "boolean" }` to `structField`.
- Normalizer: preserve `hidden`; never default it true; drop only when false to
  keep files minimal (match `bitFieldsCollapsed` handling).
- Toggle: a boolean profile field `showHiddenFields`, default false.

## Data flow

1. Editor row checkbox -> draft field `.hidden`.
2. Save -> normalizer keeps it -> `structs.json`.
3. Instance view: skip any field whose `.hidden === true` unless the toggle is
   on. A hidden container drops its whole subtree because the container group
   is skipped before children render.

## Where to filter

Filter at the decode-to-render seam, not in raw decode. Decode must stay
complete so offsets/size and the C preview are unaffected. Group the decoded
rows and drop a group when its declared `StructField.hidden === true`
(resolve the declaration by field path so arrays, nested structs, and bit-unit
containers are all covered uniformly).

## Toggle persistence

Mirror the existing per-profile bit-field allocation path: a
`showHiddenFields: boolean` on `ProfileRecord` (empty default false,
normalized on read), an `init` + `perFileDataChange` field, a
`saveShowHiddenFields` webview message, a shared normalizer, a panel setter
pushed on state refresh, and a `showHiddenFieldsChanged` invalidation effect.

## Compatibility

- Additive optional field and profile key. Old pools/profiles load unchanged;
  the profile key self-heals on first write.

## Risks / tradeoffs

- Filtering must resolve through array expansion and grouped rows; use the
  declared-path resolver, not a raw row index.
- Toggle must not force a full editor reload.

## Rollback

Single revert. No persisted-data migration to unwind; the optional keys are
ignored by older builds.

## Deliberate simplifications

`ponytail:` global toggle only, no per-instance override. Add per-instance
override only if users ask for granularity.
