---
name: fallow-fix
description: "Fix all fallow findings (dead-code, complexity, duplication) by refactoring source code. Never uses suppression comments or fallow config edits. Trigger on: 'fix fallow', 'fix all fallow warnings', 'fix fallow findings', 'make fallow green', 'zero fallow findings'."
---

# Fallow Fix

Fix every fallow finding by refactoring source code. No `fallow-ignore` comments. No fallow config changes.

## Before starting

Load the `fallow` skill (if available) for detailed fallow CLI docs, issue types, and workflow recipes. This skill covers the fix loop only.

## Tooling

Always run fallow via `npx fallow ...`. Never install fallow globally (`npm i -g fallow`). Never install it as a project dependency.

## Process

### 1. Run full fallow scan

```bash
npx fallow --format json --quiet 2>/dev/null || true
```

Parse JSON output with `node -e` or a proper JSON parser — do NOT `cat` or `Get-Content` the file, because the JSON line is truncated at 2000 chars when printed to terminal. The `health.findings` section lives at the end and is the first part lost.

Extract all:
- `check.total_issues` — dead code
- `health.findings` — complexity (separate from `total_issues`)
- `health.refactoring_targets` — structural suggestions (informational only)
- `dupes.stats.clone_groups` — code duplication
- fallow exit code

### 2. Exit if green

`check.total_issues === 0` alone is NOT green — `health.findings` is a separate axis and can be non-zero when `total_issues` is 0.

Green requires ALL of:
- `check.total_issues === 0` (dead code)
- `health.findings.length === 0` (complexity — ALL severities, including `moderate`)
- `dupes.stats.clone_groups === 0` (duplication)
- fallow exit code `0`

`health.refactoring_targets` are NOT part of green — they are informational suggestions that don't affect exit code or finding counts. Do not block green on them.

### 3. Report refactoring targets (informational only)

`health.refactoring_targets` are structural suggestions based on churn and coupling, not violations. They never block green.

For each target:
1. Check if the target file is in-scope for the current task (modified by the diff or directly related)
2. If in-scope: evaluate and apply the recommended refactoring
3. If out-of-scope: report it for awareness, do not refactor

If a recommendation is clearly wrong (false positive), explain why and skip it regardless of scope.

### 3. Fix dead-code findings (if any)

**Unused exports** — Run `npx fallow fix --dry-run --format json --quiet 2>/dev/null || true` to preview. Then `npx fallow fix --yes --format json --quiet 2>/dev/null || true` to apply.

**Unused dependencies** — Verify the dependency is truly unused (check `package.json` scripts, config files like `.eslintrc`/`eslint.config.*`, `vitest.config.*`, CI configs, `.mjs`/`.cjs` scripts at repo root). If truly unused, remove from `package.json`. If used by tooling, do not remove.

**Other dead-code types** — Read the file, verify the finding is correct, then remove the unused code.

### 4. Fix complexity findings

For each `health.findings[]` with `severity !== "none"`:

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

Review `health.refactoring_targets`. If any target file was modified by the current diff, evaluate the suggested refactoring. Apply it if it improves the code without scope creep. If the target is outside the diff scope (pre-existing code), report it but do not refactor — it's a separate task.

### 7. Re-run fallow

After fixing each group of findings, re-run fallow. Repeat until zero findings. Log what was fixed.

### 8. Verify

Run `npx tsc --noEmit` and the project's test command after all fixes to confirm no breakage.

### 9. Summary output

After each fix cycle, print: `findings fixed: <N>, refactoring targets remaining: <M>`. After zero findings, list any remaining refactoring targets that were outside diff scope.
