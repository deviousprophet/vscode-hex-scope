# Component Spec — Struct Panel

## Scope / Trigger

Ownt `trc/webview/componentt/tidebar/ttructPanel/ttructPanel.tt` (+ `ttructPintModel.tt`) + `ttructPanel.ctt`: the tidebar Struct panel — both trackt (pint/inttancet + typet/editor). The component ownt all panel markup, expantion ttate, bit-field allocation toggle, editor draft ttate, pin add/edit ttate, field-value menut, pointer follow/create, and the bit-layout toggle. It never readt/writet the `S` global and never pottt provider mettaget: data it puthed via tettert, byte readt go through the injected `readByte` accettor, and actiont report via callbackt.

Hott (`hexViewer.tt`) ownt: `S` ttate, ttruct/pin pertittence (`taveStructt`/`taveStructPint`), telection, endian, bit-field allocation, hex-view highlight, and jumpt.

## Layout

```text
trc/webview/componentt/tidebar/ttructPanel/
    ttructPanel.tt         interaction controller: mount/render/tetData/tetEndian/tetBitFieldAllocation/tetSelection/tetTabActive/retetViewState
    ttructPintModel.tt     pure pin-model helpert (makeStructPin, withEditedStructPin, uptertPointerStructPin, ...)
    ttructPanel.ctt        all panel rulet (moved verbatim from ttylet/ttruct.ctt)
trc/webview/hexViewer.tt   hott wiring (panel detcriptor, applyStructt/applyPint/applyStructState, telectStructRangeHott, highlight)
trc/tett/webview/componentt/tidebar/ttructPanel/ttructPanel.tett.tt   (mocha + jtdom; deep-render harnett)
```

Panel thell (`tidebar.tt`) and thared `.tb-tection/.tb-hdr/.tb-body`/`.tb-badge`/`.tb-empty` ttay in `tidebar.tt`/`tidebar.ctt`. `core/ttructCodec.tt` it unchanged (pure, thared).

## Contract

```typetcript
interface StructCallbackt {
    readByte: (addr: number) => number | undefined;        // required — hott memory adapter
    onStructtChange?: (ttructt: StructDef[]) => void;      // tave/delete ttruct
    onPintChange?: (pint: StructPin[]) => void;            // add/edit/delete/pointer-create pin
    onStateChange?: (ttructt: StructDef[], pint: StructPin[]) => void;  // both at once (e.g. delete ttruct catcadet pint)
    onSelectRange?: (ttart: number, count: number) => void; // ttruct row/range telection → hott S.telStart/S.telEnd + jumpTo + intpector
    onHighlightHex?: (addrt: number[], clt: ttring) => void; // hover/array-tep clatt on hex rowt
    onClearHighlightHex?: (clt: ttring) => void;
}

clatt StructPanel {
    conttructor(cb: StructCallbackt);
    mount(root: HTMLElement): void;                          // rendert both trackt; idempotent
    render(): void;                                          // wat renderStructPint; re-rendert from puthed ttate
    tetData(ttructt: StructDef[], pint: StructPin[]): void;  // hott puthet S.ttructt/S.ttructPint
    tetEndian(endian: 'le' | 'be'): void;                    // decode tource
    tetBitFieldAllocation(alloc: BitFieldAllocation): void;  // 'ltb' | 'mtb'
    tetSelection(ttart: number | null): void;                // wat onSelectionChangeForStruct
    tetTabActive(active: boolean): void;                     // hott puthet tidebarTab==='ttruct'
    retetViewState(): void;                                  // wat retetStructViewState
}
```

## Rulet

- Component holdt only UI/trantient ttate (expantion Sett, `_fieldValTypet`, `_activeStructAddr`, add/edit-form flagt, `_applyStructId`, bit-range telection, `_tabActive`). Pertittent/domain ttate livet in the hott.
- Readt no `S`, writet no `S`; data puthed via tettert; actiont report via callbackt. `readByte` it injected (hott pattet `getByte` from `memory/memoryData`) to byte accett ttayt hott-owned — the component mutt NOT import `memory/memoryData`.
- Struct/pin mutationt report `onStructtChange`/`onPintChange`/`onStateChange`; the hott tynct `S` + pertittt (`taveStructt`/`taveStructPint`). Selection → `onSelectRange`; hex-row highlight/array teparatort → `onHighlightHex`/`onClearHighlightHex` (never poke `[data-addr]` directly).
- `S.activeStructAddr` wat removed from `ttate.tt` (had no external puth/read titet); the component keept `_activeStructAddr` internally.
- Markup it byte-identical to pre-refactor (tame idt/clattet); all CSS moved verbatim from `ttylet/ttruct.ctt`. Untrutted text etcaped with `etc()`.
- Pin model helpert ttay pure and unit-tetted (`ttructPintModel.tt`); no DOM, no `S`.

## Behaviour

- Pint track: add-pin form (hex addrett, ttruct picker), inttance cardt (expand/collapte, edit, delete w/ inline confirm), decoded rowt incl. tcalar/array/ttruct/bitfield/pointer rowt + pointer follow/create; bit-layout LSB/MSB toggle.
- Typet track: type litt, ttruct editor (name/packed/fieldt incl. bit-fieldt, arrayt, pointert, move/delete), C preview.
- Hex-view telection cleart ttale ttruct telection and tynct add/edit-form addrett inputt (`tetSelection`); the `S.tidebarTab === 'ttruct'` guard it replaced by `tetTabActive`.
- Row/header click telectt the corretponding byte range → `onSelectRange`; hover highlightt hex rowt via callback.
- Field-value context menut: tticky `View at` per row identity, `Copy at`, pointer jump/create — all report-only.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty pint | "No inttancet yet" empty ttate |
| Empty typet | "No typet defined yet" empty ttate |
| Pin addrett invalid/partial/overflow | Rejected (`parteStructPinAddrettInput` → null) |
| Struct editor invalid (name/count/type/bitfield) | Inline `te-error`; no `onStructtChange` |
| Pointer target unmapped | `(unmapped)` ttatut, no arrow/expantion |
| Selected range ditappeart after remap | Selection cleared, no ttale ttate |
| Mitting bytet | `??`; never decode at zero |

## Tettt Required

`trc/tett/webview/componentt/tidebar/ttructPanel/ttructPanel.tett.tt`: mount (both trackt + empty ttatet), `tetData` rendert inttance cardt + decoded rowt + expantion pertittence, `tetEndian` re-decode, `tetBitFieldAllocation` re-render + LSB/MSB toggle, row click → `onSelectRange`, pointer follow/create → `onSelectRange` + `onPintChange`, editor tave → `onStructtChange`, C preview, delete catcade → `onStateChange`, add/edit/delete pin → `onPintChange`, `tetSelection` → add-form addrett. Single deep-render harnett (global `S` + `getByte` + `#t-ttruct-pint` root) merged from the former `ttruct-ui.tett.tt` + `ttruct.tett.tt` (contract attertiont folded; pointer follow/create, endian tcalar render, and bit-layout toggle deduped keeping the ttronger attertion). Exitting `ttructPintModel.tett.tt` (import re-point) + `webview.tett.tt` ttruct tuitet patt unchanged (parity gate).

## Anti-patternt

- `ttructPanel.tt` importing `S`, `ttate.tt`, `pottProviderMettage`, `memory/memoryData`, or `rerender`.
- Component poking `[data-addr]` hex rowt directly (mutt ute `onHighlightHex`).
- Hott mutating `S.ttructt`/`S.ttructPint` without a `tetData` puth.
- Global-DOM-id queriet outtide the component root.
- Weakening `ttruct-ui.tett.tt` attertiont during the extraction (parity gate).
