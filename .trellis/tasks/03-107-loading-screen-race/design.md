# Design: Loading screen race condition fix

## Changes overview

Three independent changes in two files:

### 1. `src/hexEditorSession.ts` — Queue progress before webview ready

**Problem**: `LoadProgressReporter.post` drops messages when `webviewReady` is false.

**Fix**: Remove the `webviewReady` gate from the throttled post path. Always post (throttled to 100ms as before), but store the latest throttled message. On `ready`, resend it in case the webview missed it. No queue — at most one pending message.

```ts
class LoadProgressReporter {
  private lastAt = 0;
  private lastStage = '';
  private pending: ProviderToWebviewMessage | null = null;

  constructor(
    private readonly webview: vscode.Webview,
    private readonly generation: () => number,
  ) {}

  public post(stage, completed, total?): void {
    const now = Date.now();
    if (this.isThrottled(stage, completed, total, now)) { return; }
    this.lastAt = now;
    this.lastStage = stage;
    this.pending = { type: 'loadProgress', generation: this.generation(), stage, completed, total };
    void postToWebview(this.webview, this.pending);
  }

  public flush(): void {
    if (this.pending) {
      void postToWebview(this.webview, this.pending);
      this.pending = null;
    }
  }

  private isThrottled(...): boolean { /* same throttle logic */ }
}
```

No queue = zero extra allocations during parse. `reportParseProgress` fires on every line (~400K for a 24MB file), but throttling limits actual posts to ~10/sec. Storing the latest instead of queuing avoids O(n) memory and GC pressure.

**Flush reference**: both the initial one-shot handler (line 322) and `messageHandlers.ready` (line 577) need to flush before setting `webviewReady`. Use a shared `let` variable:

```ts
let flushProgress: (() => void) | null = null;

// initial handler — no synthetic progress, just flush latest
let dispatchIncoming = async (rawMsg: unknown): Promise<void> => {
    if (messageType(rawMsg) === 'ready') {
        flushProgress?.();
        webviewReady = true;
    }
};

// after progressReporter is created
flushProgress = () => progressReporter.flush();

// messageHandlers.ready also flushes
ready: async () => {
    flushProgress?.();
    webviewReady = true;
    await postInit();
},
```

### 2. `src/webview/hexViewer.ts` — Update shell in-place, don't replace `#app`

**Problem**: `renderInitialLoadProgress` does `document.getElementById('app')!.innerHTML = ...` which destroys the styled `.loading-shell`.

**Fix**: Select the existing `.loading-bar-fill` and `.loading-text` elements and update their content. Keep the shell intact.

```ts
function renderInitialLoadProgress(label: string): void {
  const fill = document.querySelector('.loading-bar-fill');
  const text = document.querySelector('.loading-text');
  if (fill) (fill as HTMLElement).style.width = ''; // indeterminate
  if (text) text.textContent = `Loading ${label}…`;
}
```

When `init` arrives, `render()` replaces `#app` entirely (as it already does) — that's correct.

### 3. `src/hexEditorSession.ts` — Emit `'transfer'` stage

**Problem**: `serializeParseResult` runs silently between parse finish and `init` emission.

**Fix**: Call `postProgress('transfer', 0)` before serialization, `postProgress('transfer', 1, 1)` after.

## Files touched

| File | Why |
|---|---|
| `src/hexEditorSession.ts` | Queue logic in `LoadProgressReporter`, flush on ready, emit transfer stage |
| `src/webview/hexViewer.ts` | `renderInitialLoadProgress` updates shell in-place |

## Backward compatibility

- `flush()` is a no-op if called before any `post()` calls (empty queue)
- Existing throttling inside `postNow()` is unchanged
- `renderInitialLoadProgress` only runs when `!S.parseResult` (before init), so no conflict with post-init rendering
