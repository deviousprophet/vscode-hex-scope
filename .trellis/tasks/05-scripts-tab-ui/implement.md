# Implement: Scripts tab UI per spec

## Gaps identified (current code vs spec)

| # | Spec | Current | Status |
|---|------|---------|--------|
| 1 | Toolbar header: "Scripts (N)" + Refresh ↻ | Collapsible `sb-hdr` | ❌ |
| 2 | Status dot: green/red/gray on card | Missing | ❌ |
| 3 | Icon-only button: ▶ Play / ⟳ Spinner / ⏹ Stop | Text button "Run" / "Running…" | ❌ |
| 4 | 200ms spinner before Stop icon | No spinner | ❌ |
| 5 | Cancel via AbortController | No cancel mechanism | ❌ |
| 6 | Distinct error headers (compile/runtime/timeout/cancel) | Single "Error" header | ❌ |
| 7 | Result header collapsible (▶/▼) | Not collapsible | ❌ |
| 8 | Output batching: 100 calls then debounced | All calls immediate | ❌ |
| 9 | `.ts` files shown with disabled button | `.ts` hidden or error on run | ❌ |
| 10 | Refresh re-scans scripts dir | Only refreshes on tab switch | ❌ |

## Checklist

### Step 1: Core — AbortController support

- [ ] 1.1 Add `AbortSignal` parameter to `execute()` and `runWithTimeout()`
- [ ] 1.2 Pass signal to `vm.runInNewContext` and check `signal.aborted` before/after execution
- [ ] 1.3 Add `cancel()` method to `execute` return or check signal in `runOrError`

### Step 2: Protocol — error type differentiation

- [ ] 2.1 Add `errorType: 'compile' | 'runtime' | 'timeout' | 'cancel'` to `ScriptOutput`
- [ ] 2.2 Populate `errorType` in `execute()` / `runOrError()` for each failure mode
- [ ] 2.3 Include `errorType` in `scriptResult` provider→webview message

### Step 3: UI — Toolbar header

- [ ] 3.1 Replace `sb-hdr` in `renderScripts()` with toolbar: "Scripts (N)" + ↻ button
- [ ] 3.2 Wire Refresh button to `requestScriptList()`
- [ ] 3.3 Style toolbar with proper CSS (no collapsible arrow)

### Step 4: UI — Status dot

- [ ] 4.1 Track last-run status per script (use a Map<filePath, 'success' | 'error' | null>)
- [ ] 4.2 Render colored dot in `scriptListHtml()` based on tracked status
- [ ] 4.3 Update status when `showResult()` is called

### Step 5: UI — Icon button with state machine

- [ ] 5.1 Replace text button with fixed-width icon-only button (▶ Play)
- [ ] 5.2 On click: show ⟳ spinner (CSS animation), set 200ms timer
- [ ] 5.3 After 200ms: switch to ⏹ Stop icon, enable cancel via AbortController
- [ ] 5.4 On completion/error/timeout: revert to ▶ Play
- [ ] 5.5 On cancel: show ⏹ dimmed, abort signal, show "Cancelled" result
- [ ] 5.6 No text labels — icons only, `min-width` prevents layout shift

### Step 6: UI — Result block with collapsible headers

- [ ] 6.1 Add collapse/expand toggle on result header (▶/▼)
- [ ] 6.2 Auto-expand on new result regardless of previous collapsed state
- [ ] 6.3 Different header styles per error type:
  - Success: "▶ Result" default style
  - Runtime: "🔴 Script Error" red header
  - Timeout: "⏱️ Timeout" orange header
  - Compile: "⚠️ Compile Error" yellow header
  - Cancel: "⏹ Cancelled" dimmed header
- [ ] 6.4 Wire header click to toggle `.collapsed` on the result block

### Step 7: UI — Output batching

- [ ] 7.1 Track output call count in `VSCodeScriptHost`
- [ ] 7.2 First 100 calls: post immediately (current behavior)
- [ ] 7.3 After 100: accumulate in buffer, flush via `setTimeout(flush, 0)` debounce
- [ ] 7.4 Flush remaining on script completion

### Step 8: UI — `.ts` disabled state

- [ ] 8.1 Pass `esbuildAvailable` info to webview (or check on scan)
- [ ] 8.2 `.ts` files show disabled Run button + "requires esbuild" tooltip when unavailable
- [ ] 8.3 Add CSS for disabled button state

### Step 9: Quality

- [ ] 9.1 `npm run check-types`
- [ ] 9.2 `npm run lint`
- [ ] 9.3 `npm test`
- [ ] 9.4 Manual testing with sample scripts

## Validation

```bash
npm run check-types
npm run lint
npm test
```
