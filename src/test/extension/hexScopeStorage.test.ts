// ── .hexscope three-tier storage tests (extension host) ───────────
// Runs under vscode-test where vscode.workspace.fs + real FS watchers work.
// Covers the struct pool, profile registry, binding table, JsonStore slots,
// deferred lazy-dir materialization, and the legacy migrations.

import * as assert from 'assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { StructDef } from '../../core/types';
import {
    DATA_VERSION,
    JsonStore,
    attachProfileWatcher,
    bindingsJsonUri,
    createProfileRegistryEntry,
    emptyProfileRecord,
    hexScopeProfilesRegistryDir,
    hexScopeSchemasDir,
    normalizeBindings,
    normalizeProfileRecord,
    perFileRelativePath,
    profileRegistryJsonUri,
    readJson,
    seedSchemaCopies,
    structPoolJsonUri,
    unwrapEnvelope,
    withEnvelope,
    writeIfMissing,
    writeJson,
    type ProfileRecord,
} from '../../hexScopeStorage';
import type { MementoLike } from '../../hexScopeMigration';
import { migrateLegacyData } from '../../hexScopeMigration';
import { migrateStructDefinitions } from '../../core/structMigration';
import { normalizeStructDefsValue } from '../../core/structNormalization';

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

function profileUriFor(root: string, id: string): vscode.Uri {
    return profileRegistryJsonUri(vscode.Uri.file(path.join(hexScopeProfilesRegistryDir(root), id)).fsPath);
}

function profileStoreFor(root: string, id: string): JsonStore<ProfileRecord> {
    return new JsonStore<ProfileRecord>({
        uri: profileUriFor(root, id),
        normalizer: raw => normalizeProfileRecord(raw, emptyProfileRecord(id, id)),
        empty: () => emptyProfileRecord(id, id),
        debounceMs: FAST,
    });
}

function poolStoreFor(root: string): JsonStore<StructDef[]> {
    return new JsonStore<StructDef[]>({
        uri: structPoolJsonUri(root),
        normalizer: structsNormalizer,
        empty: () => [],
        debounceMs: FAST,
    });
}

function lazyProfileStore(root: string, id: string, lazyDir: () => Promise<string | null>): JsonStore<ProfileRecord> {
    return new JsonStore<ProfileRecord>({
        uri: profileUriFor(root, id),
        normalizer: raw => normalizeProfileRecord(raw, emptyProfileRecord(id, id)),
        empty: () => emptyProfileRecord(id, id),
        debounceMs: FAST,
        lazyDir,
    });
}

function structsNormalizer(raw: unknown): { value: StructDef[]; changed: boolean } {
    const defs = normalizeStructDefsValue(migrateStructDefinitions(raw)).defs;
    return { value: defs, changed: JSON.stringify(raw) !== JSON.stringify(defs) };
}

const REL = 'firmware/boot.hex';
const REL_WIN = REL.split('/').join(path.sep);
const MIGRATION_MARKER_KEY = 'hexScope.migration.v3';

function onlyMigrationMarkerRemains(memento: MementoLike): boolean {
    return memento.keys().every(key => key === MIGRATION_MARKER_KEY);
}

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
        const read = await readJson(structPoolJsonUri(testRoot));
        assert.strictEqual(read.status, 'missing');
    });

    test('valid enveloped file reads unwrapped data', async () => {
        const uri = structPoolJsonUri(testRoot);
        await writeText(uri, JSON.stringify({ version: 1, data: [{ id: 's1', name: 'S1', fields: [] }] }));
        const read = await readJson(uri);
        assert.strictEqual(read.status, 'ok');
        assert.deepStrictEqual(read.status === 'ok' ? read.value : null, [{ id: 's1', name: 'S1', fields: [] }]);
    });

    test('invalid JSON reads as corrupt', async () => {
        const uri = bindingsJsonUri(testRoot);
        await writeText(uri, '{ not json');
        const read = await readJson(uri);
        assert.strictEqual(read.status, 'corrupt');
    });

    test('unknown envelope version reads as corrupt (never treated as ok)', async () => {
        const uri = structPoolJsonUri(testRoot);
        await writeText(uri, JSON.stringify({ version: 99, data: [] }));
        const read = await readJson(uri);
        assert.strictEqual(read.status, 'corrupt');
    });

    test('writeJson creates parent dirs and pretty-prints', async () => {
        const uri = vscode.Uri.file(path.join(testRoot, 'a', 'b', 'profile.json'));
        await writeJson(uri, { version: 1, data: { x: 1 } });
        const text = await readText(uri);
        assert.ok(text.includes('\n'), 'pretty-printed JSON');
        assert.deepStrictEqual(await readJsonValue(uri), { version: 1, data: { x: 1 } });
    });

    test('writeIfMissing keeps an existing committed file', async () => {
        const uri = structPoolJsonUri(testRoot);
        await writeJson(uri, { version: 1, data: [{ committed: true }] });
        await writeIfMissing(uri, { version: 1, data: [{ replaced: true }] });
        const value = await readJsonValue(uri) as { data: unknown[]; $schema?: string };
        assert.deepStrictEqual(value.data, [{ committed: true }]);
        assert.strictEqual(value.$schema, 'schemas/structs.schema.json');
    });

    test('writeIfMissing writes when missing', async () => {
        const uri = structPoolJsonUri(testRoot);
        await writeIfMissing(uri, { version: 1, data: [{ seeded: true }] });
        const value = await readJsonValue(uri) as { data: unknown[]; $schema?: string };
        assert.deepStrictEqual(value.data, [{ seeded: true }]);
        assert.strictEqual(value.$schema, 'schemas/structs.schema.json');
    });
});

suite('hexScopeStorage — JsonStore slots', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    const ID = 'profile_1';

    test('missing file loads the empty default and writes nothing', async () => {
        const store = profileStoreFor(testRoot, ID);
        const value = await store.load();
        assert.strictEqual(value.labels.length, 0);
        assert.strictEqual((await readJson(profileUriFor(testRoot, ID))).status, 'missing', 'no file created');
    });

    test('corrupt file loads empty, warns once, and is never overwritten', async () => {
        const uri = profileUriFor(testRoot, ID);
        await writeText(uri, '{{{ corrupt');
        const store = profileStoreFor(testRoot, ID);
        const value = await store.load();
        assert.strictEqual(value.labels.length, 0);
        assert.strictEqual(await readText(uri), '{{{ corrupt', 'corrupt file untouched');
    });

    test('unknown-version file loads empty, warns, and is untouched', async () => {
        const uri = profileUriFor(testRoot, ID);
        await writeText(uri, JSON.stringify({ version: 99, data: { labels: [] } }));
        const store = profileStoreFor(testRoot, ID);
        const value = await store.load();
        assert.strictEqual(value.labels.length, 0);
        const after = await readJsonValue(uri);
        assert.strictEqual((after as { version?: unknown }).version, 99, 'unknown version untouched');
    });

    test('self-heal rewrites only when parse-ok and normalized output differs', async () => {
        const uri = profileUriFor(testRoot, ID);
        await writeText(uri, JSON.stringify({
            version: 1,
            data: { id: ID, name: ID, labels: [], segmentNames: {}, pins: [], activeChecks: null, endian: 'le' },
        }));
        const store = profileStoreFor(testRoot, ID);
        await store.load();
        const healed = await readJsonValue(uri) as { version: number; data: { activeChecks: { checks: unknown[] } } };
        assert.strictEqual(healed.version, 1);
        assert.deepStrictEqual(healed.data.activeChecks, { schemaVersion: 1, checks: [] }, 'normalized back');
    });

    test('set() debounces a single write of the enveloped value', async () => {
        const store = profileStoreFor(testRoot, ID);
        await store.load();
        store.set({ ...emptyProfileRecord(ID, ID), labels: [{ id: 'a', name: 'A', startAddress: 0, length: 1, color: '#000' }] });
        store.set({ ...emptyProfileRecord(ID, ID), endian: 'be' });
        await sleep(60);
        const value = await readJsonValue(profileUriFor(testRoot, ID)) as { version: number; data: { endian: string; labels: unknown[] } };
        assert.strictEqual(value.version, 1);
        assert.strictEqual(value.data.endian, 'be', 'last set wins');
        assert.deepStrictEqual(value.data.labels, [], 'single debounced write');
    });

    test('flush writes immediately', async () => {
        const store = poolStoreFor(testRoot);
        await store.load();
        store.set([{ id: 's1', name: 'S1', fields: [] }]);
        await store.flush();
        const value = await readJsonValue(structPoolJsonUri(testRoot)) as { version: number; data: unknown[] };
        assert.strictEqual(value.version, 1);
        assert.deepStrictEqual(value.data, [{ id: 's1', name: 'S1', fields: [] }]);
    });

    test('dispose flushes a pending write', async () => {
        const store = profileStoreFor(testRoot, ID);
        await store.load();
        store.set({ ...emptyProfileRecord(ID, ID), endian: 'be' });
        store.dispose();
        await sleep(60);
        const value = await readJsonValue(profileUriFor(testRoot, ID)) as { data: { endian: string } };
        assert.strictEqual(value.data.endian, 'be');
    });

    test('slots are independent (one write never touches the other file)', async () => {
        const profile = profileStoreFor(testRoot, ID);
        const pool = poolStoreFor(testRoot);
        await profile.load();
        await pool.load();
        pool.set([{ id: 's1', name: 'S1', fields: [] }]);
        await pool.flush();
        assert.strictEqual((await readJson(profileUriFor(testRoot, ID))).status, 'missing', 'profile untouched');
        const value = await readJsonValue(structPoolJsonUri(testRoot)) as { data: unknown[] };
        assert.strictEqual(value.data.length, 1);
    });

    test('unversioned bare array is accepted and upgraded (dedupe triggers self-heal)', async () => {
        const uri = structPoolJsonUri(testRoot);
        await writeText(uri, '[{"id":"s1","name":"S1","fields":[]},{"id":"s1","name":"S1","fields":[]}]');
        const store = poolStoreFor(testRoot);
        const value = await store.load();
        assert.strictEqual(value.length, 1, 'duplicate dropped on normalize');
        const healed = await readJsonValue(uri) as { version: number; data: unknown[] };
        assert.strictEqual(healed.version, 1, 'upgraded to envelope');
        assert.strictEqual(healed.data.length, 1);
    });
});

suite('hexScopeStorage — deferred (lazyDir) JsonStore', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    const ID = 'profile_1';

    test('reads return the in-memory empty default and create nothing on disk', async () => {
        const store = lazyProfileStore(testRoot, ID, () => createProfileRegistryEntry(testRoot, ID, 'Boot'));
        const value = await store.load();
        assert.strictEqual(value.labels.length, 0);
        assert.strictEqual((await readJson(profileUriFor(testRoot, ID))).status, 'missing', 'no registry file from a read-only open');
    });

    test('first write materializes the registry entry and lands the slot in it', async () => {
        const store = lazyProfileStore(testRoot, ID, () => createProfileRegistryEntry(testRoot, ID, 'Boot'));
        await store.load();
        store.set({ ...emptyProfileRecord(ID, ID), endian: 'be' });
        await store.flush();
        const value = await readJsonValue(profileUriFor(testRoot, ID)) as { data: { endian: string } };
        assert.strictEqual(value.data.endian, 'be', 'slot written into the materialized registry entry');
    });

    test('null dir resolver stays in-memory (no disk) for non-explicit writes', async () => {
        const store = lazyProfileStore(testRoot, ID, () => Promise.resolve(null));
        await store.load();
        store.set({ ...emptyProfileRecord(ID, ID), endian: 'be' });
        await store.flush();
        store.dispose();
        await sleep(60);
        assert.strictEqual((await readJson(profileUriFor(testRoot, ID))).status, 'missing', 'no registry file seeded out-of-workspace');
    });

    test('a later explicit write materializes after non-explicit ones stayed in-memory', async () => {
        let explicit = false;
        const store = lazyProfileStore(testRoot, ID, () => explicit ? createProfileRegistryEntry(testRoot, ID, 'Boot') : Promise.resolve(null));
        await store.load();
        store.set({ ...emptyProfileRecord(ID, ID), endian: 'be' });
        await store.flush();
        assert.strictEqual((await readJson(profileUriFor(testRoot, ID))).status, 'missing', 'non-explicit write stayed in-memory');

        explicit = true;
        store.set({ ...emptyProfileRecord(ID, ID), endian: 'le' });
        await store.flush();
        const value = await readJsonValue(profileUriFor(testRoot, ID)) as { data: { endian: string } };
        assert.strictEqual(value.data.endian, 'le', 'latest in-memory value written');
    });
});

suite('hexScopeStorage — profile registry + bindings', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('createProfileRegistryEntry seeds an ordinal profile_1 dir', async () => {
        const dir = await createProfileRegistryEntry(testRoot, 'profile_1', 'Boot');
        assert.ok(dir.endsWith('profile_1'), `dir name ordinal: ${dir}`);
        const raw = await readJson(profileUriFor(testRoot, 'profile_1'));
        assert.strictEqual(raw.status, 'ok');
        const data = raw.status === 'ok' ? raw.value as ProfileRecord : null;
        assert.strictEqual(data?.id, 'profile_1');
        assert.strictEqual(data?.name, 'Boot');
    });

    test('normalizeBindings filters malformed entries and rewrites clean', async () => {
        const raw = [
            { fileKey: REL, profileId: 'profile_1' },
            { fileKey: '' as string, profileId: 'x' },
            { fileKey: 'a.hex', profileId: '' },
            'junk',
        ];
        const { value, changed } = normalizeBindings(raw);
        assert.deepStrictEqual(value, [{ fileKey: REL, profileId: 'profile_1' }]);
        assert.strictEqual(changed, true);
    });

    test('seeds exactly the three-tier schema copies, no ignore rules', async () => {
        await createProfileRegistryEntry(testRoot, 'profile_1', 'Boot');
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path.join(testRoot, '.hexscope')));
        assert.deepStrictEqual(entries.map(([name]) => name).sort(), ['profiles', 'schemas']);
        const schemas = await vscode.workspace.fs.readDirectory(vscode.Uri.file(hexScopeSchemasDir(testRoot)));
        assert.deepStrictEqual(schemas.map(([name]) => name).sort(), ['bindings.schema.json', 'profile.schema.json', 'structs.schema.json']);
    });

    test('registry files carry a $schema sibling; root pool/bindings reference schemas/', async () => {
        const dir = await createProfileRegistryEntry(testRoot, 'profile_1', 'Boot');
        const profile = await readJsonValue(profileRegistryJsonUri(dir)) as { data: unknown; $schema?: string };
        assert.strictEqual(profile.$schema, '../../schemas/profile.schema.json');
        await seedSchemaCopies(testRoot);
        await writeJson(bindingsJsonUri(testRoot), withEnvelope([{ fileKey: REL, profileId: 'profile_1' }]));
        const bindings = await readJsonValue(bindingsJsonUri(testRoot)) as { $schema?: string };
        assert.strictEqual(bindings.$schema, 'schemas/bindings.schema.json');
    });

    test('self-heal preserves the $schema sibling on registry files', async () => {
        const dir = await createProfileRegistryEntry(testRoot, 'profile_1', 'Boot');
        const uri = profileRegistryJsonUri(dir);
        await writeText(uri, JSON.stringify({
            $schema: '../../schemas/profile.schema.json',
            version: 1,
            data: { id: 'profile_1', name: 'Boot', labels: [], segmentNames: {}, pins: [], activeChecks: null, endian: 'le' },
        }));
        const store = profileStoreFor(testRoot, 'profile_1');
        await store.load();
        const healed = await readJsonValue(uri) as { data: { activeChecks: unknown }; $schema?: string };
        assert.deepStrictEqual(healed.data.activeChecks, { schemaVersion: 1, checks: [] }, 'self-heal applied');
        assert.strictEqual(healed.$schema, '../../schemas/profile.schema.json', 'sibling preserved through self-heal');
    });

    test('perFileRelativePath uses posix separators', () => {
        assert.strictEqual(perFileRelativePath(testRoot, vscode.Uri.file(path.join(testRoot, 'firmware', 'boot.hex'))), REL);
        assert.strictEqual(perFileRelativePath(testRoot, vscode.Uri.file(path.join(testRoot, 'boot.hex'))), 'boot.hex');
    });
});

suite('hexScopeMigration — one-time legacy transfer', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    const uri = () => vscode.Uri.file(path.join(testRoot, ...REL_WIN.split(path.sep)));

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

    test('Memento era: seeds registry profile + binding + pool; hard-deletes every key', async () => {
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

        // Open doc bound to a seeded profile
        const bindings = await readJsonValue(bindingsJsonUri(testRoot)) as { data: Array<{ fileKey: string; profileId: string }> };
        assert.strictEqual(bindings.data.length, 1, 'a binding exists');
        const boundProfileId = bindings.data[0].profileId;
        const profile = await readJsonValue(profileUriFor(testRoot, boundProfileId)) as { version: number; data: ProfileRecord };
        assert.strictEqual(profile.version, 1);
        assert.strictEqual(profile.data.labels.length, 1, 'labels migrated');
        assert.deepStrictEqual(profile.data.segmentNames, { '0': 'Boot' });
        assert.strictEqual(profile.data.pins.length, 1, 'pins migrated');
        assert.deepStrictEqual(profile.data.activeChecks, { schemaVersion: 1, checks: [] });
        assert.strictEqual(profile.data.endian, 'be');

        // Global integrity template → unbound registry profile
        const registryDir = vscode.Uri.file(hexScopeProfilesRegistryDir(testRoot));
        const dirs = (await vscode.workspace.fs.readDirectory(registryDir)).filter(([, t]) => t === vscode.FileType.Directory);
        assert.strictEqual(dirs.length, 2, 'open-doc profile + P1 template profile');

        // Structs → workspace pool (v2 supersedes v1; per-file merged, deduped)
        const pool = await readJsonValue(structPoolJsonUri(testRoot)) as { data: { id: string }[] };
        assert.deepStrictEqual(pool.data.map(s => s.id).sort(), ['legacy', 's1']);

        assert.ok(onlyMigrationMarkerRemains(globalState), 'every global legacy key hard-deleted (marker aside)');
        assert.ok(onlyMigrationMarkerRemains(workspaceState), 'every workspace legacy key hard-deleted (marker aside)');
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

        const bindings = await readJsonValue(bindingsJsonUri(testRoot)) as { data: Array<{ fileKey: string; profileId: string }> };
        assert.strictEqual(bindings.data.length, 1, 'first document bound');
        const pool = await readJsonValue(structPoolJsonUri(testRoot)) as { data: unknown[] };
        assert.strictEqual(pool.data.length, 1, 'first document structs migrated to pool');
        assert.deepStrictEqual(workspaceState.keys(), [], 'per-file keys for BOTH documents hard-deleted');
    });

    test('tree era: firmware_profiles tree converts to pool + registry profiles + bindings', async () => {
        // Build a legacy firmware_profiles/<n> tree the old way.
        const legacyContainer = vscode.Uri.file(path.join(testRoot, '.hexscope', 'firmware_profiles'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(legacyContainer.fsPath, 'profiles_1')));
        const dir = path.join(legacyContainer.fsPath, 'profiles_1');
        await writeText(vscode.Uri.file(path.join(dir, 'index.json')), JSON.stringify({
            version: 1,
            data: {
                relPath: REL,
                labels: [{ id: 'l1', name: 'L1', startAddress: 0, length: 1, color: '#000' }],
                segmentNames: { '0': 'Boot' },
                pins: [],
                activeChecks: { schemaVersion: 1, checks: [] },
                endian: 'be',
            },
        }));
        await writeText(vscode.Uri.file(path.join(dir, 'structs.json')), JSON.stringify({
            version: 1,
            data: [{ id: 's1', name: 'S1', fields: [] }],
        }));
        await writeText(vscode.Uri.file(path.join(dir, 'integrity.json')), JSON.stringify({
            version: 1,
            data: [{ schemaVersion: 1, id: 'p1', name: 'P1', checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0, endAddress: 3, autoFixStoredValue: false }] }],
        }));

        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        globalState.update('hexScope.structs.global.v2', [{ id: 's1', name: 'S1', fields: [] }]);
        globalState.update('hexScope.structs.global.v1', [{ id: 'old', name: 'Old', fields: [] }]);
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });

        // Pool got the struct (v2 supersedes v1; tree struct deduped against Memento)
        const pool = await readJsonValue(structPoolJsonUri(testRoot)) as { data: { id: string }[] };
        assert.deepStrictEqual(pool.data.map(s => s.id).sort(), ['s1'], 'tree structs + Memento v2 merged');

        // Binding created for the file; registry has the file profile.
        const bindings = await readJsonValue(bindingsJsonUri(testRoot)) as { data: Array<{ fileKey: string; profileId: string }> };
        assert.strictEqual(bindings.data[0].fileKey, REL);
        const profile = await readJsonValue(profileUriFor(testRoot, bindings.data[0].profileId)) as { data: ProfileRecord };
        assert.strictEqual(profile.data.labels.length, 1);
        assert.strictEqual(profile.data.endian, 'be');
        assert.deepStrictEqual(profile.data.activeChecks.checks.map(c => c.algorithm), ['crc16-ccitt-false'], 'empty index activeChecks folds the first integrity template in');

        // Legacy tree stays in place (revert safety).
        assert.strictEqual((await readJson(vscode.Uri.file(path.join(dir, 'index.json')))).status, 'ok', 'legacy tree untouched');

        // Legacy tree stays in place (revert safety).
        assert.strictEqual((await readJson(vscode.Uri.file(path.join(dir, 'index.json')))).status, 'ok', 'legacy tree untouched');
    });

    test('tree era: no activeChecks folds the first integrity template in; rerun is a no-op', async () => {
        const legacyContainer = vscode.Uri.file(path.join(testRoot, '.hexscope', 'firmware_profiles'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(legacyContainer.fsPath, 'profiles_1')));
        const dir = path.join(legacyContainer.fsPath, 'profiles_1');
        await writeText(vscode.Uri.file(path.join(dir, 'index.json')), JSON.stringify({
            version: 1,
            data: { relPath: REL, labels: [], segmentNames: {}, pins: [], activeChecks: null, endian: 'le' },
        }));
        await writeText(vscode.Uri.file(path.join(dir, 'structs.json')), JSON.stringify({ version: 1, data: [] }));
        await writeText(vscode.Uri.file(path.join(dir, 'integrity.json')), JSON.stringify({
            version: 1,
            data: [
                { schemaVersion: 1, id: 'p1', name: 'P1', checks: [{ algorithm: 'md5', startAddress: 0, endAddress: 3, autoFixStoredValue: false }] },
                { schemaVersion: 1, id: 'p2', name: 'P2', checks: [{ algorithm: 'sha-1', startAddress: 0, endAddress: 3, autoFixStoredValue: false }] },
            ],
        }));

        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });

        const bindings = await readJsonValue(bindingsJsonUri(testRoot)) as { data: Array<{ fileKey: string; profileId: string }> };
        const profile = await readJsonValue(profileUriFor(testRoot, bindings.data[0].profileId)) as { data: ProfileRecord };
        assert.deepStrictEqual(profile.data.activeChecks.checks.map(c => c.algorithm), ['md5'], 'first template folded in');

        const registryDir = vscode.Uri.file(hexScopeProfilesRegistryDir(testRoot));
        const dirs = (await vscode.workspace.fs.readDirectory(registryDir)).filter(([, t]) => t === vscode.FileType.Directory);
        assert.strictEqual(dirs.length, 2, 'file profile + P2 unbound template profile');

        // Rerun is a no-op (no new profiles/bindings).
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });
        const bindingsAfter = await readJsonValue(bindingsJsonUri(testRoot)) as { data: unknown[] };
        assert.strictEqual(bindingsAfter.data.length, 1, 'rerun no-op');
    });

    test('no legacy data → nothing seeded, no crash', async () => {
        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });
        assert.strictEqual((await readJson(bindingsJsonUri(testRoot))).status, 'missing', 'no bindings created');
        assert.ok(onlyMigrationMarkerRemains(globalState), 'no legacy keys (marker aside)');
        assert.deepStrictEqual(workspaceState.keys(), []);
    });
});

suite('hexScopeStorage — profile watcher', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('external edit auto-applies; a self-write never reverts our own bytes', async function () {
        this.timeout(30000);
        const dir = await createProfileRegistryEntry(testRoot, 'profile_1', 'Boot');
        const uri = profileRegistryJsonUri(dir);

        let lastSelfWriteAt = 0;
        let reloads = 0;
        const store = profileStoreFor(testRoot, 'profile_1');
        // Mirrors the session guard + per-slot debounced reload. Driven
        // directly (not by real fs events) so the test is deterministic on
        // every OS — including CI where tmpdir watcher delivery is unreliable.
        const onProfileChanged = () => {
            if (Date.now() - lastSelfWriteAt < 1000) { return; }
            reloads++;
            store.scheduleReload(0);
        };
        const watcher = attachProfileWatcher({ root: testRoot, onProfileChanged });
        try {
            await store.load();

            // Genuine external edit → reload auto-applies (reload reads the
            // real file written on disk, so the auto-apply path is exercised).
            await writeText(uri, JSON.stringify({ version: 1, data: { ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' } }));
            onProfileChanged();
            await waitFor(() => store.get()?.endian === 'be', 5000);
            assert.ok(reloads >= 1, 'reload ran for the external edit');

            // Host self-write persists; the (possibly late) watcher echo only
            // re-reads our own bytes and must not revert them.
            lastSelfWriteAt = Date.now(); // session stamps the write horizon
            store.set({ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'le' });
            await store.flush();
            await waitFor(async () => (await readJsonValue(uri) as { data: { endian: string } }).data.endian === 'le', 5000);
            onProfileChanged(); // echo reload inside the horizon → must not run
            await sleep(100); // let any mis-fired scheduleReload settle
            assert.strictEqual(reloads, 1, 'echo inside the write horizon suppressed');
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