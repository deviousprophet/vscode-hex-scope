# Design: script permission lifetime and visibility

## Store lifetime

Today `HexEditorSession` owns `_scriptGrants`, so “session” means one editor panel. Move to a
host-lifetime registry keyed by workspace root:

```ts
// scriptPermissions.ts
const stores = new Map<string, ScriptGrantStore>();

export function scriptGrantStoreFor(root: string, state: vscode.Memento): ScriptGrantStore {
    const key = normalizeRoot(root);
    let store = stores.get(key);
    if (!store) { store = new ScriptGrantStore(state); stores.set(key, store); }
    return store;
}
```

- `restore`, `close`, and document changes do not clear it.
- The extension host process exit is the only reset.
- Workspace grants still persist in `workspaceState`.
- Out-of-workspace documents use the document directory as the root, matching scan behavior.

## Grant model

Expose scope in the list:

```ts
type ScriptGrantScope = 'script' | 'session' | 'workspace';
interface ScriptGrantView {
    scriptPath: string;       // '*' for session-wide
    capability: ScriptCapabilityGrant;
    scope: ScriptGrantScope;
}
```

- `workspaceEntries` -> `workspace`.
- `sessionEntries` with `scriptPath: '*'` -> `session`.
- `sessionEntries` with a path -> `script`.
- `exec` is always `script`/`session`; never `workspace`.

Store methods:

```ts
listGrants(): ScriptGrantView[];
revokeGrant(scope, scriptPath, capability): void;
revokeAllForScript(scriptPath): void;   // session + workspace, keeps session-wide
revokeAll(scope?: ScriptGrantScope): void;
```

## Protocol and panel

Replace the workspace-only payload with the full list:

```ts
| { type: 'scriptPermissions'; grants: ScriptGrantView[] }
| { type: 'revokeScriptPermission'; scope: ScriptGrantScope; scriptPath: string; capability: ScriptCapabilityGrant }
| { type: 'revokeAllScriptPermissions'; scope?: ScriptGrantScope }
```

Panel rows:

```
write   patch.js       this script     Revoke
exec    patch.js       this session    Revoke
write   *.js           workspace       Revoke
```

- Sort workspace -> session -> script, then path.
- Scope chip uses user-facing labels (`This script`, `This session`, `Workspace`).
- `Manage` opens the same list expanded; `Revoke all` is a two-step confirm.
- A session-wide row displays `All scripts` rather than `*`.

Prompt copy must state the actual lifetime. The option values remain `once`/`script`/`session`/
`workspace`; only the labels and help text change.

## Invalidation

- `revokeStaleFingerprint` stays, now on the registry store.
- `revokeMissing` stays.
- `revokeScript` on delete.
- Session-wide grants intentionally survive per-script edits; the permission center explains
  this in a hint.

## Tests

- Closing/reopening a session with the same root reuses the store and keeps session grants.
- Different roots do not share grants.
- Restart simulation with a fresh registry loses session grants, keeps workspace grants.
- `listGrants` covers all three scopes and labels.
- Revoke one/all updates the store and persists workspace removals.
- `exec` never appears as workspace.
