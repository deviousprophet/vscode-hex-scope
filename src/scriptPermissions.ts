// ── Script permission grants ──────────────────────────────────────
// Host-owned approval store behind the inline Scripts-panel prompt
// (`.trellis/tasks/archive/2026-10/10-20-script-write-confirmation`).
//
// A grant is keyed by absolute script path + the script file's fingerprint
// (mtime, the same value `scanScripts` exposes) + the capability. Editing the
// file changes the fingerprint, so the grant stops matching and the next
// dangerous call prompts again.
//
// Lifetimes:
//   - `script`    in-memory, this script (path + fingerprint) until the host exits
//   - `session`   in-memory wildcard, any script, until the host exits
//   - `workspace` persisted in `workspaceState` (never settings), survives restart
//   - `once`      never stored
//
// Stores are keyed by workspace root and live as long as the extension host
// (`scriptGrantStoreFor`), so closing and reopening an editor keeps its
// session grants; only the host exiting resets them.
//
// `exec` never reaches workspace scope (downgraded to `session`), and a
// workspace `*` grant covers every non-exec capability only.

import * as path from 'node:path';
import {
    SCRIPT_PERMISSION_TIMEOUT_MS,
    type ProviderToWebviewMessage,
    type ScriptCapability,
    type ScriptCapabilityGrant,
    type ScriptGrantScope,
    type ScriptGrantView,
    type ScriptPermissionScope,
} from './webviewProtocol';

/** Subset of `vscode.Memento` the store needs (structural so tests stay host-free). */
export interface GrantMemento {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

interface GrantEntry {
    scriptPath: string;
    fingerprint: string;
    capability: ScriptCapabilityGrant;
}

interface StoredGrants {
    version: 1;
    grants: GrantEntry[];
}

export const SCRIPT_GRANTS_KEY = 'hexScope.scriptPermissions';
const STORE_VERSION = 1;
/** Synthetic path key for a session-wide grant. */
const ANY_SCRIPT = '*';

/** Case-fold Windows paths so the same file or root always maps to one key. */
function pathKey(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isCapabilityGrant(value: unknown): value is ScriptCapabilityGrant {
    return value === 'write' || value === 'exec' || value === 'fetch' || value === '*';
}

function isGrantEntry(value: unknown): value is GrantEntry {
    const entry = value as Partial<GrantEntry> | null;
    return !!entry
        && typeof entry.scriptPath === 'string'
        && typeof entry.fingerprint === 'string'
        && isCapabilityGrant(entry.capability);
}

/** A session-scoped grant entry: `session` is the file-independent `*` wildcard. */
function sessionEntry(
    scope: 'script' | 'session',
    scriptPath: string,
    fingerprint: string,
    capability: ScriptCapabilityGrant,
): GrantEntry {
    return scope === 'session'
        ? { scriptPath: ANY_SCRIPT, fingerprint: '*', capability }
        : { scriptPath, fingerprint, capability };
}

/** Paths whose script no longer exists in the scanned folder (`*` entries are exempt). */
function missingScriptPaths(entries: readonly GrantEntry[], active: ReadonlySet<string>): Set<string> {
    const missing = new Set<string>();
    for (const entry of entries) {
        if (isMissingScript(entry, active)) { missing.add(entry.scriptPath); }
    }
    return missing;
}

function isMissingScript(entry: GrantEntry, active: ReadonlySet<string>): boolean {
    return entry.scriptPath !== ANY_SCRIPT && !active.has(pathKey(entry.scriptPath));
}

function normalizeStored(value: unknown): GrantEntry[] {
    const stored = value as Partial<StoredGrants> | null;
    if (!stored || !Array.isArray(stored.grants)) { return []; }
    return stored.grants.filter(isGrantEntry);
}

/** True when the grant covers this capability (exact or `*` breadth). */
function coversCapability(entry: GrantEntry, capability: ScriptCapability): boolean {
    return entry.capability === capability || entry.capability === '*';
}

/** Exact path + fingerprint match, plus same-fingerprint `*` breadth. */
function entryMatches(entry: GrantEntry, key: string, fingerprint: string, capability: ScriptCapability): boolean {
    if (!coversCapability(entry, capability)) { return false; }
    if (entry.scriptPath === ANY_SCRIPT) { return true; }
    return pathKey(entry.scriptPath) === key && entry.fingerprint === fingerprint;
}

/** Same script file (by key), same content fingerprint. */
function sameTarget(entry: GrantEntry, key: string, fingerprint: string): boolean {
    return pathKey(entry.scriptPath) === key && entry.fingerprint === fingerprint;
}

/** Workspace breadth check: exact capability, or `*` for every non-exec capability. */
function workspaceCovers(grant: ScriptCapabilityGrant, capability: ScriptCapability): boolean {
    return grant === capability || (grant === '*' && capability !== 'exec');
}

/** Workspace entries are always script-scoped; `*` excludes `exec`. */
function workspaceEntryMatches(entry: GrantEntry, key: string, fingerprint: string, capability: ScriptCapability): boolean {
    if (!sameTarget(entry, key, fingerprint)) { return false; }
    return workspaceCovers(entry.capability, capability);
}

function sameEntry(a: GrantEntry, b: GrantEntry): boolean {
    return pathKey(a.scriptPath) === pathKey(b.scriptPath)
        && a.fingerprint === b.fingerprint
        && a.capability === b.capability;
}

/** Add an entry unless an equivalent one is already present. */
function pushUnique(entries: GrantEntry[], entry: GrantEntry): void {
    if (!entries.some(existing => sameEntry(existing, entry))) { entries.push(entry); }
}

export class ScriptGrantStore {
    /** Grants that die with the extension host (`script` + `session` scope). */
    private sessionEntries: GrantEntry[] = [];
    private workspaceEntries: GrantEntry[];

    constructor(private readonly state: GrantMemento) {
        this.workspaceEntries = normalizeStored(state.get<unknown>(SCRIPT_GRANTS_KEY));
    }

    /** True when an earlier approval covers this call. */
    check(scriptPath: string, fingerprint: string, capability: ScriptCapability): boolean {
        const key = pathKey(scriptPath);
        if (this.sessionEntries.some(e => entryMatches(e, key, fingerprint, capability))) { return true; }
        return this.workspaceEntries.some(e => workspaceEntryMatches(e, key, fingerprint, capability));
    }

    /** Record an approval. `once` is never stored; `exec` never persists. */
    grant(scope: ScriptPermissionScope, scriptPath: string, fingerprint: string, capability: ScriptCapabilityGrant): void {
        if (scope === 'once') { return; }
        if (scope === 'workspace') {
            this.grantWorkspace(scriptPath, fingerprint, capability);
            return;
        }
        pushUnique(this.sessionEntries, sessionEntry(scope, scriptPath, fingerprint, capability));
    }

    /** Workspace-scope grant: persisted, except `exec` which downgrades to `session`. */
    private grantWorkspace(scriptPath: string, fingerprint: string, capability: ScriptCapabilityGrant): void {
        if (capability === 'exec') {
            pushUnique(this.sessionEntries, { scriptPath, fingerprint, capability });
            return;
        }
        pushUnique(this.workspaceEntries, { scriptPath, fingerprint, capability });
        this.persist();
    }

    /** Drop every session + workspace grant for one script (file changed, deleted, or bulk revoke). Keeps session-wide grants. */
    revokeAllForScript(scriptPath: string): void {
        const key = pathKey(scriptPath);
        const before = this.workspaceEntries.length;
        this.sessionEntries = this.sessionEntries.filter(e => e.scriptPath === ANY_SCRIPT || pathKey(e.scriptPath) !== key);
        this.workspaceEntries = this.workspaceEntries.filter(e => pathKey(e.scriptPath) !== key);
        if (this.workspaceEntries.length !== before) { this.persist(); }
    }

    /**
     * Bulk revoke. No scope clears everything; otherwise one scope class:
     * `workspace` = persisted entries, `session` = session-wide, `script` = path-scoped.
     */
    revokeAll(scope?: ScriptGrantScope): void {
        if (scope !== 'workspace') {
            this.sessionEntries = this.sessionEntries.filter(e => !sessionEntryInScope(e, scope));
        }
        if (scope === undefined || scope === 'workspace') { this.clearWorkspace(); }
    }

    private clearWorkspace(): void {
        if (this.workspaceEntries.length === 0) { return; }
        this.workspaceEntries = [];
        this.persist();
    }

    /**
     * Drop grants for scripts that no longer exist in the scanned folder.
     * Session-wide (`*`) entries are intentionally kept until the host exits.
     * Returns true when anything was removed.
     */
    revokeMissing(activePaths: readonly string[]): boolean {
        const active = new Set(activePaths.map(pathKey));
        const missing = missingScriptPaths([...this.sessionEntries, ...this.workspaceEntries], active);
        for (const scriptPath of missing) { this.revokeAllForScript(scriptPath); }
        return missing.size > 0;
    }

    /**
     * Revoke grants whose recorded fingerprint no longer matches the file.
     * Returns true when something was removed (the panel list needs a refresh).
     */
    revokeStaleFingerprint(scriptPath: string, fingerprint: string): boolean {
        const key = pathKey(scriptPath);
        const stale = (e: GrantEntry): boolean => e.scriptPath !== ANY_SCRIPT
            && pathKey(e.scriptPath) === key
            && e.fingerprint !== fingerprint;
        const sessionBefore = this.sessionEntries.length;
        const workspaceBefore = this.workspaceEntries.length;
        this.sessionEntries = this.sessionEntries.filter(e => !stale(e));
        this.workspaceEntries = this.workspaceEntries.filter(e => !stale(e));
        const changed = sessionBefore !== this.sessionEntries.length
            || workspaceBefore !== this.workspaceEntries.length;
        if (workspaceBefore !== this.workspaceEntries.length) { this.persist(); }
        return changed;
    }

    /** Every stored grant for the panel's revocable Permissions list, workspace → session → script, then path. */
    listGrants(): ScriptGrantView[] {
        const views = this.workspaceEntries.map(entry => grantView(entry, 'workspace'));
        for (const entry of this.sessionEntries) {
            views.push(grantView(entry, entry.scriptPath === ANY_SCRIPT ? 'session' : 'script'));
        }
        return views.sort(compareGrants);
    }

    /** Revoke one listed grant (per-row Revoke action). */
    revokeGrant(scope: ScriptGrantScope, scriptPath: string, capability: ScriptCapabilityGrant): void {
        if (scope === 'workspace') { this.revokeWorkspaceGrant(scriptPath, capability); return; }
        if (scope === 'session') {
            this.sessionEntries = this.sessionEntries.filter(
                e => !(e.scriptPath === ANY_SCRIPT && e.capability === capability),
            );
            return;
        }
        const key = pathKey(scriptPath);
        this.sessionEntries = this.sessionEntries.filter(
            e => !(e.scriptPath !== ANY_SCRIPT && pathKey(e.scriptPath) === key && e.capability === capability),
        );
    }

    /** Revoke one persisted entry (panel action). */
    private revokeWorkspaceGrant(scriptPath: string, capability: ScriptCapabilityGrant): void {
        const key = pathKey(scriptPath);
        const before = this.workspaceEntries.length;
        this.workspaceEntries = this.workspaceEntries.filter(
            e => !(pathKey(e.scriptPath) === key && e.capability === capability),
        );
        if (this.workspaceEntries.length !== before) { this.persist(); }
    }

    private persist(): void {
        const payload: StoredGrants = { version: STORE_VERSION, grants: this.workspaceEntries };
        void this.state.update(SCRIPT_GRANTS_KEY, payload);
    }
}

/** Render order for the grant list: persisted workspace grants first, then session-wide, then per-script. */
const SCOPE_ORDER: Record<ScriptGrantScope, number> = { workspace: 0, session: 1, script: 2 };

function grantView(entry: GrantEntry, scope: ScriptGrantScope): ScriptGrantView {
    return { scriptPath: entry.scriptPath, capability: entry.capability, scope };
}

function compareGrants(a: ScriptGrantView, b: ScriptGrantView): number {
    return SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope]
        || a.scriptPath.localeCompare(b.scriptPath)
        || a.capability.localeCompare(b.capability);
}

/** True when a bulk revoke limited to `scope` should drop this session entry. */
function sessionEntryInScope(entry: GrantEntry, scope?: ScriptGrantScope): boolean {
    if (scope === 'script') { return entry.scriptPath !== ANY_SCRIPT; }
    if (scope === 'session') { return entry.scriptPath === ANY_SCRIPT; }
    return true;
}

/** Host-lifetime stores, one per workspace root: editor close/reopen keeps grants, host exit drops them. */
const stores = new Map<string, ScriptGrantStore>();

/**
 * Workspace-root-keyed grant store factory. `restore`/`close`/document changes
 * reuse the same store for a root; only the extension host exiting resets it.
 */
export function scriptGrantStoreFor(root: string, state: GrantMemento): ScriptGrantStore {
    const key = pathKey(root);
    let store = stores.get(key);
    if (!store) {
        store = new ScriptGrantStore(state);
        stores.set(key, store);
    }
    return store;
}

/** Test seam: simulate an extension-host restart (drops every in-memory store). */
export function resetScriptGrantStores(): void {
    stores.clear();
}

/** Scopes the inline prompt may offer for a capability (`exec` never persists). */
export function offeredScopes(capability: ScriptCapability): ScriptPermissionScope[] {
    return capability === 'exec'
        ? ['once', 'script', 'session']
        : ['once', 'script', 'session', 'workspace'];
}

export interface ScriptPermissionDecision {
    decision: 'allow' | 'deny';
    scope: ScriptPermissionScope;
    capability?: ScriptCapabilityGrant;
}

/**
 * Validate a prompt response against the request it answers.
 * Returns the grant breadth to store, or null when the response must be denied
 * (unoffered scope, capability mismatch, exec workspace escape).
 */
export function acceptedGrant(
    capability: ScriptCapability,
    scopes: readonly ScriptPermissionScope[],
    response: ScriptPermissionDecision,
): ScriptCapabilityGrant | null {
    const breadth = response.capability ?? capability;
    return isAcceptableResponse(capability, scopes, response, breadth) ? breadth : null;
}

/** Every rule a stored grant must pass; a denied response never passes. */
function isAcceptableResponse(
    capability: ScriptCapability,
    scopes: readonly ScriptPermissionScope[],
    response: ScriptPermissionDecision,
    breadth: ScriptCapabilityGrant,
): boolean {
    return response.decision === 'allow'
        && scopes.includes(response.scope)
        && breadthAllowed(capability, breadth)
        && !workspaceExecEscape(response.scope, capability);
}

function breadthAllowed(capability: ScriptCapability, breadth: ScriptCapabilityGrant): boolean {
    return breadth === capability || breadth === '*';
}

/** `exec` never persists, so a workspace-scoped exec decision is invalid. */
function workspaceExecEscape(scope: ScriptPermissionScope, capability: ScriptCapability): boolean {
    return scope === 'workspace' && capability === 'exec';
}

/** What a dangerous call needs to be approved. */
export interface PermissionRequestDetail {
    capability: ScriptCapability;
    detail: string;
    scriptPath: string;
    scriptName: string;
    fingerprint: string;
}

type PermissionRequestMessage = Extract<ProviderToWebviewMessage, { type: 'scriptPermissionRequest' }>;

type PendingPermission = PermissionRequestDetail & {
    id: number;
    scopes: ScriptPermissionScope[];
    resolve: (allow: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
};

/**
 * Request/response bridge behind `ScriptHost.confirm`.
 * Grant hits resolve without prompting; otherwise one inline prompt is posted
 * and answered by `respond`. A new prompt, `denyPending()` (cancel/dispose), or
 * the timeout denies whatever is outstanding; unknown/stale ids are ignored.
 */
export class ScriptPermissionBroker {
    private pending: PendingPermission | null = null;
    private seq = 0;

    constructor(
        private readonly store: ScriptGrantStore,
        private readonly post: (request: PermissionRequestMessage) => void,
        private readonly timeoutMs: number = SCRIPT_PERMISSION_TIMEOUT_MS,
    ) {}

    confirm(request: PermissionRequestDetail): Promise<boolean> {
        if (this.store.check(request.scriptPath, request.fingerprint, request.capability)) {
            return Promise.resolve(true);
        }
        this.denyPending();
        const id = ++this.seq;
        const scopes = offeredScopes(request.capability);
        return new Promise<boolean>(resolve => {
            const timer = setTimeout(() => {
                if (this.pending?.id !== id) { return; }
                this.pending = null;
                resolve(false);
            }, this.timeoutMs);
            this.pending = { ...request, id, scopes, resolve, timer };
            this.post({ type: 'scriptPermissionRequest', requestId: id, ...request, scopes });
        });
    }

    /** Apply a webview decision. Returns true when it allowed the pending call. */
    respond(response: ScriptPermissionDecision & { requestId: number }): boolean {
        const pending = this.pending;
        if (!pending || response.requestId !== pending.id) { return false; }
        const grant = acceptedGrant(pending.capability, pending.scopes, response);
        this.pending = null;
        clearTimeout(pending.timer);
        if (grant) {
            this.store.grant(response.scope, pending.scriptPath, pending.fingerprint, grant);
        }
        pending.resolve(grant !== null);
        return grant !== null;
    }

    /** Deny the outstanding prompt (run cancelled, panel disposed, replaced). */
    denyPending(): void {
        const pending = this.pending;
        if (!pending) { return; }
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(false);
    }

    hasPending(): boolean {
        return this.pending !== null;
    }
}

