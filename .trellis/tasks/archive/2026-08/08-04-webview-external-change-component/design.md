# Design — ExternalChange component extraction

## Component contract

```ts
// src/webview/components/ExternalChange/ExternalChange.ts

export class ExternalChange {
    constructor();                       // no args; renders into host-provided #app
    showConflict(incoming: IncomingFile, unsavedEditCount: number, onReload: (incoming: IncomingFile) => void): void;
    showReload(incoming: IncomingFile, onReload: (incoming: IncomingFile) => void): void;
    showError(
        checksumErrors: number,
        malformedLines: number,
        canQuickRepair: boolean,
        onRepair: () => void,
        onViewText: () => void,
    ): void;
    clearAll(): void;                    // remove all three banner ids
    clearError(): void;                  // remove only the error banner (host update path)
}
```

## Rendering

- Conflict banner: `#ext-conflict-banner.ext-conflict-banner` — icon `&#9888;` (⚠), msg `File changed externally. You have <strong>{count}</strong> unsaved edit(s). Changes must be reloaded.` (count escaped), button `#ecb-reload.ecb-btn.ecb-reload` "Reload & discard my edits". `esc()` on user-text.
- Reload banner: `#ext-reload-banner.ext-reload-banner` — icon `&#128260;`, msg "File changed externally. Reloading...", button `#erb-reload.erb-btn.erb-reload` "Reload".
- Error banner: `#ext-error-banner.ext-error-banner` — icon `\u274C`, msg "File changed externally and is now invalid: <strong>N checksum error(s) and/or N malformed line(s)</strong>", action `#eeb-repair.eeb-btn.eeb-repair` "Quick Repair & reload" when canRepair else `#eeb-view-text.eeb-btn.eeb-view-text` "View in text editor". Error built via `createElement`/`textContent` (auto-escaped).
- Insertion: `document.getElementById('app')!.prepend(banner)` — byte-identical position vs pre-refactor.
- Each show first removes its own kind's prior banner (`#ext-<kind>-banner`).

## Dismiss wiring (parity)

- Conflict/reload buttons: on click → `banner.remove()` → call `onReload(incoming)`.
- Error buttons: on click → call `onRepair()` / `onViewText()` (host reload flow removes banner via reload). No explicit remove — matches current.

## Lock-state util (host)

`src/webview/lock.ts`:
```ts
export function updateExternalChangeLockState(locked: boolean): void;
// internal: disableAllInteractiveElements / enableAllInteractiveElements / forEachLockableRoot
// forEachLockableRoot iterates ['main-area','toolbar']; toggles 'data-was-enabled' + disabled on button/input/[role=button].
```
Moved verbatim from `externalChangeUi.ts`. Host `hexViewer.ts` keeps calling it on lock-state invalidation.

## CSS

- `src/webview/components/ExternalChange/ExternalChange.css` = `.ext-conflict-banner`, `.ext-reload-banner`, `.ext-error-banner`, `.ecb-*`, `.erb-*`, `.eeb-*` (+ related) rules moved verbatim from `styles/stats-bar.css`.
- `styles/stats-bar.css` keeps toolbar-chrome + stats rules only.
- `ExternalChange.ts` imports `./ExternalChange.css` → bundled into `dist/webview.css`.

## Host wiring (hexViewer.ts)

1. `import { ExternalChange } from './components/ExternalChange/ExternalChange'` + `import { updateExternalChangeLockState } from './lock'`.
2. Module-level `const externalChange = new ExternalChange()`.
3. Replace `showExternalChangeConflict/showExternalChangeReloadBanner/showExternalChangeError/removeAllExternalChangeBanners` imports with `externalChange.showConflict/showReload/showError/clearAll`.
4. Lock-state call site unchanged (`updateExternalChangeLockState` from lock.ts).

## Tests

- `src/test/webview/components/external-change.test.ts` (mocha + jsdom + css-import-hook): render parity per banner (ids/classes/text, entity icons), dismiss wiring (conflict/reload remove + callback; error callback-only), show-replaces-same-kind, clearAll removes all three, lock.ts disable/enable round-trip (buttons/inputs disabled + restored).