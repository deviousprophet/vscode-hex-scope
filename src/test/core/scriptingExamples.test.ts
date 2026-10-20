import * as assert from 'assert';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { crc32 } from '../../core/byteTools/crc';
import { EXAMPLE_INSTALL_FILES, installExampleScripts } from '../../core/scripting/examples';
import { execute, executeEntry, scanScripts, type ScriptInfo } from '../../core/scripting/scriptRunner';
import type { ScriptHost } from '../../core/scripting/types';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXAMPLES_ROOT = path.join(REPO_ROOT, 'examples');
const SCRIPTS_ROOT = path.join(EXAMPLES_ROOT, 'scripts');

/** The reviewed catalog, exactly as it ships (no generated files). */
const CATALOG_FILES = [
    'README.md',
    'tsconfig.json',
    'scripts/types/hexscope.d.ts',
    'scripts/verify-crc.ts',
    'scripts/write-pattern.js',
    'scripts/follow-pointer.ts',
    'scripts/array-size-from-header.ts',
    'scripts/verify-integrity.ts',
];

const CRC_START = 0x08000000;

type MockHost = {
    host: ScriptHost;
    log: string[];
    results: Array<{ label: string; value: string }>;
    writes: Array<{ address: number; data: number[] }>;
    confirms: string[];
};

/** Consecutive bytes starting at `start`; every address outside `values` is unmapped. */
function memory(start: number, values: number[]): Map<number, number> {
    const map = new Map<number, number>();
    values.forEach((value, index) => map.set(start + index, value));
    return map;
}

function makeHost(bytes: Map<number, number>, allowWrite = false): MockHost {
    const log: string[] = [];
    const results: Array<{ label: string; value: string }> = [];
    const writes: Array<{ address: number; data: number[] }> = [];
    const confirms: string[] = [];
    const host: ScriptHost = {
        readBytes(address, length) {
            const out: number[] = [];
            for (let i = 0; i < length; i++) {
                const byte = bytes.get(address + i);
                if (byte === undefined) { break; }
                out.push(byte);
            }
            return Uint8Array.from(out);
        },
        writeBytes(address, data) {
            writes.push({ address, data: [...data] });
            return true;
        },
        totalSize: bytes.size,
        confirm: async type => { confirms.push(type); return allowWrite; },
        output: text => { log.push(text); },
        setResult: (label, value) => { results.push({ label, value }); },
        assert: (condition, label) => { results.push({ label, value: condition ? 'PASS' : 'FAIL' }); },
        collectOutput: () => ({ results: [...results], log: [...log] }),
    };
    return { host, log, results, writes, confirms };
}

function catalogPath(...parts: string[]): string {
    return path.join(SCRIPTS_ROOT, ...parts);
}

function catalogSource(source: string): string {
    return path.join(EXAMPLES_ROOT, ...source.split('/'));
}

function resultValue(rows: Array<{ label: string; value: string }>, label: string): string | undefined {
    return rows.find(row => row.label === label)?.value;
}

function tempRoot(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'hexscope-examples-'));
}

function relativeCatalogFiles(): string[] {
    return fs.readdirSync(EXAMPLES_ROOT, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => fs.statSync(path.join(EXAMPLES_ROOT, ...entry.split('/'))).isFile())
        .sort();
}

function isCatalogFileKind(file: string): boolean {
    return /\.(ts|js|md|json)$/i.test(file);
}

function rolesOf(scripts: ScriptInfo[], name: string): string[] | undefined {
    return scripts.find(script => script.name === name)?.roles;
}

function capabilitiesOf(scripts: ScriptInfo[], name: string): string[] | undefined {
    return scripts.find(script => script.name === name)?.capabilities;
}

function hasDeclarationFile(scripts: ScriptInfo[]): boolean {
    return scripts.some(script => script.name.endsWith('.d.ts'));
}

suite('scripting examples catalog', () => {

test('the bundled catalog contains exactly the reviewed files', () => {
    assert.deepStrictEqual(relativeCatalogFiles(), [...CATALOG_FILES].sort());
});

test('every catalog file is a non-empty script/document of the expected extension', () => {
    for (const file of CATALOG_FILES) {
        const full = path.join(EXAMPLES_ROOT, ...file.split('/'));
        assert.ok(fs.existsSync(full), `catalog file ${file} must exist`);
        assert.ok(fs.readFileSync(full, 'utf-8').trim().length > 0, `${file} must not be empty`);
        assert.ok(isCatalogFileKind(file), `${file} must be a script, declaration, doc, or build file`);
    }
});

test('the install manifest copies the five examples plus the type definition', () => {
    const targets = EXAMPLE_INSTALL_FILES.map(file => file.target);
    assert.deepStrictEqual(targets, [
        '.hexscope/scripts/verify-crc.ts',
        '.hexscope/scripts/write-pattern.js',
        '.hexscope/scripts/follow-pointer.ts',
        '.hexscope/scripts/array-size-from-header.ts',
        '.hexscope/scripts/verify-integrity.ts',
        '.hexscope/scripts/types/hexscope.d.ts',
    ]);
    for (const file of EXAMPLE_INSTALL_FILES) {
        assert.ok(fs.existsSync(catalogSource(file.source)), `manifest source ${file.source} exists`);
    }
    const sources = EXAMPLE_INSTALL_FILES.map(file => file.source).sort();
    const catalogScripts = CATALOG_FILES.filter(file => file.startsWith('scripts/')).sort();
    assert.deepStrictEqual(sources, catalogScripts, 'every catalog script and the type definition are installable');
    assert.strictEqual(catalogScripts.filter(file => !file.endsWith('.d.ts')).length, 5, 'five runnable examples');
});

test('scanning an installed workspace lists the five scripts and skips the .d.ts', () => {
    const root = tempRoot();
    try {
        installExampleScripts(EXAMPLES_ROOT, root);
        const scripts = scanScripts(root);
        assert.deepStrictEqual(scripts.map(script => script.name), [
            'array-size-from-header.ts',
            'follow-pointer.ts',
            'verify-crc.ts',
            'verify-integrity.ts',
            'write-pattern.js',
        ]);
        assert.deepStrictEqual(rolesOf(scripts, 'follow-pointer.ts'), ['address']);
        assert.deepStrictEqual(rolesOf(scripts, 'array-size-from-header.ts'), ['size']);
        assert.deepStrictEqual(rolesOf(scripts, 'verify-integrity.ts'), ['integrity']);
        assert.deepStrictEqual(rolesOf(scripts, 'verify-crc.ts'), []);
        assert.deepStrictEqual(capabilitiesOf(scripts, 'write-pattern.js'), ['write']);
        assert.ok(!hasDeclarationFile(scripts), 'the type definition is not runnable');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

});

suite('scripting examples run against a mock host', () => {

test('verify-crc.ts reads its range, CRCs it, and asks for no approval', async () => {
    const bytes = Array.from({ length: 256 }, (_, index) => index & 0xFF);
    const mock = makeHost(memory(CRC_START, bytes));
    const out = await execute(catalogPath('verify-crc.ts'), mock.host);
    assert.strictEqual(out.error, undefined);
    assert.strictEqual(
        resultValue(mock.results, 'CRC32'),
        `0x${crc32(bytes).toString(16).toUpperCase().padStart(8, '0')}`,
    );
    assert.strictEqual(resultValue(mock.results, 'Range'), `0x${CRC_START.toString(16).toUpperCase()} + 256 byte(s)`);
    assert.match(mock.log.join('\n'), /Computed CRC32 over 256 byte\(s\)/);
    assert.deepStrictEqual(mock.confirms, [], 'read-only examples never prompt');
});

test('verify-crc.ts reports an unmapped range instead of a bogus checksum', async () => {
    const mock = makeHost(new Map());
    const out = await execute(catalogPath('verify-crc.ts'), mock.host);
    assert.strictEqual(out.error, undefined);
    assert.strictEqual(resultValue(mock.results, 'CRC32'), undefined);
    assert.match(mock.log.join('\n'), /No mapped bytes/);
});

test('write-pattern.js stages one approved write and reports it', async () => {
    const mock = makeHost(memory(CRC_START, [0, 0, 0, 0]), true);
    const out = await execute(catalogPath('write-pattern.js'), mock.host);
    assert.strictEqual(out.error, undefined);
    assert.strictEqual(resultValue(mock.results, 'Write approved'), 'Yes');
    assert.deepStrictEqual(mock.confirms, ['write'], 'exactly one approval prompt');
    assert.deepStrictEqual(mock.writes, [{ address: CRC_START, data: [0xDE, 0xAD, 0xBE, 0xEF] }]);
    assert.match(mock.log.join('\n'), /Ctrl\+Z restores/);
});

test('write-pattern.js writes nothing when the approval is denied', async () => {
    const mock = makeHost(memory(CRC_START, [0, 0, 0, 0]), false);
    const out = await execute(catalogPath('write-pattern.js'), mock.host);
    assert.strictEqual(out.error, undefined);
    assert.strictEqual(resultValue(mock.results, 'Write approved'), 'No');
    assert.deepStrictEqual(mock.writes, []);
    assert.match(mock.log.join('\n'), /Write denied/);
});

test('follow-pointer.ts returns the little-endian pointer as an address', async () => {
    const mock = makeHost(memory(CRC_START, [0x00, 0x01, 0x00, 0x08]));
    const out = await executeEntry(catalogPath('follow-pointer.ts'), 'getAddress', mock.host);
    assert.strictEqual(out.error, undefined);
    assert.strictEqual(out.value, 0x08000100);
});

test('follow-pointer.ts fails loudly when its pointer is unmapped', async () => {
    const out = await executeEntry(catalogPath('follow-pointer.ts'), 'getAddress', makeHost(new Map()).host);
    assert.strictEqual(out.errorType, 'runtime');
    assert.match(out.error ?? '', /pointer mapped at 0x8000000/);
    assert.strictEqual(out.value, undefined);
});

test('array-size-from-header.ts resolves its own parameter and falls back elsewhere', async () => {
    const mock = makeHost(memory(0x08000010, [0x05, 0x00]));
    const own = await executeEntry(catalogPath('array-size-from-header.ts'), 'getSize', mock.host, {
        context: { param: 'ITEM_COUNT' },
    });
    assert.strictEqual(own.error, undefined);
    assert.strictEqual(own.value, 5);

    const other = await executeEntry(catalogPath('array-size-from-header.ts'), 'getSize', mock.host, {
        context: { param: 'OTHER_PARAM' },
    });
    assert.strictEqual(other.value, 1, 'a different parameter still gets a positive size');
});

test('array-size-from-header.ts returns a positive size when the count is unmapped or zero', async () => {
    const unmapped = await executeEntry(catalogPath('array-size-from-header.ts'), 'getSize', makeHost(new Map()).host, {
        context: { param: 'ITEM_COUNT' },
    });
    assert.strictEqual(unmapped.value, 1);

    const zero = await executeEntry(catalogPath('array-size-from-header.ts'), 'getSize', makeHost(memory(0x08000010, [0, 0])).host, {
        context: { param: 'ITEM_COUNT' },
    });
    assert.strictEqual(zero.value, 1);
});

test('verify-integrity.ts sums the check range, excluding the stored field', async () => {
    const mock = makeHost(memory(CRC_START, [0xFF, 0x02]));
    const context = { selection: { start: CRC_START, end: CRC_START + 1 }, storedStart: CRC_START, storedEnd: CRC_START };
    const value = await executeEntry(catalogPath('verify-integrity.ts'), 'getIntegrityValue', mock.host, { context });
    assert.strictEqual(value.error, undefined);
    assert.deepStrictEqual(value.value, [2], 'stored byte 0xFF is skipped');

    const verify = await executeEntry(catalogPath('verify-integrity.ts'), 'verifyIntegrity', mock.host, { context });
    assert.strictEqual(verify.value, false, 'stored 0xFF does not match the computed 0x02');
});

test('verify-integrity.ts passes when the stored byte matches the computed checksum', async () => {
    const mock = makeHost(memory(CRC_START, [1, 2, 3, 4, 10]));
    const context = {
        selection: { start: CRC_START, end: CRC_START + 3 },
        storedStart: CRC_START + 4,
        storedEnd: CRC_START + 4,
    };
    const value = await executeEntry(catalogPath('verify-integrity.ts'), 'getIntegrityValue', mock.host, { context });
    assert.deepStrictEqual(value.value, [10]);
    const verify = await executeEntry(catalogPath('verify-integrity.ts'), 'verifyIntegrity', mock.host, { context });
    assert.strictEqual(verify.value, true);
    assert.strictEqual(resultValue(mock.results, 'Computed'), '0x0A');
    assert.strictEqual(resultValue(mock.results, 'Stored'), '0x0A');
});

test('verify-integrity.ts is display-only without a stored field', async () => {
    const mock = makeHost(memory(CRC_START, [1, 2]));
    const context = { selection: { start: CRC_START, end: CRC_START + 1 } };
    const verify = await executeEntry(catalogPath('verify-integrity.ts'), 'verifyIntegrity', mock.host, { context });
    assert.strictEqual(verify.value, true);
    assert.strictEqual(resultValue(mock.results, 'Checksum'), '0x03');
});

});

suite('scripting examples type definition', () => {

test('hexscope.d.ts declares the public API surface referenced by the examples', () => {
    const dts = fs.readFileSync(catalogPath('types', 'hexscope.d.ts'), 'utf-8');
    const required = [
        'interface ExecResult',
        'interface FetchResult',
        'interface FetchOptions',
        'interface ScriptContext',
        'interface HexScopeAPI',
        'type ScriptRole',
        'read(address: number, length: number): Uint8Array',
        'readSelected(): Uint8Array',
        'write(address: number, data: Uint8Array): Promise<boolean>',
        'crc8(',
        'crc16(',
        'crc32(',
        'sha1(',
        'sha256(',
        'sha512(',
        'exec(command: string, args?: string[]): Promise<ExecResult | null>',
        'fetch(url: string, options?: FetchOptions): Promise<FetchResult | null>',
        'output(text: string): void',
        'setResult(label: string, value: string): void',
        'assert(condition: boolean, label: string): void',
        'context: ScriptContext',
        'maxSize?: number',
        'allowLoopback?: boolean',
    ];
    for (const member of required) {
        assert.ok(dts.includes(member), `hexscope.d.ts must declare ${member}`);
    }
    assert.ok(!/^\s*(import|export)\s/m.test(dts), 'the declaration file stays ambient (no top-level import/export)');
});

test('every typed example references the shipped declaration file', () => {
    const typed = CATALOG_FILES.filter(file => file.startsWith('scripts/') && file.endsWith('.ts') && !file.endsWith('.d.ts'));
    assert.deepStrictEqual(typed.sort(), [
        'scripts/array-size-from-header.ts',
        'scripts/follow-pointer.ts',
        'scripts/verify-crc.ts',
        'scripts/verify-integrity.ts',
    ]);
    for (const file of typed) {
        const source = fs.readFileSync(path.join(EXAMPLES_ROOT, ...file.split('/')), 'utf-8');
        assert.match(source, /^\/\/\/ <reference path="\.\/types\/hexscope\.d\.ts" \/\>/m, `${file} references the shipped types`);
        assert.ok(!/\brequire\s*\(/.test(source), `${file} uses only the public api`);
    }
});

});
