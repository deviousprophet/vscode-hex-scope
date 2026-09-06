# Parent Integrate: final review + quality gate

## Ordered checklist

1. **Confirm branch state** — `feat/firmware-profile-improve` contains all three
   child commits: d6b5967 (P0), c2890ed + d37d1a4 (P1), 4b159ff (P2). Working
   tree clean of source changes.
2. **Cross-child integration review** — dispatch `trellis-check` over the whole
   branch vs parent `prd.md` AC + `firmware_profile.md` acceptance checklist:
   - R1/R2 three-tier layout on disk, deferred creation, binding lifecycle.
   - Cross-layer data flow: session ↔ storage ↔ migration ↔ webview protocol ↔
     toolbar dropdown ↔ CRUD commands ↔ schemas ↔ docs consistent.
   - No `firmware_profiles`/`index.json`/`integrity.json` reads outside migration.
   - Grep gates (no Memento outside migration; no host-import in `src/core/`).
3. **Validation** — `npm run check-types`, `npm run lint`, `npm test` from clean
   tree; fix any findings on the branch.
4. **Review gate before push (user requirement)** — run the **fallow-fix skill**
   as the final quality gate over the full branch; resolve all findings.
5. **Wrap up** — `task.py finish` parent + archive; record session.

## Validation commands

- `npm run check-types`
- `npm run lint`
- `npm test`

## Rollback points

- Each child commit independent; storage additive (new `.hexscope/` tiers +
  migration) and legacy tree preserved → revert of the three commits restores
  prior behavior.
- Do NOT commit `firmware_profile.md` or `.trellis/tasks/` (task-tracking +
  spec-only inputs, untracked by design in this repo).

## Context manifests

- See child `implement.jsonl`/`check.jsonl`.