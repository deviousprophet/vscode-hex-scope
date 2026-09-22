# Fix hex file auto-opening with external-change banner after copy

## Goal

Copying a hex file inside the workspace opens the copy in HexScope and immediately
shows the external-change banner, even though the file did not change. Diagnose and
fix the spurious external change so a freshly opened copy stays clean.

## Background

- HexScope registers a custom editor for `*.hex`/`*.ihex`/… with `priority: option`.
  Once the user picks HexScope as the default for a glob, VS Code opens a copied file
  with it.
- `src/hexEditorSession.ts:825` creates a `FileSystemWatcher` on the document's exact
  filename and wires `onDidCreate` + `onDidChange` to `onExternalChange` (line 831).
- `onExternalChange` reads the file and unconditionally posts an `externalChange` /
  `externalChangeError` message to the webview. It has no guard for (a) the initial
  load not having finished, or (b) the re-read content being identical to what is
  already loaded.
- Reproduced symptom: the file-create event for the copy is delivered to the watcher
  after `resolveCustomEditor` registers it, so `onDidCreate` fires for a file that did
  not actually change.

## Requirements

- A watcher event for the currently open document whose re-read content is identical
  to the loaded content must NOT post an external-change banner.
- A watcher event delivered before the initial load has populated the document must
  NOT post an external-change banner (the initial load already reads current content).
- Genuine external changes (content differs) keep the existing behavior: lock, reload
  or conflict banner, error/repair banner for invalid content.
- Self-writes within the existing 1 s horizon stay ignored.
- No change to `.hexscope/` profile-watcher behavior.

## Acceptance Criteria

- [ ] Opening a freshly copied hex file shows no external-change banner.
- [ ] Reading the same content via the document watcher posts no message.
- [ ] An event arriving before initial load completion posts no message.
- [ ] A real content change still posts `externalChange` (clean) / conflict (dirty).
- [ ] Invalid external content still posts `externalChangeError` with repair option.
- [ ] `npm run check-types`, `npm run lint`, and `npm test` pass.

## Out of Scope

- Changing the custom-editor registration/priority (auto-open on copy is expected).
- The `.hexscope/` three-tier profile watcher.
