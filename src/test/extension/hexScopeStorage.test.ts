// ── .hexscope three-tier storage tests (extension host) ───────────
// Runs under vscode-test where vscode.workspace.fs + real FS watchers work.
// Covers the struct pool, single-file profile registry (profiles.json
// array), binding table, JsonStore slots, deferred lazy-dir materialization,
// legacy migrations, and the per-dir → array registry merge.

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
    collectProfileRecords,
    emptyProfileRecord,
    hexScopeSchemasDir,
    migrateLegacyProfileDirs,
    nextProfileOrdinal,
    normalizeBindings,
    normalizeProfilesRegistry,
    perFileRelativePath,
    profilesJsonUri,
    readJson,
    readProfileRecord,
    removeProfileRecord,
    renameProfileRecord,
    resolveHexScopeRoot,
    seedSchemaCopies,
    structPoolJsonUri,
    unwrapEnvelope,
    withEnvelope,
    writeIfMissing,
    writeJson,
    writeProfileRecord,
    type ProfileRecord,
} from '../../hexScopeStorage';
import {
    applyStructDeletion,
    bindFile,
    bindingsUsing,
    boundProfileId,
    collectStructDeletionUsage,
    createBoundProfile,
    loadWorkspaceStructs,
    pruneBindings,
    stripDeletedStructPins,
    unbindFile,
    workspaceStructPoolCache,
} from '../../hexEditorSession';
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

async function profilesOnDisk(root: string): Promise<ProfileRecord[]> {
    const read = await readJson(profilesJsonUri(root));
    return read.status === 'ok' ? normalizeProfilesRegistry(read.value).value : [];
}

function registryStoreFor(root: string): JsonStore<ProfileRecord[]> {
    return new JsonStore<ProfileRecord[]>({
        uri: profilesJsonUri(root),
        normalizer: normalizeProfilesRegistry,
        empty: () => [],
        debounceMs: FAST,
    });
}

function lazyRegistryStore(root: string, lazyDir: () => Promise<string | null>): JsonStore<ProfileRecord[]> {
    return new JsonStore<ProfileRecord[]>({
        uri: profilesJsonUri(root),
        normalizer: normalizeProfilesRegistry,
        empty: () => [],
        debounceMs: FAST,
        lazyDir,
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

function structsNormalizer(raw: unknown): { value: StructDef[]; changed: boolean } {
    const defs = normalizeStructDefsValue(migrateStructDefinitions(raw)).defs;
    return { value: defs, changed: JSON.stringify(raw) !== JSON.stringify(defs) };
}

const REL = 'firmware/boot.hex';
const REL_WIN = REL.split('/').join(path.sep);
const MIGRATION_MARKER_KEY = 'hexScope.migration.v3';
const PROFILES_ARRAY_MARKER_KEY = 'hexScope.profilesArray.v1';

function onlyMigrationMarkerRemains(memento: MementoLike): boolean {
    return memento.keys().every(key => key === MIGRATION_MARKER_KEY || key === PROFILES_ARRAY_MARKER_KEY);
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
        const uri = vscode.Uri.file(path.join(testRoot, 'a', 'b', 'profiles.json'));
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

    test('missing registry loads the empty array default and writes nothing', async () => {
        const store = registryStoreFor(testRoot);
        const value = await store.load();
        assert.deepStrictEqual(value, []);
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing', 'no file created');
    });

    test('corrupt registry loads empty, warns once, and is never overwritten', async () => {
        const uri = profilesJsonUri(testRoot);
        await writeText(uri, '{{{ corrupt');
        const store = registryStoreFor(testRoot);
        const value = await store.load();
        assert.deepStrictEqual(value, []);
        assert.strictEqual(await readText(uri), '{{{ corrupt', 'corrupt file untouched');
    });

    test('unknown-version registry loads empty, warns, and is untouched', async () => {
        const uri = profilesJsonUri(testRoot);
        await writeText(uri, JSON.stringify({ version: 99, data: [] }));
        const store = registryStoreFor(testRoot);
        const value = await store.load();
        assert.deepStrictEqual(value, []);
        const after = await readJsonValue(uri);
        assert.strictEqual((after as { version?: unknown }).version, 99, 'unknown version untouched');
    });

    test('self-heal rewrites only when parse-ok and normalized output differs', async () => {
        const uri = profilesJsonUri(testRoot);
        await writeText(uri, JSON.stringify({
            version: 1,
            data: [{
                id: 'profile_1', name: 'Boot',
                labels: [], segmentNames: {}, pins: [], activeChecks: null, endian: 'le',
            }],
        }));
        const store = registryStoreFor(testRoot);
        await store.load();
        const healed = await readJsonValue(uri) as { version: number; data: Array<{ activeChecks: { checks: unknown[] } }> };
        assert.strictEqual(healed.version, 1);
        assert.deepStrictEqual(healed.data[0].activeChecks, { schemaVersion: 1, checks: [] }, 'normalized back');
    });

    test('set() debounces a single write of the enveloped array', async () => {
        const store = registryStoreFor(testRoot);
        await store.load();
        store.set([{ ...emptyProfileRecord('profile_1', 'Boot'), labels: [{ id: 'a', name: 'A', startAddress: 0, length: 1, color: '#000' }] }]);
        store.set([{ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' }]);
        await sleep(60);
        const value = await readJsonValue(profilesJsonUri(testRoot)) as { version: number; data: Array<{ endian: string; labels: unknown[] }> };
        assert.strictEqual(value.version, 1);
        assert.strictEqual(value.data[0].endian, 'be', 'last set wins');
        assert.deepStrictEqual(value.data[0].labels, [], 'single debounced write');
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
        const store = registryStoreFor(testRoot);
        await store.load();
        store.set([{ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' }]);
        store.dispose();
        await sleep(60);
        const value = await readJsonValue(profilesJsonUri(testRoot)) as { data: Array<{ endian: string }> };
        assert.strictEqual(value.data[0].endian, 'be');
    });

    test('slots are independent (one write never touches the other file)', async () => {
        const registry = registryStoreFor(testRoot);
        const pool = poolStoreFor(testRoot);
        await registry.load();
        await pool.load();
        pool.set([{ id: 's1', name: 'S1', fields: [] }]);
        await pool.flush();
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing', 'registry untouched');
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

    async function lazyDirPath(): Promise<string> {
        const dir = path.join(testRoot, 'lazy');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
        return dir;
    }

    test('reads return the in-memory empty default and create nothing on disk', async () => {
        const store = lazyRegistryStore(testRoot, lazyDirPath);
        const value = await store.load();
        assert.deepStrictEqual(value, []);
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing', 'no registry file from a read-only open');
        assert.strictEqual((await readJson(vscode.Uri.file(path.join(testRoot, 'lazy', 'profiles.json')))).status, 'missing');
    });

    test('first write materializes the entry and lands the slot in it', async () => {
        const store = lazyRegistryStore(testRoot, lazyDirPath);
        await store.load();
        store.set([{ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' }]);
        await store.flush();
        const value = await readJsonValue(vscode.Uri.file(path.join(testRoot, 'lazy', 'profiles.json'))) as { data: Array<{ endian: string }> };
        assert.strictEqual(value.data[0].endian, 'be', 'slot written into the materialized dir');
    });

    test('null dir resolver stays in-memory (no disk) for non-explicit writes', async () => {
        const store = lazyRegistryStore(testRoot, () => Promise.resolve(null));
        await store.load();
        store.set([{ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' }]);
        await store.flush();
        store.dispose();
        await sleep(60);
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing', 'no registry file seeded out-of-workspace');
    });

    test('a later explicit write materializes after non-explicit ones stayed in-memory', async () => {
        let explicit = false;
        const store = lazyRegistryStore(testRoot, () => explicit ? lazyDirPath() : Promise.resolve(null));
        await store.load();
        store.set([{ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' }]);
        await store.flush();
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing', 'non-explicit write stayed in-memory');

        explicit = true;
        store.set([{ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'le' }]);
        await store.flush();
        const value = await readJsonValue(vscode.Uri.file(path.join(testRoot, 'lazy', 'profiles.json'))) as { data: Array<{ endian: string }> };
        assert.strictEqual(value.data[0].endian, 'le', 'latest in-memory value written');
    });
});

suite('hexScopeStorage — profile registry (single-file array) + bindings', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('writeProfileRecord seeds an ordinal profile record + schema copies', async () => {
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        const raw = await readJson(profilesJsonUri(testRoot));
        assert.strictEqual(raw.status, 'ok');
        const data = raw.status === 'ok' ? raw.value as ProfileRecord[] : [];
        assert.strictEqual(data.length, 1);
        assert.strictEqual(data[0]?.id, 'profile_1');
        assert.strictEqual(data[0]?.name, 'Boot');
    });

    test('normalizeProfilesRegistry dedupes ids + case-insensitive names, preserves order', () => {
        const rec = (id: string, name: string) => emptyProfileRecord(id, name);
        const raw = [rec('profile_1', 'Boot'), rec('profile_1', 'Dup'), rec('profile_2', 'boot'), rec('profile_3', 'App')];
        const { value, changed } = normalizeProfilesRegistry(raw);
        assert.deepStrictEqual(value.map(r => r.id), ['profile_1', 'profile_3'], 'id dup + name dup dropped, order kept');
        assert.strictEqual(changed, true);
        assert.deepStrictEqual(normalizeProfilesRegistry(raw).value, normalizeProfilesRegistry(value).value, 'idempotent');
    });

    test('normalizeProfilesRegistry drops malformed entries', () => {
        const raw = [emptyProfileRecord('profile_1', 'Boot'), 'junk', null, { name: 'NoId' }];
        const { value } = normalizeProfilesRegistry(raw);
        assert.deepStrictEqual(value.map(r => r.id), ['profile_1']);
    });

    test('writeProfileRecord upserts; removeProfileRecord deletes; renameProfileRecord renames', async () => {
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_2', 'App'));
        // Upsert (same id replaces in place, order preserved).
        await writeProfileRecord(testRoot, { ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' });
        let recs = await collectProfileRecords(testRoot);
        assert.deepStrictEqual(recs.map(r => r.id), ['profile_1', 'profile_2']);
        assert.strictEqual(recs[0].endian, 'be');

        await renameProfileRecord(testRoot, 'profile_2', 'App v2');
        recs = await collectProfileRecords(testRoot);
        assert.strictEqual((await readProfileRecord(testRoot, 'profile_2'))?.name, 'App v2');

        await removeProfileRecord(testRoot, 'profile_1');
        recs = await collectProfileRecords(testRoot);
        assert.deepStrictEqual(recs.map(r => r.id), ['profile_2']);
        assert.strictEqual(await readProfileRecord(testRoot, 'profile_1'), null);
    });

    test('nextProfileOrdinal scans the array for the lowest unused profile_<n>', async () => {
        assert.strictEqual(await nextProfileOrdinal(testRoot), 1, 'empty array → 1');
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_2', 'B'));
        await writeProfileRecord(testRoot, emptyProfileRecord('custom', 'C'));
        assert.strictEqual(await nextProfileOrdinal(testRoot), 1, 'profile_1 unused despite custom id');
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'A'));
        assert.strictEqual(await nextProfileOrdinal(testRoot), 3);
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
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path.join(testRoot, '.hexscope')));
        assert.deepStrictEqual(entries.map(([name]) => name).sort(), ['profiles.json', 'schemas']);
        const schemas = await vscode.workspace.fs.readDirectory(vscode.Uri.file(hexScopeSchemasDir(testRoot)));
        assert.deepStrictEqual(schemas.map(([name]) => name).sort(), ['bindings.schema.json', 'profiles.schema.json', 'structs.schema.json']);
    });

    test('registry files carry a $schema sibling; root pool/bindings reference schemas/', async () => {
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        const profile = await readJsonValue(profilesJsonUri(testRoot)) as { data: unknown; $schema?: string };
        assert.strictEqual(profile.$schema, 'schemas/profiles.schema.json');
        await seedSchemaCopies(testRoot);
        await writeJson(bindingsJsonUri(testRoot), withEnvelope([{ fileKey: REL, profileId: 'profile_1' }]));
        const bindings = await readJsonValue(bindingsJsonUri(testRoot)) as { $schema?: string };
        assert.strictEqual(bindings.$schema, 'schemas/bindings.schema.json');
    });

    test('self-heal preserves the $schema sibling on registry files', async () => {
        const uri = profilesJsonUri(testRoot);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
        await writeText(uri, JSON.stringify({
            $schema: 'schemas/profiles.schema.json',
            version: 1,
            data: [{ id: 'profile_1', name: 'Boot', labels: [], segmentNames: {}, pins: [], activeChecks: null, endian: 'le' }],
        }));
        const store = registryStoreFor(testRoot);
        await store.load();
        const healed = await readJsonValue(uri) as { data: Array<{ activeChecks: unknown }>; $schema?: string };
        assert.deepStrictEqual(healed.data[0].activeChecks, { schemaVersion: 1, checks: [] }, 'self-heal applied');
        assert.strictEqual(healed.$schema, 'schemas/profiles.schema.json', 'sibling preserved through self-heal');
    });

    test('perFileRelativePath uses posix separators', () => {
        assert.strictEqual(perFileRelativePath(testRoot, vscode.Uri.file(path.join(testRoot, 'firmware', 'boot.hex'))), REL);
        assert.strictEqual(perFileRelativePath(testRoot, vscode.Uri.file(path.join(testRoot, 'boot.hex'))), 'boot.hex');
    });

    test('two files can share one profile (2 entries → 1 ProfileRecord)', async () => {
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        const firstFile = path.join(testRoot, ...REL_WIN.split(path.sep));
        const secondFile = path.join(testRoot, 'firmware', 'app.hex');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(firstFile)));
        await writeText(vscode.Uri.file(firstFile), ':00000001FF\n');
        await writeText(vscode.Uri.file(secondFile), ':00000001FF\n');

        await bindFile(testRoot, REL, 'profile_1');
        await bindFile(testRoot, 'firmware/app.hex', 'profile_1');

        const bindings = (await readJsonValue(bindingsJsonUri(testRoot)) as { data: Array<{ fileKey: string; profileId: string }> }).data;
        assert.strictEqual(bindings.length, 2, 'one entry per file');
        assert.ok(bindings.every(b => b.profileId === 'profile_1'), 'both files point at the shared profile');
        assert.deepStrictEqual(await bindingsUsing(testRoot, 'profile_1'), [
            { fileKey: REL },
            { fileKey: 'firmware/app.hex' },
        ], 'share count for the "used by N files" hint');
        assert.strictEqual(await boundProfileId(testRoot, REL), 'profile_1');
        assert.strictEqual(await boundProfileId(testRoot, 'firmware/app.hex'), 'profile_1');

        // Unbinding one file leaves the other + the profile intact.
        await unbindFile(testRoot, REL);
        assert.strictEqual(await boundProfileId(testRoot, REL), null, 'unbound file reverts to No Profile');
        assert.strictEqual(await boundProfileId(testRoot, 'firmware/app.hex'), 'profile_1');
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'ok', 'profile untouched');
    });

    test('pruneBindings drops entries whose file no longer exists on disk', async () => {
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        const staysUri = vscode.Uri.file(path.join(testRoot, 'firmware', 'stays.hex'));
        const goneUri = vscode.Uri.file(path.join(testRoot, 'firmware', 'gone.hex'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(staysUri.fsPath)));
        await writeText(staysUri, ':00000001FF\n');
        await writeText(goneUri, ':00000001FF\n');

        await bindFile(testRoot, 'firmware/stays.hex', 'profile_1');
        await bindFile(testRoot, 'firmware/gone.hex', 'profile_1');
        assert.strictEqual(await boundProfileId(testRoot, 'firmware/gone.hex'), 'profile_1');

        // Entry whose file does not exist on disk (CLI mv/rm VS Code never saw).
        const pruned = await pruneBindings(testRoot, [
            { fileKey: 'firmware/never.hex', profileId: 'profile_1' },
            { fileKey: 'firmware/stays.hex', profileId: 'profile_1' },
        ]);
        assert.deepStrictEqual(pruned, [{ fileKey: 'firmware/stays.hex', profileId: 'profile_1' }], 'dead entry dropped');

        // Every bindings write prunes first, so a CLI-deleted bound file is
        // cleaned up on the next write → "No Profile" → one-click re-pick.
        await vscode.workspace.fs.delete(goneUri);
        await bindFile(testRoot, 'firmware/stays.hex', 'profile_1');
        assert.strictEqual(await boundProfileId(testRoot, 'firmware/gone.hex'), null, 'pruned on next write; re-pick from dropdown');
    });
});

suite('hexScopeStorage — per-dir registry → profiles.json migration', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    async function seedLegacyDir(dirName: string, rec: ProfileRecord): Promise<void> {
        const dir = path.join(testRoot, '.hexscope', 'profiles', dirName);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
        await writeText(vscode.Uri.file(path.join(dir, 'profile.json')), JSON.stringify(withEnvelope(rec)));
    }

    test('merges per-dir profiles into profiles.json (dedupe id + name), leaves the tree for rollback', async () => {
        const dirRec1: ProfileRecord = { ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' };
        const dirRec2 = emptyProfileRecord('profile_2', 'App');
        const dupName: ProfileRecord = { ...emptyProfileRecord('profile_9', 'boot') }; // id dup resolved by existing profile_1 wins
        await seedLegacyDir('profile_1', dirRec1);
        await seedLegacyDir('profile_2', dirRec2);
        await seedLegacyDir('profile_9', dupName);
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing', 'nothing to merge from yet');

        await migrateLegacyProfileDirs(testRoot);

        const recs = await collectProfileRecords(testRoot);
        assert.deepStrictEqual(recs.map(r => r.id), ['profile_1', 'profile_2'], 'name-dup profile_9 dropped (case-insensitive)');
        assert.strictEqual(recs[0].endian, 'be');
        // Legacy dir tree left in place for rollback.
        for (const name of ['profile_1', 'profile_2', 'profile_9']) {
            assert.strictEqual(
                (await readJson(vscode.Uri.file(path.join(testRoot, '.hexscope', 'profiles', name, 'profile.json')))).status,
                'ok',
                `legacy ${name} dir kept`,
            );
        }

        // Idempotent: re-running after existing array keeps order + no dupes.
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_3', 'New'));
        await migrateLegacyProfileDirs(testRoot);
        assert.deepStrictEqual((await collectProfileRecords(testRoot)).map(r => r.id), ['profile_1', 'profile_2', 'profile_3']);
    });

    test('no legacy dirs → no write, no crash', async () => {
        await migrateLegacyProfileDirs(testRoot);
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing', 'nothing written');
    });

    test('legacy record with missing id inherits the dir name', async () => {
        await seedLegacyDir('profile_4', { ...emptyProfileRecord('', ''), name: 'Anon' });
        await migrateLegacyProfileDirs(testRoot);
        const recs = await collectProfileRecords(testRoot);
        assert.strictEqual(recs.length, 1);
        assert.strictEqual(recs[0].id, 'profile_4', 'dir name becomes the id');
        assert.strictEqual(recs[0].name, 'Anon');
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
        const recs = await collectProfileRecords(testRoot);
        const profile = recs.find(r => r.id === boundProfileId);
        assert.ok(profile, 'bound profile exists in the single-file registry');
        assert.strictEqual(profile!.labels.length, 1, 'labels migrated');
        assert.deepStrictEqual(profile!.segmentNames, { '0': 'Boot' });
        assert.strictEqual(profile!.pins.length, 1, 'pins migrated');
        assert.deepStrictEqual(profile!.activeChecks, { schemaVersion: 1, checks: [] });
        assert.strictEqual(profile!.endian, 'be');

        // Global integrity template → unbound registry profile (array entry).
        assert.strictEqual(recs.length, 2, 'open-doc profile + P1 template profile');

        // Structs → workspace pool (v2 supersedes v1; per-file merged, deduped)
        const pool = await readJsonValue(structPoolJsonUri(testRoot)) as { data: { id: string }[] };
        assert.deepStrictEqual(pool.data.map(s => s.id).sort(), ['legacy', 's1']);

        assert.ok(onlyMigrationMarkerRemains(globalState), 'every global legacy key hard-deleted (markers aside)');
        assert.ok(onlyMigrationMarkerRemains(workspaceState), 'every workspace legacy key hard-deleted (markers aside)');
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
        const recs = await collectProfileRecords(testRoot);
        const profile = recs.find(r => r.id === bindings.data[0].profileId);
        assert.ok(profile, 'file profile in the array registry');
        assert.strictEqual(profile!.labels.length, 1);
        assert.strictEqual(profile!.endian, 'be');
        assert.deepStrictEqual(profile!.activeChecks.checks.map(c => c.algorithm), ['crc16-ccitt-false'], 'empty index activeChecks folds the first integrity template in');

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
        const recs = await collectProfileRecords(testRoot);
        const profile = recs.find(r => r.id === bindings.data[0].profileId);
        assert.deepStrictEqual(profile!.activeChecks.checks.map(c => c.algorithm), ['md5'], 'first template folded in');
        assert.strictEqual(recs.length, 2, 'file profile + P2 unbound template profile');

        // Rerun is a no-op (no new profiles/bindings).
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });
        const bindingsAfter = await readJsonValue(bindingsJsonUri(testRoot)) as { data: unknown[] };
        assert.strictEqual(bindingsAfter.data.length, 1, 'rerun no-op');
        assert.strictEqual((await collectProfileRecords(testRoot)).length, 2, 'rerun no-op for registry');
    });

    test('tree era: pre-existing bindings.json never suppresses conversion of an unconverted legacy dir', async () => {
        // Regression (#3): the old guard treated bindings.json existing as
        // "migration done". A binding written for an unrelated file (or a
        // partially-migrated root) must NOT permanently disable conversion of
        // a remaining legacy tree — that would silently drop its data.
        const legacyContainer = vscode.Uri.file(path.join(testRoot, '.hexscope', 'firmware_profiles'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(legacyContainer.fsPath, 'profiles_1')));
        const dir = path.join(legacyContainer.fsPath, 'profiles_1');
        await writeText(vscode.Uri.file(path.join(dir, 'index.json')), JSON.stringify({
            version: 1,
            data: { relPath: REL, labels: [{ id: 'l1', name: 'L1', startAddress: 0, length: 1, color: '#000' }], segmentNames: {}, pins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'be' },
        }));
        await writeText(vscode.Uri.file(path.join(dir, 'structs.json')), JSON.stringify({ version: 1, data: [{ id: 's1', name: 'S1', fields: [] }] }));
        await writeText(vscode.Uri.file(path.join(dir, 'integrity.json')), JSON.stringify({ version: 1, data: [] }));

        // Pre-existing bindings.json from an UNRELATED file (file exists on
        // disk so it is not pruned away) — the exact broken ordering.
        const otherFile = vscode.Uri.file(path.join(testRoot, 'other', 'app.hex'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(otherFile.fsPath)));
        await writeText(otherFile, ':00000001FF\n');
        await writeText(bindingsJsonUri(testRoot), JSON.stringify({ version: 1, data: [{ fileKey: 'other/app.hex', profileId: 'profile_1' }] }));
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Other App'));

        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });

        const bindings = await readJsonValue(bindingsJsonUri(testRoot)) as { data: Array<{ fileKey: string; profileId: string }> };
        const relBinding = bindings.data.find(b => b.fileKey === REL);
        assert.ok(relBinding, 'legacy dir converted despite pre-existing bindings.json');
        assert.strictEqual(relBinding!.profileId, 'profile_2', 'legacy conversion got a fresh ordinal, not the unrelated profile');
        const recs = await collectProfileRecords(testRoot);
        const profile = recs.find(r => r.id === relBinding!.profileId);
        assert.strictEqual(profile!.labels.length, 1, 'legacy labels migrated');
        assert.strictEqual(profile!.endian, 'be');
        const pool = await readJsonValue(structPoolJsonUri(testRoot)) as { data: { id: string }[] };
        assert.deepStrictEqual(pool.data.map(s => s.id), ['s1'], 'legacy structs merged into pool');
        assert.strictEqual(bindings.data.find(b => b.fileKey === 'other/app.hex')?.profileId, 'profile_1', 'pre-existing binding untouched');
    });

    test('tree era: already-converted root (.converted markers present) is a no-op across process restarts', async () => {
        // Simulates a second extension-host session: the legacy tree still
        // exists (deliberately kept for revert safety) but a previous run has
        // written the per-dir `.converted` marker. Migration must not
        // re-convert — otherwise every restart would accumulate duplicate
        // profiles and silently re-bind the file to an empty profile.
        const legacyContainer = vscode.Uri.file(path.join(testRoot, '.hexscope', 'firmware_profiles'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(legacyContainer.fsPath, 'profiles_1')));
        const dir = path.join(legacyContainer.fsPath, 'profiles_1');
        await writeText(vscode.Uri.file(path.join(dir, 'index.json')), JSON.stringify({
            version: 1,
            data: { relPath: REL, labels: [], segmentNames: {}, pins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le' },
        }));
        await writeText(vscode.Uri.file(path.join(dir, 'structs.json')), JSON.stringify({ version: 1, data: [] }));
        await writeText(vscode.Uri.file(path.join(dir, 'integrity.json')), JSON.stringify({ version: 1, data: [] }));
        // The conversion-complete marker from the previous process run.
        await writeText(vscode.Uri.file(path.join(dir, '.converted')), '');

        // Prior process state: registry profile + binding + migrated pool exist.
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        await writeText(bindingsJsonUri(testRoot), JSON.stringify({ version: 1, data: [{ fileKey: REL, profileId: 'profile_1' }] }));
        await writeText(structPoolJsonUri(testRoot), JSON.stringify({ version: 1, data: [{ id: 's1', name: 'S1', fields: [] }] }));

        const before = (await collectProfileRecords(testRoot)).map(r => r.id);
        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });

        const after = (await collectProfileRecords(testRoot)).map(r => r.id);
        assert.deepStrictEqual(after, before, 'no duplicate profiles created on re-run');
        const bindings = await readJsonValue(bindingsJsonUri(testRoot)) as { data: Array<{ fileKey: string; profileId: string }> };
        assert.deepStrictEqual(bindings.data, [{ fileKey: REL, profileId: 'profile_1' }], 'binding untouched');
        const pool = await readJsonValue(structPoolJsonUri(testRoot)) as { data: { id: string }[] };
        assert.deepStrictEqual(pool.data.map(s => s.id), ['s1'], 'pool left untouched');
    });

    test('per-dir registry merges once (marker), and rerun with marker is a no-op', async () => {
        // Current-release per-dir registry from an earlier build: the open doc
        // binds profile_1 which lives in .hexscope/profiles/profile_1/profile.json.
        const dir = path.join(testRoot, '.hexscope', 'profiles', 'profile_1');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
        await writeText(vscode.Uri.file(path.join(dir, 'profile.json')), JSON.stringify(withEnvelope({
            ...emptyProfileRecord('profile_1', 'Boot'),
            endian: 'be',
        })));

        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });

        const recs = await collectProfileRecords(testRoot);
        assert.deepStrictEqual(recs.map(r => r.id), ['profile_1'], 'legacy dir merged into the array');
        assert.strictEqual(recs[0].endian, 'be');
        assert.strictEqual(globalState.get<string>(PROFILES_ARRAY_MARKER_KEY), testRoot, 'marker set');

        // Second run: marker present → merge skipped (profile_1 not duplicated).
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });
        assert.strictEqual((await collectProfileRecords(testRoot)).length, 1, 'no duplicate after marker');
    });

    test('no legacy data → nothing seeded, no crash', async () => {
        const globalState = new FakeMemento();
        const workspaceState = new FakeMemento();
        await migrateLegacyData(testRoot, uri(), { globalState, workspaceState });
        assert.strictEqual((await readJson(bindingsJsonUri(testRoot))).status, 'missing', 'no bindings created');
        assert.ok(onlyMigrationMarkerRemains(globalState), 'no legacy keys (markers aside)');
        assert.deepStrictEqual(workspaceState.keys(), []);
    });
});

suite('hexScopeSession — struct-storage helpers', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    function structDef(id: string): StructDef {
        return { id, name: id.toUpperCase(), fields: [] };
    }

    function pin(id: string, structId: string): { id: string; structId: string; addr: number; name: string } {
        return { id, structId, addr: 0, name: id.toUpperCase() };
    }

    function seedProfile(id: string, name: string, pins: Array<{ id: string; structId: string; addr: number; name: string }>): Promise<void> {
        return writeProfileRecord(testRoot, { ...emptyProfileRecord(id, name), pins });
    }

    test('collectStructDeletionUsage scans every profile, not just the bound one', async () => {
        await seedProfile('profile_1', 'A', [pin('a1', 's_gone'), pin('a2', 's_kept')]);
        await seedProfile('profile_2', 'B', [pin('b1', 's_gone')]);
        await seedProfile('profile_3', 'C', [pin('c1', 's_unrelated')]); // no referencing pins

        const usage = await collectStructDeletionUsage(testRoot, ['s_gone']);
        assert.strictEqual(usage.pins, 2);
        assert.deepStrictEqual([...usage.profileIds].sort(), ['profile_1', 'profile_2']);
    });

    test('stripDeletedStructPins removes orphaned pins from every affected profile only', async () => {
        await seedProfile('profile_1', 'A', [pin('a1', 's_gone'), pin('a2', 's_kept')]);
        await seedProfile('profile_2', 'B', [pin('b1', 's_kept')]);

        await stripDeletedStructPins(testRoot, ['s_gone']);

        const recA = await readProfileRecord(testRoot, 'profile_1');
        assert.deepStrictEqual(recA?.pins.map(p => p.id), ['a2'], 'profile A orphaned pin stripped, kept pin retained');
        const recB = await readProfileRecord(testRoot, 'profile_2');
        assert.deepStrictEqual(recB?.pins.map(p => p.id), ['b1'], 'profile B untouched');
    });

    test('applyStructDeletion: plain edit / no referencing pins write straight through; confirmed cascade strips across profiles; declined writes nothing', async () => {
        const s = (defs: StructDef[]) => new JsonStore<StructDef[]>({
            uri: structPoolJsonUri(testRoot),
            normalizer: structsNormalizer,
            empty: () => [],
            debounceMs: FAST,
        });

        // Seed pool + two profiles with pins referencing Header (and one unrelated).
        const seedPool = s([structDef('Header'), structDef('Pkt')]);
        await seedPool.load();
        seedPool.set([structDef('Header'), structDef('Pkt')]);
        await seedPool.flush();
        seedPool.dispose();
        await seedProfile('profile_1', 'A', [pin('a1', 'Header')]);
        await seedProfile('profile_2', 'B', [pin('b1', 'Header'), pin('b2', 'Pkt')]);

        // Plain edit (no deletion) → applied, pool updated, no confirm.
        let confirmCalls = 0;
        const plainPool = s([structDef('Header'), structDef('Pkt')]);
        await plainPool.load();
        const r1 = await applyStructDeletion(testRoot, plainPool, [structDef('Header'), structDef('Pkt'), structDef('Crc')], async () => { confirmCalls++; return true; });
        assert.strictEqual(r1, 'applied');
        assert.strictEqual(confirmCalls, 0, 'no confirm for a non-delete edit');
        await plainPool.flush();
        plainPool.dispose();

        // Deletion with referencing pins → confirmed → pool updated + all
        // affected-profile pins stripped.
        const freshPool = s([structDef('Header'), structDef('Pkt'), structDef('Crc')]);
        await freshPool.load();
        const seenUsage: Array<{ pins: number; profileIds: string[] }> = [];
        const r2 = await applyStructDeletion(testRoot, freshPool, [structDef('Pkt'), structDef('Crc')], async (usage) => {
            seenUsage.push(usage);
            return true;
        });
        assert.strictEqual(r2, 'applied');
        // Only Header is deleted; profile_1 pins 1×Header, profile_2 pins 1×Header.
        assert.deepStrictEqual(seenUsage, [{ pins: 2, profileIds: ['profile_1', 'profile_2'] }]);
        await freshPool.flush();
        const poolAfter = await readJsonValue(structPoolJsonUri(testRoot)) as { data: { id: string }[] };
        assert.deepStrictEqual(poolAfter.data.map(sd => sd.id).sort(), ['Crc', 'Pkt'], 'pool entry removed on confirm');
        freshPool.dispose();
        const recA = await readProfileRecord(testRoot, 'profile_1');
        assert.deepStrictEqual(recA?.pins, [], 'profile A orphaned pin stripped');
        const recB = await readProfileRecord(testRoot, 'profile_2');
        assert.deepStrictEqual(recB?.pins.map(p => p.id), ['b2'], 'profile B orphaned pin stripped, unrelated kept');

        // Declined deletion → no writes at all, nothing stripped.
        await seedProfile('profile_3', 'C', [pin('c1', 'Pkt')]);
        const declPool = s([structDef('Pkt'), structDef('Crc')]);
        await declPool.load();
        const r3 = await applyStructDeletion(testRoot, declPool, [structDef('Crc')], async () => false);
        assert.strictEqual(r3, 'declined');
        const poolBeforeDecline = await readJsonValue(structPoolJsonUri(testRoot)) as { data: { id: string }[] };
        assert.deepStrictEqual(poolBeforeDecline.data.map(sd => sd.id).sort(), ['Crc', 'Pkt'], 'pool untouched on decline');
        const recC = await readProfileRecord(testRoot, 'profile_3');
        assert.deepStrictEqual(recC?.pins.map(p => p.id), ['c1'], 'affected profile pins untouched on decline');
        declPool.dispose();
    });

    test('per-root struct-pool fallback is independent (two roots never share an empty default)', async () => {
        // Clear any cross-test residue so the assertion starts from a clean map.
        for (const key of Array.from(workspaceStructPoolCache.keys())) {
            if (!key.startsWith(testRoot)) { workspaceStructPoolCache.delete(key); }
        }

        // Root A: registry store + pool store with defs on disk.
        const rootA = testRoot;
        await writeProfileRecord(rootA, emptyProfileRecord('profile_1', 'A'));
        const poolUriA = structPoolJsonUri(rootA);
        await writeJson(poolUriA, withEnvelope([structDef('s_a1'), structDef('s_a2')]));
        const registryA = registryStoreFor(rootA);
        const poolA = poolStoreFor(rootA);
        const defsA = await loadWorkspaceStructs(rootA, poolA);
        assert.deepStrictEqual(defsA.map(s => s.id), ['s_a1', 's_a2']);
        registryA.dispose();
        poolA.dispose();

        // Root B: fresh fallback (no pool on disk) must NOT see root A's defs.
        const rootB = path.join(testRoot, 'root-b');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(rootB));
        await writeProfileRecord(rootB, emptyProfileRecord('profile_1', 'B'));
        const registryB = registryStoreFor(rootB);
        const poolB = new JsonStore<StructDef[]>({
            uri: structPoolJsonUri(rootB),
            normalizer: structsNormalizer,
            empty: () => [...(workspaceStructPoolCache.get(rootB) ?? [])],
            debounceMs: FAST,
        });
        const defsB = await loadWorkspaceStructs(rootB, poolB);
        assert.deepStrictEqual(defsB, [], 'root B empty default does not leak root A defs');
        registryB.dispose();
        poolB.dispose();

        // Root A's cached defs are still intact.
        assert.deepStrictEqual((workspaceStructPoolCache.get(rootA) ?? []).map(s => s.id), ['s_a1', 's_a2']);
    });
});

suite('hexScopeStorage — P2 #7 regression: out-of-workspace open writes nothing', () => {
    // Regression guard for issue #212-req-#7: "File changed externally. Reloading..."
    // false-positives on out-of-workspace HEX files. The suspected trigger was
    // sibling .hexscope/ schema-seed writes inside the file's directory being
    // misattributed to the neighboring hex file by VS Code's watcher. P0/P1 fixed
    // the trigger structurally: a bare open (no edits, no profile action) now never
    // creates .hexscope/ at all, and the profile watcher attaches only once a
    // profile exists. This suite asserts the composition an out-of-workspace
    // open performs: dirname root resolution + read-only lookups + in-memory
    // staged edits → zero .hexscope/ sibling on disk, and that the guard
    // only lifts after an explicit profile action (tooth check).
    let outRoot: string;
    let outRootUri: vscode.Uri;

    setup(async () => {
        // Sibling of the test workspace folder (which lives under os.tmpdir()),
        // so getWorkspaceFolder() is undefined — exactly an out-of-workspace open.
        outRoot = path.join(os.tmpdir(), `hexscope-outws-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
        outRootUri = vscode.Uri.file(outRoot);
        await vscode.workspace.fs.createDirectory(outRootUri);
    });

    teardown(async () => {
        try { await vscode.workspace.fs.delete(outRootUri, { recursive: true }); } catch { /* already gone */ }
    });

    async function assertNoHexScopeSibling(dir: string): Promise<void> {
        let exists = true;
        try { await vscode.workspace.fs.stat(vscode.Uri.file(path.join(dir, '.hexscope'))); } catch { exists = false; }
        assert.ok(!exists, `no .hexscope/ sibling created under ${dir}`);
    }

    test('resolveHexScopeRoot falls back to the document dir outside a workspace', () => {
        const file = vscode.Uri.file(path.join(outRoot, 'boot.hex'));
        assert.strictEqual(vscode.workspace.getWorkspaceFolder(file), undefined, 'sibling of the test workspace is out-of-workspace');
        // Compare against dirname(file.fsPath): Uri normalizes the drive letter
        // case (C:\ vs c:\), so the expected value must share the Uri's casing.
        assert.strictEqual(resolveHexScopeRoot(file), path.dirname(file.fsPath), 'dirname fallback (single-file open)');
        assert.strictEqual(perFileRelativePath(path.dirname(file.fsPath), file), 'boot.hex');
    });

    test('bare out-of-workspace open performs zero .hexscope/ writes; explicit profile action flips it on', async () => {
        const file = vscode.Uri.file(path.join(outRoot, 'boot.hex'));
        // The bound file must exist on disk: bindings are pruned on write when
        // their fileKey no longer resolves, so a phantom file would be dropped
        // immediately (production behavior, not a P2 defect).
        await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(':00000001FF\n'));
        const root = resolveHexScopeRoot(file);
        const rel = perFileRelativePath(root, file);

        // Mirrors resolveCustomEditor (hexEditorSession.ts):
        // migration seeds nothing with no legacy data; the binding lookup is a
        // pure read (no bindings.json → null); the deferred registry resolver
        // declines because !hasWorkspaceFolder (non-explicit write — explicit
        // newProfile/selectProfile actions / Save bypass the resolver).
        assert.strictEqual(await boundProfileId(root, rel), null, 'no bindings.json → unbound');

        let explicit = false;
        const resolver = () => explicit ? createBoundProfile(root, rel) : Promise.resolve(null);
        const registry = lazyRegistryStore(root, resolver);
        const pool = poolStoreFor(root);

        await registry.load();   // deferred mode: empty default, no fs access
        await pool.load();       // structs.json missing: empty default, no write
        registry.set([{ ...emptyProfileRecord('profile_1', 'profile_1'), endian: 'be' }]); // in-memory edit
        await registry.flush();  // resolver declined → stays in-memory
        registry.dispose();
        pool.dispose();
        await sleep(60);

        assert.strictEqual((await readJson(bindingsJsonUri(root))).status, 'missing', 'no bindings.json');
        assert.strictEqual((await readJson(structPoolJsonUri(root))).status, 'missing', 'no struct pool');
        await assertNoHexScopeSibling(outRoot);

        // Tooth: a later explicit profile action (materializePending / Save)
        // creates the sibling dir + binding + registry entry — the guard is
        // scoped to bare open.
        explicit = true;
        const store = lazyRegistryStore(root, resolver);
        await store.load();
        store.set([{ ...emptyProfileRecord('profile_1', 'profile_1'), endian: 'be' }]);
        await store.flush();
        store.dispose();
        await sleep(60);

        const bindings = await readJson(bindingsJsonUri(root));
        assert.strictEqual(bindings.status, 'ok', 'explicit action binds the file');
        if (bindings.status === 'ok') {
            const data = bindings.value as Array<{ fileKey: string; profileId: string }>;
            assert.deepStrictEqual(data, [{ fileKey: rel, profileId: 'profile_1' }]);
        }
        await vscode.workspace.fs.stat(vscode.Uri.file(path.join(outRoot, '.hexscope'))); // no throw → exists
    });
});

suite('hexScopeStorage — profile watcher', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('external edit auto-applies; a self-write never reverts our own bytes', async function () {
        this.timeout(30000);
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        const uri = profilesJsonUri(testRoot);

        let lastSelfWriteAt = 0;
        let reloads = 0;
        const store = registryStoreFor(testRoot);
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
            await writeText(uri, JSON.stringify({ version: 1, data: [{ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'be' }] }));
            onProfileChanged();
            await waitFor(() => store.get()?.some(r => r.endian === 'be') === true, 5000);
            assert.ok(reloads >= 1, 'reload ran for the external edit');

            // Host self-write persists; the (possibly late) watcher echo only
            // re-reads our own bytes and must not revert them.
            lastSelfWriteAt = Date.now(); // session stamps the write horizon
            store.set([{ ...emptyProfileRecord('profile_1', 'Boot'), endian: 'le' }]);
            await store.flush();
            await waitFor(async () => (await readJsonValue(uri) as { data: Array<{ endian: string }> }).data[0].endian === 'le', 5000);
            onProfileChanged(); // echo reload inside the horizon → must not run
            await sleep(100); // let any mis-fired scheduleReload settle
            assert.strictEqual(reloads, 1, 'echo inside the write horizon suppressed');
            assert.strictEqual(store.get()?.[0]?.endian, 'le', 'echo reload is a no-op on own bytes');
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