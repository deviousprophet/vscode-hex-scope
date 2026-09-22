# Design — suppress spurious external change on document copy

## Root cause

`resolveCustomEditor` (`src/hexEditorSession.ts:438`) registers a per-document
`FileSystemWatcher` (`:825`) bound to `onDidCreate` (`:882`) while the initial
async load (`loadInitialDocument`, `:500`) is still in flight. When VS Code copies a
file in the Explorer it creates the file, then opens the custom editor; the file-create
event is delivered to the extension host around the time the editor registers the
watcher, so `onExternalChange` (`:831`) fires for a file that did not change.

`onExternalChange` currently has only one guard — the self-write horizon — and then
unconditionally posts `externalChange`/`externalChangeError` after re-reading.

## Fix

Add two cheap guards to `onExternalChange`, before the debounce is scheduled:

1. **Not loaded yet**: `if (!parseResult) { return; }` — the initial load owns the
   content until it completes; any event before then is redundant because the load
   reads the current file.
2. **Content unchanged**: in the debounced callback, after reading `newRaw`, drop the
   event when `newRaw === raw`. This is the direct invariant: an external-change event
   only matters when the bytes actually differ. It also covers duplicate watcher
   emissions for a single write.

The self-write horizon stays first, so host writes are still ignored even if content
differs transiently.

## Seam and regression test

The decision is a pure function of `(loaded?, currentRaw, nextRaw, lastSelfWriteAt,
now)`; extract it so it is testable without a webview:

`src/core/documentExternalChange.ts`

```typescript
export interface ExternalChangeGate {
    markSelfWrite(): void;
    /** true when the event describes a real external change to handle. */
    shouldHandle(nextRaw: string, isLoaded: boolean, currentRaw: string, now?: number): boolean;
}

export function createExternalChangeGate(horizonMs: number): ExternalChangeGate;
```

The session calls `gate.markSelfWrite()` wherever it currently sets `lastSelfWriteAt`
(and `markSelfWrite` in `ensureRootStores`), and uses
`gate.shouldHandle(newRaw, parseResult !== null, raw)` in `onExternalChange`.

Why a core module: the decision is runtime-neutral (strings/booleans/time), and the
session has no injectable seam to observe posted webview messages, so a session-level
E2E assertion on the banner is not possible today. This module is the correct seam —
it encodes the exact bug policy (spurious same-content / pre-load events are not
changes) and is unit-testable.

Tradeoff: small extraction. Kept minimal — no watcher, no FS, no vscode import — so it
runs in the fast core test tier rather than the vscode-test host tier.

## Data flow (unchanged)

watcher event → `onExternalChange` → gate (self-write / not-loaded / unchanged) →
debounce 200 ms → re-read → gate (unchanged) → parse → `externalChange` |
`externalChangeError` → webview banner.

## Compatibility / rollback

- No protocol, message-shape, or persistence change.
- Behavior change is strictly narrowing: fewer messages. No consumer requires the
  spurious banner.
- Rollback: revert the guards and the module.

## Risks

- If an external writer changes content to a value identical to the loaded raw, we now
  skip the banner. That is correct: nothing observable changed.
- If a change lands while the initial load is reading, we skip it; the load re-reads the
  file itself, so the final state still reflects disk. Worst case is a stale read of one
  generation, same as before.
