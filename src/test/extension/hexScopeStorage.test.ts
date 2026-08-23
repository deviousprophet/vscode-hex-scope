import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { StructDef } from '../../core/types';
import { JsonStore, readJson, resolveHexScopeRoot } from '../../hexScopeStorage';
import { migrateLegacyData } from '../../hexScopeMigration';

function tempRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hexscope-test-'));
}

function fileUri(root: string, ...segments: string[]): vscode.Uri {
    return vscode.Uri.file(path.join(root, ...segments));
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function identityNormalizer<T>(): (raw: unknown) => { value: T; changed: boolean } {
    return raw => ({ value: raw as T, changed: false });
}

async function readJsonOk(uriPath: string): Promise<unknown> {
    const read = await readJson(vscode.Uri.file(uriPath));
    assert.strictEqual(read.status, 'ok', `expected readable JSON at ${uriPath}`);
    return read.value;
}

suite('hexScopeStorage JsonStore', () => {
    test('resolveHexScopeRoot falls back to the file directory outside a workspace', () => {
        const dir = tempRoot();
        const uri = fileUri(dir, 'firmware', 'boot.hex');
        const actual = resolveHexScopeRoot(uri);
        const expected = path.join(dir, 'firmware');
        assert.strictEqual(actual.toLowerCase(), expected.toLowerCase(), `root should be the file's directory (got ${actual})`);
    });

    test('readJson reports missing for absent files', async () => {
        assert.deepStrictEqual(await readJson(fileUri(tempRoot(), 'nope.json')), { status: 'missing' });
    });

    test('readJson reports corrupt for malformed JSON', async () => {
        const root = tempRoot();
        const uri = fileUri(root, 'bad.json');
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('{{not json'));
        const read = await readJson(uri);
        assert.strictEqual(read.status, 'corrupt');
    });

    test('set + flush writes JSON and readJson parses it back', async () => {
        const root = tempRoot();
        const store = new JsonStore(fileUri(root, 'structs.json'), root, identityNormalizer<StructDef[]>(), () => [], () => {});
        store.set([{ id: 'a', name: 'A', fields: [] }]);
        await store.flush();

        const read = await readJson(fileUri(root, 'structs.json'));
        assert.strictEqual(read.status, 'ok');
        const value = read.status === 'ok' ? read.value : undefined;
        assert.deepStrictEqual(value, [{ id: 'a', name: 'A', fields: [] }]);
    });

    test('missing file loads the empty default', async () => {
        const root = tempRoot();
        const store = new JsonStore(fileUri(root, 'data.json'), root, identityNormalizer<number[]>(), () => [], () => {});
        const value = await store.load();
        assert.deepStrictEqual(value, []);
    });

    test('self-heal writes the normalized value back when changed', async () => {
        const root = tempRoot();
        const uri = fileUri(root, 'structs.json');
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify([{ id: 'a', name: 'A', fields: [] }, { id: 'a', name: 'A', fields: [] }])));
        let writes = 0;
        const store = new JsonStore(uri, root, () => ({ value: [{ id: 'a', name: 'A', fields: [] }], changed: true }), () => [], () => { writes++; });
        await store.load();

        assert.strictEqual(writes, 1, 'self-heal write-back happened');
        const healed = await readJson(uri);
        assert.strictEqual(healed.status, 'ok');
        assert.deepStrictEqual(healed.status === 'ok' ? healed.value : undefined, [{ id: 'a', name: 'A', fields: [] }]);
    });

    test('corrupt file loads empty, is left untouched, and warns once', async () => {
        const root = tempRoot();
        const uri = fileUri(root, 'bad.json');
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('{{nope'));
        let warnings = 0;
        const realShow = vscode.window.showWarningMessage;
        vscode.window.showWarningMessage = (async () => { warnings++; return undefined as never; }) as typeof vscode.window.showWarningMessage;

        const store = new JsonStore(uri, root, identityNormalizer<number[]>(), () => [], () => {});
        const value = await store.load();
        await store.load();

        assert.deepStrictEqual(value, []);
        assert.strictEqual(warnings, 1, 'corrupt warning shown once per session');
        const reread = await readJson(uri);
        assert.strictEqual(reread.status, 'corrupt', 'corrupt file never overwritten');

        vscode.window.showWarningMessage = realShow;
    });

    test('debounced set writes after the idle window', async () => {
        const root = tempRoot();
        const uri = fileUri(root, 'data.json');
        const store = new JsonStore(uri, root, identityNormalizer<number[]>(), () => [], () => {}, 10);
        store.set([1, 2, 3]);
        await sleep(60);
        assert.strictEqual((await readJson(uri)).status, 'ok');
    });

    test('dispose cancels a pending debounce; explicit flush still persists', async () => {
        const root = tempRoot();
        const uri = fileUri(root, 'data.json');
        const store = new JsonStore(uri, root, identityNormalizer<number[]>(), () => [], () => {}, 10);
        store.set([7]);
        store.dispose();
        await sleep(30);
        assert.strictEqual((await readJson(uri)).status, 'missing', 'dispose drops the pending auto-write');

        store.set([9]);
        await store.flush();
        const flushed = await readJson(uri);
        assert.strictEqual(flushed.status, 'ok');
        assert.deepStrictEqual(flushed.status === 'ok' ? flushed.value : undefined, [9]);
    });

    test('first write seeds .hexscope/.gitignore with local/', async () => {
        const root = tempRoot();
        const store = new JsonStore(fileUri(root, '.hexscope', 'data', 'f.hex.json'), root, () => ({ value: 1, changed: false }), () => 1, () => {});
        store.set(1);
        await store.flush();
        const gitignore = await vscode.workspace.fs.readFile(fileUri(root, '.hexscope', '.gitignore'));
        assert.strictEqual(new TextDecoder('utf-8').decode(gitignore), 'local/\n');
    });

    test('existing .gitignore with local/ is not overwritten', async () => {
        const root = tempRoot();
        await vscode.workspace.fs.writeFile(fileUri(root, '.hexscope', '.gitignore'), new TextEncoder().encode('# mine\nlocal/\n'));
        const store = new JsonStore(fileUri(root, '.hexscope', 'structs.json'), root, identityNormalizer<number[]>(), () => [], () => {});
        store.set([]);
        await store.flush();
        const read = await vscode.workspace.fs.readFile(fileUri(root, '.hexscope', '.gitignore'));
        assert.ok(new TextDecoder('utf-8').decode(read).includes('# mine'));
    });
});

const GLOBAL_STRUCT_KEY = 'hexScope.structs.global.v2';
const PREV_GLOBAL_STRUCT_KEY = 'hexScope.structs.global.v1';
const GLOBAL_INTEGRITY_KEY = 'hexScope.integrityProfiles.global.v1';

function fakeMemento(initial: Record<string, unknown>) {
    const map = new Map(Object.entries(initial));
    return {
        get: (key: string, defaultValue: unknown = undefined) => (map.has(key) ? map.get(key) : defaultValue),
        update: async (key: string, value: unknown) => {
            if (value === undefined) { map.delete(key); } else { map.set(key, value); }
        },
        keys: () => [...map.keys()],
    } as unknown as vscode.Memento;
}

function fakeContext(global: Record<string, unknown>, workspace: Record<string, unknown>) {
    return {
        globalState: fakeMemento(global),
        workspaceState: fakeMemento(workspace),
    } as unknown as vscode.ExtensionContext;
}

suite('migrateLegacyData', () => {
    test('migrates global structs, per-file labels/pins/endian and deletes every old key', async () => {
        const root = tempRoot();
        const hexUri = fileUri(root, 'firmware', 'boot.hex').toString();
        const context = fakeContext(
            {
                [GLOBAL_STRUCT_KEY]: [{ id: 'g1', name: 'G1', fields: [] }],
                [GLOBAL_INTEGRITY_KEY]: [{
                    schemaVersion: 1,
                    id: 'p1',
                    name: 'P1',
                    checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0, endAddress: 3, autoFixStoredValue: false }],
                }],
            },
            {
                [`hexScope.labels.${hexUri}`]: [{ id: 'l1', name: 'L1', startAddress: 0, length: 1 }],
                [`hexScope.segmentNames.${hexUri}`]: { '0': 'Boot' },
                [`hexScope.structPins.${hexUri}`]: [{ id: 'pin1', structId: 'g1', addr: 0, name: 'PIN1' }],
                [`hexScope.integrityChecks.${hexUri}.v1`]: { schemaVersion: 1, checks: [] },
                [`hexScope.endian.${hexUri}.v1`]: 'be',
                [`hexScope.structs.${hexUri}`]: [{ id: 'legacy', name: 'Legacy', fields: [] }],
            },
        );

        await migrateLegacyData(context, root);

        // structs.json holds global v2 merged with the legacy per-file structs (deduped)
        const structs = await readJsonOk(path.join(root, '.hexscope', 'structs.json')) as StructDef[];
        assert.deepStrictEqual(structs.map(def => def.id).sort(), ['g1', 'legacy']);

        const integrity = await readJsonOk(path.join(root, '.hexscope', 'integrity.json')) as unknown[];
        assert.deepStrictEqual(integrity, [{
            schemaVersion: 1,
            id: 'p1',
            name: 'P1',
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0, endAddress: 3, autoFixStoredValue: false }],
        }]);

        const data = await readJsonOk(path.join(root, '.hexscope', 'data', 'firmware', 'boot.hex.json')) as { labels: unknown[]; segmentNames: Record<string, string> };
        assert.strictEqual(data.labels.length, 1);
        assert.strictEqual(data.segmentNames['0'], 'Boot');

        const local = await readJsonOk(path.join(root, '.hexscope', 'local', 'firmware', 'boot.hex.json')) as { pins: unknown[]; endian: string };
        assert.strictEqual(local.pins.length, 1);
        assert.strictEqual(local.endian, 'be');

        // every old key hard-deleted
        assert.strictEqual(context.globalState.keys().length, 0);
        assert.strictEqual(context.workspaceState.keys().length, 0);
    });

    test('global v1 structs migrate when v2 is absent', async () => {
        const root = tempRoot();
        const context = fakeContext(
            { [PREV_GLOBAL_STRUCT_KEY]: [{ id: 'old', name: 'Old', fields: [{ name: 'w', type: 'uint16', count: 1, endian: 'be' }] }] },
            {},
        );

        await migrateLegacyData(context, root);

        const structs = await readJsonOk(path.join(root, '.hexscope', 'structs.json')) as StructDef[];
        assert.strictEqual(structs.length, 1);
        assert.strictEqual(structs[0].id, 'old');
        assert.ok(!('endian' in structs[0].fields[0]), 'legacy per-field endian stripped');
        assert.strictEqual(context.globalState.keys().length, 0);
    });

    test('skips file writes when targets exist but still deletes old keys', async () => {
        const root = tempRoot();
        await vscode.workspace.fs.writeFile(fileUri(root, '.hexscope', 'structs.json'), new TextEncoder().encode(JSON.stringify([{ id: 'team', name: 'Team', fields: [] }])));
        const hexUri = fileUri(root, 'firmware', 'boot.hex').toString();
        const context = fakeContext(
            { [GLOBAL_STRUCT_KEY]: [{ id: 'mine', name: 'Mine', fields: [] }] },
            { [`hexScope.labels.${hexUri}`]: [{ id: 'l1', name: 'L1', startAddress: 0, length: 1 }] },
        );

        await migrateLegacyData(context, root);

        const structs = await readJsonOk(path.join(root, '.hexscope', 'structs.json')) as StructDef[];
        assert.deepStrictEqual(structs, [{ id: 'team', name: 'Team', fields: [] }], 'team copy preserved');
        assert.strictEqual(context.globalState.keys().length, 0, 'legacy global keys still deleted');
        assert.strictEqual(context.workspaceState.keys().length, 0);
    });

    test('no legacy data writes nothing', async () => {
        const root = tempRoot();
        await migrateLegacyData(fakeContext({}, {}), root);
        assert.strictEqual((await readJson(fileUri(root, '.hexscope', 'structs.json'))).status, 'missing');
    });
});