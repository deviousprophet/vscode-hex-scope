# Design — struct type editor fixes

## Context

Two surfacing webview bugs in the struct type editor (`structPanel.ts`) plus one core decoder bug. The editor bugs stem from its **full-re-render** architecture: every mutation calls `this.render()`, which overwrites the section body innerHTML from scratch and destroys scroll position. A separate core bug makes pointer rows decode with global endian instead of the inherited struct endian.

## Decisions (from grilling)

1. **Both** endianness defects in scope: editor reset AND pointer inheritance.
2. **Full incremental DOM** — mutation handlers no longer call `this.render()`; row set rebuilds go through `refreshFieldRows` (only `#se-fields`).
3. **Original scrollable layout preserved for scroll** — the section body (`.sb-body`) stays the sole scroll container for non-editor flows; edits never replace it.
4. **#221: editor fills its pane** via scoped flex (`:has()`), keeping the form as one internal scroll unit — applied, pending user-machine verification.

## Component: endianness state, editor open

**Root cause 1 — editor drops struct defaults.** In `wireTypesPanelControls` (`structPanel.ts:1828`) the editor draft for an *existing* struct is built with only `{id, name, packed, fields}`. `endian` and `allocation` are omitted, so they default to `undefined` → rendered select shows `Auto`, and `saveEditorDraft` persists Auto.

Fix: when opening the editor for an existing type, copy `existing.endian` and `existing.allocation` into the draft (fall back to `undefined` = Auto for a truly-unspecified struct).

Acceptance: opening editor on a BE struct shows `BE` in the `#se-endian` select; save keeps `BE`.

## Component: pointer endian inheritance (core)

**Root cause 2 — core decoder reads global endian for pointers.** Two call sites decode pointer values with `ctx.globalEndian`:

- `decodeAsciiField` (`structCodec.ts:674`): `decodePointerElements(ctx, normalized, offset, ctx.globalEndian)`
- `decodeFieldElements` (`structCodec.ts:807`): `decodePointerElements(ctx, field, offset, ctx.globalEndian)`

Both already receive a resolved `endian` param (`structEndian → fieldEndian`) produced by `resolveEndianAllocation` (`structCodec.ts:874-896`), which already implements the "field beats struct beats nested parents beats global" cascade. So the pointer value read ignores the resolved field/struct endian and forces global.

Fix: pass the resolved `endian` argument (the `fieldEndian`) instead of `ctx.globalEndian` at both call sites.

Blast radius: `decodeStruct`/`decodeStructRecursive` pass resolved endian down; no other pointer decode path. Validate with existing core tests + add a regression case.

Acceptance: a pointer field declared with endian `Auto` inside a `BE` struct decodes pointer target as big-endian (inherits struct).

## Component: scroll preservation via incremental DOM

**Root cause — whole-`#types-body` rebuild.** Every mutation handler called `this.render()`, which set `this.sections.body('types').innerHTML`, replacing the section body — the scroll container — and wiping `scrollTop` on every Add Field / Add bit / move / delete.

Design (implemented):
1. `fieldRowsHtml(draft)` — shared row markup (full render + incremental rebuild).
2. `refreshFieldRows(sec, draft)` — rebuilds ONLY `#se-fields` innerHTML, re-wires row controls via `wireFieldRows`, refreshes preview. The `.sb-body` scroll container is never touched → `scrollTop` survives.
3. `wireFieldRows(fieldsEl, sec, draft)` — all row-scoped listeners (moved out of `wireEditorInSec`), attached on mount and again after each rebuild.
4. Mutation handlers (Add Field, bit toggle, child add/del/move, field move/delete, pointer toggle) mutate the draft, call `refreshFieldRows`, then bring the touched row into view (`scrollIntoView` guarded for jsdom).
5. Struct-level `#se-endian`/`#se-alloc` change syncs the draft and updates per-field "Auto — inherits…" tooltip titles in place (`updateEditorOverrideTitles`) — no rebuild.
6. Save/cancel/validation-error still full-render (correct: editor open/close semantics).

The editor keeps its original layout: `.sb-body` is the sole scroll container and the whole form flows in it (preview and Add Field scroll with the rows — nothing pinned).

## Component: layout (#221) — flex fill, diagnostics pending user machine

Symptom: "New Type" section shows a big blank block at its bottom on SOME machines (not on dev). Repro narrative from reporter: new type expands → form sits at top → large empty space below → dragging the sash bigger reveals more form but the blank persists at the bottom.

Diagnosis (no real-layout engine in the test suite; jsdom has no geometry, cssImportHook stubs CSS; no local Electron):
- The blank is the section scroll container (`.sb-body`) showing dead scroll space below the short editor form, whenever the pane's flex-basis is taller than the form (taller sidebar/window on the reporter's machine).
- The codebase's panes/bodies have definite heights when the tab is active (bodies scroll in every panel — the designed contract), so a flex fill is viable.

Fix (scoped, does not affect other sections):
```
.sb-pane .sb-body:has(> .si-editor-wrap) { display: flex; flex-direction: column; min-height: 0; }
.si-editor-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.se-form { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 5px;
           overflow-y: auto; overflow-x: hidden; }
```
- `:has()` confines the flex column to the type-editor body; list bodies (instances, other sections) unchanged.
- The whole form (name, struct default, field rows, Add Field, Save/Cancel, C preview) is one scroll unit inside the pane → no blank; overflow scrolls internally.
- This avoids the earlier failing pattern (`height:100%` percent-resolution inside the scroll container) by flexing the body itself.

Previously rejected attempts are documented as "do not repeat":
1. `#se-fields { flex:1; overflow-y:auto }` → pinned the Add Field button and C preview off-flow at the pane bottom (user rejected).
2. `.si-editor-wrap { height:100% }` + `.se-form { flex:1; overflow-y:auto }` → relied on percent height inside the scroll container; reported non-scrollable.

Verification loop: no local repro. Tagged diagnostic `[DEBUG-221b]` (editor geometry: clientHeight/scrollHeight/display/height/overflowY for `#s-struct-pins`, `.sb-pane-view`, `#si-types`, `#si-types-body`, `.si-editor-wrap`, `.se-form`, `#se-fields`, `#se-preview`) logs on editor open and on pane resize (ResizeObserver on `.si-editor-wrap` — catches sash drags, which emit no `resize`). User verifies on their (reproducing) machine; if the void persists, the log pins the mechanism. Event wiring guards `typeof ResizeObserver === 'undefined'` (jsdom parity).

## Compatibility / rollback

- No file-format or schema changes; parser/migration untouched.
- Core `structCodec` endian change is behavior-affecting for existing packed structs with pointers — validate via full core suite; revert window is the single-thread commit history on this branch.

## Open items

- #221 verification on the reporter's machine: the flex-fill fix + `[DEBUG-221b]` geometry log are in place; needs one run on the reproducing machine to confirm the void is gone (and that no non-editor section regressed). Remove diagnostics (tag grep) once confirmed.