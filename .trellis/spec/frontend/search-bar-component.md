# SearchBarComponent Code-Spec

Reusable search box component: mode select + endian pill + input + run/prev/next/clear + match count + busy spinner. Hosts (diff view today, single view later) run the actual search and apply/navigate matches.

## 1. Scope / Trigger

- Used by the diff view (`src/webview/hexDiffViewer.ts`) for union search (D21/D28/D37-Q8) and by the single hex view (`src/webview/hexViewer.ts`, hosting the shared `searchEngine.ts` orchestration glue).

## 2. Component API (`src/webview/ui-components/search-bar/searchBarComponent.ts`)

```typescript
type SearchTrigger = 'button' | 'enter-next' | 'enter-prev';

interface SearchBarCallbacks {
    onSearch: (query: string, mode: SearchMode, endianness: SearchEndianness, trigger?: SearchTrigger) => void;
    onPrev: () => void;
    onNext: () => void;
    onClear: () => void;
}

interface SearchBarSeedOptions {
    mode?: SearchMode;
    endianness?: SearchEndianness;
    query?: string;
}

class SearchBarComponent {
    constructor(cb: SearchBarCallbacks, seed?: SearchBarSeedOptions);
    toHtml(): string;                 // host injects into its toolbar; survives host re-renders
    mount(): void;                    // document-delegated listeners; idempotent
    setCount(count: number, current: number): void;  // "N / M"; blank on empty query; "0 / 0" on no hits
    setBusy(busy: boolean): void;     // toggles #search-progress spinner
}
```

`toHtml()` emits `#search-box` with: `#search-endian-toggle` (segmented Auto/LE/BE pill, `compact-tabs`), `#search-mode` select (Bytes/Value/ASCII/Addr via `MODE_LABELS`), `.search-addr-wrap` (`#search-addr-prefix` "0x" overlay for addr mode), `#search-input`, `#btn-search` 🔍, `#btn-prev` ▲, `#btn-next` ▼, `#btn-clear-search` ✕, `#search-progress` spinner, `#match-count`.

The optional `seed` restores initial UI state (defaults stay `bytes`/`le`/`''`); hosts seed from their own state on boot — e.g. the single view seeds `{ mode: S.searchMode, endianness: S.searchEndianness, query: '' }` to preserve its `'auto'` endian default.

The optional `trigger` on `onSearch` is the component's UI-gesture signal: `'button'` from the 🔍 button, mode/endian change, or applyEndian; `'enter-next'`/`'enter-prev'` from Enter on a fresh query (Shift = prev). Hosts that navigate a *running* search forward it to their glue; hosts that only care about the query ignore it (e.g. the diff host).

## 3. Behaviors

- **Mode change** re-runs the search; the endian pill shows only for `value` mode (`inline-flex` vs `none`).
- **Endian** = segmented Auto/LE/BE pill (single-view style). Active mode highlighted; click re-runs.
- **Addr mode**: input strips non-`[0-9a-fA-F]`; `0x` prefix overlay appears when non-empty.
- **Run/Enter**: `Enter` runs a fresh search. **Enter-nav parity (Q10)**: Enter on an *unchanged, already-completed* query navigates next match (Shift+Enter = prev) instead of re-running. The 🔍 button always re-runs. Enter on a *running* search hands the gesture to the host via `trigger` so the host can navigate (single-view parity); the component itself never navigates a running search.
- **Ctrl/Cmd+F** focuses + selects the input.
- **Clear**: empties input + query, calls `onClear` (host clears matches + busy).
- **Busy**: `setBusy(true)` shows the spinner while a search runs; the host calls `setBusy(false)` only when the search finishes.

## 4. Tests Required

- jsdom interaction tests in `src/test/webview/ui-components/search-bar-component.test.ts`: mode/endian UI, addr prefix, Enter fresh vs completed-nav, Ctrl+F focus, clear → onClear, setCount/setBusy DOM effects, seed option reflected in `toHtml()`, and the `onSearch` trigger arg (`'enter-next'`/`'enter-prev'`/`'button'`).

## 5. Wrong vs Correct

Wrong: Enter always re-runs a completed search (no next-match nav); endian as a single unlabeled cycling button; mode labels lowercase (`bytes` not `Bytes`); global host Ctrl+C/copy keydown instead of component-owned intents; component writes host state (`S`) directly or re-implements the running-search navigation it signals via `trigger`.
Correct: Enter navigates an unchanged completed query (Shift = prev) and runs otherwise; segmented Auto/LE/BE pill; capitalized mode labels matching the single view; copy lives in `HexViewComponent` as an `onCopy` intent (spec `hex-view-component.md`); the component stays a stateless control surface — hosts own the search logic and `S` mirrors.
