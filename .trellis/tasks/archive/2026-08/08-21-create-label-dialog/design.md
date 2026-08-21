# Design — Create Label dialog redesign

## Boundaries

| File | Change |
|---|---|
| `src/webview/components/sidebar/inspectorPanel/inspectorLabels.ts` | Pure helpers: chip text calc, end-mode default range; `labelFormHtml` restructure |
| `src/webview/components/sidebar/inspectorPanel/inspectorLabelForm.ts` | Wiring: default mode `'end'`, chip updates, swatch buttons, Esc/Enter, focus, draft-range emission |
| `src/webview/components/sidebar/inspectorPanel/inspectorPanel.css` | Layout (tabs above field), mono inputs, swatch ring, action alignment |
| `src/webview/state.ts` | `S.labelDraft: { start: number; end: number; color: string } | null` |
| `src/webview/hexViewer.ts` | Include `S.labelDraft` in grid render input; clear on save/cancel/form close |
| `src/webview/components/sidebar/inspectorPanel/inspectorPanel.ts` | Extend `InspectorCallbacks` with `onLabelDraftChange(range: {start,end} | null)` |

No provider-protocol changes; everything is webview-internal.

## Contracts

### Chip calculation (pure, unit-tested)

```ts
/** Derived counterpart text for the non-focused representation. '' when raw doesn't parse. */
export function labelChipText(mode: LabelRangeMode, startAddress: number, raw: string): string;
```

- mode `'end'`: parse raw as hex address ≥ start → `` `(${fmtB(end - start + 1)})` `` ; else `''`.
- mode `'len'`: parse raw as dec/hex length > 0 → `` `0x…` `` padded like `endAddressOrEmpty`; else `''`.
- Lives in `inspectorLabels.ts` next to `parseExplicitLength` / `parseEndAddressLength` (reuses their parsing).

### Default range value

`formDefaultRange` becomes mode-aware: selection `{start, end}` renders **end address hex** when mode is `'end'`, length otherwise. Editing defaults unchanged (end mode shows `start + length - 1`).

### Draft-range sync (new reverse path)

```
form input/mode-switch/swatch-click
  → read fields → valid range? {start, start+len-1} : null
  → panel.cb.onLabelDraftChange(range)
  → hexViewer: S.labelDraft = { …range, color: chosenColor } | null
  → existing grid invalidation repaints visible rows
```

Clear triggers: invalid/partial input, form cancel/save/close, rename mode (never emits). Grid treats `labelDraft` as lowest-priority overlay: real labels and selection paint over it.

## UI structure (per mockup)

```
Label Name          [input #lf-name]
Start Address       [input #lf-start]
Define End By       [compact-tabs: End Address | Size · Length]   ← above field
End Address         [input #lf-range] [chip span .lf-chip]
Color               [swatch buttons ×8, ring on active]
                    [inline error #lf-warn]
                    ……spacer……
                    [Cancel] [Add]        ← right-aligned
```

- Labels Title Case; `.lf-lbl` styling updated.
- Hex inputs get monospace font (same stack as hex view) + 1px border via existing `.sb-input` token tweaks scoped to `.lbl-form`.
- Swatches: `<button type="button" class="lf-swatch" aria-pressed>` replacing `<span>`; active gets ring (outline/box-shadow using `--fg` or color itself); keyboard operable for free as buttons.
- Rename mode: unchanged field-freeze behavior; no tabs/chips/draft emission.

## Tradeoffs

- **Chips as spans, not disabled inputs**: cheaper, no focus/tab-stop noise; text carried via `aria-label`.
- **Draft highlight through render input** (not imperative DOM toggling): single paint path, boring, works with virtualization; cost = repaint of visible rows per keystroke, acceptable at current row budgets.
- **Keeping two-step overlap gate** instead of hard block: overlaps are legal-ish (user may intend replacement); existing `pendingWarning` state reused unchanged.

## Compatibility & rollback

- No persisted state, no protocol, no API changes. `LabelFormState.rangeMode` default flips `'len'`→`'end'` — consumers only read it transiently while the form is open.
- Rollback = revert the single feature commit; no migrations.
