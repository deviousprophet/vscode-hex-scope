# PRD — Extract external-change banners into self-contained component

## Origin
Child of `08-03-webview-component-refactor` (issue #151: "Refactor webview UI into self-contained components"). ACs: per-component `.ts`+`.css`, colocated styles, shared styles only global, no functional/visual change.

## Problem
`externalChangeUi.ts` (166 lines) mixes two concerns with no colocated CSS: (1) three external-change banners (conflict/reload/error) rendered at `#app` top; (2) an app-wide lock-state (disable/enable interactive elements in `#main-area`/`#toolbar`). Banner CSS lives in shared `styles/toolbar.css`. Untested, coupled to composition root.

## Goal
Self-contained `ExternalChange` component owning the three banner renderers + their dismiss wiring + colocated banner CSS. Lock-state split out to a small host util. Host owns reload/repair/view logic + lock-state transitions.

Structure:
```text
src/webview/components/ExternalChange/
    ExternalChange.ts    class ExternalChange (showConflict/showReload/showError/clearAll) + pure inner render fns
    ExternalChange.css   .ext-*-banner/.ecb-*/.erb-*/.eeb-* rules (moved verbatim from toolbar.css)
src/webview/lock.ts      host util: updateExternalChangeLockState + disable/enable interactive elements
```

## Design decisions (locked in planning grills)
- **Scope (Q1-A):** component = 3 banners only. Lock-state is host/util behavior, NOT part of component.
- **API (Q2-A):** `class ExternalChange { showConflict(incoming, count, onReload); showReload(incoming, onReload); showError(errors, malformed, canRepair, onRepair, onViewText); clearAll() }`. Each show removes prior same-kind banner + prepends `#app`.
- **Root/CSS/mount (Q3-A):** renders into host-provided `#app` (prepend, byte-identical placement); colocated `ExternalChange.css`; no persistent `mount()` — dismiss buttons wired per-banner (remove + callback).
- **Lock-state home (Q4-B):** `externalChangeUi.ts` fully absorbed into component; lock-state extracted to `src/webview/lock.ts` util host calls.
- **Host wiring (Q5-A):** hexViewer creates module-level `const externalChange = new ExternalChange()`; calls `showConflict/showReload/showError` from message handlers; lock-state via `lock.ts`.
- **CSS (Q6-A):** single `ExternalChange.css` holding all banner rules; `toolbar.css` keeps nothing banner-related.
- **Dismiss wiring (Q7-A):** conflict/reload buttons remove-then-callback; error buttons callback-only (host reload flow), parity preserved.

## Scope
In:
- `src/webview/components/ExternalChange/ExternalChange.ts` + `ExternalChange.css`.
- `src/webview/lock.ts` — lock-state util (moved from externalChangeUi.ts).
- `hexViewer.ts` — replace `externalChangeUi.ts` imports with `ExternalChange` instance + `lock.ts`.
- `styles/toolbar.css` — banner rules moved to `ExternalChange.css`.

Out:
- Lock-state folded into component — stays host util.
- Renaming existing banner DOM ids/classes — byte-identical.

## Acceptance Criteria
- [ ] `components/ExternalChange/ExternalChange.ts` + `ExternalChange.css` exist; component owns 3 banner renderers + dismiss wiring + banner styles. Zero `S` reads; no reload/repair/logic.
- [ ] Renders 3 banner types byte-identical (same ids `ext-conflict-banner`/`ext-reload-banner`/`ext-error-banner`, classes `.ext-conflict-banner`/`.ext-reload-banner`/`.ext-error-banner`/`.ecb-*`/`.erb-*`/`.eeb-*`, same text incl entity icons) as pre-refactor; inserted at `#app` top.
- [ ] Dismiss: conflict/reload remove banner + call host `onReload`; error calls `onRepair`/`onViewText` (no remove) — parity.
- [ ] `externalChangeUi.ts` deleted; lock-state extracted to `src/webview/lock.ts`, behavior identical.
- [ ] `styles/toolbar.css` banner rules moved verbatim to `ExternalChange.css`.
- [ ] `npm run lint`, `npm run check-types`, `npm run test` pass. Fallow green.
- [ ] No functional/visual change to external-change banners or lock-state in the running extension.