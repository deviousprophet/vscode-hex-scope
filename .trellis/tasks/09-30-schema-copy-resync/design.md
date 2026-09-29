# Design — Refresh stale .hexscope/schemas copies

## Boundaries

- `src/hexScopeStorage.ts` — the sink (`writeJson`), the seeding refresher
  (`seedSchemaCopies`), a new URI→root guard, and the now-redundant
  `read.status === 'missing'` seed call in `writeProfileRecord`.
- Tests: `src/test/extension/hexScopeStorage.test.ts`.
- Specs/docs: `.trellis/spec/frontend/hexscope-storage.md`,
  `docs/HEXSCOPE_STORAGE.md`.

## Hook: the single write sink

Every `.hexscope` data write funnels through `writeJson(uri, value)`
(`hexScopeStorage.ts:140`) — registry writes (`writeProfileRecord`/
`removeProfileRecord`/`renameProfileRecord`), `JsonStore.flush` (pool +
registry), bindings writes, and migration. So the refresh hooks there once.

Add a guard:

```ts
/** Root of a top-level .hexscope data file, else null. */
function hexScopeRootFromDataUri(uri: vscode.Uri): string | null {
    if (!isTopLevelDataFile(path.basename(uri.fsPath))) { return null; }   // profiles.json | structs.json | bindings.json
    const hsDir = path.dirname(uri.fsPath);
    if (path.basename(hsDir) !== '.hexscope') { return null; }
    return path.dirname(hsDir);
}
```

and in `writeJson`, after the data write:

```ts
await vscode.workspace.fs.writeFile(uri, encoded);
const root = hexScopeRootFromDataUri(uri);
if (root) { await refreshSchemaCopies(root); }   // best-effort
```

- **Recursion guard (R5):** `refreshSchemaCopies` writes only
  `schemas/*.schema.json`; their basenames are not data files, so
  `hexScopeRootFromDataUri` returns `null` for them → no re-trigger. No flag
  needed, though a comment must state the invariant.
- **Best-effort (R6):** wrap the refresh in `try/catch` and swallow; the data
  write has already succeeded and the copies are tooling-only.

## Refresher (R1, R2, R7)

Replace `seedSchemaCopies`'s writeIfMissing body with a content-diff:

```ts
export async function seedSchemaCopies(root: string): Promise<string[]> {
    const written: string[] = [];
    for (const { schema } of SCHEMA_FILES) {
        const bundled = bundledSchema(schema);
        if (bundled === undefined) { continue; }
        const uri = vscode.Uri.file(path.join(hexScopeSchemasDir(root), schema));
        const onDisk = await readJson(uri);
        const differs = onDisk.status !== 'ok'
            || JSON.stringify(onDisk.value, null, 2) !== JSON.stringify(bundled, null, 2);
        if (differs) { await writeJson(uri, bundled); written.push(schema); }
    }
    return written;
}
```

- Comparison is on parsed values re-stringified with the same `(null, 2)` shape
  `writeJson` emits, so whitespace/key-order noise cannot cause a false
  rewrite, while a real schema change always does.
- Schema files carry no `data` key, so `writeJson`'s `$schema`-sibling injection
  is a no-op for them; `resolveProfileSchemaRef` returns `null`.

## Redundant seed call

`writeProfileRecord`'s `if (read.status === 'missing') { await seedSchemaCopies(root); }`
becomes redundant (the write itself now refreshes). Remove it; the first
materializing write still seeds the copies via the sink. Keeps the "first write
seeds schemas" contract with one code path.

## Failure / ordering

- Refresh runs **after** the data write, so a refresh error can never abort or
  corrupt a data write.
- No ordering dependency on the `$schema` sibling: data files already inject
  their sibling from the write itself.

## Compatibility / rollback

- No on-disk data-format change; only the generated copies are rewritten, and
  only when they differ.
- Rollback: revert the sink hook + refresher; behavior returns to write-once.

## Deliberate simplifications

`ponytail:` reuse the existing `writeJson` sink and `SCHEMA_FILES` table; no
version counter, no manifest file (content-diff cannot go stale).
