# Design: Hex Diff View

Task: `08-01-hex-diff-view` · Branch: `feat/hex-diff-view` · Base: `main`

## 1. Architecture & Boundaries

Two new layers, mirroring the existing single-file editor's split (spec: `frontend/directory-structure.md`):

```text
extension host                          webview (browser)
─────────────────                       ─────────────────
src/hexDiffProvider.ts   ──protocol──▶  src/webview/hexDiffViewer.ts   (composition root)
src/hexDiffSession.ts    ──protocol──▶  src/webview/diff/*             (render + model)
src/core/diff.ts         (pure, testable — no vscode/DOM imports)
```

- **`src/core/diff.ts`** — pure diff engine. Input: two `CompactParseResult`s. Output: serializable `DiffResult` (below). No `vscode`, no DOM. Unit-testable like `core/search.ts`, `core/memory.ts`.
- **`src/hexDiffProvider.ts`** — `CustomReadonlyEditorProvider` for `viewType = 'hexScope.hexDiff'`; registers via `registerCustomEditorProvider` with `webviewOptions.retainContextWhenHidden: true`. `openCustomDocument` returns a **virtual document** whose `uri` encodes the canonicalized URI pair (D14). Delegates to `HexDiffSession`.
- **`src/hexDiffSession.ts`** — per-panel orchestration: parse both files, run `core/diff`, serialize `DiffResult` over the protocol, watch both URIs + debounce (reuse pattern from `hexEditorSession.ts:524`), swap/staging state that is webview-local vs session-local.
- **`src/webview/hexDiffViewer.ts`** — thin composition root: wires panels, shared label rail, summary bar, next/prev, swap, search. No diff logic.

Where it plugs into existing code:

- `src/extension.ts` — register `hexDiffProvider`, plus 3 new commands (Compare Selected, Select as 1st, Compare to <name>) + staging state.
- `package.json` — new custom editor entry, new commands, explorer/editor-title menus (`resourceLangId =~ /^(intel-hex|srec)$/`), keybindings `Alt+↓/↑` (webview-local, D20).
- `src/webviewProtocol.ts` — new message discriminators (below); update `webviewMessageDispatcher.ts`/`webviewMessageModel.ts` per protocol-change discipline.

Boundary rules (from spec):

- Diff logic lives in `src/core/diff.ts`, never in the webview.
- Cross-runtime messages only via `src/webviewProtocol.ts`; a new discriminator needs host sender/handler + browser dispatch + model applier + tests (spec `editor-lifecycle.md` §5).
- No `vscode` import from `src/core/**` or `src/webview/**`.
- No new framework/wrapper; direct DOM as in the rest of the webview.

## 2. Data Flow & Contracts

### 2.1 Diff core (`src/core/diff.ts`)

```typescript
// per-address status; ranges are display groupings, not structures (D4)
type ByteStatus = 'unchanged' | 'changed' | 'added' | 'removed' | 'empty';

interface DiffResult {
    // union-of-rows alignment (D5): one row set for both panels
    rows: Array<{
        address: number;
        a: { present: boolean; byte: number } | null; // null = gap/empty on A
        b: { present: boolean; byte: number } | null;
        status: ByteStatus;                          // derived from a/b presence+value
    }>;
    summary: { unchanged: number; changed: number; added: number; removed: number };
    runs: Array<{ start: number; end: number; status: ByteStatus }>; // for next/prev (D16)
}
```

Row construction: union of both files' `buildMemoryRows` spans (address range per row), merged, sorted, deduped; `empty` cells where one side lacks a byte (D5). Status per address from presence + value (D4). Runs = contiguous non-`unchanged` addresses (D16). `BPR = 16` shared (D12), reusing `src/webview/state.ts:8`.

Memory-map construction reuses `buildSegmentIndex`/`getByteAt` from `core/memory.ts`.

### 2.2 Protocol (`src/webviewProtocol.ts`)

New provider→webview messages:

- `type: 'diffInit'` — full `DiffResult` + A/B panel metadata (fileName, format, per-side labels union with side tag per D22).
- `type: 'diffUpdate'` — recomputed `DiffResult` after external change (D13); replaces prior, keeps same tab.

New webview→provider messages:

- `type: 'diffSwap'` — request panel swap (D23); host confirms or webview handles locally (swap is view preference — see §4).
- `type: 'diffSearch'` — query + mode + endianness; host runs `SearchEngine` against **both** sides (D21), returns union match list. (Alternatively reuse existing search message if shape fits; keep diff-specific if not.)

All new discriminators: dispatch + model handling + unknown-message no-op assertions (spec `editor-lifecycle.md` §5, §6).

### 2.3 Staging commands (extension host)

Staging state lives in extension host (module-level in `src/hexDiffSession.ts` or a small `src/diffStaging.ts`):

```typescript
let stagedFirst: vscode.Uri | null;   // ephemeral (D7)
```

- **`hexScope.compareSelected`** — invoked with 2 selected URIs; first selected = A (D17). Validates both via `parseResultIsValid` (D9, `src/extension.ts:26`), rejects same-URI/identical-content (D8), opens diff.
- **`hexScope.selectAsFirst`** — stages current file as A; adds explorer decoration (D18, `FileDecorationProvider`).
- **`hexScope.compareToStaged`** — current file vs staged A; opens diff, clears staging (D7).

Pair identity = canonicalized URI pair; same pair reuses one tab (D14). Virtual `CustomDocument.uri` encodes the pair so `vscode.openWith` dedupes; `openCustomDocument` parses the pair back out.

### 2.4 Read-only enforcement

`CustomReadonlyEditorProvider` + no save/edit messages wired. D10/AC7: no tabs, edit controls, scripts, structs, inspector, bit view, integrity. Selection + copy reuse existing copy formatters (D11) via existing `copyCommand` pattern (`src/extension.ts:84`).

## 3. Compatibility & Migration

- **No breaking change** to `hexScope.hexEditor`; new viewType is additive.
- Pair-key URI encoding must round-trip: two URIs → one opaque document URI → two URIs. Use a stable reversible encoding (e.g. base64 of a JSON `[aPath, bPath]`), canonical order by fsPath so same pair always maps to same URI (D14).
- Cross-format pairs (ihex vs srec) supported (AC8); both parse to `CompactParseResult` segments, diff operates on addresses only.
- Labels: read from per-uri `hexScope.labels.${uri}` workspaceState (existing key format, `hexEditorSession.ts:388`), unioned with side tags (D22); display-only, never persisted from diff view.

## 4. Important Trade-offs

| Decision | Trade-off |
|---|---|
| D3 host-side diff | One-time cost per open, big payload for huge files; serialization must be compact (reuse ArrayBuffer-segment transfer pattern from `hexEditorSession`). Acceptable: diff of two firmware images is typically ≤ a few MiB. |
| D5 union rows | Guarantees address alignment (AC6) at the cost of rendering empty cells; same virtual-scroll state keeps it cheap. |
| D23 swap = position only | Identity stays file-bound; added/removed semantics never flip. Webview-local view preference; can be applied client-side without host round-trip — but diffUpdate must arrive with orientation the webview already knows (host sends A/B data keyed by side tag, webview renders left/right by its swap flag). |
| D21 union search | Two engine runs, one merged match list; match highlight lives on the panel with data. Cost is two segment scans, acceptable. |
| Virtual doc URI pair | Requires reversible encoding + careful canonicalization; failure mode = duplicate tabs. Test the round-trip. |
| Live re-diff (D13) | Recompute + reserialize on each external change; debounce 200ms like single-file. Identical/unparseable states handled per D15 without closing the tab. |

## 5. Operational / Rollback

- Rollback: feature lives behind new viewType + new commands; disabling the extension restores prior behavior. No migration of user data.
- Risky areas: pair-URI encoding round-trip; protocol additions (must update all four seam files); union-row alignment under gaps; webview virtual-scroll reuse with two panels.
- Performance: `core/diff.ts` must not do per-byte clock reads (reuse `core/search.ts` chunk-deadline pattern) on large files; keep diff computation bounded.

## 6. Tests Required (map to PRD ACs)

- `src/test/core/diff.test.ts` — statuses (unchanged/changed/added/removed/empty), union rows + gaps, summary counts, run extraction, address `0`/huge gaps/empty results, cross-format parse inputs (AC3/AC4/AC6/AC8).
- `src/test/core/` pair-URI encoding round-trip tests (D14).
- `src/test/webview/webview-message-model.test.ts` — new discriminators dispatch + unknown no-op (D1/D21).
- `src/test/extension/extension.test.ts` — new command registration + staging lifecycle (D7/D17/D18).
- Search union tests against `core/search.ts` on two segment sets (D21).

## 7. Follow-up before `task.py start`

- PRD convergence pass complete (no duplicate facts, no blocking open questions).
- Final planning summary presented and explicitly approved by user.
