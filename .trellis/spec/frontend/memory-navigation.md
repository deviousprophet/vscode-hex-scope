# Memory, Record, and Navigation Code-Spec

## Scenario: Explore parsed firmware by address or source record

### 1. Scope / Trigger

Applies to `core/memory.ts`, `webview/memory/`, virtual scrolling, Record view, segment navigation, labels, stats, and address jumps.

### 2. Signatures

```typescript
interface SegmentIndexEntry { startAddr: number; endAddr: number; offset: number; }
function buildSegmentIndex(result: SerializedParseResult | null): SegmentIndexEntry[];
function getByteAt(result, index, edits, address): number | undefined;
function buildMemoryRows(result: SerializedParseResult | null, bytesPerRow: number): MemRow[];

type MemRow =
    | { type: 'data'; address: number }
    | { type: 'gap'; from: number; to: number; bytes: number };
```

Current `BPR` default/contract is 16.

### 3. Contracts

- Segment index is sorted ascending and stores inclusive `startAddr`/`endAddr` plus the source segment `offset`.
- Byte lookup checks pending edits first, then mapped segment data; unmapped bytes return `undefined`.
- Memory data rows are BPR-aligned. Gaps become explicit gap rows; never allocate rows for every missing address.
- Memory view virtualizes visible rows plus buffer and caps physical scroll height for large logical ranges.
- Rerendering the same Memory scroll container preserves its logical scroll position: convert the current physical position through the old layout before replacing virtual state, then map that logical position into the new layout.
- Jump-to-address switches to Memory view, finds the containing row, scrolls it into view, and selects/highlights the intended range.
- Record view represents every parsed record, including source errors/checksum status, but fetches only aligned 512-record pages for its visible window. It keeps an eight-page LRU cache, prefetches one adjacent page, and rejects stale generations.
- Segment navigator sorts segments, displays inclusive range/size, and jumps to the segment start.
- Labels are address/length overlays. Visibility/reordering persists through host messages; memory rows rebuild when label structure changes.
- Stats derive from current parse result and pending/edit state, not stale DOM text.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| No parse result / no segments | Empty memory/segment state; no crash. |
| Address is mapped and edited | Return pending edit value. |
| Address is unmapped | Return `undefined`; show gap/status, not byte `00`. |
| Adjacent segments/rows | No synthetic gap. |
| Large address gap | One logical gap row. |
| Jump outside mapped data | Do not create selection for nonexistent bytes. |
| Viewport taller than content | Render all available rows and keep jump stable. |
| Label add/delete/style rerender in compressed range | Preserve the first visible logical address; never reinterpret capped physical pixels as logical pixels. |
| Hidden label | Preserve label data; omit its visual overlay. |

### 5. Good/Base/Bad Cases

- Base: 16 mapped bytes at aligned address -> one data row.
- Good: two distant segments -> ordered data rows separated by one gap row; jump uses segment index, not linear scan of address space.
- Good: pending edit changes Memory/Inspector/struct/integrity reads without mutating original segment.
- Good: compressed Record scrolling requests the target page and renders placeholders until that generation's page arrives.
- Good: adding or deleting a label while viewing compressed Memory rows rerenders overlays without shifting the visible address.
- Bad: flatten all firmware addresses into one giant array or fill gaps with zero.
- Bad: use record address field without format-resolved address when navigating.

### 6. Tests Required

- `src/test/webview/webview.test.ts`: segment index, edited byte precedence, gap rows, ordering, virtual scroll, navigation, segment navigator, Record view.
- Compressed Memory rerender test: jump into a range above the physical-height cap, rebuild labels/rows, rerender the same container, and assert the first rendered address is unchanged.
- Parser sample tests: mapped segment inputs and address gaps.
- Add boundary cases for address `0`, last byte of segment, first byte after segment, huge gaps, and empty results.

### 7. Wrong vs Correct

#### Wrong

```typescript
state.scrollTop = scrollContainer.scrollTop; // physical value misread as logical
```

#### Correct

```typescript
const logicalTop = physicalToLogicalScroll(scrollContainer.scrollTop, oldState);
state.scrollTop = logicalTop;
scrollContainer.scrollTop = logicalToPhysicalScroll(logicalTop, state);
```

Compressed scroll coordinates are a boundary contract: preserve logical position across rerenders.

## Scenario: Diff row model across two address spaces

### 1. Scope / Trigger

Applies to `src/webview/diff/diffModel.ts` and `src/webview/diff/diffGrid.ts` — the two-grid diff editor's row model and virtual scroll.

### 2. Signatures

```typescript
function buildDiffRows(a: DiffSideData, b: DiffSideData): DiffRow[];
function getSideByte(side: DiffSideData, addr: number): number | undefined;
function diffKindAt(runs: readonly DiffRun[], addr: number): DiffKind | undefined;
function diffClassForSide(side: 'a' | 'b', kind: DiffKind | undefined): string;

interface DiffRow { address: number; kind: 'data' | 'gap'; gap?: { from: number; to: number; bytes: number } }
```

### 3. Contracts

- One row model is shared by both grids: the union of mapped 16-byte-aligned blocks from both sides, ascending. A block is `data` when either side maps any byte in it; `gap` only when neither side maps it.
- `getSideByte` returns `undefined` for an address a side does not map — never a synthetic zero. A side renders an empty (`be`) cell there.
- `diffKindAt` is a binary search over `DiffModel.runs`; `diffClassForSide` marks `changed` on both sides, `added` on B only, `removed` on A only.
- Both grids render their own address column (no hidden-address variant) and identical row order.
- Diff grids render hex only (`showAscii:false`).
- Each pane owns its own `VirtualScrollState` (`scrollPaneA`/`scrollPaneB`) so two scroll positions are representable; the driving grid reports `onVisibleWindowChange(top, left)` and the host re-slices that pane's window. `Sync scroll` ON additionally mirrors `setScrollTop`/`setScrollLeft` onto the follower with a re-entrancy guard; OFF leaves the follower at its own position, still rendering its own rows. Scroll-driven renders coalesce to one per animation frame and skip an unchanged slice.

### 4. Validation & Error Matrix

| Condition | Behavior |
|---|---|
| Neither side maps an address | Gap row (when a whole aligned block is unmapped) — never allocated per address. |
| One side maps an address | Data row; mapped side shows the byte, unmapped side shows an empty cell. |
| Identical files | Rows render; no cell carries a `diff-*` class. |
| Same block mapped on both sides | One shared row; both grids render it. |
| Scroll driven by either grid | Logical scroll position preserved; with `Sync scroll` on the follower mirrors vertical + horizontal; with it off each pane keeps its own position and rows. |

### 5. Good/Base/Bad Cases

- Base: one mapped byte at 0x1000 on A, one at 0x1020 on B → two data rows plus one gap row; both sides keep the same `data-row` order.
- Good: added range → empty cells on A, `diff-add` cells on B.
- Bad: zero-filling unmapped bytes, or building one row per missing address.

### 6. Tests Required

- `src/test/core/diff.test.ts`: `computeByteDiff` run semantics.
- `src/test/webview/diffViewer.test.ts`: shared `data-row` order across sides, gap row between distant blocks, added/removed empty-vs-value, changed marking, summary counts, prev/next, vertical + horizontal scroll sync, decoded-text hidden, error card, unknown-message rejection.

### 7. Wrong vs Correct

#### Wrong

```typescript
const val = getSideByte(side, addr) ?? 0;   // synthetic zero becomes a false difference
```

#### Correct

```typescript
const val = getSideByte(side, addr);
cells.push(val === undefined ? EMPTY_CELL : dataCell(val, side, addr));
```
