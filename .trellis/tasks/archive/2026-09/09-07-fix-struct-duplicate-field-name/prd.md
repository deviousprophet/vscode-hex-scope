# Fix struct visualization for duplicate field names

## Goal

Struct definitions currently accept two fields with identical names in one struct. The struct instance tree then groups and re-resolves those fields by name only, so every duplicate group header shows the *first* declaration's type/size while the decoded bytes are correct — a confusing mismatch between header and content. Users cannot write this in C, so block it at definition: `validateStructs` rejects duplicate field names inside a struct, preventing any def that would render the wrong header.

## Confirmed Facts

- Decode is index-based (`decodeStructRecursive`, `src/core/structCodec.ts:818`); rows carry correct `byteOffset`/`arrayIdx`. Memory view and expanded rows are correct — the bug is purely the header/group metadata.
- The tree re-resolves each row-group's declaration by name: `groupRowsByBase` (`structPanel.ts:2948`) keys groups by `arrayGroupBaseName`; `describeStructGroup` → `structGroupDeclarationInfo` (`structPanel.ts:2918`) → `resolveStructFieldByPath` → `findStructField` (`structCodec.ts:417`), which returns the first name match. Same-named groups inherit the first declaration's `count`/type/summary.
- `validateStructs` (`src/core/structCodec.ts:187`) is the central validator. Its only app caller is the struct-editor save path (`structPanel.ts:1497`), which already surfaces `validationErrors` next to the editor.
- No field-name uniqueness rule currently exists.
- Tests: `src/test/core/struct.test.ts`, `validateStructs()` suite at line 740.

## Requirements

- R1: `validateStructs` reports an error for any struct def with two or more fields sharing a name at the same level (`def.fields`). Only same-struct direct duplicates are rejected; the same name in different struct defs, or under different nested parents, remains valid.
- R2: The error message names the struct and the duplicated field name, matching existing `validateStructs` message conventions (`Struct "<name>": field "<name>" …`).
- R3: No rendering changes. Already-saved defs with duplicates keep current (wrong-header) behavior until the user edits and re-saves, at which point they are blocked.

## Acceptance Criteria

- AC1: `validateStructs([defWithTwoSameNameFields])` returns a non-empty error array mentioning the struct name and the duplicated field name.
- AC2: `validateStructs` on a def with distinct field names returns `[]` (unchanged behavior).
- AC3: `validateStructs` on a def array where different defs reuse a field name returns `[]` (no cross-def false positive).
- AC4: Nested structs reusing the same name under different parents still validate clean.
- AC5: The whole `validateStructs()` suite in `src/test/core/struct.test.ts:740` passes, including new regression tests for AC1–AC4.

## Out of Scope

- Disambiguating the renderer by declaration occurrence (chosen strategy rejects instead).
- Migrating or auto-repairing already-saved defs with duplicates.
- Names reused across nested scopes (valid).
- Changes to decode, `findStructField`, or group rendering.

## Open Questions

- TBD error wording — decided at implementation inside existing `validateStructs` conventions.

## Deferred / Risks

- Defs saved with duplicates before this change still show the wrong header until the user re-saves (then blocked). Accepted trade-off: matches C semantics, minimal surface.
- Validation lives in `src/core/structCodec.ts`; any future entry point that writes defs must route through `validateStructs`. Currently the editor save path is the only writer.