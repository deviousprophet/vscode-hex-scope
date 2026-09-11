# Fix struct type editor UI bugs

## Goal

Fix three struct type editor defects in the webview:

1. Clicking "Add bit" or "Add Field" causes the editor to scroll back to the top of the struct type, making work on large structs tedious.
2. Setting (or editing an existing struct's) predefined endianness resets back to Auto, and a pointer field set to Auto does not inherit its struct's endian when decoding.
3. The "New Type" editor section shows a big blank/empty block at its bottom (only reproducible on some machines — taller sidebar → pane taller than the short form → empty scroll area).

## Root causes (from code inspection)

- **Scroll jump**: mutation handlers call `this.render()`, which does `this.sections.body('types').innerHTML = ...`, rebuilding the whole editor DOM — destroying native scroll position of the section body on every `se-add` / `sfe-bf-add-child` / toggle / move / delete.
- **Endianness reset** (`structPanel.ts`: edit-open handler): when opening the editor for an *existing* struct, the draft is built as `{ id, name, packed, fields }` — it omits `endian`/`allocation`, so they default to `undefined` (Auto) and are shown/saved as Auto even when the struct was pre-set to BE.
- **Pointer inheritance** (`structCodec.ts`): `decodeAsciiField` and `decodeFieldElements` decode pointer values with `ctx.globalEndian`, ignoring the resolved field/struct endian cascade (`resolveEndianAllocation`).
- **Blank void under New Type** (only on some machines): pane flex-basis is taller than the short new-type form, so the section body (`.sb-body`, scroll container) shows dead scroll space below the form. The editor form does not fill the pane.

## Requirements

- Editing an existing struct must preserve its predefined endianness (`endian`) and bit allocation (`allocation`), showing the set value in the editor and persisting it on save.
- Pointer fields must inherit the resolved endian (field beats struct beats nested parents beats global) instead of always reading the global overlay.
- Adding a field or a bit must not scroll the editor viewport back to the top; the user keeps their place in large structs. The scroll container (section body `#si-types-body`) is never replaced by a mutation.
- The whole editor form must keep scrolling normally — when saved WITHOUT a form-fill fix, a short "New Type" form must not leave a big blank block under it; the editor fills the pane and the form scrolls internally only when content exceeds the pane.
- The editor form must be scrollable when its content is longer than the pane (regression risk from any fill-pane layout).

## Acceptance Criteria

- [x] Open editor on an existing struct pre-set to BE: the "struct default" endian select shows BE; Save keeps BE (does not revert to Auto).
- [x] A pointer field with endianness Auto set against a BE struct inherits BE when decoding (regression-tested in `src/test/core/struct.test.ts` and the structPanel webview suite).
- [x] After Add Field / Add bit / move / delete, the section body keeps its current scroll offset instead of jumping to the top.
- [x] No regression: adding/moving/deleting fields and bits still updates the live preview; structPanel + core suites green.
- [ ] The New Type editor fills its pane (no dead blank block) on machines where the pane is taller than the form, and stays scrollable when content is longer (pending user-machine verification via `[DEBUG-221b]` geometry log).

## Notes

- Scope: webview struct type editor + core struct decoder (`structCodec.ts`). No schema/format/migration changes.
- Deep module boundary: struct editor state lives in `StructCallbacks`/webview; core changes confined to pointer decode endian resolution.
- Scroll preservation is achieved by rebuilding only `#se-fields` (`refreshFieldRows`), never the `.sb-body` scroll container.
- The blank-void fix is scoped CSS: only `.sb-body:has(> .si-editor-wrap)` becomes a flex column; every other section body is untouched.