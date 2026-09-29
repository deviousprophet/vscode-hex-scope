# Design — Move struct modules into src/core/struct/

## Boundaries

- **Moved** (`git mv`, names unchanged): `src/core/structCodec.ts`,
  `structNormalization.ts`, `structMigration.ts`, `structIdentities.ts`,
  `structBitChildren.ts` → `src/core/struct/`.
- **Unchanged location**: `src/core/types.ts`; all tests; add no barrel.
- **Import-only edits**: host (`hexEditorSession.ts`, `hexScopeMigration.ts`,
  `hexEditorProvider.ts`), webview panel (`structPanel.ts`, `structValueFormat.ts`,
  `structRowRenderer.ts`, `structEditorFields.ts`, `structCPreview.ts`,
  `structBinaryView.ts`, `structPinsModel.ts`), tests
  (`src/test/core/struct.test.ts`, `structNormalization.test.ts`,
  `src/test/extension/hexScopeStorage.test.ts`,
  `src/test/webview/components/sidebar/structPanel/structPanel.test.ts`).
- **Docs**: the 7 spec files + `docs/HEXSCOPE_STORAGE.md`.

## Move mechanics

1. `git mv src/core/struct<X>.ts src/core/struct/struct<X>.ts` for the five.
2. Inside the moved files, `'./types'` → `'../types'` (5 sites).
3. Intra-set specifiers keep working unchanged because the files stay siblings:
   `structNormalization → './structCodec' | './structBitChildren' | './structIdentities'`,
   `structMigration → './structIdentities'`.

## Importer rewrite table (specifier suffix preserved per site)

| Importer | Old | New |
|---|---|---|
| `src/hexEditorSession.ts:21` | `./core/structCodec` | `./core/struct/structCodec` |
| `src/hexEditorSession.ts:20` | `./core/structNormalization` | `./core/struct/structNormalization` |
| `src/hexEditorSession.ts:19` | `./core/structMigration` | `./core/struct/structMigration` |
| `src/hexScopeMigration.ts:18` | `./core/structNormalization` | `./core/struct/structNormalization` |
| `src/hexScopeMigration.ts:17` | `./core/structMigration` | `./core/struct/structMigration` |
| `src/hexEditorProvider.ts:3` | `./core/structMigration` | `./core/struct/structMigration` |
| `.../structPanel/structPanel.ts:22,23` | `../../../../core/structCodec.js` | `../../../../core/struct/structCodec.js` |
| `.../structValueFormat.ts:4,5` | `../../../../core/structCodec.js` | `../../../../core/struct/structCodec.js` |
| `.../structRowRenderer.ts:7,8` | `../../../../core/structCodec.js` | `../../../../core/struct/structCodec.js` |
| `.../structEditorFields.ts:4` | `../../../../core/structCodec.js` | `../../../../core/struct/structCodec.js` |
| `.../structCPreview.ts:3` | `../../../../core/structCodec.js` | `../../../../core/struct/structCodec.js` |
| `.../structBinaryView.ts:3,4` | `../../../../core/structCodec.js` | `../../../../core/struct/structCodec.js` |
| `.../structPinsModel.ts:2` | `../../../../core/structBitChildren` | `../../../../core/struct/structBitChildren` |
| `src/test/core/struct.test.ts:8` | `../../core/structCodec` | `../../core/struct/structCodec` |
| `src/test/core/structNormalization.test.ts:3` | `../../core/structNormalization` | `../../core/struct/structNormalization` |
| `src/test/extension/hexScopeStorage.test.ts:57,58` | `../../core/struct{...}` | `../../core/struct/struct{...}` |
| `.../structPanel.test.ts:11` | `../../../../../core/structCodec` | `../../../../../core/struct/structCodec` |

Counts: 24 specifier rewrites (structCodec 14 incl. one intra-set left as-is → 13 external, structNormalization 4, structMigration 4, structBitChildren 1 external, structIdentities 0) + 5 `./types` rewrites.

## Docs updates

- `directory-structure.md`: tree lines 38–39 to `struct/…` (and add the three
  unlisted struct modules); Deep Module Seams line 90 →
  `src/core/struct/structCodec.ts`.
- `struct-model.md` (7, 141), `struct-instance-display.md` (21),
  `state-management.md` (49, two refs), `component-sidebar-struct-panel.md` (27),
  `hexscope-storage.md` (86), `docs/HEXSCOPE_STORAGE.md` (103, 153).

## Ordering

1. `git mv` the five files.
2. Fix internal `'./types'` → `'../types'`.
3. Rewrite the 24 importer specifiers (host → webview → tests).
4. Update specs/docs.
5. Gates + fallow.

## Compatibility / rollback

- Pure path move; no runtime, schema, or API change. Implementation files still
  compile from `src/` via tsconfig `rootDir`. `hexEditorProvider`'s re-export
  shim preserves the one compatibility surface.
- Rollback: `git mv` back; the import edits are mechanical and reversible.

## Deliberate simplifications

`ponytail:` keep file names, leave tests/types in place, no barrel — the move is
the whole change.
