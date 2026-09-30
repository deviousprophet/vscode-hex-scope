# Design — Migrate .hexscope data on schema change

## Boundaries

- `src/hexScopeStorage.ts` — envelope read/write, the data-schema version
  constant, the migration runner, and the `JsonStore` self-heal hook.
- `src/hexEditorSession.ts` — normalizer wiring for the three stores.
- `schemas/*.schema.json` — declare `schemaVersion` on each `data` payload.
- Tests: `src/test/extension/hexScopeStorage.test.ts` (+ schema tests if needed).
- Specs/docs: `hexscope-storage.md`, `state-management.md`, `docs/HEXSCOPE_STORAGE.md`.

## Where the version lives

Envelope `version` stays `1` (storage). The **data-schema version** is a field
inside the payload:

```jsonc
{ "version": 1, "data": { "schemaVersion": 2, "…payload…" } }
```

- Struct pool `data` is an array today (`data: StructDef[]`), so the array gets
  a **carrier**: migrate `data` to an object `{ schemaVersion, defs }`?  Decide:
  keep `data` an array and put `schemaVersion`… an array cannot carry a field.
  → Therefore each `data` payload becomes an **object** with a `schemaVersion`
  plus the existing payload under a stable key:
  - structs: `{ schemaVersion, defs: StructDef[] }`
  - profiles: `{ schemaVersion, records: ProfileRecord[] }`
  - bindings: `{ schemaVersion, bindings: Binding[] }`
  Reading accepts **both** the legacy bare-array and the object form (legacy =
  version 1), so no file is lost.

  > This is the one structural decision the design must make explicit: carrying
  > a version requires an object envelope inside `data`. The alternative —
  > putting `schemaVersion` on each item — is rejected (per-item duplication,
  > and it cannot version an empty list).

## Migration runner (R2, R7)

```ts
export const DATA_SCHEMA_VERSION = 1 as const;   // current

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;
const MIGRATIONS: Readonly<Record<number, Migration>> = {
    // 1 -> 2: example, added when the shape actually changes
};

function migrateData<T>(raw: unknown, empty: () => unknown): { value: unknown; changed: boolean };
```

- Detect the recorded version: `isObject(raw) && typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1`.
- **newer than current** → return a sentinel the store maps to the existing
  `corrupt` path (warn-once + empty default, never overwritten) — reuses R4's
  safe behavior instead of inventing one.
- Apply `MIGRATIONS[v]` for `v = recorded … current-1` in order; stamp the
  result with `DATA_SCHEMA_VERSION`; `changed` = version advanced or payload
  differs (JSON compare).
- Idempotent: at the current version with no further diff → `changed: false`.

## Wiring (R3)

Each store's normalizer composes the migration **before** its shape normalizer:

```ts
// structs
const normalizeStructs = raw => {
    const migrated = migrateStructPool(raw);            // version + shape
    return { value: migrated.defs, changed: migrated.changed };
};
```

`JsonStore.applyOk` then writes back on `changed` (existing behavior — no new
write path, satisfies R3/C4).

The write side stamps the current version: `withEnvelope` callers pass the
object form (`{ schemaVersion: DATA_SCHEMA_VERSION, defs }`), or a helper
`withDataEnvelope(payloadKey, payload)` centralizes it.

## Forward-only (R4)

A newer `schemaVersion` must not be "migrated down". Two options:
(a) map to the existing `corrupt` path (empty default + warn-once, file kept);
(b) load it best-effort and skip the write.
➡️ **(a)** — it already exists, warns once, and never overwrites the file, so
data survives until a matching build is installed.

## Compatibility (C3)

- Legacy bare-array `data` reads as version 1 → migrated to the object form.
- Older builds reading the new object form: `unwrapEnvelope` returns the object;
  their normalizers see an object where they expect an array and fall back to
  the empty default (documented) — the file itself is preserved, and a newer
  build reads it correctly. This is the accepted cost of carrying a version.
- Schema files declare the object shape so authoring validation matches.

## Ordering

1. Add the data-schema constant + migration runner + `withDataEnvelope` helper.
2. Declare `schemaVersion` + the object `data` shape in the three schemas.
3. Wire the three normalizers; stamp on write.
4. Forward-only handling + legacy-array acceptance.
5. Docs/spec.
6. Tests (below).

## Risks / tradeoffs

- **Structural change to `data`** (array → object) is the real cost; mitigated by
  accepting the legacy form and by the forward-only rule. Confirm this is the
  intended tradeoff before implementing.
- A migration step that is not idempotent would rewrite on every open; the
  `changed` compare guards it, and a test asserts a second load is a no-op.

## Rollback

Revert the edit set; legacy bare-array files remain readable, so no data is
stranded by a revert.

## Deliberate simplifications

`ponytail:` one shared runner for three files; no per-file version constants.
