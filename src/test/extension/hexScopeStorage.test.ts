// ── .hexscope firmware-profile storage tests (extension host) ──────
// Runs under vscode-test where vscode.workspace.fs + real FS watchers work.

import * as assert from 'assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { StructDef } from '../../core/types';
import {
    DATA_VERSION,
    JsonStore,
    attachProfileWatcher,
    createProfile,
    emptyIndexData,
    findProfile,
    hexScopeProfilesDir,
    hexScopeSchemasDir,
    normalizeIndexFile,
    perFileRelativePath,
    readJson,
    unwrapEnvelope,
    withEnvelope,
    writeIfMissing,
    writeJson,
    type IndexFileData,
} from '../../hexScopeStorage';
import type { MementoLike } from '../../hexScopeMigration';
import { migrateLegacyData } from '../../hexScopeMigration';
import { migrateStructDefinitions, normalizeStructDefsValue } from '../../core/structMigration';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const FAST = 1; // near-immediate debounce for tests

function workspaceBase(): string {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return folder ?? os.tmpdir();
}

let testRoot: string;
let testRootUri: vscode.Uri;

async function makeTestRoot(): Promise<void> {
    testRoot = path.join(workspaceBase(), '.test-tmp', `hexscope-storage-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    testRootUri = vscode.Uri.file(testRoot);
    await vscode.workspace.fs.createDirectory(testRootUri);
}

async function removeTestRoot(): Promise<void> {
    try { await vscode.workspace.fs.delete(testRootUri, { recursive: true }); } catch { /* already gone */ }
}

async function writeText(uri: vscode.Uri, text: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

async function readText(uri: vscode.Uri): Promise<string> {
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
}

async function readJsonValue(uri: vscode.Uri): Promise<unknown> {
    return JSON.parse(await readText(uri));
}

function indexUriFor(dir: string): vscode.Uri {
    return vscode.Uri.file(path.join(dir, 'index.json'));
}

function structsUriFor(dir: string): vscode.Uri {
    return vscode.Uri.file(path.join(dir, 'structs.json'));
}

function integrityUriFor(dir: string): vscode.Uri {
    return vscode.Uri.file(path.join(dir, 'integrity.json'));
}

function indexStoreFor(root: string): JsonStore<IndexFileData> {
    return new JsonStore<IndexFileData>({
        uri: indexUriFor(root),
        normalizer: raw => normalizeIndexFile(raw, emptyIndexData(REL)),
        empty: () => emptyIndexData(REL),
        debounceMs: FAST,
    });
}

function structsStoreFor(root: string): JsonStore<StructDef[]> {
    return new JsonStore<StructDef[]>({
        uri: structsUriFor(root),
        normalizer: structsNormalizer,
        empty: () => [],
        debounceMs: FAST,
    });
}

function structsNormalizer(raw: unknown): { value: StructDef[]; changed: boolean } {
    const defs = normalizeStructDefsValue(migrateStructDefinitions(raw)).defs;
    return { value: defs, changed: JSON.stringify(raw) !== JSON.stringify(defs) };
}

const REL = 'firmware/boot.hex';

suite('hexScopeStorage — version envelope', () => {
    test('withEnvelope wraps with the current version', () => {
        assert.deepStrictEqual(withEnvelope([1]), { version: DATA_VERSION, data: [1] });
    });

    test('unwrapEnvelope: current version returns data', () => {
        assert.deepStrictEqual(unwrapEnvelope({ version: 1, data: { a: 1 } }), { a: 1 });
    });

    test('unwrapEnvelope: unknown version is refused (null)', () => {
        assert.strictEqual(unwrapEnvelope({ version: 2, data: {} }), null);
        assert.strictEqual(unwrapEnvelope({ version: 'x', data: {} }), null);
    });

    test('unwrapEnvelope: unversioned object/array accepted as current', () => {
        assert.deepStrictEqual(unwrapEnvelope([1, 2]), [1, 2]);
        assert.deepStrictEqual(unwrapEnvelope({ labels: [] }), { labels: [] });
    });

    test('unwrapEnvelope: null/scalar payloads refused', () => {
        assert.strictEqual(unwrapEnvelope(null), null);
        assert.strictEqual(unwrapEnvelope('x'), null);
        assert.strictEqual(unwrapEnvelope(42), null);
    });
});

suite('hexScopeStorage — readJson/writeJson', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('missing file reads as missing', async () => {
        const read = await readJson(indexUriFor(testRoot));
        assert.strictEqual(read.status, 'missing');
    });

    test('valid enveloped file reads unwrapped data', async () => {
        const uri = indexUriFor(testRoot);
        await writeText(uri, JSON.stringify({ version: 1, data: { relPath: REL } }));
        const read = await readJson(uri);
        assert.strictEqual(read.status, 'ok');
        assert.deepStrictEqual(read.status === 'ok' ? read.value : null, { relPath: REL });
    });

    test('invalid JSON reads as corrupt', async () => {
        const uri = indexUriFor(testRoot);
        await writeText(uri, '{ not json');
        const read = await readJson(uri);
        assert.strictEqual(read.status, 'corrupt');
    });

    test('unknown envelope version reads as corrupt (never treated as ok)', async () => {
        const uri = indexUriFor(testRoot);
        await writeText(uri, JSON.stringify({ version: 99, data: [] }));
        const read = await readJson(uri);
        assert.strictEqual(read.status, 'corrupt');
    });

    test('writeJson creates parent dirs and pretty-prints', async () => {
        const uri = vscode.Uri.file(path.join(testRoot, 'a', 'b', 'index.json'));
        await writeJson(uri, { version: 1, data: { x: 1 } });
        const text = await readText(uri);
        assert.ok(text.includes('\n'), 'pretty-printed JSON');
        assert.deepStrictEqual(await readJsonValue(uri), { version: 1, data: { x: 1 } });
    });

    test('writeIfMissing keeps an existing committed file', async () => {
        const uri = indexUriFor(testRoot);
        await writeJson(uri, { version: 1, data: { committed: true } });
        await writeIfMissing(uri, { version: 1, data: { replaced: true } });
        assert.deepStrictEqual(await readJsonValue(uri), { version: 1, data: { committed: true } });
    });

    test('writeIfMissing writes when missing', async () => {
        const uri = indexUriFor(testRoot);
        await writeIfMissing(uri, { version: 1, data: { seeded: true } });
        assert.deepStrictEqual(await readJsonValue(uri), { version: 1, data: { seeded: true } });
    });
});

suite('hexScopeStorage — JsonStore slots', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('missing file loads the empty default and writes nothing', async () => {
        const store = indexStoreFor(testRoot);
        const value = await store.load();
        assert.strictEqual(value.labels.length, 0);
        assert.strictEqual((await readJson(indexUriFor(testRoot))).status, 'missing', 'no file created');
    });

    test('corrupt file loads empty, warns once, and is never overwritten', async () => {
        const uri = indexUriFor(testRoot);
        await writeText(uri, '{{{ corrupt');
        const store = indexStoreFor(testRoot);
        const value = await store.load();
        assert.strictEqual(value.labels.length, 0);
        assert.strictEqual(await readText(uri), '{{{ corrupt', 'corrupt file untouched');
    });

    test('unknown-version file loads empty, warns, and is untouched', async () => {
        const uri = indexUriFor(testRoot);
        await writeText(uri, JSON.stringify({ version: 99, data: { labels: [] } }));
        const store = indexStoreFor(testRoot);
        const value = await store.load();
        assert.strictEqual(value.labels.length, 0);
        const after = await readJsonValue(uri);
        assert.strictEqual((after as { version?: unknown }).version, 99, 'unknown version untouched');
    });

    test('self-heal rewrites only when parse-ok and normalized output differs', async () => {
        const uri = indexUriFor(testRoot);
        await writeText(uri, JSON.stringify({ version: 1, data: { relPath: REL, labels: [], segmentNames: {}, pins: [], activeChecks: null, endian: 'le' } }));
        const store = indexStoreFor(testRoot);
        await store.load();
        const healed = await readJsonValue(uri) as { version: number; data: { activeChecks: { checks: unknown[] } } };
        assert.strictEqual(healed.version, 1);
        assert.deepStrictEqual(healed.data.activeChecks, { schemaVersion: 1, checks: [] }, 'normalized back');
    });

    test('no write when file is already normalized', async () => {
        const uri = indexUriFor(testRoot);
        const normalized = emptyIndexData(REL);
        await writeText(uri, JSON.stringify({ version: 1, data: normalized }));
        const store = indexStoreFor(testRoot);
        await store.load();
        assert.deepStrictEqual(await readJsonValue(uri), { version: 1, data: normalized }, 'untouched');
    });

    test('set() debounces a single write of the enveloped value', async () => {
        const store = indexStoreFor(testRoot);
        await store.load();
        store.set({ ...emptyIndexData(REL), labels: [{ id: 'a', name: 'A', startAddress: 0, length: 1, color: '#000' }] });
        store.set({ ...emptyIndexData(REL), endian: 'be' });
        await sleep(60);
        const value = await readJsonValue(indexUriFor(testRoot)) as { version: number; data: { endian: string; labels: unknown[] } };
        assert.strictEqual(value.version, 1);
        assert.strictEqual(value.data.endian, 'be', 'last set wins');
        assert.deepStrictEqual(value.data.labels, [], 'single debounced write');
    });

    test('flush writes immediately', async () => {
        const store = structsStoreFor(testRoot);
        await store.load();
        store.set([{ id: 's1', name: 'S1', fields: [] }]);
        await store.flush();
        const value = await readJsonValue(structsUriFor(testRoot)) as { version: number; data: unknown[] };
        assert.strictEqual(value.version, 1);
        assert.deepStrictEqual(value.data, [{ id: 's1', name: 'S1', fields: [] }]);
    });

    test('dispose flushes a pending write', async () => {
        const store = indexStoreFor(testRoot);
        await store.load();
        store.set({ ...emptyIndexData(REL), endian: 'be' });
        store.dispose();
        await sleep(60);
        const value = await readJsonValue(indexUriFor(testRoot)) as { data: { endian: string } };
        assert.strictEqual(value.data.endian, 'be');
    });

    test('slots are independent (one write never touches the other file)', async () => {
        const index = indexStoreFor(testRoot);
        const structs = structsStoreFor(testRoot);
        await index.load();
        await structs.load();
        structs.set([{ id: 's1', name: 'S1', fields: [] }]);
        await structs.flush();
        assert.strictEqual((await readJson(indexUriFor(testRoot))).status, 'missing', 'index untouched');
        const value = await readJsonValue(structsUriFor(testRoot)) as { data: unknown[] };
        assert.strictEqual(value.data.length, 1);
    });

    test('unversioned bare array is accepted and upgraded (dedupe triggers self-heal)', async () => {
        const uri = structsUriFor(testRoot);
        await writeText(uri, '[{"id":"s1","name":"S1","fields":[]},{"id":"s1","name":"S1","fields":[]}]');
        const store = structsStoreFor(testRoot);
        const value = await store.load();
        assert.strictEqual(value.length, 1, 'duplicate dropped on normalize');
        const healed = await readJsonValue(uri) as { version: number; data: unknown[] };
        assert.strictEqual(healed.version, 1, 'upgraded to envelope');
        assert.strictEqual(healed.data.length, 1);
    });

    test('structs slot chain: migrate + normalize returns normalized defs', async () => {
        const uri = structsUriFor(testRoot);
        await writeText(uri, JSON.stringify({
            version: 1,
            data: [{ id: 's1', name: 'S1', fields: [{ name: 'f', type: 'uint8', count: 1, endian: 'be' }] }],
        }));
        const store = structsStoreFor(testRoot);
        const value = await store.load();
        assert.strictEqual('endian' in value[0].fields[0], false, 'legacy endian field removed');
    });
});

suite('hexScopeStorage — profile lookup / creation', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('createProfile seeds an ordinal profiles_1 dir with index.json relPath', async () => {
        const dir = await createProfile(testRoot, REL);
        assert.ok(dir.endsWith('profiles_1'), `dir name ordinal: ${dir}`);
        const raw = await readJson(indexUriFor(dir));
        assert.strictEqual(raw.status, 'ok');
        const data = raw.status === 'ok' ? raw.value as { relPath: string } : null;
        assert.strictEqual(data?.relPath, REL);
    });

    test('second profile gets the next ordinal (profiles_2)', async () => {
        await createProfile(testRoot, 'a.hex');
        const dir2 = await createProfile(testRoot, REL);
        assert.ok(dir2.endsWith('profiles_2'));
    });

    test('findProfile resolves by relPath and survives a dir rename', async () => {
        const dir = await createProfile(testRoot, REL);
        const renamed = path.join(hexScopeProfilesDir(testRoot), 'renamed_profile');
        await vscode.workspace.fs.rename(vscode.Uri.file(dir), vscode.Uri.file(renamed));
        const found = await findProfile(testRoot, REL);
        assert.strictEqual(found, renamed);
    });

    test('findProfile returns null on miss', async () => {
        await createProfile(testRoot, 'other.hex');
        assert.strictEqual(await findProfile(testRoot, REL), null);
    });

    test('seeds no ignore rules anywhere in the profile tree', async () => {
        await createProfile(testRoot, REL);
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path.join(testRoot, '.hexscope')));
        assert.deepStrictEqual(entries.map(([name]) => name).sort(), ['firmware_profiles', 'schemas']);
        const profiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(hexScopeProfilesDir(testRoot)));
        assert.deepStrictEqual(profiles.map(([name]) => name), ['profiles_1']);
        const schemas = await vscode.workspace.fs.readDirectory(vscode.Uri.file(hexScopeSchemasDir(testRoot)));
        assert.deepStrictEqual(schemas.map(([name]) => name).sort(), ['index.schema.json', 'integrity.schema.json', 'structs.schema.json']);
    });

    test('profile files carry a $schema sibling; non-profile writes do not', async () => {
        const dir = await createProfile(testRoot, REL);
        const index = await readJsonValue(indexUriFor(dir)) as { data: unknown; $schema?: string };
        assert.strictEqual(index.$schema, '../../schemas/index.schema.json');
        const outside = vscode.Uri.file(path.join(testRoot, 'plain.json'));
        await writeJson(outside, { version: 1, data: { x: 1 } });
        assert.deepStrictEqual(await readJsonValue(outside), { version: 1, data: { x: 1 } });
    });

    test('self-heal preserve the $schema sibling on profile files', async () => {
        const dir = await createProfile(testRoot, REL);
        const uri = indexUriFor(dir);
        await writeText(uri, JSON.stringify({
            $schema: '../../schemas/index.schema.json',
            version: 1,
            data: { relPath: REL, labels: [], segmentNames: {}, pins: [], activeChecks: null, endian: 'le' },
        }));
        const store = indexStoreFor(dir);
        await store.load();
        const healed = await readJsonValue(uri) as { data: { activeChecks: unknown }; $schema?: string };
        assert.deepStrictEqual(healed.data.activeChecks, { schemaVersion: 1, checks: [] }, 'self-heal applied');
        assert.strictEqual(healed.$schema, '../../schemas/index.schema.json', 'sibling preserved through self-heal');
    });

    test('perFileRelativePath uses posix separators', () => {
        assert.strictEqual(perFileRelativePath(testRoot, vscode.Uri.file(path.join(testRoot, 'firmware', 'boot.hex'))), 'firmware/boot.hex');
        assert.strictEqual(perFileRelativePath(testRoot, vscode.Uri.file(path.join(testRoot, 'boot.hex'))), 'boot.hex');
    });
});

suite('hexScopeMigration — one-time legacy Memento transfer', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    const uri = () => vscode.Uri.file(path.join(testRoot, 'firmware', 'boot.hex'));

    class FakeMemento implements MementoLike {
        private data = new Map<string, unknown>();
        get<T>(key: string, defaultValue?: T): T | undefined {
            return this.data.has(key) ? this.data.get(key) as T : defaultValue;
        }
        update(key: string, value: unknown): Thenable<void> {
            if (value === undefined) { this.data.delete(key); } else { this.data.set(key, value); }
            return Promise.resolve();
        }
        keys(): string[] { return Array.from(this.data.keys()); }
    }

    test('seeds the open profile and hard-deletes every legacy key', async () => {
        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        globalState.update('hexScope.structs.global.v2', [{ id: 's1', name: 'S1', fields: [] }]);
        globalState.update('hexScope.structs.global.v1', [{ id: 'old', name: 'Old', fields: [] }]);
        globalState.update('hexScope.integrityProfiles.global.v1', [{
            schemaVersion: 1,
            id: 'p1',
            name: 'P1',
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0, endAddress: 3, autoFixStoredValue: false }],
        }]);
        workspaceState.update(`hexScope.structs.${uri().toString()}`, [{ id: 'legacy', name: 'Legacy', fields: [] }]);
        workspaceState.update(`hexScope.labels.${uri().toString()}`, [{ id: 'l1', name: 'L1', startAddress: 0, length: 1, color: '#000' }]);
        workspaceState.update(`hexScope.segmentNames.${uri().toString()}`, { '0': 'Boot' });
        workspaceState.update(`hexScope.structPins.${uri().toString()}`, [{ id: 'pin1', structId: 's1', addr: 0, name: 'P' }]);
        workspaceState.update(`hexScope.integrityChecks.${uri().toString()}.v1`, { schemaVersion: 1, checks: [] });
        workspaceState.update(`hexScope.endian.${uri().toString()}.v1`, 'be');

        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });

        const dir = await findProfile(testRoot, 'firmware/boot.hex');
        assert.ok(dir, 'profile created');
        const index = await readJsonValue(indexUriFor(dir!)) as { version: number; data: IndexFileData };
        assert.strictEqual(index.version, 1);
        assert.strictEqual(index.data.relPath, 'firmware/boot.hex');
        assert.strictEqual(index.data.labels.length, 1, 'labels migrated');
        assert.deepStrictEqual(index.data.segmentNames, { '0': 'Boot' });
        assert.strictEqual(index.data.pins.length, 1, 'pins migrated');
        assert.deepStrictEqual(index.data.activeChecks, { schemaVersion: 1, checks: [] });
        assert.strictEqual(index.data.endian, 'be');

        const structs = await readJsonValue(structsUriFor(dir!)) as { data: { id: string }[] };
        assert.deepStrictEqual(structs.data.map(s => s.id).sort(), ['legacy', 's1']);
        const profiles = await readJsonValue(integrityUriFor(dir!)) as { data: { id: string }[] };
        assert.strictEqual(profiles.data[0].id, 'p1');

        assert.deepStrictEqual(globalState.keys(), [], 'every global key hard-deleted');
        assert.deepStrictEqual(workspaceState.keys(), [], 'every workspace key hard-deleted');
    });

    test('root sweep deletes per-file keys for sibling documents under the same root', async () => {
        const first = vscode.Uri.file(path.join(testRoot, 'firmware', 'boot.hex'));
        const sibling = vscode.Uri.file(path.join(testRoot, 'firmware', 'other.hex'));
        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        workspaceState.update(`hexScope.labels.${first.toString()}`, [{ id: 'l1', name: 'L1', startAddress: 0, length: 1, color: '#000' }]);
        workspaceState.update(`hexScope.structs.${first.toString()}`, [{ id: 's1', name: 'S1', fields: [] }]);
        workspaceState.update(`hexScope.labels.${sibling.toString()}`, [{ id: 'l2', name: 'L2', startAddress: 4, length: 1, color: '#111' }]);
        workspaceState.update(`hexScope.endian.${sibling.toString()}.v1`, 'be');
        workspaceState.update(`hexScope.integrityChecks.${sibling.toString()}.v1`, { schemaVersion: 1, checks: [] });

        await migrateLegacyData(testRoot, first, { globalState, workspaceState });

        const dir = await findProfile(testRoot, 'firmware/boot.hex');
        assert.ok(dir, 'first profile created + seeded');
        const index = await readJsonValue(indexUriFor(dir!)) as { version: number; data: IndexFileData };
        assert.strictEqual(index.data.labels.length, 1, 'first document labels migrated');
        const structs = await readJsonValue(structsUriFor(dir!)) as { data: unknown[] };
        assert.strictEqual(structs.data.length, 1, 'first document structs migrated');
        assert.deepStrictEqual(workspaceState.keys(), [], 'per-file keys for BOTH documents hard-deleted');
    });

    test('existing committed profile files are preserved; rerun is a no-op', async () => {
        const dir = await createProfile(testRoot, 'firmware/boot.hex');
        const committed = [{ id: 'committed', name: 'Committed', fields: [] }];
        await writeText(structsUriFor(dir), JSON.stringify({ version: 1, data: committed }));

        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        globalState.update('hexScope.structs.global.v2', [{ id: 's1', name: 'S1', fields: [] }]);

        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });
        const after = await readJsonValue(structsUriFor(dir)) as { data: unknown[] };
        assert.deepStrictEqual(after.data, committed, 'committed copy kept');
        assert.deepStrictEqual(globalState.keys(), []);
        assert.deepStrictEqual(workspaceState.keys(), []);

        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });
        const again = await readJsonValue(structsUriFor(dir)) as { data: unknown[] };
        assert.deepStrictEqual(again.data, committed, 'rerun no-op');
    });

    test('no legacy data → no profile seeded, no crash', async () => {
        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });
        assert.strictEqual(await findProfile(testRoot, 'firmware/boot.hex'), null, 'no dir created without legacy data');
        assert.deepStrictEqual(globalState.keys(), []);
        assert.deepStrictEqual(workspaceState.keys(), []);
    });
});

suite('hexScopeStorage — profile watcher', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('external edit auto-applies; a self-write never reverts our own bytes', async function () {
        this.timeout(30000);
        const dir = await createProfile(testRoot, REL);
        const uri = indexUriFor(dir);

        let lastSelfWriteAt = 0;
        let reloads = 0;
        const store = indexStoreFor(dir);
        // Mirrors the session guard + per-slot debounced reload.
        const onProfileChanged = () => {
            if (Date.now() - lastSelfWriteAt < 1000) { return; }
            reloads++;
            store.scheduleReload(0);
        };
        const watcher = attachProfileWatcher({ root: testRoot, onProfileChanged });
        try {
            await store.load();

            // Genuine external edit → watcher fires → debounced reload auto-applies.
            await writeText(uri, JSON.stringify({ version: 1, data: { ...emptyIndexData(REL), endian: 'be' } }));
            await waitFor(() => store.get()?.endian === 'be', 15000);
            assert.ok(reloads >= 1, 'watcher fired for the external edit');

            // Host self-write persists; any (possibly late) watcher echo only
            // re-reads our own bytes and must not revert them.
            store.set({ ...emptyIndexData(REL), endian: 'le' });
            await store.flush();
            await waitFor(async () => (await readJsonValue(uri) as { data: { endian: string } }).data.endian === 'le', 15000);
            await sleep(2500); // let multi-event delivery and debounce settle
            assert.strictEqual((await readJsonValue(uri) as { data: { endian: string } }).data.endian, 'le', 'self-write persisted');
            assert.strictEqual(store.get()?.endian, 'le', 'echo reload is a no-op on own bytes');
        } finally {
            watcher.dispose();
        }
    });

    test('self-write guard: events inside the write horizon do not re-trigger', async () => {
        let lastSelfWriteAt = 0;
        let calls = 0;
        const onProfileChanged = () => {
            if (Date.now() - lastSelfWriteAt < 1000) { return; }
            calls++;
        };
        lastSelfWriteAt = Date.now();
        onProfileChanged();
        onProfileChanged();
        assert.strictEqual(calls, 0, 'horizon suppresses self-write echoes');
        await sleep(1100);
        onProfileChanged();
        assert.strictEqual(calls, 1, 'outside the horizon counts');
    });
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() > deadline) { throw new Error('waitFor timed out'); }
        await sleep(50);
    }
}