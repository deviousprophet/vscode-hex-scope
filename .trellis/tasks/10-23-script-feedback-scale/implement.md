# Implement: script feedback and scale

## Before coding

1. Read the `scriptWritesCommit`/`savedEdits` flow in `hexViewer.ts`, the save error path, and the
   Scripts panel result rendering.
2. Read the Scripts panel card/filter surface; keep result areas intact when filtering.
3. Confirm the host session disposables for a file watcher.

## Checklist

- [ ] 1. Capture before/after and a write summary in the webview; render `saving`/`saved`/`failed`
      with range, bytes, and undo guidance.
- [ ] 2. Add the expandable details row with roles, capabilities, entries, fingerprint, last run,
      grants count, and actions.
- [ ] 3. Add search + kind filter using hide/show, group hiding, and a no-match state.
- [ ] 4. Add the `.hexscope/scripts` watcher with debounce/rescan and result preservation.
- [ ] 5. Implement the JS-first TypeScript decision: actionable setup/help and create-JS-version.
- [ ] 6. Add last-run timestamp/state storage and render it.
- [ ] 7. Add tests for summary states, details, filtering, watcher, and TS path.
- [ ] 8. Update docs/specs and run gates.

## Validation commands

```bash
npm run check-types
npm run check-examples
npm run lint
npm test
```

Manual checks:

- approve a write: summary shows range/before/after, then saved; Ctrl+Z restores.
- force a save failure: summary shows failed, not saved.
- filter to Providers: actions disappear, provider results remain when switching back.
- edit a script on disk: list refreshes without a tab switch.
- `.ts` without compiler: setup/create-JS actions are visible.

## Review gates

- Gate A after step 2: write summary and details reviewed.
- Gate B after step 4: filtering/watcher preserve results.
- Gate C after step 7: TS decision and tests.
- Gate D after step 8: gates/docs.

## Rollback points

- The summary/status is additive; reverting leaves the original result notice.
- Filtering is presentation-only; reverting restores the full list.
- The watcher can be disabled while keeping manual Refresh.
