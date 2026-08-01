# SearchBarComponent Code-Spec

Reusable search box component: mode select + endian pill + input + run/prev/next/clear + match count + busy spinner. Hosts (diff view today, single view later) run the actual search and apply/navigate matches.

## 1. Scope / Trigger

- Used by the diff view (`src/webview/hexDiffViewer.ts`) for union search (D21/D28/D37-Q8).
- The single hex view keeps its own `searchControls.ts` wiring until a future task adopts the component (per D33 note).

## 2. Component API (`src/webview/ui-components/search-bar/searchBarComponent.ts`)

```typescript
interface SearchBarCallbacks {
    onSearch: (query: string, mode: SearchMode, endianness: SearchEndianness) => void;
    onPrev: () => void;
    onNext: () => void;
    onClear: () => void;
}

class SearchBarComponent {
    constructor(cb: SearchBarCallbacks);
    setCallbacks(cb: SearchBarCallbacks): void;
    toHtml(): string;                 // host injects into its toolbar; survives host re-renders
    mount(): void;                    // document-delegated listeners; idempotent
    destroy(): void;
    setCount(count: number, current: number): void;  // "N / M"; blank on empty query; "0 / 0" on no hits
    setBusy(busy: boolean): void;     // toggles #search-progress spinner
}
```

`toHtml()` emits `#search-box` with: `#search-endian-toggle` (segmented Auto/LE/BE pill, `compact-tabs`), `#search-mode` select (Bytes/Value/ASCII/Addr via `MODE_LABELS`), `.search-addr-wrap` (`#search-addr-prefix` "0x" overlay for addr mode), `#search-input`, `#btn-search` 🔍, `#btn-prev` ▲, `#btn-next` ▼, `#btn-clear-search` ✕, `#search-progress` spinner, `#match-count`.

## 3. Behaviors

- **Mode change** re-runs the search; the endian pill shows only for `value` mode (`inline-flex` vs `none`).
- **Endian** = segmented Auto/LE/BE pill (single-view style). Active mode highlighted; click re-runs.
- **Addr mode**: input strips non-`[0-9a-fA-F]`; `0x` prefix overlay appears when non-empty.
- **Run/Enter**: `Enter` runs a fresh search. **Enter-nav parity (Q10)**: Enter on an *unchanged, already-completed* query navigates next match (Shift+Enter = prev) instead of re-running — mirrors single view `handleCompletedSearchNavigation`. The 🔍 button always re-runs.
- **Ctrl/Cmd+F** focuses + selects the input.
- **Clear**: empties input + query, calls `onClear` (host clears matches + busy).
- **Busy**: `setBusy(true)` shows the spinner while a search runs; the host calls `setBusy(false)` only on the final (`done: true`) reply.

## 4. Tests Required

- jsdom interaction tests in `src/test/webview/`: mode/endian UI, addr prefix, Enter fresh vs completed-nav, Ctrl+F focus, clear → onClear, setCount/setBusy DOM effects.

## 5. Wrong vs Correct

Wrong: Enter always re-runs a completed search (no next-match nav); endian as a single unlabeled cycling button; mode labels lowercase (`bytes` not `Bytes`); global host Ctrl+C/copy keydown instead of component-owned intents.
Correct: Enter navigates an unchanged completed query (Shift = prev) and runs otherwise; segmented Auto/LE/BE pill; capitalized mode labels matching the single view; copy lives in `HexViewComponent` as an `onCopy` intent (spec `hex-view-component.md`).
