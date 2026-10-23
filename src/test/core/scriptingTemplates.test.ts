import * as assert from 'assert';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';
import { SCRIPT_TEMPLATES, scriptTemplate, type ScriptTemplate } from '../../core/scripting/templates';
import { execute, executeEntry, scanScripts } from '../../core/scripting/scriptRunner';
import type { ScriptHost } from '../../core/scripting/types';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXAMPLES_ROOT = path.join(REPO_ROOT, 'examples');

/** The reviewed catalog, exactly as it ships. */
const TEMPLATE_IDS = ['action', 'integrity', 'address', 'size'];
const TEMPLATE_FILES = ['new-action.js', 'integrity-check.js', 'instance-address.js', 'array-size.js'];
const TEMPLATE_ROLES: Array<string | undefined> = [undefined, 'integrity', 'address', 'size'];

type MockHost = {
    host: ScriptHost;
    log: string[];
    results: Array<{ label: string; value: string }>;
    confirms: string[];
};

/** Consecutive bytes starting at `start`; every address outside `values` is unmapped. */
function memory(start: number, values: number[]): Map<number, number> {
    const map = new Map<number, number>();
    values.forEach((value, index) => map.set(start + index, value));
    return map;
}

function makeHost(bytes: Map<number, number>): MockHost {
    const log: string[] = [];
    const results: Array<{ label: string; value: string }> = [];
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
        writeBytes: () => false,
        totalSize: bytes.size,
        confirm: async type => { confirms.push(type); return false; },
        output: text => { log.push(text); },
        setResult: (label, value) => { results.push({ label, value }); },
        assert: (condition, label) => { results.push({ label, value: condition ? 'PASS' : 'FAIL' }); },
        collectOutput: () => ({ results: [...results], log: [...log] }),
    };
    return { host, log, results, confirms };
}

function resultValue(rows: Array<{ label: string; value: string }>, label: string): string | undefined {
    return rows.find(row => row.label === label)?.value;
}

function tempRoot(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'hexscope-template-'));
}

/** Write one template body as an installed `.hexscope/scripts/<name>` file. */
function installScript(root: string, name: string, body: string): string {
    const scripts = path.join(root, '.hexscope', 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    const file = path.join(scripts, name);
    fs.writeFileSync(file, body);
    return file;
}

/** Write a body at `<root>/scripts/<name>` with the shipped types, mirroring the examples tree. */
function installBody(root: string, name: string, body: string): string {
    const scripts = path.join(root, 'scripts');
    fs.mkdirSync(path.join(scripts, 'types'), { recursive: true });
    fs.copyFileSync(
        path.join(EXAMPLES_ROOT, 'scripts', 'types', 'hexscope.d.ts'),
        path.join(scripts, 'types', 'hexscope.d.ts'),
    );
    const file = path.join(scripts, name);
    fs.writeFileSync(file, body);
    return file;
}

/**
 * `npm run check-examples` parity: compile a body with the exact options from
 * `examples/tsconfig.json`, resolving includes and the `./types/hexscope.d.ts`
 * reference inside a temp dir. Returns the compiler's diagnostics.
 */
function templateDiagnostics(body: string): string[] {
    const dir = tempRoot();
    try {
        installBody(dir, 'template.js', body);
        const config = ts.readConfigFile(path.join(EXAMPLES_ROOT, 'tsconfig.json'), ts.sys.readFile).config;
        const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dir);
        assert.deepStrictEqual(parsed.fileNames.length, 1, 'the temp template is the only input');
        const program = ts.createProgram(parsed.fileNames, parsed.options);
        return ts.getPreEmitDiagnostics(program)
            .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

suite('scripting templates catalog', () => {

    test('the four reviewed templates are exported in catalog order', () => {
        assert.deepStrictEqual(SCRIPT_TEMPLATES.map(template => template.id), TEMPLATE_IDS);
        assert.deepStrictEqual(SCRIPT_TEMPLATES.map(template => template.fileName), TEMPLATE_FILES);
        assert.deepStrictEqual(SCRIPT_TEMPLATES.map(template => template.role), TEMPLATE_ROLES);
        for (const template of SCRIPT_TEMPLATES) {
            assert.ok(template.name.startsWith('New '), `${template.id} has a New-script label`);
            assert.ok(template.description.length > 0, `${template.id} has a picker description`);
            assert.ok(template.body.trim().length > 0, `${template.id} has a body`);
        }
    });

    test('template lookup returns known ids and refuses unknown ones', () => {
        for (const id of TEMPLATE_IDS) {
            assert.strictEqual(scriptTemplate(id)?.id, id);
        }
        assert.strictEqual(scriptTemplate('bogus'), undefined);
        assert.strictEqual(scriptTemplate(undefined), undefined);
    });

    test('every body carries the typed header, the shipped type reference, and an export', () => {
        for (const template of SCRIPT_TEMPLATES) {
            assert.ok(template.body.startsWith('// @ts-check\n'), `${template.id} starts with @ts-check`);
            assert.match(template.body, /^\/\/\/ <reference path="\.\/types\/hexscope\.d\.ts" \/>$/m,
                `${template.id} references the shipped declaration`);
            assert.match(template.body, /module\.exports = \{/, `${template.id} exposes a CommonJS entry`);
        }
        for (const template of SCRIPT_TEMPLATES.filter(t => t.role)) {
            assert.ok(template.body.includes(`@script ${template.role}`), `${template.id} declares its role tag`);
        }
        assert.ok(!/@script \w/.test(scriptTemplate('action')!.body), 'the plain action declares no role');
    });

    test('every body type-checks with the examples compiler options (check-examples parity)', () => {
        for (const template of SCRIPT_TEMPLATES) {
            const diagnostics = templateDiagnostics(template.body);
            assert.deepStrictEqual(diagnostics, [], `${template.fileName} must type-check:\n${diagnostics.join('\n')}`);
        }
    });

    test('scanning the installed templates classifies each one (role / run)', () => {
        const root = tempRoot();
        try {
            for (const template of SCRIPT_TEMPLATES) { installScript(root, template.fileName, template.body); }
            const scripts = scanScripts(root);
            assert.deepStrictEqual([...scripts].map(script => script.name).sort(), [...TEMPLATE_FILES].sort());
            const expected: ReadonlyArray<[string, string[], boolean]> = [
                ['new-action.js', [], true],
                ['integrity-check.js', ['integrity'], false],
                ['instance-address.js', ['address'], false],
                ['array-size.js', ['size'], false],
            ];
            for (const [name, roles, hasRun] of expected) {
                const script = scripts.find(item => item.name === name);
                assert.ok(script, `${name} was scanned`);
                assert.deepStrictEqual(script.roles, roles, `${name} roles`);
                assert.strictEqual(script.hasRun, hasRun, `${name} hasRun`);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

suite('scripting templates run against a mock host', () => {
    let root: string;

    setup(() => { root = tempRoot(); });
    teardown(() => { fs.rmSync(root, { recursive: true, force: true }); });

    function pathFor(template: ScriptTemplate): string {
        return installScript(root, template.fileName, template.body);
    }

    test('the action template reports the document size without an approval', async () => {
        const mock = makeHost(memory(0, [1, 2, 3]));
        const out = await execute(pathFor(scriptTemplate('action')!), mock.host);
        assert.strictEqual(out.error, undefined);
        assert.strictEqual(resultValue(mock.results, 'Document size'), '3 byte(s)');
        assert.deepStrictEqual(mock.confirms, [], 'the starter is read-only');
    });

    test('the integrity template sums the range, excluding the stored field', async () => {
        const mock = makeHost(memory(0x08000000, [0xFF, 0x02]));
        const context = { selection: { start: 0x08000000, end: 0x08000001 }, storedStart: 0x08000000, storedEnd: 0x08000000 };
        const value = await executeEntry(pathFor(scriptTemplate('integrity')!), 'getIntegrityValue', mock.host, { context });
        assert.strictEqual(value.error, undefined);
        assert.deepStrictEqual(value.value, [2], 'stored byte 0xFF is skipped');
        const verify = await executeEntry(pathFor(scriptTemplate('integrity')!), 'verifyIntegrity', mock.host, { context });
        assert.strictEqual(verify.value, false, 'stored 0xFF does not match the computed 0x02');
    });

    test('the integrity template stays display-only without a stored field', async () => {
        const mock = makeHost(memory(0x08000000, [1, 2]));
        const verify = await executeEntry(pathFor(scriptTemplate('integrity')!), 'verifyIntegrity', mock.host, {
            context: { selection: { start: 0x08000000, end: 0x08000001 } },
        });
        assert.strictEqual(verify.error, undefined);
        assert.strictEqual(verify.value, true);
    });

    test('the address template returns the little-endian pointer', async () => {
        const mock = makeHost(memory(0x08000000, [0x00, 0x01, 0x00, 0x08]));
        const out = await executeEntry(pathFor(scriptTemplate('address')!), 'getAddress', mock.host);
        assert.strictEqual(out.error, undefined);
        assert.strictEqual(out.value, 0x08000100);
    });

    test('the address template fails loudly when the pointer is unmapped', async () => {
        const out = await executeEntry(pathFor(scriptTemplate('address')!), 'getAddress', makeHost(new Map()).host);
        assert.strictEqual(out.errorType, 'runtime');
        assert.match(out.error ?? '', /adapt POINTER_AT/);
    });

    test('the size template resolves its own parameter and falls back elsewhere', async () => {
        const templatePath = pathFor(scriptTemplate('size')!);
        const mock = makeHost(memory(0x08000010, [0x05, 0x00]));
        const own = await executeEntry(templatePath, 'getSize', mock.host, { context: { param: 'ITEM_COUNT' } });
        assert.strictEqual(own.error, undefined);
        assert.strictEqual(own.value, 5);
        const other = await executeEntry(templatePath, 'getSize', mock.host, { context: { param: 'OTHER' } });
        assert.strictEqual(other.value, 1, 'a different parameter still gets a positive size');
    });

    test('the size template returns a positive size when the count is unmapped or zero', async () => {
        const templatePath = pathFor(scriptTemplate('size')!);
        const unmapped = await executeEntry(templatePath, 'getSize', makeHost(new Map()).host, { context: { param: 'ITEM_COUNT' } });
        assert.strictEqual(unmapped.value, 1);
        const zero = await executeEntry(templatePath, 'getSize', makeHost(memory(0x08000010, [0, 0])).host, { context: { param: 'ITEM_COUNT' } });
        assert.strictEqual(zero.value, 1);
    });
});
