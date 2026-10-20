# Enhance scripting functionality

## Goal

Make workspace scripts first-class participants in overlay layout and integrity checks,
replace the two-step dangerous-action prompt with one scoped inline approval that also
saves, and ship runnable examples so users can start from working code.

## Source requirements

| ID | Requirement |
|----|-------------|
| R1 | Integrity checks can be supplied by a workspace script: a script may provide the value bytes for comparison/auto-fix, a boolean verification result, or both, and the check appears in the Integrity panel next to built-in checks. |
| R2 | A struct instance may take its start address from a workspace script instead of a fixed address. |
| R3 | A struct type may declare size parameters, and a script may supply the parameter values that determine array lengths for one instance. |
| R4 | A dangerous script action is approved once, inline, with scoped options (once / this script / this session / this workspace / all commands / deny). The modal warning and the separate Apply & Save step are removed. |
| R5 | Users get runnable example scripts, a type definition for IntelliSense, and an in-product way to install them, so the new APIs are learnable without reading the source. |

## Task map

| Child task | Deliverable | Priority | Ordering |
|------------|-------------|----------|----------|
| `10-20-script-entry-runner` | Named-entry execution, typed values, role discovery | P2 | Foundation; land first |
| `10-20-script-write-confirmation` | Inline scoped approvals and one-step commit for script writes | P2 | Independent; can ship alongside the runner |
| `10-20-script-integrity-checks` | Script-backed integrity checks with optional auto-fix | P2 | Needs the shared script-execution bridge |
| `10-20-struct-template-parameters` | Size parameters on struct types plus per-instance values | P3 | Enabler for script-supplied array sizes |
| `10-20-script-instance-address` | Script-resolved instance start addresses | P3 | Needs the shared script-execution bridge |
| `10-20-script-array-sizes` | Script-supplied template parameter values | P3 | Needs template parameters and the address scheduler |
| `10-20-scripting-examples` | Example scripts, `hexscope.d.ts`, and an install action | P2 | Run examples after the runner; role examples follow their APIs |

Ordering is written here and repeated in each child `prd.md`; the tree itself carries no order.

## Cross-child acceptance criteria

- [ ] No script-provided value reaches layout, integrity, or persistence without boundary
      normalization and validation.
- [ ] A failing, cancelled, or mistyped script cannot corrupt a profile, overwrite bytes, or
      block the rest of the panel; the affected instance or check reports a visible error and
      the remaining UI stays usable.
- [ ] Role scripts respect workspace trust and show their required capabilities before running.
- [ ] Permissions are host-owned, keyed by script fingerprint, revocable, and never persisted
      outside the workspace's own storage scope.
- [ ] Existing `run(api)` scripts keep working unchanged.
- [ ] Every shipped example compiles against the current API and is exercised by a test, so
      examples cannot silently rot.
- [ ] `docs/SCRIPTING.md` and the owning `.trellis/spec/frontend/` specs are updated when
      behavior, protocol payloads, or persistence change.
- [ ] `npm run check-types`, `npm run lint`, and `npm test` pass; schema fixtures validate.

## Non-goals

- A new script language, runtime, or sandbox model.
- Script-authored type definitions, importing external binaries, or background execution.
- Full C template code generation; the C preview only needs a readable, correct rendering.
- Redesigning the `exec`/`fetch` hardening already covered by the scripting spec.
- Persisting resolved script values as if they were authored data.
- A marketplace or gallery of community scripts.

## Risks and constraints

- Overlay decode is synchronous (`decodeType`, `typeByteSize`); every dynamic feature must
  resolve values before decode and cache them for rendering.
- `TypeField.count` is type-level and `TypeInstance.addr` is per-instance; array-size
  scripting is impossible without the template-parameter layer, so that ordering is hard.
- `IntegrityAlgorithm` is a closed union used by rendering, stored-length math, byte order,
  auto-fix, and the on-disk schema. Script checks need a deliberate discriminator and a
  data-schema migration, not a string appended to the enum.
- Scripts run in the extension host worker; the webview owns pending edits. Any host-run
  script must receive the edit overlay or it will evaluate stale bytes.
- Examples are user-facing API documentation. They must be compiled and executed in tests,
  not just copied as text.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Role discovery uses an explicit `@script integrity\|address\|size` header tag; exported function names define the call contract | Cheap, deterministic, no user code evaluated during a scan; mirrors the existing `@requires` parser |
| D2 | Approved writes stage during the run and are applied plus saved once on successful completion; failure discards them | One consent, one save, atomic behavior, and undo remains available |
| D3 | Template parameters are supported on the top-level instance type; a nested templated reference must provide defaults | Avoids an ambiguous parameter scope in the first release without blocking the main use case |
| D4 | Script integrity checks run on open, save, and explicit refresh; an edit marks them stale | Avoids spawning a worker on every keystroke while keeping results honest |
| D5 | Contract values are typed: bytes for auto-fix, boolean for verify, number for address/size | Removes width and endian ambiguity at the boundary |
| D6 | `write` and `fetch` may be granted at workspace scope; `exec` is session-only; every grant is fingerprint-bound | Limits the blast radius of persistent grants |
| D7 | The pre-run `@requires` gate is removed; the per-command inline approval is the only gate | One approval concept instead of two |
| D8 | Examples live in a bundled examples directory and are installed through a command that never overwrites files; `hexscope.d.ts` is installed under `scripts/types/` and `.d.ts` files are filtered | Users get working code without risking existing scripts; the subfolder keeps types with scripts without colliding with `types.json` |
| D9 | `.d.ts` files are excluded from script scanning and scanning never descends into subdirectories | Two independent guards keep the type definition out of the runnable list |

## Done when

All seven child deliverables are archived, the parent integration review confirms the
cross-child criteria, and the scripting, integrity, overlay, protocol, storage, and examples
documentation describes the shipped behavior.
