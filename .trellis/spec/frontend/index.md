# Hex Scope Development Specs

Project-specific contracts for the VS Code extension host, direct-DOM webview, and runtime-neutral TypeScript core.

## Cross-Cutting Guides

| Spec | Owns |
|---|---|
| [Frontend and Core Architecture](./directory-structure.md) | Runtime/module placement, deep module seams, dependency direction |
| [DOM Rendering and Interaction](./component-guidelines.md) | HTML rendering, listener wiring, rerenders, accessibility |
| [State, Persistence, and Invalidation](./state-management.md) | Shared state owners, protocol flow, derived state, storage scope |
| [Type and Validation Contracts](./type-safety.md) | Discriminated unions, boundary normalization, numeric/address rules |
| [Quality and Test Contracts](./quality-guidelines.md) | Required checks, test placement, coverage expectations |

## Feature Code-Specs

| Spec | Owns |
|---|---|
| [Firmware Document Formats](./document-formats.md) | IHEX/SREC parse, segments, serialization, checksum repair |
| [Editor Session and Protocol](./editor-lifecycle.md) | Activation, provider/session lifecycle, host-webview messages |
| [Memory, Record, and Navigation](./memory-navigation.md) | Addressed memory, gaps, virtual scroll, records, segments, labels |
| [Search, Selection, Inspector, and Byte Tools](./search-inspect-copy.md) | Search modes, cancellation, selection, decode, context copy/analyze |
| [Editing, Save, and External Change](./editing-save-external-change.md) | Transactions, undo, save confirmation, file-change conflicts |
| [Integrity Checks and Profiles](./integrity-checks.md) | Algorithms, ranges, stored comparison, fixes, profiles |
| [Struct Definitions, Decode, Pins, and Persistence](./struct-model.md) | Layout, validation, C text, decode, pins, migration |
| [Struct Instance Display](./struct-instance-display.md) | Struct row rendering, pointers, selection, menus, accessibility |
| [Scripting Support](./scripting.md) | Script runner, vm sandbox, ScriptHost adapter, API surface, sidebar UI |

## Pre-Development Checklist

1. Read [Frontend and Core Architecture](./directory-structure.md).
2. Read the feature code-spec for every touched flow.
3. Read [State, Persistence, and Invalidation](./state-management.md) plus [Type and Validation Contracts](./type-safety.md) for protocol/persistence/model changes.
4. Read [DOM Rendering and Interaction](./component-guidelines.md) for webview UI changes.
5. Read [Quality and Test Contracts](./quality-guidelines.md) before writing tests or finishing.

## Quality Check

- Confirm each changed behavior still has one owning module and one authoritative contract.
- Run `npm run check-types`, `npm run lint`, and `npm test`.
- Update the owning feature spec when signatures, payload fields, validation errors, persistence, or visible behavior change.

All specs are English, source-backed, and describe current behavior. Unsupported/future behavior is labeled explicitly; it is not an implementation promise.
