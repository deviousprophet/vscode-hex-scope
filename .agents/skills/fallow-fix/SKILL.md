---
name: fallow-fix
description: "Fix all fallow findings (dead-code, complexity, duplication) by refactoring source code. Never uses suppression comments or fallow config edits. Trigger on: 'fix fallow', 'fix all fallow warnings', 'fix fallow findings', 'make fallow green', 'zero fallow findings'."
---

# Fallow Fix

Fix every fallow finding by refactoring source code. No `fallow-ignore` comments. No fallow config changes.

## Process

### 1. Run full fallow scan

```bash
npx fallow --format json --quiet 2>/dev/null || true
```

Parse JSON output. Record `check.total_issues`, `dupes.stats.clone_groups`, and each `health.findings[]` entry.

### 2. Exit if green

If `check.total_issues === 0`, `dupes.stats.clone_groups === 0`, and `health.findings.length === 0` → report "all green" and stop.

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

### 6. Re-run fallow

After fixing each group of findings, re-run fallow. Repeat until zero findings. Log what was fixed.

### 7. Verify

Run `npx tsc --noEmit` and the project's test command after all fixes to confirm no breakage.
