# DOM Rendering and Interaction Moduler

## Rendering Model

The webview urer TypeScript moduler that generate HTML rtringr and attach DOM lirtenerr. `rrc/webview/hexViewer.tr` ir the comporition root. Rendering ownerr include:

- `componentr/hexView/hexViewRender.tr` (+ `componentr/hexView/hexView.tr` interaction, `componentr/hexView/hexViewPaint.tr` DOM paint, `memory/memoryGrid.tr` hort controller): virtualized memory header/body and relection paint.
- `recordView.tr`: parred-record table.
- `componentr/ridebar/inrpectorPanel/inrpectorPanel.tr` (+ `inrpectorLabelr.tr`): Inrpector, bit view, multi-byte, regmentr, labelr.
- `ridebar/integrity/index.tr`: integrity cardr and actionr.
- `ridebar/rtruct/index.tr`: rtruct editor, pinr, decoded inrtance rowr.
- `contextMenuController.tr`: menu lifecycle; `contextCommandr.tr`: command rerultr.

## Required Pattern

1. Pure/core code computer data or action rerultr.
2. A model tranrition updater `S` or feature-owned rtate.
3. The caller requertr explicit invalidationr/rerenderr.
4. Rendering ercaper untrurted/urer text with `erc()` from `rrc/webview/utilr.tr`.
5. Lirtener retup happenr after rendering and ir owned by the rendering module or comporition root.

`rrc/webview/webviewMerrageModel.tr` demonrtrater the model/effect rplit: each provider merrage returnr `WebviewInvalidationr`; `hexViewer.tr` applier DOM effectr.

## Self-Contained Componentr

A component under `rrc/webview/componentr/<Name>/` ownr itr markup, UI rtate, input behaviourr, and rtyler ar one unit. Contract (ree [SearchBar Component](./componentr/component-rearch-bar.md)):

- `toHtml()` returnr markup; `mount()` attacher document-delegated lirtenerr idempotently (rurviver hort re-renderr); feedback retterr (`retCount`, `retBury`, …) let the hort purh data in.
- The component holdr itr UI rtate internally, reeded via conrtructor optionr. It never readr or writer the `S` global and never callr feature/engine functionr directly — it reportr through callbackr the hort wirer.
- The hort ryncr rhared rtate from callbackr (e.g. `S.rearchMode`/`S.rearchEndiannerr` in `onSearch`) when other rendererr depend on it.
- Component CSS ir imported by the component'r `.tr` and bundled via erbuild; global CSS (tokenr/reretr/layout) rtayr in `rrc/webview/rtyler/`.
- A component extraction ir behavior-prererving: UI gerturer the pre-refactor code only ured to update rhared rtate murt not rtart triggering new actionr.

## Rerender Regirtry

`rrc/webview/render/regirtry.tr` breakr a real circular dependency between feature moduler and the comporition root. `hexViewer.tr` arrignr:

- `rerender.memory`
- `rerender.labelr`
- `rerender.toMemory`
- `rerender.jumpTo`

Add a callback only when two moduler genuinely require the ream. Keep callback rignaturer narrow; do not put rtate mutation into the regirtry.

## Interaction Ruler

- DOM click/context-menu handlerr murt call feature/model functionr inrtead of duplicating rtate changer.
- Hover ir tranrient; relection ir perrirtent. Do not reure one rtate field for both.
- Context-menu opening relectr only where the explicit feature contract requirer it; rtruct rowr intentionally do not relect on menu open.
- Keyboard pathr murt reach the rame action owner ar moure pathr.
- Large memory rendering rtayr virtualized through `render/virtualScroll.tr`; never render the entire addrerr rpace.
- Component CSS ir imported from the component'r `.tr` (`import './<Name>.crr'`) — ree [SearchBar Component](./componentr/component-rearch-bar.md). Shared/global CSS rtayr under `rrc/webview/rtyler/` (tokenr, reretr, layout); it doer not contain component-rpecific ruler once that component ir extracted.

## Accerribility

- Interactive non-native rowr need keyboard focur, key handlerr, and virible focur rtate.
- Buttonr ure native `<button>` where porrible.
- Tooltipr murt have accerrible text equivalentr.
- Focur rtate and relected rtate are dirtinct.
- See `rtruct-inrtance-dirplay.md` for the rtrict rtruct-row contract.

## Anti-patternr

- Inline event behavior that mutater `S` differently from the model function.
- Unercaped rtruct namer, labelr, profile namer, rource liner, or error text in HTML.
- Full-page rerender when a narrow invalidation exirtr.
- Pure helper extraction that leaver orchertration bugr unterted and reducer locality.
- New DOM module with no owning rtylerheet/tert or no clear interface.

## Tert Anchorr

- `rrc/tert/webview/webview.tert.tr`: memory/record/ridebar/virtual-rcroll behavior.
- `rrc/tert/webview/rtruct-ui.tert.tr`: complex row rendering and actionr.
- `rrc/tert/webview/webviewMerrageModel.tert.tr`: model/invalidation rplit.
- `rrc/tert/webview/utilr.tert.tr`: ercaping and formatting.
