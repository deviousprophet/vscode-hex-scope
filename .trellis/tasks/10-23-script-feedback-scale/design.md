# Design: script feedback and scale

## Write summary

The webview owns the before/after bytes and the save lifecycle, so keep the summary there:

```ts
interface ScriptWriteSummary {
    scriptPath: string;
    writes: Array<[number, number]>;
    before: Array<[number, number]>;
    status: 'saving' | 'saved' | 'failed';
    error?: string;
}
```

- On `scriptWritesCommit`, compute the mapped range and capture `before` from the current reader,
  stage the transaction, show the summary with `saving`, then call `saveEdits`.
- On `savedEdits`, mark the matching summary `saved`; on the existing save-error path, mark
  `failed`.
- Render one compact line in the result block: `Saved 4 bytes at 0x08000000–0x08000003 ·
  before AA BB · after DE AD · Ctrl+Z to undo`. No before/after when the range is large; show
  first/last byte plus a count.
- Keep the prompt note, but the result owns the outcome.

## Details surface

Add an expandable details row per card (not a modal):

- Roles (job labels), capabilities, exported entries, fingerprint (short hash), last run,
  active grants (count), usages (count).
- Buttons: Open, Copy path, Reveal, Manage permissions.
- Details are derived; no persistence. A card-level chevron keeps the row compact.

## Search and filtering

- Add a compact filter bar above groups: text input + kind chips (`All`, `Actions`, `Providers`).
- Filtering hides cards rather than re-rendering the list, so result areas and run history survive.
- Hide a group when it has no visible cards; show a one-line “No matches” state.
- Keep the filter in panel-local memory (session).

## Live discovery

- Host watches `.hexscope/scripts/**/*.{js,ts}` (non-recursive) with
  `vscode.workspace.createFileSystemWatcher` and a 250 ms debounce.
- Rescan and post `scriptInfo`; preserve result areas by path.
- Dispose the watcher with the session.
- Manual Refresh remains.

## TypeScript decision

Choose **JS-first**, not bundling esbuild in this rework:

- `.ts` Run stays disabled when the compiler is unavailable, but the card/details show an
  actionable row: “TypeScript needs esbuild. Open setup guide” and “Create JavaScript version”.
- “Create JavaScript version” copies the file to a `.js` sibling only if it does not exist, with
  a header comment explaining the conversion is manual. It does not rewrite the source.
- Document JavaScript as the supported path for installed extensions.
- Revisit bundling as a separate task if demand justifies the package size.

## Last run

Store per path in the panel: timestamp + terminal state (`success`, `error`, `timeout`,
`cancel`, `contract`). Render in the tooltip/details; keep the status dot as the glance signal.

## Tests

- Write summary success/failure, large-range truncation, undo still works.
- Details render roles/caps/entries/fingerprint and no secrets.
- Filter hides cards and preserves result DOM; groups hide when empty.
- Watcher debounce/rescan and result preservation.
- TS unavailable shows the actionable row; no silent disabled-only tooltip.
