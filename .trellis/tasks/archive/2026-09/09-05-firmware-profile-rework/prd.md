# Parent: Firmware profile rework (#212)

## Goal

Implement issue #212 improvements for firmware profiles in Hex Scope: no eager
profile creation on open, reusable profile annotations shared across files, a
workspace-wide struct type pool, file-to-profile bindings that survive rename,
and the external-change false-positive fix.

## Source requirements

GitHub issue #212 (`gpxricky`) + `firmware_profile.md` (working spec). Labels:
bug + enhancement. Maintainer `deviousprophet` self-assigned.

1. Opening a HEX file must never auto-create a firmware profile (bare read-only
   open writes nothing to disk).
2. Renaming/moving a firmware file must not orphan its annotations (auto-heal or
   one-click reselect; no data recreated).
3. Struct type definitions must be shareable across files/variants
   (workspace-wide pool).
4. An existing profile must be reusable against any other file, including files
   outside the workspace (explicit select/new/tune profile).
5. Out-of-workspace opens must not flood the filesystem with `.hexscope/` folders.
6. Intermittent "File changed externally. Reloading..." false-positives on
   out-of-workspace files must not recur.

## Child task map

| Child | Deliverable | Status |
|---|---|---|
| `09-05-p0-eager-profile` | Defer profile creation until first write (#1, #5); regression tests | archived (d6b5967) |
| `09-05-p1-struct-pool-profiles` | Three-tier storage: workspace struct pool, profile registry, bindings; Select Profile dropdown; CRUD; migration; schemas/docs (#2, #3, #4) | archived (c2890ed + d37d1a4) |
| `09-05-p2-external-change` | Verify #6 resolved after P0/P1; regression guard | archived (4b159ff) |

## Cross-child acceptance criteria

- [ ] Bare open of any HEX/SREC (in- or out-of-workspace) + close with no edits
      leaves zero new files/directories.
- [ ] First per-file edit or explicit profile action is the only thing that
      creates a profile/binding; out-of-workspace never seeds `.hexscope/` unless
      explicit.
- [ ] Two+ files can share one profile via Select Profile; struct types come from
      one workspace pool.
- [ ] VS Code rename auto-heals the binding; missed rename → one-click reselect;
      delete removes/prunes bindings.
- [ ] Full profile CRUD works independent of any open file; shared-profile editor
      hint shown when >1 file bound.
- [ ] Legacy `firmware_profiles/*` + Memento data migrate without loss; idempotent.
- [ ] Schemas `structs/profile/bindings`, `contributes.jsonValidation`, and
      `docs/HEXSCOPE_STORAGE.md` updated; `index`/`integrity` schemas retired.
- [ ] No spurious external-change on out-of-workspace opens (regression-guarded).
- [ ] check-types, lint, and the full test suite are green.

## Notes

- Design decisions live in `firmware_profile.md` and each child's
  `design.md`/`implement.md`. Parent runs the final integration review; it is
  not an additional implementation target.