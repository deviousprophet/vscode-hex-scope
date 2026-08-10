# Component Spec G�� ExternalChange

> Built from `component-template.md`. Owns the external-change banners as a self-contained presentational component.

## Scope / Trigger

Owns `src/webview/components/externalChange/externalChange.ts` + `externalChange.css`: the three external-change banners (conflict / reload / error) rendered at the top of `#app`. Host owns reload/repair/view logic and lock-state transitions. Lock-state (disabling interactive elements) is a separate host util (`src/webview/lock.ts`), NOT part of this component.

Boundary rule: the component owns banner markup, per-banner dismiss wiring, and styles. It never reads/writes `S`, never reloads/repairs files, never mutates `IncomingFile` G�� it renders and reports.

## Layout

```text
src/webview/components/externalChange/
    externalChange.ts   class ExternalChange (showConflict/showReload/showError/clearAll/clearError)
    externalChange.css  .ext-*-banner/.ecb-*/.erb-*/.eeb-* rules (moved from styles/statsBar.css, ex toolbar.css)
src/webview/lock.ts     host util: lock-state disable/enable (NOT component)
src/webview/hexViewer.ts   host wiring
src/test/webview/components/externalChange.test.ts  (mocha + jsdom)
```

## Contract

```typescript
import type { IncomingFile } from '../appModel';

export class ExternalChange {
    constructor();   // renders into host-provided #app
    showConflict(incoming: IncomingFile, unsavedEditCount: number, onReload: (incoming: IncomingFile) => void): void;
    showReload(incoming: IncomingFile, onReload: (incoming: IncomingFile) => void): void;
    showError(
        checksumErrors: number,
        malformedLines: number,
        canQuickRepair: boolean,
        onRepair: () => void,
        onViewText: () => void,
    ): void;
    clearAll(): void;   // remove all three banner ids
    clearError(): void; // remove only the error banner
}
```

## Rules

- **Three banner types**, each: removes its own kind's prior banner, builds byte-identical markup, `document.getElementById('app')!.prepend(banner)`.
- **Dismiss parity:** conflict/reload buttons G�� `banner.remove()` then host `onReload(incoming)`; error buttons G�� host `onRepair()`/`onViewText()` only (host reload flow removes the banner).
- **Host never writes banner DOM** G�� uses `clearAll()`/`clearError()`.
- **Lock-state is NOT in this component** G�� `src/webview/lock.ts` (`updateExternalChangeLockState` + disable/enable of `button/input/[role=button]` in `#main-area`/`#toolbar`, `data-was-enabled` round-trip). Host owns lock-state transitions.
- Markup byte-identical to pre-refactor (ids `ext-conflict-banner`/`ext-reload-banner`/`ext-error-banner`/`ecb-reload`/`erb-reload`/`eeb-repair`/`eeb-view-text`, classes `ecb-*`/`erb-*`/`eeb-*`); untrusted count/message escaped via `esc()` (conflict/reload innerHTML) or `textContent` (error).

## Behaviour

- Conflict: `#ext-conflict-banner.ext-conflict-banner` G�� G�� icon, "File changed externally. You have N unsaved edit(s). Changes must be reloaded.", "Reload & discard my edits" button G�� remove + `onReload`.
- Reload: `#ext-reload-banner.ext-reload-banner` G�� =��� icon, "File changed externally. Reloading...", "Reload" button G�� remove + `onReload`.
- Error: `#ext-error-banner.ext-error-banner` G�� G�� icon, "File changed externally and is now invalid: N checksum error(s) and/or N malformed line(s)", "Quick Repair & reload" (`canQuickRepair`) else "View in text editor" G�� `onRepair`/`onViewText`.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Show while same kind visible | Prior same-kind banner removed first. |
| Conflict/Reload dismiss | Banner removed, host callback invoked with `incoming`. |
| Error dismiss | Host callback only; host reload flow clears banner. |
| Lock on | `#app` gets `locked-due-to-external-change`; interactive elements in lockable roots disabled (`data-was-enabled` records each element's actual prior enabled state). |
| Lock off | Elements restored to their prior enabled state (`data-was-enabled` snapshot, not force-enabled); marks cleared. |

## Tests Required

`src/test/webview/components/externalChange.test.ts` (mocha + jsdom + cssImportHook): render parity per banner (ids/classes/text incl entity icons), dismiss wiring (conflict/reload remove + callback; error callback-only), show-replaces-same-kind, clearAll removes all three, clearError removes only error, lock.ts disable/enable round-trip. Existing `webview.test.ts` external-change assertions pass unchanged (parity gate).

## Anti-patterns

- Component reading `S`/`state.ts`, reloading/repairing files, mutating `IncomingFile`.
- Host writing banner DOM directly (must use `clearAll`/`clearError`/`show*`).
- Folding lock-state into the component (it is cross-app host behavior in `lock.ts`).
- Renaming banner ids/classes.
