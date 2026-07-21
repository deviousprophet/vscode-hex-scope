import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import * as assert from 'assert';
import { execute, scanScripts } from '../../core/scripting/scriptRunner';
import { isScriptFile, readScript } from '../../core/scripting/scriptCompiler';
import type { ScriptHost as IScriptHost } from '../../core/scripting/types';
import { VSCodeScriptHost } from '../../scriptHost';

function makeHost(overrides: Partial<IScriptHost> = {}): IScriptHost {
    const log: string[] = [];
    const results: Array<{ label: string; value: string }> = [];
    return {
        readBytes(address, length) {
            const bytes: number[] = [];
            for (let i = 0; i < length; i++) {
                const addr = address + i;
                if (addr >= 0 && addr <= 0xFF) { bytes.push(addr & 0xFF); }
            }
            return Uint8Array.from(bytes);
        },
        writeBytes(address, data) { return true; },
        totalSize: 256,
        confirm: async () => false,
        output(text) { log.push(text); },
        setResult(label, value) { results.push({ label, value }); },
        ...overrides,
        ...{ _log: log, _results: results },
    } as IScriptHost & { _log: string[]; _results: Array<{ label: string; value: string }> };
}

function writeScript(dir: string, name: string, code: string): string {
    const fp = path.join(dir, name);
    fs.writeFileSync(fp, code, 'utf-8');
    return fp;
}

function tmpDir(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'hex-scope-script-'));
}

function rmDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

suite('scriptRunner', () => {

test('executes a script with a run function', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'test.js', `module.exports = { run(api) { api.output('hello'); } };`);
        const host = makeHost();
        const out = await execute(fp, host);
        assert.equal(out.error, undefined);
        assert.ok((host as any)._log.includes('hello'));
    } finally { rmDir(dir); }
});

test('returns error when script has no run export', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'test.js', `module.exports = { };`);
        const out = await execute(fp, makeHost());
        assert.ok(out.error?.includes('run'));
    } finally { rmDir(dir); }
});

test('catches runtime error in script', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'test.js', `module.exports = { run(api) { throw new Error('boom'); } };`);
        const out = await execute(fp, makeHost());
        assert.ok(out.error?.includes('boom'));
    } finally { rmDir(dir); }
});

test('returns error for non-existent file', async () => {
    const out = await execute(path.join(tmpdir(), 'nope.js'), makeHost());
    assert.ok(out.error);
});

test('times out a never-resolving promise', async function () {
    this.timeout(5000);
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'hang.js', `module.exports = { run(api) { return new Promise(() => {}); } };`);
        const out = await execute(fp, makeHost(), 200);
        assert.ok(out.error, 'expected timeout error: ' + out.error);
    } finally { rmDir(dir); }
});

test('supports script that returns promise', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'async.js', `module.exports = { run: async (api) => { api.output('async done'); } };`);
        const host = makeHost();
        const out = await execute(fp, host);
        assert.equal(out.error, undefined);
        assert.ok((host as any)._log.includes('async done'));
    } finally { rmDir(dir); }
});

test('supports hex.read API', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'hexread.js', `
            module.exports = { run(api) {
                const data = api.hex.read(0, 4);
                api.output(data.length.toString());
            }};
        `);
        const host = makeHost();
        const out = await execute(fp, host);
        assert.equal(out.error, undefined);
        assert.ok((host as any)._log.includes('4'));
    } finally { rmDir(dir); }
});

test('supports crc API', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'crc.js', `
            module.exports = { run(api) {
                const v = api.crc.crc32([0x31, 0x32, 0x33, 0x34]);
                api.output(v.toString(16));
            }};
        `);
        const host = makeHost();
        const out = await execute(fp, host);
        assert.equal(out.error, undefined);
        assert.ok((host as any)._log.some((l: string) => l.includes('9be3e0a3')));
    } finally { rmDir(dir); }
});

test('supports setResult API', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'result.js', `module.exports = { run(api) { api.setResult('key', 'val'); } };`);
        const host = makeHost();
        const out = await execute(fp, host);
        assert.equal(out.error, undefined);
    } finally { rmDir(dir); }
});

test('hex.write calls confirm and respects denial', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'write.js', `
            module.exports = { run(api) {
                api.hex.write(0, new Uint8Array([0xAA])).then(ok => api.output(ok ? 'allowed' : 'denied'));
            }};
        `);
        const host = makeHost({ confirm: async () => false });
        const out = await execute(fp, host, 500);
        assert.equal(out.error, undefined);
    } finally { rmDir(dir); }
});

test('hex.write calls confirm and proceeds when allowed', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'writeok.js', `
            module.exports = { run(api) {
                api.hex.write(0, new Uint8Array([0xBB])).then(ok => api.output(ok ? 'allowed' : 'denied'));
            }};
        `);
        const host = makeHost({ confirm: async () => true, writeBytes: () => true });
        const out = await execute(fp, host, 500);
        assert.equal(out.error, undefined);
        assert.ok((host as any)._log.includes('allowed'), 'expected allowed');
    } finally { rmDir(dir); }
});

test('exec calls confirm and returns null when denied', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'exec.js', `
            module.exports = { run(api) {
                api.exec('ls').then(r => api.output(r === null ? 'denied' : 'ran'));
            }};
        `);
        const host = makeHost({ confirm: async () => false });
        const out = await execute(fp, host, 500);
        assert.equal(out.error, undefined);
    } finally { rmDir(dir); }
});

test('scanScripts returns scripts from .hexscope/scripts/', async () => {
    const dir = tmpDir();
    try {
        const scriptsDir = path.join(dir, '.hexscope', 'scripts');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.writeFileSync(path.join(scriptsDir, 'a.js'), '', 'utf-8');
        fs.writeFileSync(path.join(scriptsDir, 'b.ts'), '', 'utf-8');
        fs.writeFileSync(path.join(scriptsDir, 'readme.txt'), '', 'utf-8');
        const scripts = scanScripts(dir);
        assert.equal(scripts.length, 2);
        assert.ok(scripts.some(s => s.name === 'a.js'));
        assert.ok(scripts.some(s => s.name === 'b.ts'));
    } finally { rmDir(dir); }
});

test('scanScripts returns empty for missing dir', () => {
    assert.deepEqual(scanScripts(tmpdir()), []);
});

test('isScriptFile recognizes .js and .ts', () => {
    assert.equal(isScriptFile('foo.js'), true);
    assert.equal(isScriptFile('foo.ts'), true);
    assert.equal(isScriptFile('foo.txt'), false);
    assert.equal(isScriptFile('foo'), false);
});

test('readScript reads file content', () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'hello.js', 'console.log(1);');
        assert.equal(readScript(fp), 'console.log(1);');
    } finally { rmDir(dir); }
});

test('real-world: CRC verify script', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'verify-crc.js', `
            module.exports = { run(api) {
                const data = api.hex.read(0, 16);
                const hash = api.crc.crc32([...data]);
                api.setResult('CRC32', '0x' + hash.toString(16).toUpperCase().padStart(8, '0'));
                api.output('Computed CRC32 over 16 bytes');
            }};
        `);
        const host = makeHost();
        const out = await execute(fp, host);
        assert.equal(out.error, undefined);
    } finally { rmDir(dir); }
});

test('real-world: SHA-256 hash calculation', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'sha-test.js', `
            module.exports = { run: async (api) => {
                const data = api.hex.read(0, 32);
                const digest = await api.hash.sha256(data);
                api.setResult('SHA-256', [...digest].map(b => b.toString(16).padStart(2, '0')).join(''));
            }};
        `);
        const host = makeHost();
        const out = await execute(fp, host, 5000);
        assert.equal(out.error, undefined);
    } finally { rmDir(dir); }
});

test('real-world: fix byte with confirmation', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'fix-byte.js', `
            module.exports = { run: async (api) => {
                const ok = await api.hex.write(0, new Uint8Array([0xFF]));
                api.setResult('Fixed', ok ? 'yes' : 'no');
            }};
        `);
        const host = makeHost({ confirm: async () => true, writeBytes: () => true });
        const out = await execute(fp, host, 500);
        assert.equal(out.error, undefined);
    } finally { rmDir(dir); }
});

test('real-world: search pattern across range', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'find-pattern.js', `
            module.exports = { run(api) {
                const data = api.hex.read(0, 256);
                let count = 0;
                for (let i = 0; i < data.length - 1; i++) {
                    if (data[i] === 0xAA && data[i+1] === 0xBB) { count++; }
                }
                api.setResult('Matches', count.toString());
            }};
        `);
        const host = makeHost();
        const out = await execute(fp, host, 1000);
        assert.equal(out.error, undefined);
    } finally { rmDir(dir); }
});

test('executes .ts script when esbuild is available', async () => {
    const dir = tmpDir();
    try {
        const fp = writeScript(dir, 'typescript-test.ts', `
            export function run(api: any) {
                api.output('ts works');
            }
        `);
        const host = makeHost();
        const out = await execute(fp, host);
        if (out.error?.includes('esbuild')) { return; }
        assert.equal(out.error, undefined);
        assert.ok((host as any)._log.includes('ts works'));
    } finally { rmDir(dir); }
});

test('VSCodeScriptHost readBytes returns edits before source data', () => {
    const seg = { startAddress: 0x100, data: new Uint8Array([0xAA, 0xBB, 0xCC]) };
    const host = new VSCodeScriptHost([seg], {
        output: () => {}, setResult: () => {}, confirm: async () => false,
    });
    host.writeBytes(0x101, new Uint8Array([0xFF]));
    const result = host.readBytes(0x100, 3);
    assert.equal(result.length, 3);
    assert.equal(result[0], 0xAA);
    assert.equal(result[1], 0xFF);
    assert.equal(result[2], 0xCC);
});

test('VSCodeScriptHost readBytes returns empty for unmapped address', () => {
    const seg = { startAddress: 0x100, data: new Uint8Array([0xAA]) };
    const host = new VSCodeScriptHost([seg], {
        output: () => {}, setResult: () => {}, confirm: async () => false,
    });
    assert.equal(host.readBytes(0x200, 1).length, 0);
});

test('VSCodeScriptHost totalSize sums all segments', () => {
    const host = new VSCodeScriptHost([
        { startAddress: 0, data: new Uint8Array([1, 2]) },
        { startAddress: 10, data: new Uint8Array([3]) },
    ], { output: () => {}, setResult: () => {}, confirm: async () => false });
    assert.equal(host.totalSize, 3);
});

});
