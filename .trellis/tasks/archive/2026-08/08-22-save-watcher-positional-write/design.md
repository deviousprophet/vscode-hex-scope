# Design — watcher horizon + positional writes

## Q2 — Watcher horizon (hexEditorSession.ts)

```
module scope: let lastSelfWriteAt = 0;
const SELF_WRITE_HORIZON_MS = 1000;

markSelfWrite(): void            { lastSelfWriteAt = Date.now(); }
onExternalChange(): void {
    if (Date.now() - lastSelfWriteAt < SELF_WRITE_HORIZON_MS) { return; }
    clearTimeout(reloadTimer); reloadTimer = setTimeout(…existing full reload…);
}
```
- `suppressReload` boolean removed; `markSelfWrite()` called in `saveEdits`
  (after write), `repairAndReload`, and `writeRawAndReparse`.
- Multiple FS events per write all land inside the horizon → ignored. A genuine
  external save within 1 s of ours is ignored (documented, rare).

## Q3 — Positional writes

### core/document.ts
```
export interface SplicePatch { offset: number; bytes: Uint8Array }
export interface SplicePlan {
    newRaw: string;
    patches: SplicePatch[] | null;   // null => caller must write newRaw whole
}
export function buildSplicePlan(raw, edits, format): SplicePlan
```
- Reuses the existing line scan (intelOwnerLines / srecOwnerLines). During the
  scan, track cumulative byte offset: `byteOffset += line.length + eolLen`
  (eolLen = 1 or 2). For each rebuilt same-length line: push
  `{ offset: byteOffsetAtLineStart, bytes: utf8(bytes) }`. If the rebuilt
  length ≠ original length, or any scanned line contains `/[^\x00-\x7F]/`
  (non-ASCII), clear the patch list and stop collecting (fallback).
- `spliceEditedLines(raw, edits, format)` becomes `buildSplicePlan(...).newRaw`
  (single implementation; existing tests unchanged by construction).

### hexEditorSession.ts saveEdits
```
const plan = buildSplicePlan(raw, editMap, format);
if (plan.patches) { await writeSplices(document.uri, plan.patches); }
else              { await vscode.workspace.fs.writeFile(document.uri, encode(plan.newRaw)); }
raw = plan.newRaw;
foldEditsIntoSegments(parseResult.segments, editMap);
currentGeneration = ++generation;
markSelfWrite();
post savedEdits { generation };
```

### writeSplices (host, node:fs)
```
const fh = await fs.promises.open(uri.fsPath, 'r+');
try { for (const p of patches) await fh.write(p.bytes, 0, p.bytes.length, p.offset); }
finally { await fh.close(); }
// on any error: caller catches → whole-file writeFile(plan.newRaw)
```
- Patches cover only the edited line text (no EOL), so total byte count is
  unchanged. ASCII-only plan guarantees `line.length` (chars) == byte length.

## Parity guarantee
- Positional path must produce the identical file as the full-write path:
  enforced by the plan sharing one scan/rebuild implementation plus a parity
  test (positional chunks reassembled == newRaw).

## Files touched
- `src/core/document.ts` (+ tests in `src/test/core/document.test.ts`)
- `src/hexEditorSession.ts`

## Compatibility / Rollback
- Behavior additive within save path; horizon replace removes suppressReload
  (internal). Rollback: revert both.