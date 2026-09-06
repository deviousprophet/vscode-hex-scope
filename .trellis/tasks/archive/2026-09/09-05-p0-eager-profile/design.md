# P0 Design: Defer profile creation until first write

## Problem

`hexEditorSession.postInit()` → `openStores()` → `openProfileStores()` runs on
every panel init (every file open) and calls `createProfile(root, relPath)`
(`src/hexScopeStorage.ts:216`) when `findProfile` misses, writing a
`firmware_profiles/profiles_N/index.json` immediately. `resolveHexScopeRoot`
(`src/hexScopeStorage.ts:132`) falls back to `path.dirname(uri.fsPath)` for
out-of-workspace files, so those seed a `.hexscope/` sibling on every open.

## Decision: lazy materialization on first write

Make profile storage materialize on first write, not on open.

- The three slot stores (`index`, `structs`, `integrity`) are built regardless,
  but when `findProfile()` returns nothing they are built in **deferred mode**
  with a `null` directory: reads return in-memory empty defaults
  (`emptyIndexData(relPath)`, `[]`), no directory and no `index.json` are created.
- The first `set()` on any slot triggers store **materialization**: create the
  profile directory (reusing `createProfile`) then write the slot. Because a
  single file's first write touches only one slot (e.g. `saveLabels` writes only
  `index.json`), only that slot's write performs the create; sibling slots still
  materialize on their own first write (same dir, near-free).
- All materialization runs inside `enqueuePerFileOp` (the per-file serializer)
  so a concurrent label+pin save cannot race two `createProfile` calls.
- `attachProfileWatcher` is only attached once a directory exists (no dir → no
  watch, avoiding the P2 sibling-watch false-positive on out-of-workspace opens).

### JsonStore changes (`src/hexScopeStorage.ts`)

Introduce a lazily-created store variant. Minimal approach: add the ability to
build a `JsonStore` whose URI is resolved lazily. Concretely:

- `JsonStoreOptions.uri` gains an optional `lazyDir?: () => Promise<string | null>`
  (returns a created profile dir, or `null` to stay in-memory — out-of-workspace
  non-explicit save).
- Reads: if `lazyDir` set and directory not yet resolved, return `empty()` in
  memory (no fs access).
- Writes (`writeNow`/`writePendingNow`): if `lazyDir` set and dir unresolved,
  resolve it first; if it returns `null` (no-workspace, not explicit save), skip
  the disk write and stay in memory.

The three stores share one resolved dir. Session owns a single `resolveDir`
responsible for materializing once and seeding schemas, guarded so concurrent
first-writes serialize through `enqueuePerFileOp`.

### Out-of-workspace default

No workspace folder → `lazyDir` may return `null` (stay in-memory) unless the
call is an explicit save/profile action. Session tracks an "explicit save"
flag passed down; only explicit actions flip `lazyDir` to materialize.

## Tradeoffs

- Keeps storage layout unchanged (P1 reworks identity separately). The P1
  bindings/profiles redesign will replace the `lazyDir` mechanic but the
  "no write on open" invariant it enforces carries forward.
- `JsonStore` gains a small lazy-directory branch; contained, no behavioral
  change for existing persisted trees (they find a dir and skip deferred mode).

## Rollout / rollback

- Backward compatible: existing `firmware_profiles/*` trees still found and
  loaded normally — deferred mode only applies when `findProfile` returns null.
- Rollback: revert to `createProfile` on open if any regression.
