# Technical Design — Hex Diff View

## Architecture & Boundaries

Runtime placement follows `.trellis/spec/frontend/directory-structure.md` (core = runtime-neutral, host = `vscode`-importing, webview = browser-only).

| Layer | New / changed | Responsibility |
|---|---|---|
| Core | `src/core/diff.ts` (new) | Pure byte-diff engine over `MemorySegment[]`. No `vscode`, no DOM. |
| Core | `src/core/wire.ts` (new, extraction) | `serializeParseResult` moved out of `hexEditorSession.ts`. |
| Host | `src/diff/diffEditorPanel.ts` (new) | Owns the two files, parse, diff, webview panel, lifecycle/disposal. |
| Host | `src/extension.ts` (changed) | Registers the compare command + file picker. |
| Host | `package.json` (changed) | Contributes command + editor-title menu entry. |
| Host | `esbuild.js` (changed) | Adds `src/webview/diffViewer.ts` → `dist/diffViewer.js`. |
| Protocol | `src/diffProtocol.ts` (new) | Typed hostwebview union for the diff surface. |
| Browser | `src/webview/diffViewer.ts` (new) | Diff composition root. |
| Browser | `src/webview/diff/` (new) | `diffModel.ts`, `diffGrid.ts`, `diffSummary.ts`, `diff.css`. |
| Reused | `src/webview/components/hexView/*` | `HexView` + `renderHexViewHeader` / `renderHexViewHtml` + paint. |
| Reused | `src/core/parser/*`, `core/document.ts`, `core/types.ts` | Parse, `detectFormatFromParts`, `WireParseResult`. |
| Reused | `src/webview/render/virtualScroll.ts` | Shared virtual-scroll math (host-computed). |

Rationale: a separate diff bundle avoids booting the single-file app shell (sidebar, toolbar, state, integrity, scripts) for a grid + summary surface, and keeps `webviewProtocol.ts` single-editor.

## Prerequisite Refactor — de-globalize `HexView`

`HexView` listeners are already root-scoped; only id queries and id CSS block two instances.

- `src/webview/components/hexView/hexView.ts`: `#mem-header` → root-scoped `.mem-header` (lines 94, 110, 209); `#mem-scroll` → `.mem-scroll` (line 191).
- `src/webview/components/hexView/hexView.css`: `#memory-view` / `#mem-header` / `#mem-scroll` selectors → class selectors.
- `src/webview/hexViewer.ts` shell (lines 1206-1208): add classes beside the existing ids, so `memoryGrid.ts` / `hexViewer.ts` `getElementById` callers keep working.
- Add a horizontal-scroll seam: the component scroll handler reports `scrollLeft` alongside `scrollTop`, and a `setScrollLeft(left)` method is exposed.
- Parity gate: `src/test/webview/components/hexView.test.ts` and `src/test/webview/webview.test.ts` pass unchanged.

## Contracts

### `src/core/diff.ts`

```typescript
export type DiffKind = 'changed' | 'added' | 'removed';

export interface DiffRun { start: number; end: number; kind: DiffKind; count: number; }
export interface DiffSummary { changed: number; added: number; removed: number; }
export interface DiffModel { summary: DiffSummary; runs: DiffRun[]; }

export function computeByteDiff(
    a: readonly MemorySegment[],
    b: readonly MemorySegment[],
): DiffModel;
```

Semantics: sweep the union of resolved addresses from both sides; address in both → compare bytes (`changed` when different); address only in A → `removed`; only in B → `added`. Adjacent same-kind addresses merge into one run. Addresses mapped in neither file never appear. Runs are sorted ascending.

### `src/diffProtocol.ts`

```typescript
export interface DiffSide {
    name: string;
    format: 'ihex' | 'srec';
    parseResult: WireParseResult;
    labels: SegmentLabel[];
}

export type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string };

export type DiffWebviewToProvider = { type: 'ready' };
```

Serialization reuses the moved `serializeParseResult` (`core/wire.ts`), which copies each `Uint8Array` into an exact `ArrayBuffer` — same seam contract as the single-file editor.

### `DiffEditorPanel` (`src/diff/diffEditorPanel.ts`)

```typescript
export class DiffEditorPanel {
    static readonly viewType = 'hexScope.hexDiff';
    static open(context: vscode.ExtensionContext, baseUri: vscode.Uri, otherUri: vscode.Uri): Promise<void>;
}
```

Owns: file read, format detection (`detectFormatFromParts`), compact parse (shared parse dispatch), `computeByteDiff`, the `WebviewPanel` (`ViewColumn.Active`, read-only), the HTML shell, `ready`/disposal handling. Cleanup registered before awaiting reads (mirrors `editor-lifecycle.md` panel-cleanup rule).

## Data Flow

1. User runs `HexScope: Compare with...` with a supported file active.
2. Command validates the base file (`parseResultIsValid`); prompts `showOpenDialog` filtered to the eight extensions; validates the chosen file.
3. `DiffEditorPanel.open` reads/parses both, computes the diff, serializes both sides.
4. Panel opens, webview sends `ready`, host posts `diffInit`.
5. Webview builds one row model (identical on both sides), renders two `HexView` instances, paints diff classes, renders the summary bar + navigation, and syncs scroll.

## Grid / Row Model

- One `HexViewRow` per 16-byte-aligned block over the union of mapped ranges. Block is `data` when mapped on either side, `gap` only when mapped on neither.
- Per side, a byte cell exists only where that side maps the address; otherwise `be` empty cell. An added block → empty cells on A, values on B.
- Cell `cls` combines the base byte class with `diff-chg` / `diff-add` / `diff-del`.
- Shared address column: the left grid renders `.addr-cell`; the right grid hides it via a variant class. Rows and BPR are identical, so addresses stay aligned.
- Scroll sync: host mirrors `scrollTop` (from `onVisibleWindowChange`) and `scrollLeft` (new callback) between instances; both grids share identical row heights.

## Navigation & Summary

- Summary bar: total bytes changed / added / removed from `DiffModel.summary`.
- Next/previous difference: walk `DiffModel.runs`, scroll the target address into view (`HexView.scrollTo`), highlight the active run; disable at ends.

## Labels (Phase B)

`diffInit` already carries `labelsA` / `labelsB`. Phase B renders them as read-only `.seg-banner` context per side. No `saveLabels`, no label editing.

## Validation & Error Matrix

| Condition | Response |
|---|---|
| Base or chosen file has checksum/malformed errors | Do not compare; warn and offer Quick Repair (mirrors `openInHexScope`). |
| File read/parse fails | Post `diffError`; render error card. |
| Unknown webview message | Ignore (typed dispatcher). |
| Panel disposed / load superseded | Abort parse, ignore stale generation, clear host state. |
| Address gaps / differing formats | Union model; gap rows / empty cells; no synthetic zeros. |
| Identical files | Empty summary and run list; grid renders plain. |

## Trade-offs

- **Separate bundle vs mode flag**: isolation and a smaller surface chosen; cost is a second esbuild entry.
- **Run list vs per-address map**: runs stay compact for large sparse images; cost is a host sweep of mapped bytes.
- **Address-keyed vs textual**: shifted-but-identical blocks count as removed + added; accepted because firmware is address-addressed.

## Compatibility & Rollback

- The de-globalization refactor keeps ids on the shell elements and swaps CSS selectors only, so existing `getElementById` call sites and tests are unaffected.
- Rollback: revert the branch; no persisted state, schema, or migration is introduced.

## Specs to Update (Phase 3)

- `.trellis/spec/frontend/editor-lifecycle.md` — new diff panel + protocol.
- `.trellis/spec/frontend/memory-navigation.md` — addressed diff rows/gaps.
- `.trellis/spec/frontend/components/component-hex-view.md` — class-scoped contract, scroll-left seam, remove the "future diff task" note.
- A new `components/component-diff-view.md` (or feature spec) for the diff surface.
