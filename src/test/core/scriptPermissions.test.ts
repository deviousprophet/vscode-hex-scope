// ── Script permission grant store ─────────────────────────────────
// Pure host-side logic (no VS Code API): scope matrix, `*` breadth,
// fingerprint invalidation, workspace persistence + revocation, and the
// `exec` workspace downgrade. Lives under core/ because the store imports
// nothing from `vscode` (design file name scriptPermissions.test.ts).

import * as assert from 'assert';
import {
    acceptedGrant,
    offeredScopes,
    SCRIPT_GRANTS_KEY,
    ScriptGrantStore,
    ScriptPermissionBroker,
    type GrantMemento,
} from '../../scriptPermissions';
import type { ProviderToWebviewMessage } from '../../webviewProtocol';

class FakeMemento implements GrantMemento {
    constructor(private readonly values = new Map<string, unknown>()) {}

    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.values.has(key) ? this.values.get(key) as T : defaultValue;
    }

    update(key: string, value: unknown): Thenable<void> {
        this.values.set(key, value);
        return Promise.resolve();
    }
}

const SCRIPT = 'D:\\ws\\.hexscope\\scripts\\patch.js';
const OTHER = 'D:\\ws\\.hexscope\\scripts\\sign.js';

function newStore(memento: GrantMemento = new FakeMemento()): ScriptGrantStore {
    return new ScriptGrantStore(memento);
}

suite('ScriptGrantStore scopes', () => {
    test('once grants are never stored', () => {
        const store = newStore();
        store.grant('once', SCRIPT, 'fp1', 'write');
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), false);
        assert.deepStrictEqual(store.listWorkspaceGrants(), []);
    });

    test('script scope covers this file + capability only, and dies on fingerprint change', () => {
        const store = newStore();
        store.grant('script', SCRIPT, 'fp1', 'write');
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), true);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'exec'), false, 'one capability only');
        assert.strictEqual(store.check(SCRIPT, 'fp2', 'write'), false, 'fingerprint changed');
        assert.strictEqual(store.check(OTHER, 'fp1', 'write'), false, 'other script');
    });

    test('script-scoped "*" covers every capability of that file', () => {
        const store = newStore();
        store.grant('script', SCRIPT, 'fp1', '*');
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), true);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'fetch'), true);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'exec'), true, 'session/script "*" includes exec');
        assert.strictEqual(store.check(OTHER, 'fp1', 'write'), false);
    });

    test('session scope spans scripts and fingerprints until the host exits', () => {
        const store = newStore();
        store.grant('session', SCRIPT, 'fp1', 'exec');
        assert.strictEqual(store.check(OTHER, 'fp9', 'exec'), true);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'exec'), true);
        assert.strictEqual(store.check(OTHER, 'fp9', 'write'), false);
        assert.strictEqual(newStore().check(OTHER, 'fp9', 'exec'), false, 'not persisted');
    });

    test('duplicate grants collapse', () => {
        const store = newStore();
        store.grant('script', SCRIPT, 'fp1', 'write');
        store.grant('script', SCRIPT, 'fp1', 'write');
        store.revokeScript(SCRIPT);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), false);
    });
});

suite('ScriptGrantStore workspace persistence', () => {
    test('workspace grants persist through the memento and survive a restart', () => {
        const memento = new FakeMemento();
        const store = newStore(memento);
        store.grant('workspace', SCRIPT, 'fp1', 'write');
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), true);
        assert.deepStrictEqual(store.listWorkspaceGrants(), [{ scriptPath: SCRIPT, capability: 'write' }]);

        const restarted = newStore(memento);
        assert.strictEqual(restarted.check(SCRIPT, 'fp1', 'write'), true, 'reloaded from workspaceState');
        assert.strictEqual(memento.get<{ version: number }>(SCRIPT_GRANTS_KEY)!.version, 1);
    });

    test('workspace "*" grants cover non-exec capabilities only', () => {
        const store = newStore();
        store.grant('workspace', SCRIPT, 'fp1', '*');
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), true);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'fetch'), true);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'exec'), false, 'exec never persists');
    });

    test('exec workspace scope is downgraded to a script-scoped session grant (never persisted)', () => {
        const memento = new FakeMemento();
        const store = newStore(memento);
        store.grant('workspace', SCRIPT, 'fp1', 'exec');
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'exec'), true, 'session-scoped for this script');
        assert.strictEqual(store.check(OTHER, 'fp2', 'exec'), false, 'never broader than the script');
        assert.deepStrictEqual(store.listWorkspaceGrants(), []);
        assert.strictEqual(memento.get(SCRIPT_GRANTS_KEY), undefined, 'nothing written');
    });

    test('revokeWorkspaceGrant removes one entry and persists the removal', () => {
        const memento = new FakeMemento();
        const store = newStore(memento);
        store.grant('workspace', SCRIPT, 'fp1', 'write');
        store.grant('workspace', SCRIPT, 'fp1', 'fetch');
        store.revokeWorkspaceGrant(SCRIPT, 'write');
        assert.deepStrictEqual(store.listWorkspaceGrants(), [{ scriptPath: SCRIPT, capability: 'fetch' }]);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), false);
        assert.strictEqual(newStore(memento).check(SCRIPT, 'fp1', 'write'), false, 'removal persisted');
    });

    test('revokeScript drops session and workspace grants but keeps session-wide ones', () => {
        const store = newStore();
        store.grant('script', SCRIPT, 'fp1', 'write');
        store.grant('workspace', SCRIPT, 'fp1', 'fetch');
        store.grant('session', SCRIPT, 'fp1', 'exec');
        store.revokeScript(SCRIPT);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), false);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'fetch'), false);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'exec'), true, 'session-wide grant is not path-scoped');
        assert.deepStrictEqual(store.listWorkspaceGrants(), []);
    });

    test('revokeStaleFingerprint reports and removes edited-script grants', () => {
        const store = newStore();
        store.grant('script', SCRIPT, 'old', 'write');
        store.grant('workspace', SCRIPT, 'old', 'fetch');
        assert.strictEqual(store.revokeStaleFingerprint(SCRIPT, 'new'), true);
        assert.strictEqual(store.check(SCRIPT, 'old', 'write'), false);
        assert.strictEqual(store.check(SCRIPT, 'old', 'fetch'), false);
        assert.strictEqual(store.revokeStaleFingerprint(SCRIPT, 'new'), false, 'idempotent');
        store.grant('script', SCRIPT, 'new', 'write');
        assert.strictEqual(store.revokeStaleFingerprint(SCRIPT, 'new'), false, 'current fingerprint survives');
        assert.strictEqual(store.check(SCRIPT, 'new', 'write'), true);
    });

    test('corrupt stored payloads are ignored', () => {
        const memento = new FakeMemento(new Map([[SCRIPT_GRANTS_KEY, { version: 1, grants: [{ nope: true }] }]]));
        assert.deepStrictEqual(newStore(memento).listWorkspaceGrants(), []);
    });
});

suite('script permission response validation', () => {
    test('offeredScopes excludes workspace for exec', () => {
        assert.deepStrictEqual(offeredScopes('write'), ['once', 'script', 'session', 'workspace']);
        assert.deepStrictEqual(offeredScopes('fetch'), ['once', 'script', 'session', 'workspace']);
        assert.deepStrictEqual(offeredScopes('exec'), ['once', 'script', 'session']);
    });

    test('deny, unoffered scope, and capability mismatch are rejected', () => {
        const scopes = offeredScopes('write');
        assert.strictEqual(acceptedGrant('write', scopes, { decision: 'deny', scope: 'once' }), null);
        assert.strictEqual(acceptedGrant('write', ['once', 'script'], { decision: 'allow', scope: 'workspace' }), null);
        assert.strictEqual(acceptedGrant('write', scopes, { decision: 'allow', scope: 'once', capability: 'exec' }), null);
        assert.strictEqual(acceptedGrant('write', scopes, { decision: 'allow', scope: 'script', capability: '*' }), '*');
        assert.strictEqual(acceptedGrant('write', scopes, { decision: 'allow', scope: 'once' }), 'write');
    });

    test('workspace-scoped exec is always rejected', () => {
        assert.strictEqual(acceptedGrant('exec', ['once', 'workspace'], { decision: 'allow', scope: 'workspace' }), null);
        assert.strictEqual(acceptedGrant('exec', offeredScopes('exec'), { decision: 'allow', scope: 'session' }), 'exec');
    });
});

type PermissionRequestMessage = Extract<ProviderToWebviewMessage, { type: 'scriptPermissionRequest' }>;

const REQUEST = {
    capability: 'write' as const,
    detail: 'Write 2 bytes at 0x8000000',
    scriptPath: SCRIPT,
    scriptName: 'patch.js',
    fingerprint: 'fp1',
};

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function brokerFixture(timeoutMs = 500): {
    posted: PermissionRequestMessage[];
    store: ScriptGrantStore;
    broker: ScriptPermissionBroker;
} {
    const posted: PermissionRequestMessage[] = [];
    const store = newStore();
    const broker = new ScriptPermissionBroker(store, request => posted.push(request), timeoutMs);
    return { posted, store, broker };
}

suite('ScriptPermissionBroker', () => {
    test('an existing grant approves without posting a prompt', async () => {
        const { posted, store, broker } = brokerFixture();
        store.grant('script', SCRIPT, 'fp1', 'write');
        assert.strictEqual(await broker.confirm(REQUEST), true);
        assert.strictEqual(posted.length, 0);
    });

    test('a miss posts one request carrying capability, detail, and offered scopes', async () => {
        const { posted, store, broker } = brokerFixture();
        const approved = broker.confirm(REQUEST);
        assert.strictEqual(posted.length, 1);
        assert.strictEqual(posted[0].type, 'scriptPermissionRequest');
        assert.strictEqual(posted[0].requestId, 1);
        assert.strictEqual(posted[0].capability, 'write');
        assert.strictEqual(posted[0].detail, REQUEST.detail);
        assert.strictEqual(posted[0].scriptName, 'patch.js');
        assert.strictEqual(posted[0].fingerprint, 'fp1');
        assert.deepStrictEqual(posted[0].scopes, ['once', 'script', 'session', 'workspace']);

        assert.strictEqual(broker.respond({ requestId: 1, decision: 'allow', scope: 'once' }), true);
        assert.strictEqual(await approved, true);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), false, 'once stores nothing');
    });

    test('allow once prompts again on the next call', async () => {
        const { posted, store, broker } = brokerFixture();
        const first = broker.confirm(REQUEST);
        broker.respond({ requestId: 1, decision: 'allow', scope: 'once' });
        await first;
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), false);
        const second = broker.confirm(REQUEST);
        assert.strictEqual(posted.length, 2, 'second call prompts again');
        broker.respond({ requestId: 2, decision: 'deny', scope: 'once' });
        assert.strictEqual(await second, false);
    });

    test('workspace allow persists and the next call skips the prompt', async () => {
        const memento = new FakeMemento();
        const store = new ScriptGrantStore(memento);
        const posted: PermissionRequestMessage[] = [];
        const broker = new ScriptPermissionBroker(store, request => posted.push(request));
        const first = broker.confirm(REQUEST);
        broker.respond({ requestId: 1, decision: 'allow', scope: 'workspace' });
        assert.strictEqual(await first, true);
        assert.deepStrictEqual(store.listWorkspaceGrants(), [{ scriptPath: SCRIPT, capability: 'write' }]);

        assert.strictEqual(await broker.confirm(REQUEST), true);
        assert.strictEqual(posted.length, 1, 'no second prompt');
        assert.strictEqual(new ScriptGrantStore(memento).check(SCRIPT, 'fp1', 'write'), true, 'survives restart');
    });

    test('deny resolves false and stores nothing', async () => {
        const { store, broker } = brokerFixture();
        const approved = broker.confirm(REQUEST);
        assert.strictEqual(broker.respond({ requestId: 1, decision: 'deny', scope: 'once' }), false);
        assert.strictEqual(await approved, false);
        assert.strictEqual(store.check(SCRIPT, 'fp1', 'write'), false);
    });

    test('unknown and stale request ids are ignored', async () => {
        const { broker } = brokerFixture();
        const approved = broker.confirm(REQUEST);
        assert.strictEqual(broker.respond({ requestId: 99, decision: 'allow', scope: 'once' }), false);
        assert.strictEqual(broker.hasPending(), true, 'the real request stays open');
        assert.strictEqual(broker.respond({ requestId: 1, decision: 'allow', scope: 'once' }), true);
        assert.strictEqual(await approved, true);
        assert.strictEqual(broker.respond({ requestId: 1, decision: 'allow', scope: 'once' }), false, 'already resolved');
    });

    test('an unanswered prompt denies after the timeout', async () => {
        const { broker } = brokerFixture(10);
        assert.strictEqual(await broker.confirm(REQUEST), false);
        assert.strictEqual(broker.hasPending(), false);
    });

    test('a replacement prompt denies the previous call', async () => {
        const { posted, broker } = brokerFixture();
        const first = broker.confirm(REQUEST);
        const second = broker.confirm({ ...REQUEST, detail: 'Write 4 bytes at 0x8000010' });
        assert.strictEqual(await first, false, 'stale call denied');
        assert.strictEqual(posted.length, 2);
        assert.strictEqual(posted[1].requestId, 2);
        broker.respond({ requestId: 2, decision: 'allow', scope: 'once' });
        assert.strictEqual(await second, true);
    });

    test('denyPending denies the open call (cancel/dispose)', async () => {
        const { broker } = brokerFixture();
        const approved = broker.confirm(REQUEST);
        broker.denyPending();
        assert.strictEqual(await approved, false);
        assert.strictEqual(broker.hasPending(), false);
        broker.denyPending(); // idempotent
    });

    test('exec prompts never offer workspace and reject a workspace response', async () => {
        const { posted, broker } = brokerFixture();
        const approved = broker.confirm({ ...REQUEST, capability: 'exec', detail: 'openssl version' });
        assert.deepStrictEqual(posted[0].scopes, ['once', 'script', 'session']);
        assert.strictEqual(broker.respond({ requestId: 1, decision: 'allow', scope: 'workspace' }), false);
        assert.strictEqual(await approved, false, 'unoffered scope denies');
    });
});
