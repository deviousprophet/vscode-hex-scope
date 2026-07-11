# Implementation Plan

1. Capture clean git state and hash/checksum of all Fallow config files.
2. Run Fallow fix dry-run, full dead-code, duplication, health, and changed-code audit as JSON.
3. Verify each finding with source/graph evidence; group safe deletions and refactors.
4. Apply fixes without suppression or config changes; add/update focused tests where behavior-bearing seams move.
5. Repeat all Fallow reports until zero warnings/findings; verify config hashes and absence of new suppression tokens.
6. Run type, lint, unit/integration, and performance gates.
7. Update Trellis quality contract, review diff, commit, push, and verify draft PR #94.

Rollback point: keep cleanup in a dedicated commit so it can be reverted independently if a regression appears.
