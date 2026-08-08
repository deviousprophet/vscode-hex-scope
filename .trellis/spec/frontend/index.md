# Hex Scope Development Specs

Project-specific contracts for the VS Code extension host, direct-DOM webview, and runtime-neutral TypeScript core.

## Cross-Cutting Guides

| Spec | Owns |
|---|---|
| [Frontend and Core Architecture](./directory-structure.md) | Runtime/module placement, deep module seams, dependency direction |
| [DOM Rendering and Interaction](./component-guidelines.md) | HTML rendering, listener wiring, rerenders, accessibility |
| [State, Persistence, and Invalidation](./state-management.md) | Shared state owners, protocol flow, derived state, storage scope |
| [Type and Validation Contracts](./type-safety.md) | Discriminated unions, boundary normalization, numeric/address rules |
| [Quality Test Contracts](./quality-guidelines.md) | Required checks, test placement, coverage expectations, fallow-fix skill |
| [CSS Guidelines](./css-guidelines.md) | File placement, design tokens, selector patterns, button standards |

## Component Code-Specs

Every self-contained webview component has one spec at `components/component-<name>.md` (naming rule; new components copy [component-template.md](./components/component-template.md)). Each spec owns the component's contract, markup parity, interaction, and tests.

| Spec | Owns |
|---|---|
| [Component Template](./components/component-template.md) | Starting point for any new component spec; naming + boundary rules |
| [HexView Component](./components/component-hex-view.md) | Virtualized hex grid: header/rows/gaps/banners, match/sel paint, interaction |
| [Toolbar Component](./components/component-toolbar.md) | Top toolbar chrome: view tabs, ASCII toggle, edit-mode group, SearchBar slot |
| [ExternalChange Component](./components/component-external-change.md) | External-change banners: conflict/reload/error + dismiss wiring |
| [SearchBar Component](./components/component-search-bar.md) | Self-contained search bar UI unit: markup, UI state, input behaviours, styles |
| [RecordView Component](./components/component-record-view.md) | Record table: IHEX/SREC row formatting, paging placeholders, scroll reporting |
| [Sidebar Component](./components/component-sidebar.md) | Generic tabbed sidebar shell: tabs, resizer+persistence, header slot, injected panels |
| [Inspector Component](./components/component-sidebar-inspector.md) | Sidebar Inspector panel: address/values, bit view, multi-byte, segments, labels + form |
| [StructPanel Component](./components/component-sidebar-struct-panel.md) | Sidebar Struct panel: pins/instances + types/editor, decoded rows, pointers, bit layout |
| [IntegrityPanel Component](./components/component-sidebar-integrity-panel.md) | Sidebar Integrity panel: checks + results, auto fix, profile library, fix-all |
| [ScriptsPanel Component](./components/component-sidebar-scripts-panel.md) | Sidebar Scripts panel: script cards, run/cancel state machine, result blocks, output streaming |
| [ContextMenu Component](./components/component-context-menu.md) | Right-click byte menu: copy/analyze/patch, go-address, select |

## Feature Code-Specs

| Spec | Owns |
|---|---|
| [Firmware Document Formats](./document-formats.md) | IHEX/SREC parse, segments, serialization, checksum repair |
| [Editor Session and Protocol](./editor-lifecycle.md) | Activation, provider/session lifecycle, host-webview messages |
| [Memory, Record, and Navigation](./memory-navigation.md) | Addressed memory, gaps, virtual scroll, records, segments, labels |
| [Search Engine](./search-engine.md) | Cancellable/chunked search, modes, match navigation |
| [Selection, Inspector, and Byte Tools](./selection-inspect-copy.md) | Selection ranges, gap-filtered copy/analyze, Inspector decode, byte tools |
| [Editing, Save, and External Change](./editing-save-external-change.md) | Transactions, undo, save confirmation, file-change conflicts |
| [Integrity Checks and Profiles](./integrity-checks.md) | Algorithms, ranges, stored comparison, fixes, profiles |
| [Struct Definitions, Decode, Pins, and Persistence](./struct-model.md) | Layout, validation, C text, decode, pins, migration |
| [Struct Instance Display](./struct-instance-display.md) | Struct row rendering, pointers, selection, menus, accessibility |
| [Scripting Support](./scripting.md) | Script runner, vm sandbox, ScriptHost adapter, API surface, sidebar UI |

## Pre-Development Checklist

1. Read [Frontend and Core Architecture](./directory-structure.md).
2. Read the feature code-spec for every touched flow.
3. Read the component spec for every touched component (`component-<name>.md`); when creating a component, copy [component-template.md](./components/component-template.md) into `component-<name>.md`.
4. Read [State, Persistence, and Invalidation](./state-management.md) plus [Type and Validation Contracts](./type-safety.md) for protocol/persistence/model changes.
5. Read [DOM Rendering and Interaction](./component-guidelines.md) for webview UI changes.
6. Read [Quality and Test Contracts](./quality-guidelines.md) before writing tests or finishing.

## Quality Check

- Confirm each changed behavior still has one owning module and one authoritative contract.
- Run full Fallow scan and fix findings via [`fallow-fix` skill](../.agents/skills/custom/fallow-fix/SKILL.md).
- Run `npm run check-types`, `npm run lint`, and `npm test`.
- Update the owning feature spec when signatures, payload fields, validation errors, persistence, or visible behavior change.

All specs are English, source-backed, and describe current behavior. Unsupported/future behavior is labeled explicitly; it is not an implementation promise.
