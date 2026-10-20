import * as assert from 'assert';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
    MAX_INTEGRITY_EDIT_ENTRIES,
    resolveIntegrityScriptPath,
    runIntegrityScript,
    withRelativeScriptPaths,
    workspaceRelativeScriptPath,
} from '../../integrityScriptRunner';
import type { MemorySegment } from '../../core/parser/types';

const SEGMENTS: MemorySegment[] = [{ startAddress: 0x1000, data: new Uint8Array([1, 2, 3, 4]) }];

function tmpDir(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'hex-scope-integrity-script-'));
}

function rmDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

function writeScript(dir: string, name: string, code: string): string {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, code, 'utf-8');
    return filePath;
}

function baseInput(dir: string, scriptPath: string, overrides: Partial<Parameters<typeof runIntegrityScript>[0]> = {}) {
    return {
        root: dir,
        scriptPath,
        segments: SEGMENTS,
        edits: [] as Array<[number, number]>,
        trusted: true,
        startAddress: 0x1000,
        endAddress: 0x1003,
        confirm: async () => false,
        ...overrides,
    };
}

suite('integrity script runner', () => {
    test('verify-only matches the range and reports byteCount', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'verify.js', `
                module.exports = {
                    verifyIntegrity(api) {
                        const data = api.hex.read(api.context.selection.start, 4);
                        return data[0] === 1 && data[3] === 4;
                    },
                };
            `);
            const outcome = await runIntegrityScript(baseInput(dir, 'verify.js'));
            assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
            if (!outcome.ok) { return; }
            assert.strictEqual(outcome.value.valid, true);
            assert.strictEqual(outcome.value.valueBytes, undefined);
            assert.strictEqual(outcome.value.byteCount, 4);
            assert.strictEqual(outcome.value.scriptName, 'verify.js');
            assert.deepStrictEqual(outcome.value.warnings, []);
        } finally { rmDir(dir); }
    });

    test('value-only returns bytes verbatim', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'value.js', `
                module.exports = { getIntegrityValue() { return new Uint8Array([0xAA, 0xBB]); } };
            `);
            const outcome = await runIntegrityScript(baseInput(dir, 'value.js'));
            assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
            if (!outcome.ok) { return; }
            assert.deepStrictEqual(outcome.value.valueBytes, [0xAA, 0xBB]);
            assert.strictEqual(outcome.value.valid, undefined);
            assert.strictEqual(outcome.value.byteCount, 2);
        } finally { rmDir(dir); }
    });

    test('both exports: verify is authoritative and value bytes are retained', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'both.js', `
                module.exports = {
                    getIntegrityValue() { return [7, 8]; },
                    verifyIntegrity() { return false; },
                };
            `);
            const outcome = await runIntegrityScript(baseInput(dir, 'both.js'));
            assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
            if (!outcome.ok) { return; }
            assert.strictEqual(outcome.value.valid, false);
            assert.deepStrictEqual(outcome.value.valueBytes, [7, 8]);
        } finally { rmDir(dir); }
    });

    test('a value contract error does not erase a valid verify result', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'partial.js', `
                module.exports = {
                    getIntegrityValue() { return 'nope'; },
                    verifyIntegrity() { return true; },
                };
            `);
            const outcome = await runIntegrityScript(baseInput(dir, 'partial.js'));
            assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
            if (!outcome.ok) { return; }
            assert.strictEqual(outcome.value.valid, true);
            assert.strictEqual(outcome.value.valueBytes, undefined);
            assert.strictEqual(outcome.value.warnings.length, 1);
            assert.match(outcome.value.warnings[0], /getIntegrityValue/);
        } finally { rmDir(dir); }
    });

    test('a non-boolean verify result is a contract error', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'bad-verify.js', `
                module.exports = { verifyIntegrity() { return 'yes'; } };
            `);
            const outcome = await runIntegrityScript(baseInput(dir, 'bad-verify.js'));
            assert.strictEqual(outcome.ok, false);
            if (outcome.ok) { return; }
            assert.strictEqual(outcome.errorType, 'contract');
            assert.match(outcome.error, /verifyIntegrity/);
        } finally { rmDir(dir); }
    });

    test('an empty value array is a contract error', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'empty.js', `
                module.exports = { getIntegrityValue() { return []; } };
            `);
            const outcome = await runIntegrityScript(baseInput(dir, 'empty.js'));
            assert.strictEqual(outcome.ok, false);
            if (outcome.ok) { return; }
            assert.strictEqual(outcome.errorType, 'contract');
        } finally { rmDir(dir); }
    });

    test('a script with neither contract export reports a contract error', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'none.js', `module.exports = { run() {} };`);
            const outcome = await runIntegrityScript(baseInput(dir, 'none.js'));
            assert.strictEqual(outcome.ok, false);
            if (outcome.ok) { return; }
            assert.strictEqual(outcome.errorType, 'contract');
            assert.match(outcome.error, /verifyIntegrity.*getIntegrityValue/);
        } finally { rmDir(dir); }
    });

    test('a missing script reports Script not found and keeps the path', async () => {
        const dir = tmpDir();
        try {
            const outcome = await runIntegrityScript(baseInput(dir, '.hexscope/scripts/gone.js'));
            assert.strictEqual(outcome.ok, false);
            if (outcome.ok) { return; }
            assert.match(outcome.error, /Script not found: \.hexscope\/scripts\/gone\.js/);
        } finally { rmDir(dir); }
    });

    test('an untrusted workspace never executes', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'verify.js', `module.exports = { verifyIntegrity() { return true; } };`);
            const outcome = await runIntegrityScript(baseInput(dir, 'verify.js', { trusted: false }));
            assert.strictEqual(outcome.ok, false);
            if (outcome.ok) { return; }
            assert.match(outcome.error, /not trusted/i);
        } finally { rmDir(dir); }
    });

    test('pending edits are overlaid on the parsed bytes', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'read.js', `
                module.exports = { getIntegrityValue(api) { return [...api.hex.read(0x1000, 2)]; } };
            `);
            const outcome = await runIntegrityScript(baseInput(dir, 'read.js', { edits: [[0x1000, 0xEE]] }));
            assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
            if (!outcome.ok) { return; }
            assert.deepStrictEqual(outcome.value.valueBytes, [0xEE, 2]);
        } finally { rmDir(dir); }
    });

    test('the stored range is passed through context (length from a previous value)', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'context.js', `
                module.exports = {
                    verifyIntegrity(api) {
                        return api.context.storedStart === 0x1002 && api.context.storedEnd === 0x1003;
                    },
                };
            `);
            const outcome = await runIntegrityScript(baseInput(dir, 'context.js', {
                storedAddress: 0x1002,
                storedLength: 2,
            }));
            assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
            if (!outcome.ok) { return; }
            assert.strictEqual(outcome.value.valid, true);
        } finally { rmDir(dir); }
    });

    test('too many pending edits is refused before execution', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'verify.js', `module.exports = { verifyIntegrity() { return true; } };`);
            const edits: Array<[number, number]> = Array.from(
                { length: MAX_INTEGRITY_EDIT_ENTRIES + 1 },
                (_, index) => [index, 0],
            );
            const outcome = await runIntegrityScript(baseInput(dir, 'verify.js', { edits }));
            assert.strictEqual(outcome.ok, false);
            if (outcome.ok) { return; }
            assert.match(outcome.error, /Too many pending edits/);
        } finally { rmDir(dir); }
    });

    test('script paths resolve inside the root and persist workspace-relative', () => {
        const root = path.resolve('workspace');
        assert.strictEqual(resolveIntegrityScriptPath(root, '../outside.js'), null);
        assert.strictEqual(resolveIntegrityScriptPath(root, ''), null);
        assert.strictEqual(
            resolveIntegrityScriptPath(root, '.hexscope/scripts/a.js'),
            path.resolve(root, '.hexscope', 'scripts', 'a.js'),
        );
        assert.strictEqual(workspaceRelativeScriptPath(root, path.resolve(root, '.hexscope', 'scripts', 'a.js')), '.hexscope/scripts/a.js');
    });

    test('withRelativeScriptPaths rewrites script checks only', () => {
        const root = path.resolve('workspace');
        const rewritten = withRelativeScriptPaths(root, {
            schemaVersion: 1,
            checks: [
                { kind: 'builtin', algorithm: 'md5', startAddress: 0, endAddress: 1, autoFixStoredValue: false },
                {
                    kind: 'script',
                    scriptPath: path.resolve(root, '.hexscope', 'scripts', 'a.js'),
                    startAddress: 0, endAddress: 1, autoFixStoredValue: false,
                },
            ],
        });
        assert.strictEqual(rewritten.checks[0].kind, 'builtin');
        assert.deepStrictEqual(rewritten.checks[1], {
            kind: 'script',
            scriptPath: '.hexscope/scripts/a.js',
            startAddress: 0, endAddress: 1, autoFixStoredValue: false,
        });
    });
});
