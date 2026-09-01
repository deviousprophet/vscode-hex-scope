# Implement Delta — Test suite cleanup

Task: `.trellis/tasks/09-01-test-suite-cleanup` · Branch: `feat/test-suite-cleanup`
Date: 2026-09-01 · Implement agent: trellis-implement

## Scope executed

Phase A + Phase B only (design.md): fold echo `test()` blocks into table-driven loops. README untouched (main session handles R2). Phase C items untouched: parser edge cases, ihex/srec sample loops, perf tests, scripting security, schema validation, storage round-trips, panel/menu interaction tests.

## Counts (source-grep `\btest\(` per file; before vs after)

| File | Before | After | Δ |
|---|---|---|---|
| core\providerUtils.test.ts | 45 | 33 | −12 |
| core\struct.test.ts | 103 | 82 | −21 |
| core\search.test.ts | 10 | 7 | −3 |
| **TOTAL** | **947** | **911** | **−36** |

All other files unchanged (matches baseline survey; tolerated drift: srecSamples 62/61, structPanel 57/55, ihexParser 31/29 pre-existing).

## Merges log (Phase A: within-file duplicate-title same-body → merge; Phase B: same-path/different-input → table)

### core/providerUtils.test.ts (−12)
| Old test(s) | New test |
|---|---|
| ".srec"/".mot"/".s19"/".s28"/".s37" extension → srec | `known SREC extensions map to srec` (loop) |
| ".hex"/".ihx"/".ihex" extension → ihex | `known Intel HEX extensions map to ihex` (loop) |
| content starting with "S0"/"S1"/"S9" → srec (sniff) | `content sniff: leading S0/S1/S9 records → srec` (loop) |
| builds a valid S1/S2/S3 record | `builds valid S1/S2/S3 data records with the matching address size` (loop) |
| preserves LF line endings / preserves CRLF line endings (serializeSRec) | `preserves LF and CRLF line endings` (both asserts) |
| preserves LF line endings for IHEX / preserves CRLF line endings for IHEX (repairChecksums) | `preserves LF and CRLF line endings for IHEX` (both asserts) |

### core/struct.test.ts (−21)
| Old test(s) | New test |
|---|---|
| 11 scalar decode tests: uint16 LE/BE, uint32 LE, uint32 LE hex output, uint64 LE, int8/int16/int32/int64 LE, uint64 BE, int64 BE | `scalar types decode to expected values across endianness` (table, check ∈ exact/prefix/includes) |
| float32 LE 1.0 / float64 LE 1.0 | `float32 and float64 decode 1.0 (LE)` (loop) |
| returns "??" when byte missing / "??" for partial uint32 | merged into first title (two asserts, one test) |
| shared big-endian / shared little-endian setting | `shared byte-order setting applies to scalar fields` (loop) |
| byte offsets accumulate (packed) / with alignment | `byte offsets accumulate for packed and aligned layouts` (loop) |
| 7 type-keyword tests: float→float32, double→float64, uint64_t→uint64, unsigned char→uint8, unsigned int→uint32, int→int32, short→int16 | `C type keywords map to their struct field types` (table) |
| float32→float / float64→double keyword (fieldsToText) | `float32/float64 fields emit float/double keywords` (loop) |

### core/search.test.ts (−3)
| Old test(s) | New test |
|---|---|
| short "1A0" / "0x1A0" prefix / full padded "000001A0" | `address queries match their canonical form` (loop) |
| overflow >8 hex / overflow 0x-prefixed >8 hex | `overflow: >8 hex chars returns empty (no silent wrap)` (loop) |

## Behavior preservation notes

- Every merged table keeps the same input variants and the same assertion set (exact/prefix/includes modes where original tests mixed `strictEqual`/`startsWith`/`includes`).
- No distinct behaviors removed: per-format parser tests, edge cases, sample loops, perf, scripting security, panels, storage, schemas untouched.
- No production `src/` files modified (git status: only `src/test/**` + README.md, the latter by main session).
- No shared/helpers.ts additions needed — no copy-pasted assertion block appeared in ≥3 files.

## Verification (all green)

| Command | Result |
|---|---|
| `npm run check-types` | pass (tsc --noEmit, no output) |
| `npm run lint` | pass (`eslint-rules/require-escaped-html.test.mjs && eslint src`) |
| `npm test` | pass — 913 passing (34s), extension host exit 0 |

Mocha reports 913 passing (counted at runtime in extension host) ≥ 880 floor. Source-grep count 911 across 40 files.

Duplicate-title scan post-cleanup: only `no parse errors` ×3 (ihexSamples) and ×5 (srecSamples) — intentional sample loops, KEEP per design Phase C.

## Not done (per scope)

- README rewrite — main session owns R2.
- Perf files, parser edge cases, sample loops, scripting security — Phase C, untouched.
- `describe()` refactor — out of scope per design.md tradeoffs.