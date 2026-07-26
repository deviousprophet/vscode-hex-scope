# Fix post-review issues

## Findings

1. `chunks.reduce` O(n²) — replace with `let totalSize = 0` accumulator
2. No `.catch()` on `result.then()` in `handleApi`
3. `abort` listener leaks when `finish()` reached via other path
4. `Buffer` in sandbox exposes `Buffer.allocUnsafe()`
5. `ScriptInfo.trusted?` per-script field is speculative (uniform)
6. `buildAPI` returns `Record<string, unknown>` instead of `HexScopeAPI`
7. No fetch integration test
8. No exec hardening test
