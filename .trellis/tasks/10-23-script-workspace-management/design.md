# Design: script creation and workspace management

## Entry points

- Command `hexScope.manageScripts` registered in `extension.ts`; it resolves the workspace root
  from `workspace.workspaceFolders` and does not require an editor/document.
- Scripts panel **New** split button and empty-state **Create script** open the same templates.
- Integrity/Overlay pickers expose **Create … script** and **Open scripts folder** when no
  matching provider exists.

## Manager

Use a QuickPick first; avoid a second webview panel for v1.

```
Actions
  hello.js                  Open · Run
Providers
  follow-pointer.js         Open · Show usage
  array-size-from-header.js Open · Show usage
  verify-integrity.js       Open · Show usage
────────────────────────────
New action script
New integrity check
New instance address script
New array size script
Browse examples…
Manage permissions…
Open scripts folder
```

- Selection opens the file or runs the chosen command.
- `Manage Scripts` works with zero scripts (only creation actions).
- A TreeView can replace the QuickPick later; the command contract stays.

## Templates

`src/core/scripting/templates.ts` exports pure template strings and a filename suggestion:

```ts
interface ScriptTemplate {
    id: 'action' | 'integrity' | 'address' | 'size';
    name: string;
    fileName: string;
    body: string;
}
```

- Each body includes `// @ts-check`, the type reference, the role/requires header, and a working
  minimal implementation.
- Creation asks for a file name, refuses existing files, writes through the host, then opens the
  file and rescans.
- Workspace trust is required. Out-of-workspace opens use the document directory.

## Selective examples

- Change `installExampleScripts` to accept an optional selected source list while keeping the
  existing all-files behavior for the bulk action.
- `Browse examples…` shows a `canPickMany` QuickPick with descriptions and current-installed
  state; existing targets remain skipped.
- “Add all examples” stays a secondary action.

## Picker empty states

Add callbacks:

```ts
onCreateScript?: (role: 'integrity' | 'address' | 'size') => void;
onOpenScriptsFolder?: () => void;
```

- Empty `<select>` keeps a disabled placeholder, plus a Create button and an Open folder button.
- The create action invokes the same host command/template flow.

## Compatibility

- No new persistence.
- Templates and manager use the existing `scanScripts`/install helpers.
- Command registration is additive.

## Tests

- Template bodies contain the expected headers and compile through `check-examples`.
- Create refuses duplicate names and opens the new file.
- Selective install copies only selected files and skips existing.
- Manager QuickPick works with zero and many scripts.
- Picker empty states report create/open-folder callbacks.
