# Rework Scripts — Technical Design

## Scope

Collapsible run-history (latest open, older one-line headers), true `disabled` run buttons while another runs, capability confirmation gate replacing inline emoji badges.

## Ownership

| layer | change |
|---|---|
| `scriptsPanel.ts` | result area renders run-history blocks: latest expanded; older collapsed rows with header (run #n · time · status ✓/✕) + expand toggle (existing `.script-output-block.collapsed` pattern). Run button: real `disabled` attr + tooltip when blocked; remove fake aria-disabled/blocked-run-click message path (keep `onBlockedRun` just in case? remove unused). Capability gate: state map `confirmedCapabilities: Set<path>`; first run of script with capabilities → confirm dialog (host overlay or inline confirm) listing caps; accept → run + persist per-script in session; decline → no run. |
| `scriptsPanel.css` | run-history header row style; collapsed-run row (one line, dim, status glyph); disabled button styling comes from `.sb-btn:disabled`; remove `capBadges`/`.script-cap` if unused. |
| host `hexViewer.ts` | if dialog needs host chrome, a new callback `onConfirmCaps?: (script, caps) => Promise<boolean>` — prefer panel-local inline confirm (no host change) unless UX demands native modal. |
| `scriptsPanel.test.ts` | history collapse behaviors; disabled attr; gate accept/decline. |

## Data flow

- History model: keep array of run records per path `{id, at, status, blockEl}`; render latest full, older headers. Rerun appends + collapses prior. No persistence (session only).
- Blocked: `otherRunning` → set `disabled` + `title = 'A script is already running'`; no click handler needed (native disabled swallows) → remove `onBlockedRun` toolbar status usage for run buttons (keep toolbar status for other cases or remove).
- Capability gate: capabilities already on `ScriptInfo`; gate before `runScript` when `capabilities.length>0 && !confirmed`. Confirm UI: small inline panel above results (or dialog). Declined → status stays idle.

## Rendered DOM sketch

```
card
  info: [dot] name [ext] [▷ run]
  result-area
    block(latest, open): "Done ✓ [−]"    output...
    row(older): "run #2 · 14:03 ✕ [▶]"   ← collapsed, expandable
```

## Compatibility / rollback

- `ScriptInfo`/callbacks unchanged except blocked-run message; run/cancel state machine (running/pending/spin) preserved.
- Confirmation persisted in-session only; re-confirm after panel remount (matches no-persistence rule).

## Risks

| risk | mitigation |
|---|---|
| Real disabled removes click-to-message teaching | tooltip (native) + disabled styling carries explanation |
| History array unbounded | cap at e.g. 5 collapsed rows per script + "clear results" per card (dropdown: Clear results) |
| Gate blocks automated runs | gate only interactive first-run; host-initiated runs (if any) bypass |
| capBadges removal loses pre-run glance info | info now at decision moment per decision; tooltips on scripts keep listing caps in card title? no — keep clean |