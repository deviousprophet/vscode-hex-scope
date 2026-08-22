# Implement — Create Label dialog redesign

Ordered checklist. Validation after each step: `npm run check-types`. Full gate at the end.

## Steps

1. **Pure helpers** (`inspectorLabels.ts`)
   - [ ] Add `labelChipText(mode, startAddress, raw)` reusing `parseEndAddressLength` / `parseExplicitLength` + `fmtB`.
   - [ ] Make `formDefaultRange` mode-aware (end address hex in `'end'` mode).
   - [ ] Unit tests for `labelChipText` (valid/invalid/empty, both modes) near existing inspector tests.
   - Validate: `npm run check-types` + new tests pass.

2. **Markup** (`inspectorLabels.ts` `labelFormHtml`)
   - [ ] Title Case labels; move `.compact-tabs` above the range input with its own label row ("Define End By").
   - [ ] Add chip `<span class="lf-chip" id="lf-chip">` beside `#lf-range`.
   - [ ] Swatches → `<button type="button" class="lf-swatch" aria-pressed="…">`.
   - [ ] Actions row: Cancel (secondary) then Add/Update/Save (primary), right-aligned.
   - Validate: `npm run check-types`; existing inspectorPanel tests will fail here — fixed in step 5.

3. **CSS** (`inspectorPanel.css`)
   - [ ] Tabs-above-field layout; drop the inline side-by-side rule (line ~231).
   - [ ] Monospace font + 1px border for `.lbl-form` hex inputs.
   - [ ] Active-swatch ring; chip styling; right-aligned actions.

4. **Wiring** (`inspectorLabelForm.ts`)
   - [ ] Default `rangeMode: 'end'` in `renderLabelForm` state init.
   - [ ] Chip updates on every `#lf-range` input event and on mode switch (both directions).
   - [ ] Swatch click sets `aria-pressed` states (replaces class-only toggle).
   - [ ] Esc on form container cancels (stopPropagation); Enter submits via `#lf-save` click.
   - [ ] Autofocus first visible field after `body.innerHTML` set.
   - Validate: manual smoke — create/edit/rename flows, hex click/drag auto-fill still works.

5. **Live draft highlight**
   - [ ] `S.labelDraft` state + `onLabelDraftChange` callback through `InspectorCallbacks`.
   - [ ] Emit from form on input/mode-switch/swatch-change; null on invalid/cancel/save/close/rename.
   - [ ] `hexViewer.ts`: fold `S.labelDraft` into grid render input as lowest-priority overlay; clear on form teardown.
   - [ ] Tests: emission/clear logic (jsdom-level, mirroring existing inspectorPanel.test.ts patterns).

6. **Test repair + gate**
   - [ ] Update `inspectorPanel.test.ts` expectations: default mode `'end'`, markup selectors, swatch buttons.
   - [ ] Full gate: `npm run lint && npm run check-types && npm test`.

## Review gates

- After step 4: manual smoke of all three modes before touching the paint path.
- Final: trellis-check full scope.

## Rollback points

- After step 4: form restyle is self-contained; revert steps 1–4 independently of 5.
- Step 5 isolated behind one callback; revert without touching form markup.
