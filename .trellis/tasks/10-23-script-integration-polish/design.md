# Design: script integration polish

## Usage model

Derive usages from the current bound profile, not from persisted script data:

```ts
type ScriptUsage =
    | { kind: 'integrity'; label: string; checkId: number }
    | { kind: 'address'; label: string; pinId: string }
    | { kind: 'size'; label: string; pinId: string; param: string };
```

- `hexViewer` owns `S` and can read the active check set and type instances; build a map
  `scriptPath -> ScriptUsage[]` and push it to the Scripts panel.
- Rebuild on profile switch, `perFileDataChange`, check edits, and pin edits.
- Do not persist usages. A missing script keeps the usage derived from the configured path so the
  destination can show “Script not found”.

## Card integration

- Provider cards and details show `Used by` counts and labels.
- Clicking a usage invokes a panel callback:
  - integrity -> select/highlight that check (existing Integrity panel method)
  - address/size -> select the instance and expand it (existing Overlay panel method)
- The filename is a button that opens the script; keep the pencil as a secondary affordance.
- Context menu via the existing attached popover/MenuController: Open, Copy path, Reveal in
  Explorer, Show details, Manage permissions.

## Missing/changed scripts

- If a used script is missing: destination row keeps its error and links to the configured path;
  the Scripts panel is not required to show a card.
- If a script changes fingerprint: existing approvals reset; usage links remain.
- Deleting a script updates usage rows and the provider card on the next scan.

## Ownership

- Usage derivation: `hexViewer` (owns S).
- Rendering/actions: Scripts panel.
- Selection/navigation: Integrity/Overlay public methods.
- No new persistence or protocol unless the host must reveal a file (existing `openScript` is
  enough; reveal can reuse a command).

## Compatibility and tests

- No schema change.
- Tests for usage derivation, used-by rendering, click navigation, filename open, context menu,
  last-run display, and missing-script state.
- Keep result areas intact when usages refresh.
