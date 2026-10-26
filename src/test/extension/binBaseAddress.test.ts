// ── Raw-binary base-address host helpers (extension host) ─────────
// The base lives per file in `bindings.json` (`binBases`), independent of
// profiles. Opening/compare never prompt and never write; only an explicit
// save persists a value.

import * as assert from 'assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as binBaseAddressModule from '../../binBaseAddress';
import {
    effectiveBinBaseAddress,
    readStoredBinBaseAddress,
    resolveCompareBinBaseAddress,
    resolveOpenBinBaseAddress,
    saveBinBaseAddress,
} from '../../binBaseAddress';
import {
    DATA_SCHEMA_VERSION,
    bindingsJsonUri,
    boundProfileId,
    collectProfileRecords,
    profilesJsonUri,
    readJson,
    writeBinBase,
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

suite('binBaseAddress', () => {
    setup(makeTestRoot);
    teardown(removeTestRoot);

    test('an unbound image reads default 0 and opening writes nothing', async () => {
        const uri = await writeImage();
        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0, hasBaseAddress: false });
        assert.strictEqual(await resolveOpenBinBaseAddress(uri, 4), 0);
        assert.strictEqual(await exists(vscode.Uri.file(path.join(testRoot, '.hexscope'))), false, 'no .hexscope on open');
        assert.strictEqual((await readJson(bindingsJsonUri(testRoot))).status, 'missing');
    });

    test('the prompt surface is gone (no input-box helper exported)', () => {
        assert.ok(!('promptForBinBaseAddress' in binBaseAddressModule));
        assert.ok(!('persistBinBaseAddress' in binBaseAddressModule));
        assert.ok(!('resolveStoredOrPrompt' in binBaseAddressModule));
    });

    test('saving writes only the binBases entry (no profile, no binding, no profiles.json)', async () => {
        const uri = await writeImage();

        assert.strictEqual(await saveBinBaseAddress(uri, 0x08000000), true);

        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0x08000000, hasBaseAddress: true });
        assert.deepStrictEqual(await bindingsEntries(), { bindings: [], binBases: [{ fileKey: 'boot.bin', baseAddress: 0x08000000 }] });
        assert.strictEqual((await readJson(profilesJsonUri(testRoot))).status, 'missing', 'no profile registry is created');
        assert.strictEqual(await boundProfileId(testRoot, 'boot.bin'), null, 'the file stays No Profile');
        assert.deepStrictEqual(await collectProfileRecords(testRoot), []);
    });

    test('the stored value survives reopen and reopening does not rewrite bindings.json', async () => {
        const uri = await writeImage();
        await saveBinBaseAddress(uri, 0x08000000);
        const before = await readText(bindingsJsonUri(testRoot));

        assert.strictEqual(await resolveOpenBinBaseAddress(uri, 4), 0x08000000);
        assert.strictEqual(await readText(bindingsJsonUri(testRoot)), before, 'no write on reopen');
    });

    test('an explicit zero counts as stored', async () => {
        const uri = await writeImage();
        await saveBinBaseAddress(uri, 0);

        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0, hasBaseAddress: true });
        assert.strictEqual(await resolveOpenBinBaseAddress(uri, 4), 0);
        assert.deepStrictEqual(await bindingsEntries(), { bindings: [], binBases: [{ fileKey: 'boot.bin', baseAddress: 0 }] });
    });

    test('saving the same value again does not rewrite bindings.json', async () => {
        const uri = await writeImage();
        await saveBinBaseAddress(uri, 0x1000);
        const before = await readText(bindingsJsonUri(testRoot));

        assert.strictEqual(await saveBinBaseAddress(uri, 0x1000), true);
        assert.strictEqual(await readText(bindingsJsonUri(testRoot)), before);
    });

    test('a stored base that no longer fits falls back to 0 with one warning', async () => {
        const uri = await writeImage();
        await writeBinBase(testRoot, 'boot.bin', 0xFFFFFFFF);
        const warnings: string[] = [];

        assert.strictEqual(await resolveOpenBinBaseAddress(uri, 4, message => warnings.push(message)), 0);
        assert.strictEqual(warnings.length, 1, 'warns once');
        assert.match(warnings[0], /does not fit this file/);
        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0xFFFFFFFF, hasBaseAddress: true }, 'the stored entry survives until a new commit');
    });

    test('compare and open resolve the same effective base', async () => {
        const uri = await writeImage();
        await saveBinBaseAddress(uri, 0x2000);

        assert.strictEqual(await resolveCompareBinBaseAddress(uri, 4), await resolveOpenBinBaseAddress(uri, 4));
        assert.strictEqual(await resolveCompareBinBaseAddress(uri, 4), 0x2000);
    });

    test('an overflowing stored base resolves to 0 for compare too', async () => {
        const uri = await writeImage();
        await writeBinBase(testRoot, 'boot.bin', 0xFFFFFFFF);

        assert.strictEqual(await resolveCompareBinBaseAddress(uri, 4), 0);
    });

    test('a corrupt binding table falls back to the default base', async () => {
        const uri = await writeImage();
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(testRoot, '.hexscope')));
        await vscode.workspace.fs.writeFile(bindingsJsonUri(testRoot), new TextEncoder().encode('{ not json'));

        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0, hasBaseAddress: false });
        assert.strictEqual(await resolveOpenBinBaseAddress(uri, 4), 0);
    });

    test('a persistence failure warns and reports false without creating .hexscope', async () => {
        const uri = await writeImage();
        // Block `.hexscope` with a plain file so the binding write must fail.
        const blocker = vscode.Uri.file(path.join(testRoot, '.hexscope'));
        await vscode.workspace.fs.writeFile(blocker, new TextEncoder().encode('not a directory'));
        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = () => { /* keep the diagnostic out of the test output */ };
        try {
            assert.strictEqual(await saveBinBaseAddress(uri, 0x1000, message => warnings.push(message)), false);
        } finally {
            console.warn = originalWarn;
        }
        assert.strictEqual(warnings.length, 1, 'one warning');
        assert.match(warnings[0], /could not save the base address/);
        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0, hasBaseAddress: false });
    });

    test('a newer binding table is never clobbered and reports a persistence failure', async () => {
        const uri = await writeImage();
        const hexscopeDir = vscode.Uri.file(path.join(testRoot, '.hexscope'));
        await vscode.workspace.fs.createDirectory(hexscopeDir);
        const newer = JSON.stringify({ version: 1, data: { schemaVersion: DATA_SCHEMA_VERSION + 1, bindings: [], binBases: [] } });
        await vscode.workspace.fs.writeFile(bindingsJsonUri(testRoot), new TextEncoder().encode(newer));
        let warned = 0;
        const originalWarn = console.warn;
        console.warn = () => { /* keep the diagnostic out of the test output */ };
        try {
            assert.strictEqual(await saveBinBaseAddress(uri, 0x1000, () => { warned += 1; }), false);
        } finally {
            console.warn = originalWarn;
        }
        assert.strictEqual(warned, 1);
        assert.strictEqual(await readText(bindingsJsonUri(testRoot)), newer, 'the newer table survives untouched');
        assert.deepStrictEqual(await readStoredBinBaseAddress(uri), { value: 0, hasBaseAddress: false });
    });

    test('effectiveBinBaseAddress returns 0 for an absent or overflowing stored value', () => {
        assert.strictEqual(effectiveBinBaseAddress({ value: 0, hasBaseAddress: false }, 4), 0);
        assert.strictEqual(effectiveBinBaseAddress({ value: 0x1000, hasBaseAddress: true }, 4), 0x1000);
        assert.strictEqual(effectiveBinBaseAddress({ value: 0xFFFFFFFF, hasBaseAddress: true }, 4), 0);
    });

    async function bindingsEntries(): Promise<{ bindings: unknown[]; binBases: unknown[] }> {
        const read = await readJson(bindingsJsonUri(testRoot));
        assert.strictEqual(read.status, 'ok');
        const data = (read.status === 'ok' ? read.value : {}) as { bindings?: unknown[]; binBases?: unknown[] };
        return { bindings: data.bindings ?? [], binBases: data.binBases ?? [] };
    }
});
