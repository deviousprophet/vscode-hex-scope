// ── Raw-binary base-address host helpers (extension host) ─────────
// Covers the profile-backed read/persist round-trip, bound vs unbound
// resolution, and the comparison-only path that must never write .hexscope.

import * as assert from 'assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    persistBinBaseAddress,
    promptForBinBaseAddress,
    readStoredBinBaseAddress,
    resolveCompareBinBaseAddress,
} from '../../binBaseAddress';
import {
    DATA_SCHEMA_VERSION,
    bindFile,
    bindingsJsonUri,
    collectProfileRecords,
    emptyProfileRecord,
    perFileRelativePath,
    profilesJsonUri,
    readJson,
    readProfileRecord,
    writeProfileRecord,
} from '../../hexScopeStorage';

function workspaceBase(): string {
    // Keep the fixture root OUTSIDE the test workspace so `resolveHexScopeRoot`
    // uses the file's directory and each test owns an isolated `.hexscope/`.
    return os.tmpdir();
}

let testRoot: string;
let testRootUri: vscode.Uri;

async function makeTestRoot(): Promise<void> {
    testRoot = path.join(workspaceBase(), '.test-tmp', `hexscope-bin-base-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    testRootUri = vscode.Uri.file(testRoot);
    await vscode.workspace.fs.createDirectory(testRootUri);
}

async function removeTestRoot(): Promise<void> {
    try { await vscode.workspace.fs.delete(testRootUri, { recursive: true }); } catch { /* already gone */ }
}

/** Write a raw image into the test root and return its URI. */
async function writeImage(name = 'boot.bin'): Promise<vscode.Uri> {
    const uri = vscode.Uri.file(path.join(testRoot, name));
    await vscode.workspace.fs.writeFile(uri, Uint8Array.from([0x10, 0x20, 0x30, 0x40]));
    return uri;
}

async function readText(uri: vscode.Uri): Promise<string> {
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

function asking(value: string | undefined, seen: vscode.InputBoxOptions[] = []) {
    return async (options: vscode.InputBoxOptions): Promise<string | undefined> => {
        seen.push(options);
        return value;
    };
}

suite('binBaseAddress', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('an unbound image reads the default and persists a profile + binding on first accept', async () => {
        const uri = await writeImage();
        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0, bound: false });

        await persistBinBaseAddress(uri, 0x08000000);

        const stored = await readStoredBinBaseAddress(uri);
        assert.deepStrictEqual(stored, { value: 0x08000000, bound: true });
        const records = await collectProfileRecords(testRoot);
        assert.strictEqual(records.length, 1);
        assert.strictEqual(records[0].baseAddress, 0x08000000);
        assert.strictEqual(records[0].name, 'boot');
        assert.strictEqual((await readJson(bindingsJsonUri(testRoot))).status, 'ok');
    });

    test('persisting the stored value again does not rewrite profiles.json', async () => {
        const uri = await writeImage();
        await persistBinBaseAddress(uri, 0x1000);
        const before = await readText(profilesJsonUri(testRoot));

        await persistBinBaseAddress(uri, 0x1000);

        assert.strictEqual(await readText(profilesJsonUri(testRoot)), before);
    });

    test('persisting a new value patches the existing bound profile', async () => {
        const uri = await writeImage();
        await persistBinBaseAddress(uri, 0x1000);
        await persistBinBaseAddress(uri, 0x2000);

        const records = await collectProfileRecords(testRoot);
        assert.strictEqual(records.length, 1, 'no second profile is created');
        assert.strictEqual(records[0].baseAddress, 0x2000);
    });

    test('the prompt prefills from the bound profile and persists an accepted value', async () => {
        const uri = await writeImage();
        await persistBinBaseAddress(uri, 0x08000000);
        const recordId = (await collectProfileRecords(testRoot))[0].id;

        const seen: vscode.InputBoxOptions[] = [];
        const accepted = await promptForBinBaseAddress(uri, 4, {
            persist: true,
            ask: asking('0x08010000', seen),
        });

        assert.strictEqual(accepted, 0x08010000);
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].value, '0x08000000', 'prefilled from the bound profile');
        assert.strictEqual((await readProfileRecord(testRoot, recordId))?.baseAddress, 0x08010000);
    });

    test('a cancelled prompt returns null and leaves no profile behind', async () => {
        const uri = await writeImage();
        const accepted = await promptForBinBaseAddress(uri, 4, { persist: true, ask: asking(undefined) });

        assert.strictEqual(accepted, null);
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing');
        assert.strictEqual((await readJson(bindingsJsonUri(testRoot))).status, 'missing');
    });

    test('a comparison-only prompt never writes .hexscope', async () => {
        const uri = await writeImage();
        const seen: vscode.InputBoxOptions[] = [];
        const accepted = await resolveCompareBinBaseAddress(uri, 4, asking('0x20000000', seen));

        assert.strictEqual(accepted, 0x20000000);
        assert.strictEqual(seen[0].value, '0x00000000', 'unbound comparison prefills the default');
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing');
        assert.strictEqual((await readJson(bindingsJsonUri(testRoot))).status, 'missing');
    });

    test('a bound comparison uses the stored base silently', async () => {
        const uri = await writeImage();
        await persistBinBaseAddress(uri, 0x08000000);
        const seen: vscode.InputBoxOptions[] = [];

        const accepted = await resolveCompareBinBaseAddress(uri, 4, asking('0x99999999', seen));

        assert.strictEqual(accepted, 0x08000000);
        assert.strictEqual(seen.length, 0, 'no prompt for a bound image');
    });

    test('a persistence failure warns and still resolves the chosen address', async () => {
        const uri = await writeImage();
        // Block `.hexscope` with a plain file so the profile write must fail.
        const blocker = vscode.Uri.file(path.join(testRoot, '.hexscope'));
        await vscode.workspace.fs.writeFile(blocker, new TextEncoder().encode('not a directory'));
        assert.ok(await exists(blocker));

        const accepted = await promptForBinBaseAddress(uri, 4, { persist: true, ask: asking('0x1000') });
        assert.strictEqual(accepted, 0x1000, 'the session continues with the chosen base');
    });

    test('a newer registry is never clobbered and still resolves the chosen address', async () => {
        const uri = await writeImage();
        const hexscopeDir = vscode.Uri.file(path.join(testRoot, '.hexscope'));
        await vscode.workspace.fs.createDirectory(hexscopeDir);
        const newer = JSON.stringify({ version: 1, data: { schemaVersion: DATA_SCHEMA_VERSION + 1, records: [] } });
        await vscode.workspace.fs.writeFile(profilesJsonUri(testRoot), new TextEncoder().encode(newer));

        const accepted = await promptForBinBaseAddress(uri, 4, { persist: true, ask: asking('0x1000') });

        assert.strictEqual(accepted, 0x1000, 'the session continues with the chosen base');
        assert.strictEqual(await readText(profilesJsonUri(testRoot)), newer, 'the newer registry survives untouched');
        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0, bound: false });
    });

    test('an existing record without a base reads as the default', async () => {
        const uri = await writeImage();
        await writeProfileRecord(testRoot, emptyProfileRecord('profile_1', 'Boot'));
        await bindFile(testRoot, perFileRelativePath(testRoot, uri), 'profile_1');

        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0, bound: true });
        await persistBinBaseAddress(uri, 0);
        assert.strictEqual((await readProfileRecord(testRoot, 'profile_1'))?.baseAddress, 0);
    });
});
