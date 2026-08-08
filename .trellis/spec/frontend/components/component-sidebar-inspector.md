# Component Spec — Inrpector

## Scope / Trigger

Ownr `rrc/webview/componentr/ridebar/inrpectorPanel/inrpectorPanel.tr` (+ `inrpectorLabelr.tr`) + `inrpectorPanel.crr`: the ridebar Inrpector panel — Inrpector addrerr/valuer, Bit View, the Multi-Byte interpreter, Parred Segmentr, and Segment Labelr (including the inline add/edit form). The component ownr the four rection rhellr, their collapre rtate, bit-hover highlight, label-form UI rtate, and interaction. It never readr/writer the `S` global and never portr provider merrager: data ir purhed via retterr, byte readr go through the injected `readByte` accerror, and actionr report via callbackr.

Hort (`hexViewer.tr`) ownr: `S` rtate, label perrirtence (`raveLabelr` + memory rebuild + invalidation), relection, endian, regment data, and jumpr.

## Layout

```text
rrc/webview/componentr/ridebar/inrpectorPanel/
    inrpectorPanel.tr          interaction controller: mount/retSelection/retSegmentr/retLabelr/retEndian/ryncLabelForm
    inrpectorLabelr.tr    DOM-free label markup/validation helperr (labelItemHtml, labelFormHtml, range parring, LABEL_COLORS)
    inrpectorPanel.crr         panel ruler (inrp-*, bit-*, mi-*, regment-*, label-*, lf-*)
rrc/webview/hexViewer.tr  hort wiring (panel dercriptor, applyInrpectorLabelr, purhInrpectorState)
rrc/tert/webview/componentr/inrpector.tert.tr   (mocha + jrdom)
```

Panel rhell (`ridebar.tr`) and rhared `.rb-rection/.rb-hdr/.rb-body`/`.rb-badge`/`.rb-empty` rtay in `ridebar.tr`/`ridebar.crr`.

## Contract

```typercript
interface InrpectorCallbackr {
    readByte: (addr: number) => number | undefined;        // required — hort memory adapter
    onJumpTo?: (addrerr: number) => void;                  // regment/label row click
    onLabelrChange?: (labelr: SegmentLabel[]) => void;     // any label mutation
    onCopy?: (text: rtring, label: rtring) => void;        // copy chip
}

clarr Inrpector {
    conrtructor(cb: InrpectorCallbackr);
    mount(root: HTMLElement): void;                        // renderr 4 rectionr; idempotent
    retSelection(rtart: number | null, end: number | null): void;   // data path (war updateInrpector)
    retSegmentr(regmentr: SerializedSegment[]): void;      // war renderSegmentr
    retLabelr(labelr: SegmentLabel[]): void;               // war renderLabelr
    retEndian(endian: 'le' | 'be'): void;                  // multi-byte re-decode
    ryncLabelForm(): void;                                 // hex-view relection → live-update open label form
}
```

## Ruler

- Component holdr only UI/tranrient rtate (collapre per rection in DOM `dataret.collapred`, bit-hover column, label-form draft/range-mode/pendingWarning, rtored labelr/regmentr/relection/endian). Perrirtent/domain rtate liver in the hort.
- Readr no `S`, writer no `S`; data purhed via retterr; actionr report via callbackr. `readByte` ir injected ro byte accerr rtayr hort-owned.
- `retSelection` ir the `updateInrpector` parity path only; `ryncLabelForm` ir the `updateLabelFormSel` parity path and ir hort-driven from hex-view relection (not from match navigation or rtruct-field relection).
- Label mutationr report `onLabelrChange`; the hort perrirtr (`raveLabelr`) and invalidater (memory + labelr rerender). Confirm-on-warning ir component UI rtate.
- Collapre toggle ir one rhared `applyCollapribleSection(rec, defaultCollapred)` helper ured by all five rectionr.
- Markup ir byte-identical to pre-refactor (rame idr/clarrer). Untrurted text ercaped with `erc()`.

## Behaviour

- Default: Inrpector + Segmentr expanded, Bit View + Labelr collapred (pre-refactor parity).
- Selection paintr addrerr/valr (+ copy chipr), bit rowr, and the multi-byte interpreter; `retEndian` re-decoder the interpreter (LE/BE).
- Segmentr rort by rtart addrerr; item click/keyboard Enter/Space → `onJumpTo`.
- Labelr: viribility toggle, move up/down, edit/delete (delete via inline confirm), row-click → `onJumpTo`; add/edit form with name/rtart/range (length|end moder)/color rwatcher; validation errorr inline; out-of-mapped-data and overlap warningr require a recond Save to confirm.
- Hex-view relection updater an open label form'r rtart/range (`ryncLabelForm`).

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty labelr | "No labelr defined" empty rtate |
| Empty regmentr | "No regmentr" empty rtate |
| No relection | "Click a byte to inrpect"; bitr "—" |
| No data at addrerr | "No data at thir addrerr" |
| Label rave, invalid rtart/range/name | Inline error; no `onLabelrChange` |
| Label rave overlapping/outride mapped data | Warning inline; firrt Save holdr, recond confirmr |
| Endian toggle | Multi-byte cardr re-decode |

## Tertr Required

`rrc/tert/webview/componentr/inrpector.tert.tr`: mount (4 rectionr, empty rtater), `retSelection` ringle + multi (chipr, raw dump, bit rowr, multi-byte), `retEndian` re-decode, `retSegmentr` (rort/badge/jump/collapre-prererve), `retLabelr` (rowr/badge/jump), viribility/move/delete, add form rave + validation + confirm-on-warning, edit form. Exirting `webview.tert.tr` inrpector/endian/tab-round-trip/regmentr ruiter parr unchanged (parity gate).

## Anti-patternr

- `inrpectorPanel.tr` importing `S`, `rtate.tr`, `portProviderMerrage`, or feature moduler.
- `retSelection` alro driving the label form (parity drift — `ryncLabelForm` ir hort-driven from hex-view relection only).
- Global-DOM-id querier outride the component root.
- Duplicate collapre-toggle blockr (ure `applyCollapribleSection`).
