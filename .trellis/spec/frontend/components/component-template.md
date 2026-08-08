# Component Spec Template — `<ComponentName>`

> **Naming rule:** every webview component spec lives at `.trellis/spec/frontend/component-<name>.md` (e.g. `component-search-bar.md`, `component-hex-view.md`). Use this file as the starting point for a new component's spec: copy it, rename to `component-<name>.md`, fill every section, add it to `index.md`, and delete nothing you didn't answer.

## Scope / Trigger

Owns `src/webview/components/<ComponentName>/<ComponentName>.ts` + `<ComponentName>.css`: the self-contained UI unit that owns its markup, UI state, input behaviours, and styles. Host (`hexViewer.ts`) owns data, domain logic, and persistent state.

Boundary rule: each component owns its markup, UI state, input behaviours, and styles as one unit. The component never reads/writes the `S` global, never calls feature/engine functions, and never posts provider messages — it reports through callbacks the host wires.

## Layout

```text
src/webview/components/<ComponentName>/
    <ComponentName>.ts       types + pure render fn(s) + interaction controller class
    <ComponentName>.css      colocated styles (imported from the .ts; bundled via esbuild)
src/webview/<host>.ts        host wiring (render input, callbacks, state)
src/test/webview/components/<component-name>.test.ts   (mocha + jsdom)
```

> **Test location:** component tests live under `src/test/webview/components/` (mirrors the source `src/webview/components/` directory). Use that path for every component test.

## Contract

```typescript
// exported types + class shape; fill with the real signatures
interface <ComponentName>RenderInput { /* declarative paint state the host feeds */ }
interface <ComponentName>Callbacks { /* report-only; host decides */ }
export function render<ComponentName>Html(input: <ComponentName>RenderInput): string;  // pure
export class <ComponentName> {
    constructor(rootSelector: string, cb?: <ComponentName>Callbacks);
    mount(): void;                                             // idempotent, document-delegated, root-scoped
    setCallbacks(cb: <ComponentName>Callbacks): void;
    // host-invoked state repaints:
    // paintX(...), scrollTo(...), etc.
}
```

## Rules

- Component holds only **UI/transient state** (hover, drag range, display flags it owns). Persistent/domain state lives in the host.
- Component reads no `S`, writes no `S`. Host seeds on construction and syncs shared state from callbacks when other renderers depend on it.
- Pure render fn(s) are DOM-free and jsdom-testable; all paint decisions are inputs.
- Interaction = report via callbacks; component never mutates `S` or selection state directly.
- Root-scoped (constructor `rootSelector`, no global DOM ids) so diff-view/multi-instance reuse is free later. No diff-specific features added now.
- Markup is byte-identical to pre-refactor (same ids/classes/attributes); host never writes component cell DOM directly (component exposes `paint*` methods for transient mutations).
- Component CSS colocated + imported; zero size math in TS (sizing from CSS tokens).
- Untrusted/user text escaped with `esc()` from `src/webview/utils.ts`.

## Behaviour

- User-visible behaviour matrix; document parity guarantees vs pre-refactor.
- Small additive features permitted only when explicitly requested; default state must be byte-identical.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| ... | ... |

## Tests Required

`src/test/webview/components/<component-name>.test.ts` (mocha + jsdom + cssImportHook): pure render, interaction reports, paint methods, root scoping. Existing `webview.test.ts` assertions touching the component must pass unchanged (parity gate).

## Anti-patterns

- Component importing `S`, `state.ts`, engine functions, or `postProviderMessage`.
- Host writing component DOM directly instead of a `paint*` method.
- Global DOM-id queries inside the component.
- Size/layout math in TS instead of CSS.
- Diff-view-specific features (side, mirror, multi-panel) added before the diff task exists.
