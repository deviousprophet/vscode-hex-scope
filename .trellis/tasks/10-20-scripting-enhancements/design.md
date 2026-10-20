# Parent design: shared script execution and permission foundation

This document owns only the cross-cutting architecture. Each child design owns its feature
contract. If a child needs a different foundation, change this document first.

## Boundaries

| Layer | Owns | Must not do |
|-------|------|-------------|
| `src/core/scripting/` | script compilation, worker sandbox, entry dispatch, value contract, capability parsing | import VS Code, read files outside the runner, know about overlay or integrity |
| `src/scriptHost.ts` + `src/hexEditorSession.ts` | document bytes, edit overlay, confirm bridge, grant store, role resolution | render UI, persist webview drafts |
| `src/webviewProtocol.ts` | typed request/response unions for role runs and approvals | carry untyped `unknown` payloads |
| Webview panels | display, validation feedback, inline approval UI | run scripts, own grants, write files |

Dependency direction stays `webview -> protocol -> host -> core`; the core never imports host
or webview modules.

## 1. Named-entry execution

Today `scriptWorker.ts` always calls `module.exports.run`. Generalize the worker message with
an entry name and reuse the same sandbox, timeout, RPC, and cancellation path:

```ts
// core/scripting/types.ts (additive)
type ScriptEntry = 'run' | 'verifyIntegrity' | 'getIntegrityValue' | 'getAddress' | 'getSize';
type ScriptValue = number | boolean | number[] | Record<string, number>;

interface ScriptOutput {
    results: Array<{ label: string; value: string }>;
    log: string[];
    value?: ScriptValue;        // return value of a named contract entry
    error?: string;
    errorType?: ScriptErrorType; // add 'contract' for an invalid return
}
```

- `run` keeps its current void contract; contract entries return a value.
- `executeEntry(filePath, entry, host, opts)` shares compile, worker, timeout, and cancellation
  with the existing `execute()`; no second runner.
- The worker validates the export is a function before calling it and structured-clones the
  return value. `Promise` returns are awaited through the existing cross-realm thenable check.
- Reject non-finite numbers, negative values, and oversized arrays at the worker boundary.
- Keep one script run at a time per document for user-initiated runs; host-internal role
  resolutions may queue behind that run instead of racing it.

## 2. Role declaration and discovery

Decision: a header tag parsed from the first 2048 bytes, next to `@requires`:

```ts
/** @script integrity */
```

`scanScripts()` returns `roles: Array<'integrity' | 'address' | 'size'>` alongside
`capabilities` and `fingerprint`. Discovery does not evaluate user code. The exported
function name remains the behavior contract and is checked at call time, so a tag with a
missing export yields a `contract` error in the UI instead of a silent no-op.

The Scripts panel shows a role badge and a non-destructive "Try" action that invokes the
contract entry without staging writes. Scripts without `run` remain listed but cannot be
started through the normal Run button.

## 3. Fresh bytes for host-run scripts

The webview owns pending edits; the host owns the last saved parse. A host-run role script
must see the same bytes the user sees. For every role request the webview sends its pending
edit list (the same shape as `saveEdits`), and the host overlays it on a temporary reader:

```ts
interface RoleRunRequest {
    requestId: number;
    scriptPath: string;
    entry: ScriptEntry;
    generation: number;
    edits: Array<[number, number]>;
    selection?: { start: number; end: number };
    context?: Record<string, string | number>;
}
```

- Bound the request (for example 1 MiB of edits); above the bound, refuse with a visible
  error instead of truncating.
- Reject the result when `generation` no longer matches the open document; the caller
  re-requests.
- Never mutate `parseResult.segments` for a role run.

## 4. One permission model

Replace the modal-only confirm with a host-owned `ScriptGrantStore`:

```ts
type Capability = 'write' | 'exec' | 'fetch';
type GrantScope  = 'once' | 'script' | 'session' | 'workspace' | 'all';
interface GrantKey { scriptPath: string; fingerprint: string; capability: Capability | '*' }
```

- `session` lives in memory for the extension host lifetime and is intentionally
  cross-script; `workspace` uses `context.workspaceState` (not settings, so grants are never
  committed).
- Script- and workspace-scoped grants are invalidated when the script fingerprint changes.
  The host keeps its own fingerprint map; do not rely on the webview's copy. Session grants
  are an explicit broader choice and end when the host exits.
- A missing response, a disposed panel, or a timeout denies and never defaults to allow.
- `exec` never receives a workspace-scoped grant; `write` and `fetch` may. Persistent grants
  are limited to those two capabilities.

The webview renders one inline approval surface anchored to the script card. The host owns
the decision and persistence; the webview only returns a choice. The pre-run `@requires` gate
is removed, so the per-command approval is the only prompt; capability tags remain visible on
the card.

## 5. Value normalization at the boundary

Every value crossing from a worker or from the webview to a model is normalized once:

- `number`: `Number.isSafeInteger` for addresses and sizes, unsigned 32-bit for addresses,
  `>= 1` for sizes, `>= 0` for counts.
- `number[]`: bytes must be integers `0..255`; reject mixed widths.
- Object maps: plain objects, own keys only, values normalized per key.
- Normalizers return `{ ok: true, value } | { ok: false, error }`; UI shows the error on the
  owning row. No raw casts.

## 6. Persistence and compatibility

- All on-disk additions are additive: new optional keys on `TypeDef`, `TypeField`,
  `TypeInstance`, and the integrity check record. Absent keys keep today's behavior.
- Bump the data schema only when an incompatible shape change is required. The integrity
  `kind` discriminator is additive and normalized on load (self-healed once), so the schema
  version stays unchanged; keep the storage envelope at version 1.
- Readers tolerate unknown keys; writers emit only current keys. Do not silently rewrite a
  newer payload.
- Resolved script values (addresses, parameter values, integrity results) are transient
  unless the user explicitly authored them; do not persist them as authored data.

## 7. Failure taxonomy

| Failure | Surface |
|---------|---------|
| compile / runtime / timeout / cancel | Existing script result headers, unchanged |
| contract violation (missing export, wrong type, out-of-range) | New `contract` error on the owning check or instance row; no partial mutation |
| stale generation | Silent re-request, visible "Refreshing" state, then error if it repeats |
| permission denied | No write, no partial save; notice in the panel |
| script unavailable (deleted, untrusted, esbuild missing) | Row-level error plus a link back to the Scripts panel |

## 8. Rollout and rollback

1. Land the named-entry runner and the value contract with tests; no UI change.
2. Land the grant store and inline approval; remove the modal and Apply step in the same
   release so behavior is never half-migrated.
3. Land features one child at a time behind their own acceptance criteria.
4. Rollback is a revert: additions are optional, so an older build reads new profiles
   without losing authored keys (the integrity kind migration is the one exception and must
   be forward-only).

## 9. Validation strategy

- Core: unit tests for entry dispatch, value validation, timeout, cancellation, and
  cross-realm promises.
- Host: grant scoping, fingerprint invalidation, edit-overlay reads, stale generation.
- Webview: approval UI states, role badges, row-level errors, no double prompt.
- Persistence: schema fixtures for every new optional key and the integrity migration.

## 10. Examples and type definitions

Examples are part of the API contract, not marketing copy. They are compiled and exercised by
tests so a contract change breaks the build instead of shipping broken snippets.

**Layout.**

```text
examples/
├── scripts/
│   ├── types/hexscope.d.ts         # HexScopeAPI + ScriptContext definitions
│   ├── verify-crc.ts              # run(api), read + setResult
│   ├── write-pattern.js           # run(api), @requires write
│   ├── follow-pointer.ts          # @script address + getAddress
│   ├── array-size-from-header.ts  # @script size + getSize
│   └── verify-integrity.ts        # @script integrity, both exports
└── README.md                      # what each example needs
```

- The repo copy is the source of truth. `package.json` packaging includes it; a build test
  asserts every file is present in the VSIX file list.
- The install command copies scripts into `.hexscope/scripts/` and the type definition into
  `.hexscope/scripts/types/`. It never overwrites: existing files are reported as skipped. A
  second explicit action can replace them after confirmation.
- Examples reference the definition with `/// <reference path="./types/hexscope.d.ts" />`,
  which resolves identically in the repo and in an installed workspace.
- `scanScripts` reads only direct child files (never descends into subdirectories), and also
  ignores any file ending in `.d.ts`. The type definition therefore cannot appear as a
  runnable script, and the no-recursion rule is an explicit invariant rather than an accident.
- The Scripts panel empty state and header menu both expose "Add example scripts"; the docs
  link points at the same catalog.
- Each sample declares its role tag and required capabilities, uses only public API, and
  includes a comment naming the fixture assumptions (addresses, ranges) the user must adapt.
- Type-definition drift is checked by compiling the examples with `tsc --noEmit` against the
  installed `.d.ts`; contract drift is checked by running the role exports against a mock
  host in tests.

