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
| Hidden label | Preserve label data; omit its visual overlay. |

### 5. Good/Base/Bad Cases

- Base: 16 mapped bytes at aligned address -> one data row.
- Good: two distant segments -> ordered data rows separated by one gap row; jump uses segment index, not linear scan of address space.
- Good: pending edit changes Memory/Inspector/struct/integrity reads without mutating original segment.
- Good: compressed Record scrolling requests the target page and renders placeholders until that generation's page arrives.
- Bad: flatten all firmware addresses into one giant array or fill gaps with zero.
- Bad: use record address field without format-resolved address when navigating.

### 6. Tests Required

- `src/test/webview/webview.test.ts`: segment index, edited byte precedence, gap rows, ordering, virtual scroll, navigation, segment navigator, Record view.
- Parser sample tests: mapped segment inputs and address gaps.
- Add boundary cases for address `0`, last byte of segment, first byte after segment, huge gaps, and empty results.

### 7. Wrong vs Correct

#### Wrong

```typescript
return flatBytes[address] ?? 0;
```

#### Correct

```typescript
const edited = edits.get(address);
if (edited !== undefined) return edited;
return getMappedSegmentByte(index, address); // undefined when unmapped
```

Unmapped is a domain state, not zero-valued data.
