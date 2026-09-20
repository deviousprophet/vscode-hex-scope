---
name: fallow-fix
description: "Fix all fallow findings (dead-code, complexity, duplication) by refactoring source code. Never uses suppression comments or fallow config edits. Trigger on: 'fix fallow', 'fix all fallow warnings', 'fix fallow findings', 'make fallow green', 'zero fallow findings'."
---

# Fallow Fix

Fix every fallow finding by refactoring source code. No `fallow-ignore` comments. No fallow config changes.

## Before starting

Load the `fallow` skill (if available) for detailed fallow CLI docs, issue types, and workflow recipes. This skill covers the fix loop only.

## Tooling

Always run fallow through `scripts/fallow-extract.mjs` (which invokes `npx fallow ...`). Never install fallow globally (`npm i -g fallow`). Never install it as a project dependency.

## Process

### 1. Run scan and digest

```bash
node <skill-dir>/extract.mjs
```

`<skill-dir>` is the directory containing this SKILL.md (`.agents/skills/fallow-fix` in this repo). Run from the repo root — the script invokes `npx fallow --format json --quiet` itself, captures stdout (no file redirect), and prints one greppable digest. Do NOT `cat` or `Get-Content` raw JSON — a terminal truncates json lines at 2000 chars and the `health` section is the first part lost.

Also available:
- `--file <path>` to re-digest an existing fallow report file
- `--test` to run the script's self-check

The digest gives:
- `verdict: GREEN | FINDINGS` plus per-axis counts
- one line per finding, shaped `[<category>] <path>:<line> <label> <details>` — e.g. `[unused_exports] src/a.ts:12 export_name="bar"`, `[complexity] src/b.ts:1 name=complex cyclo=8 ... severity=high`, `[dup] 89 tokens, src/c.ts:3-7  src/d.ts:11-15`, `[target] <path> <category>: <recommendation>`
- `--- counts ---` with every non-zero category and complexity severity breakdown
- `--- hotspots (top 10 churn/risk) ---` — informational
- `--- targets ---` — informational, never block green

Exit code: `0` = green, `1` = findings exist, `2` = scan/parse failed, `3` = failed test.

### 2. Exit if green

`verdict: GREEN` (exit code `0`) requires ALL of:
- dead-code `0` (`check.total_issues`)
- complexity `0` (`health.findings` — ALL severities, including `moderate`)
- duplication `0` (`dupes.stats.clone_groups`)

`health.targets` and `hotspots` are NOT part of green — informational only. Do not block green on them.

### 3. Report refactoring targets (informational only)

`[target]` lines are structural "split high-impact file" suggestions based on churn and coupling, not violations. They never block green.

For each target:
1. Check if the target file is in-scope for the current task (modified by the diff or directly related)
2. If in-scope: evaluate and apply the recommended refactoring
3. If out-of-scope: report it for awareness, do not refactor

If a recommendation is clearly wrong (false positive), explain why and skip it regardless of scope. Note: `split_high_impact` targets are driven by complexity density + fan-in + churn, not size alone — a small single-concern file can be flagged; apply judgment rather than splitting for its own sake.

Dead-code findings appear as `[unused_*]` / `[unresolved_imports]` / `[duplicate_exports]` etc. lines — read the file, verify the finding, then remove the unused code or drop the export keyword.

### 3. Fix dead-code findings (if any)

**Unused exports** — Run `npx fallow fix --dry-run --format json --quiet 2>/dev/null || true` to preview. Then `npx fallow fix --yes --format json --quiet 2>/dev/null || true` to apply.

**Unused dependencies** — Verify the dependency is truly unused (check `package.json` scripts, config files like `.eslintrc`/`eslint.config.*`, `vitest.config.*`, CI configs, `.mjs`/`.cjs` scripts at repo root). If truly unused, remove from `package.json`. If used by tooling, do not remove.

**Other dead-code types** — Read the file, verify the finding is correct, then remove the unused code.

### 4. Fix complexity findings

For each `[complexity]` digest line with `severity != none` (digest gives `path:line name cyclo=... cognitive=... crap=... severity=...`):

**Goal:** reduce cyclomatic complexity so CRAP score drops below threshold (30.0) at zero coverage. This requires cyclomatic ≤4 for each function.

**Techniques (apply in order, stop when cyclo ≤4):**

- **Extract boolean helpers** — move `||` / `&&` chains into a helper function (`function isX(): boolean { return a || b; }`). The helper absorbs `||`/`&&` decision points. The original function's cyclo drops by 1 per extracted operator.
- **Split into named sub-functions** — move a `for` loop with inner `if` into its own function. Each half has fewer decision points.
- **Use `filter`/`every`/`some`/`map`** — replace `for` + `if` with `.filter(...).map(...)` or `.every(...)`. The callbacks run in separate function contexts and don't count toward the enclosing function's cyclo.
- **Ternary over if-return** — combine early returns and null checks with `?:`.
- **Combine decision points** — `if (a && b)` has 2 decisions; extracting `isBoth()` into a helper reduces it to 1 decision (`if (isBoth())`).

**Never:**
- Add `// fallow-ignore-next-line complexity` or any suppression
- Edit `.fallowrc*` or any fallow config file
- Remove or disable the function (it's the user's code)
- Change behavior

### 5. Fix duplication findings (if any)

Read clone instances. If the duplication is within the same module, extract a shared helper. If cross-module, consider a shared utility.

### 6. Address refactoring targets (if in diff scope)

Review the `[target]` lines from the latest `scripts/fallow-extract.mjs` run (see step 3). If any target file was modified by the current diff, evaluate the suggested refactoring. Apply it if it improves the code without scope creep. If the target is outside the diff scope (pre-existing code), report it but do not refactor — it's a separate task.

### 7. Re-run fallow

After fixing each group of findings, re-run `node <skill-dir>/scripts/fallow-extract.mjs`. Repeat until `verdict: GREEN`. Log what was fixed.

### 8. Verify

Run `npx tsc --noEmit` and the project's test command after all fixes to confirm no breakage.

### 9. Summary output

After each fix cycle, print: `findings fixed: <N>, refactoring targets remaining: <M>`. After zero findings, list any remaining refactoring targets that were outside diff scope.
