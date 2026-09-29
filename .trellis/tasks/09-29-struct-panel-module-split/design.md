# Design — Split structPanel into extractable modules

## Boundaries

Directory: `src/webview/components/sidebar/structPanel/`. Five new files beside
`structPanel.ts`, `structPinsModel.ts`, `structPanel.css`:

| New module | Source range | Responsibility |
|---|---|---|
| `structCPreview.ts` | ~979–1104 | C-preview token/line build + render/hydrate |
| `structBinaryView.ts` | ~441–710 | bit-span / binary rendering helpers |
| `structEditorFields.ts` | ~712–977 | editor field-row markup helpers |
| `structValueFormat.ts` | ~2523–3053 | decoded value formatting + copy text |
| `structRowRenderer.ts` | ~3054–4317 | decoded row/group + pointer renderers |

`structPanel.ts` keeps the `StructPanel` class (state, lifecycle, wiring, pins,
instance cards, menus, kind chooser, editor wiring/save) and delegates the above
to the imported functions.

## Extraction shape

- **Pure clusters** (`structBinaryView`, `structEditorFields`, most of
  `structCPreview` and `structValueFormat`) become free functions taking explicit
  parameters (the field/row/def they render, plus any small primitives).
- **Wide clusters** (`structRowRenderer`, parts of `structValueFormat`) take a
  single `StructRenderCtx` built at the call site:

  ```ts
  interface StructRenderCtx {
      structs: readonly StructDef[];
      pins: readonly StructPin[];
      endian: 'le' | 'be';
      bitFieldAllocation: 'lsb' | 'msb';
      showHiddenFields: boolean;
      fieldValTypes: ReadonlyMap<string, ColType>;
      defaultValType: ColType;
      readByte: (addr: number) => number | undefined;
  }
  ```

- Class methods that are thin wrappers stay on the class and call the module
  function with `this`-derived arguments, so existing call sites inside
  `structPanel.ts` barely change.

## Shared types / constants

- Panel-scope type aliases and constants currently declared in `structPanel.ts`
  (e.g. `ColType`, the ~30 private aliases at 85–186, the `SC_KW`/`SC_ATTR`
  regexes) move to the module that owns them (e.g. C-preview tokens →
  `structCPreview.ts`). A type needed by more than one module is imported
  **type-only** from its owner (no runtime cycle). If a runtime cycle would
  form, keep that one helper on the class instead of forcing a module.
- No new shared file is added (five modules only, per the settled scope).

## Invariants

- **Byte-identical markup**: ids, classes, attribute order, and row/render order
  are unchanged. Extracted functions must reproduce the exact strings the
  methods built.
- **Public API frozen**: `StructPanel` methods and `StructCallbacks` unchanged;
  `hexViewer.ts` untouched.
- Modules import no `S` / `state` / `postProviderMessage` / `memory/memoryData` /
  `rerender`.
- No CSS change.

## Ordering (one commit each)

1. `structCPreview.ts` — smallest, self-contained.
2. `structBinaryView.ts` — pure, few callers.
3. `structEditorFields.ts` — pure markup helpers.
4. `structValueFormat.ts` — formatting + copy, small ctx surface.
5. `structRowRenderer.ts` — largest; benefits from the ctx established above.

Run the full gates after each commit so a regression localises to one module.

## Risks / tradeoffs

- **Call-site churn**: converting `this.x(...)` to `fn(...)` touches many lines;
  mitigated by wrapper methods and by staging one cluster at a time.
- **Hidden shared state**: a cluster that turns out to read more state than the
  ctx covers → widen `StructRenderCtx` (one place), not the signatures.
- **Markup drift**: the parity golden + byte-identical assertions catch any
  string/ordering change; that is the acceptance gate.

## Compatibility / rollback

- Pure refactor: no runtime behaviour, no persisted-shape change, no API change.
- Each module is one commit → `git revert` a single module if it regresses,
  independent of the others.

## Deliberate simplifications

`ponytail:` functions over classes for the leaf clusters; do not split the
`StructPanel` class itself, the CSS, or the state-coupled wiring in this task.
