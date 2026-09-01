# Design — Test suite cleanup & README rewrite

## Boundaries

- **In scope**: `src/test/**` (tests + test helpers), `README.md`. Could touch `src/test/shared/**` helper additions.
- **Out of scope**: all production code under `src/` except README; test **runner config** unless a cleanup requires it (e.g. combine two perf files — then fold, not reconfigure). CI/`.github` untouched.
- If cleanup reveals a production bug: write it in task `notes`, leave the source alone.

## Current-state baseline (survey)

- 944 `test()` cases across 40 files. Breakdown (top): `struct.test.ts` 103, `webview.test.ts` 91, `srecSamples.test.ts` 61, `menuController.test.ts` 56, `structPanel.test.ts` 55, `providerUtils.test.ts` 45, `inspectorPanel.test.ts` 42.
- Harness: `node:assert` + mocha-style `suite()`/`test()`; NO `describe()` nesting anywhere.
- Duplicate-title scan: 8 groups / 22 occurrences. Most are **legit cross-format echoes** (ihexParser vs srecParser identical edge-case names; ihexSamples vs srecSamples sample loops). Real semantic duplicates are within-file "echo suites" where copy-paste repeated the same assertion with a cosmetic title change.
- Test data: `ihexSamples`/`srecSamples` are sample-file driven (fixtures in `src/test/fixtures` or inline).

## Cleanup strategy (ordered, low-risk → higher-risk)

### Phase A — Mechanical, zero-behavior risk
1. **Duplicate-title within same file** that assert the identical thing → merge into one `test()` (keep both inputs if distinct, else drop the echo).
2. **Repeat table-driven loops**: same body running over a literal array (e.g., sample loops "no parse errors" with 6+ near-identical cases) → keep the loop, title only where legible. No structural change.
3. Consolidate copy-pasted assertion blocks (e.g. `assertParsedRecordPayload` already in `shared/helpers.ts`) → extend helpers rather than per-call re-writing; only when identical.

### Phase B — Parametric consolidation (behavior-preserving)
4. Convert repeated **same-path, different-input** `test()` blocks into `for (const c of CASES)` loops: same assertions, same failure capture (assert on each element), single `test()` per table. This is where most of the redundant-count reduction lands.
5. Where two suites (e.g. `providerUtils`, `struct`, `webview`) have “echo suites” (same body under 10+ `suite()` with different names) → collapse to one `suite()` with cases, unless the suite names encode distinct preconditions.

### Phase C — Explicitly keep (quality gate)
- All parser edge cases (blank lines, SUB tolerance, checksum mismatch detection, record types) — these are distinct behaviors, keep 1:1.
- Perf tests (`parsePerformance`, `searchPerformance`) — untouched unless trivial dup.
- Script security tests, schema validation, storage round-trips, panel interaction tests — distinct, keep 1:1.

## Verification model

- Baseline recorded in `design.md` (this file): per-file `test()` count + unique behavior inventory (group of asserts). After cleanup, re-run scan; expect count ≈ 880–944, exact per-file deltas listed in `implement.md` before/after.
- Full gate: `npm test`. Type gate: `npm run check-types`. Lint gate: `npm run lint`.
- Spot-check: for each merged group, assert set preserved (same `assert.*` calls with the same variants).

## README design (scoped: TOC + quick-ref + doc links only)

Livepreview-style TOC discipline, but minimal surface change to honor scope (items 1, 2, 8):

```
# Hex Scope  (badge row — keep)
tagline (keep)
demo image (keep)
## Table of Contents                    # NEW — links to Features / Quick reference / Supported file types / Issues
## Features                             # keep 5 groups, unchanged
## Quick reference                      # extend existing table only
   new rows: open, search, edit byte, batch fill, save/recompute checksums, struct pin, integrity profile, run script
## Supported file types                 # keep table, unchanged or add doc-link row
## Issues                               # keep
## Documentation                        # NEW — docs/SCRIPTING.md, docs/HEXSCOPE_STORAGE.md, CHANGELOG.md, LICENSE
```

- All links must resolve: `docs/SCRIPTING.md`, `docs/HEXSCOPE_STORAGE.md`, `CHANGELOG.md`, `LICENSE`, repo URLs.
- Quick-ref rows derived from actual current README actions + real feature behavior — no invented shortcuts.
- NOT in scope: commands table, keyboard shortcuts, Release quality, FAQ, Development section, grammar-scope note (user explicitly dropped 3-9).

## Rollback

- Branch `feat/test-suite-cleanup` off `main`; everything ships as one commit (or few), revert = `git revert`. Test artifacts are rarely destructive since tests are additive-in-nature; worst case restore from git.

## Tradeoffs

- Kept per-format duplicated sample tests instead of merging ihex/srec helpers: cross-format isolation is the point (regression in one format must be visible without touching the other). Deleting them would lose isolation value — skip.
- `describe()` refactor (convert suites → describe) is **not** in scope: cosmetic, high churn, zero redundancy reduction.