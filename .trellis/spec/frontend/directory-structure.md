# Frontend and Core Architecture

## Scope

Hex Scope is one VS Code extension package with two runtimes:

- Extension host: `src/extension.ts`, `src/hexEditorProvider.ts`, `src/hexEditorSession.ts`.
- Webview: `src/webview/hexViewer.ts` and feature modules under `src/webview/`.
- Runtime-neutral core: parsers, memory, search, integrity, structs, and byte tools under `src/core/`.

No framework component or hook layer exists. Keep browser-only DOM work in `src/webview/`; keep logic that can run without DOM or VS Code in `src/core/`.

## Module Ownership

```text
src/
|- extension.ts                 command registration and activation
|- hexEditorProvider.ts         CustomReadonlyEditorProvider adapter
|- hexEditorSession.ts          per-provider document/session orchestration
|- webviewProtocol.ts           typed extension-host <-> webview seam
|- core/
|  |- parser/                   IHEX/SREC line parsing and segment construction
|  |- document.ts               format detection, serialization, checksum repair
|  |- memory.ts                 indexed byte lookup and memory-row model
|  |- search.ts                 cancellable/chunked search engine
|  |- integrity.ts              validation, algorithms, stored-value conversion
|  |- struct-codec.ts           struct layout, parse/export, decode
|  `- byte-tools/               pure copy/analyze/format helpers
`- webview/
   |- hexViewer.ts              composition root and DOM effect wiring
   |- appModel.ts               authoritative UI model transitions
   |- state.ts                  state shape/defaults only
   |- webviewMessage*.ts        provider dispatch and typed model updates
   |- memory/, search/, render/ view-specific modules
   `- sidebar/{inspector,integrity,struct}/ feature modules
```

## Placement Rules

- Put source-format rules in `src/core/parser/` or `src/core/document.ts`; UI code consumes `ParseResult`/`SerializedParseResult`, never reparses records.
- Put extension-host filesystem, VS Code storage, clipboard, and watcher effects in `HexEditorSession` or the smallest host adapter.
- Add cross-runtime messages only in `src/webviewProtocol.ts`, then update both session handling and webview dispatch/model handling.
- Put shared state mutation in `appModel.ts`; feature modules may own transient UI state when it has one owner, as integrity and struct modules do.
- `hexViewer.ts` is the composition root. It wires `rerender` callbacks and effects; it must not become a second owner for parsing or feature rules.
- Tests mirror ownership under `src/test/core`, `src/test/webview`, and `src/test/extension`.

## Deep Module Seams

- `src/core/document.ts` hides record rewriting/checksum preservation behind format-level functions.
- `src/core/search.ts` hides debounce, chunking, cancellation tokens, and match parsing behind `SearchEngine`.
- `src/core/integrity.ts` owns validation and algorithms; DOM code does not reproduce them.
- `src/core/struct-codec.ts` owns struct syntax/layout/decode; render code consumes decoded rows.
- `src/webviewProtocol.ts` is the interface between host and browser runtimes.

Preserve these seams. Applying the deletion test, removing a forwarding adapter is useful only if it concentrates complexity behind an existing owner; do not scatter its behavior into callers.

## Anti-patterns

- Importing `vscode` from `src/core/` or `src/webview/`.
- Reading raw record text from a DOM feature instead of using parsed records/segments.
- Adding feature-specific state transitions directly to multiple event listeners.
- Creating a new registry or wrapper for a single call without reducing interface complexity or increasing locality.
- Adding React/Vue-style hook guidance to this direct-DOM codebase.

## Verification

- `npm run check-types`
- `npm run lint`
- `npm test`
- For protocol changes, search every message discriminator in `src/webviewProtocol.ts`, `src/hexEditorSession.ts`, `src/webview/webviewMessageDispatcher.ts`, and `src/webview/webviewMessageModel.ts`.
