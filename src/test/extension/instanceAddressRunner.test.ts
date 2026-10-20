import * as assert from 'assert';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
    MAX_INSTANCE_ADDRESS_ENTRIES,
    MAX_INSTANCE_PARAM_ENTRIES,
    MAX_SCRIPT_PARAM_SIZE,
    runInstanceAddresses,
    runInstanceParams,
    withRelativeAddressSources,
} from '../../instanceAddressRunner';
import type { InstanceAddressRequestEntry, InstanceParamRequestEntry } from '../../webviewProtocol';
import type { MemorySegment } from '../../core/parser/types';
import type { TypeInstance } from '../../core/types';

const SEGMENTS: MemorySegment[] = [{ startAddress: 0x1000, data: new Uint8Array([1, 2, 3, 4]) }];

function tmpDir(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'hex-scope-instance-address-'));
}

function rmDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

function writeScript(dir: string, name: string, code: string): void {
    fs.writeFileSync(path.join(dir, name), code, 'utf-8');
}

function entry(pinId: string, scriptPath: string, context: InstanceAddressRequestEntry['context'] = {}): InstanceAddressRequestEntry {
    return {
        pinId,
        scriptPath,
        context: {
            instance: { id: pinId, name: pinId, typeId: 't', typeName: 'Type' },
            paramValues: {},
            ...context,
        },
    };
}

function paramEntry(
    pinId: string,
    param: string,
    scriptPath: string,
    context: InstanceParamRequestEntry['context'] = {},
): InstanceParamRequestEntry {
    return {
        pinId,
        param,
        scriptPath,
        context: {
            instance: { id: pinId, name: pinId, typeId: 't', typeName: 'Type' },
            param,
            paramValues: {},
            ...context,
        },
    };
}

function baseInput(dir: string, entries: InstanceAddressRequestEntry[], overrides: Partial<Parameters<typeof runInstanceAddresses>[0]> = {}) {
    return {
        root: dir,
        entries,
        segments: SEGMENTS,
        edits: [] as Array<[number, number]>,
        trusted: true,
        confirm: async () => false,
        ...overrides,
    };
}

function baseParamInput(
    dir: string,
    entries: InstanceParamRequestEntry[],
    overrides: Partial<Parameters<typeof runInstanceParams>[0]> = {},
) {
    return {
        root: dir,
        entries,
        segments: SEGMENTS,
        edits: [] as Array<[number, number]>,
        trusted: true,
        confirm: async () => false,
        ...overrides,
    };
}

suite('instance address runner', () => {
    test('resolves an address with instance context and an edits overlay', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'follow.js', `
                module.exports = {
                    getAddress(api) {
                        const ctx = api.context;
                        const first = api.hex.read(0x1000, 1)[0];
                        return first === 9 && ctx.instance.name === 'root'
                            && ctx.paramValues.N === 4 && ctx.documentSize === 4
                            && ctx.selection.start === 0x1000
                            ? 0x2000 : 0xDEAD;
                    },
                };
            `);
            const results = await runInstanceAddresses(baseInput(dir, [
                entry('p1', 'follow.js', {
                    instance: { id: 'p1', name: 'root', typeId: 't', typeName: 'Type' },
                    paramValues: { N: 4 },
                    selection: { start: 0x1000, end: 0x1003 },
                }),
            ], { edits: [[0x1000, 9]] }));

            assert.deepStrictEqual(results, [{ pinId: 'p1', ok: true, addr: 0x2000 }]);
        } finally { rmDir(dir); }
    });

    test('fractional, negative, and out-of-range values are contract errors', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'fractional.js', `module.exports = { getAddress() { return 1.5; } };`);
            writeScript(dir, 'negative.js', `module.exports = { getAddress() { return -1; } };`);
            writeScript(dir, 'too-big.js', `module.exports = { getAddress() { return 0x100000000; } };`);
            const results = await runInstanceAddresses(baseInput(dir, [
                entry('a', 'fractional.js'),
                entry('b', 'negative.js'),
                entry('c', 'too-big.js'),
            ]));

            assert.strictEqual(results.length, 3);
            for (const result of results) {
                assert.strictEqual(result.ok, false);
                if (result.ok) { continue; }
                assert.strictEqual(result.error, 'Invalid address from script');
                assert.strictEqual(result.errorType, 'contract');
            }
        } finally { rmDir(dir); }
    });

    test('one throwing script does not hide the other instances', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'throws.js', `module.exports = { getAddress() { throw new Error('boom'); } };`);
            writeScript(dir, 'ok.js', `module.exports = { getAddress() { return 0x1234; } };`);
            const results = await runInstanceAddresses(baseInput(dir, [
                entry('bad', 'throws.js'),
                entry('good', 'ok.js'),
            ]));

            assert.strictEqual(results[0].ok, false);
            if (!results[0].ok) {
                assert.strictEqual(results[0].errorType, 'runtime');
                assert.match(results[0].error, /boom/);
            }
            assert.deepStrictEqual(results[1], { pinId: 'good', ok: true, addr: 0x1234 });
        } finally { rmDir(dir); }
    });

    test('a missing script reports Script not found and keeps its own row', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'ok.js', `module.exports = { getAddress() { return 0x10; } };`);
            const results = await runInstanceAddresses(baseInput(dir, [
                entry('missing', 'nope.js'),
                entry('ok', 'ok.js'),
            ]));

            assert.strictEqual(results[0].ok, false);
            if (!results[0].ok) {
                assert.match(results[0].error, /Script not found: nope\.js/);
                assert.strictEqual(results[0].errorType, 'runtime');
            }
            assert.deepStrictEqual(results[1], { pinId: 'ok', ok: true, addr: 0x10 });
        } finally { rmDir(dir); }
    });

    test('a missing export is a contract error naming getAddress', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'no-export.js', `module.exports = { run() {} };`);
            const results = await runInstanceAddresses(baseInput(dir, [entry('p', 'no-export.js')]));

            assert.strictEqual(results[0].ok, false);
            if (!results[0].ok) {
                assert.strictEqual(results[0].errorType, 'contract');
                assert.match(results[0].error, /getAddress/);
            }
        } finally { rmDir(dir); }
    });

    test('an untrusted workspace blocks every entry without running the script', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'ok.js', `module.exports = { getAddress() { return 0x10; } };`);
            const results = await runInstanceAddresses(baseInput(dir, [entry('p', 'ok.js')], { trusted: false }));

            assert.deepStrictEqual(results, [{ pinId: 'p', ok: false, error: 'Workspace not trusted', errorType: 'cancel' }]);
        } finally { rmDir(dir); }
    });

    test('entries above the batch bound get a row-level error without running', async () => {
        const dir = tmpDir();
        try {
            // Missing scripts fail fast (no worker run), so the bound check dominates.
            const entries = Array.from({ length: MAX_INSTANCE_ADDRESS_ENTRIES + 1 }, (_, i) => entry(`p${i}`, 'nope.js'));
            const results = await runInstanceAddresses(baseInput(dir, entries));

            assert.strictEqual(results.length, entries.length);
            const last = results[MAX_INSTANCE_ADDRESS_ENTRIES];
            assert.strictEqual(last.ok, false);
            if (!last.ok) {
                assert.strictEqual(last.errorType, 'contract');
                assert.match(last.error, /Too many instances/);
            }
        } finally { rmDir(dir); }
    });
});

suite('instance parameter runner', () => {
    test('resolves sizes with instance/param/sibling context and an edits overlay', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'size.js', `
                module.exports = {
                    getSize(api) {
                        const ctx = api.context;
                        const first = api.hex.read(0x1000, 1)[0];
                        const value = ctx.param === 'SECOND'
                            ? (ctx.paramValues.FIRST ?? 0) + 1
                            : first + 2;
                        return first === 9 && ctx.instance.name === 'root'
                            && ctx.documentSize === 4 && ctx.selection.start === 0x1000
                            ? value : 0;
                    },
                };
            `);
            const results = await runInstanceParams(baseParamInput(dir, [
                paramEntry('p1', 'FIRST', 'size.js', {
                    instance: { id: 'p1', name: 'root', typeId: 't', typeName: 'Type' },
                    selection: { start: 0x1000, end: 0x1003 },
                }),
                paramEntry('p1', 'SECOND', 'size.js', {
                    instance: { id: 'p1', name: 'root', typeId: 't', typeName: 'Type' },
                    paramValues: { FIRST: 11 },
                    selection: { start: 0x1000, end: 0x1003 },
                }),
            ], { edits: [[0x1000, 9]] }));

            assert.deepStrictEqual(results, [
                { pinId: 'p1', param: 'FIRST', ok: true, value: 11 },
                { pinId: 'p1', param: 'SECOND', ok: true, value: 12 },
            ]);
        } finally { rmDir(dir); }
    });

    test('zero, negative, fractional, and unsafe values are contract errors', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'zero.js', `module.exports = { getSize() { return 0; } };`);
            writeScript(dir, 'negative.js', `module.exports = { getSize() { return -1; } };`);
            writeScript(dir, 'fractional.js', `module.exports = { getSize() { return 1.5; } };`);
            writeScript(dir, 'nan.js', `module.exports = { getSize() { return NaN; } };`);
            writeScript(dir, 'unsafe.js', `module.exports = { getSize() { return 9007199254740993; } };`);
            const results = await runInstanceParams(baseParamInput(dir, [
                paramEntry('a', 'N', 'zero.js'),
                paramEntry('b', 'N', 'negative.js'),
                paramEntry('c', 'N', 'fractional.js'),
                paramEntry('d', 'N', 'nan.js'),
                paramEntry('e', 'N', 'unsafe.js'),
            ]));

            assert.strictEqual(results.length, 5);
            for (const result of results) {
                assert.strictEqual(result.ok, false);
                if (result.ok) { continue; }
                assert.strictEqual(result.error, 'Invalid size from script');
                assert.strictEqual(result.errorType, 'contract');
            }
        } finally { rmDir(dir); }
    });

    test('a value above the defensive bound is rejected', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'huge.js', `module.exports = { getSize() { return ${MAX_SCRIPT_PARAM_SIZE + 1}; } };`);
            const results = await runInstanceParams(baseParamInput(dir, [paramEntry('p', 'N', 'huge.js')]));

            assert.strictEqual(results[0].ok, false);
            if (!results[0].ok) {
                assert.match(results[0].error, /Size is too large/);
                assert.strictEqual(results[0].errorType, 'contract');
            }
        } finally { rmDir(dir); }
    });

    test('one throwing script or a missing script does not hide the other parameters', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'throws.js', `module.exports = { getSize() { throw new Error('boom'); } };`);
            writeScript(dir, 'ok.js', `module.exports = { getSize() { return 4; } };`);
            const results = await runInstanceParams(baseParamInput(dir, [
                paramEntry('bad', 'N', 'throws.js'),
                paramEntry('missing', 'N', 'nope.js'),
                paramEntry('good', 'N', 'ok.js'),
            ]));

            assert.strictEqual(results[0].ok, false);
            if (!results[0].ok) { assert.match(results[0].error, /boom/); }
            assert.strictEqual(results[1].ok, false);
            if (!results[1].ok) { assert.match(results[1].error, /Script not found: nope\.js/); }
            assert.deepStrictEqual(results[2], { pinId: 'good', param: 'N', ok: true, value: 4 });
        } finally { rmDir(dir); }
    });

    test('a missing export names getSize; untrusted workspaces block every entry', async () => {
        const dir = tmpDir();
        try {
            writeScript(dir, 'no-export.js', `module.exports = { run() {} };`);
            writeScript(dir, 'ok.js', `module.exports = { getSize() { return 1; } };`);
            const missing = await runInstanceParams(baseParamInput(dir, [paramEntry('p', 'N', 'no-export.js')]));
            assert.strictEqual(missing[0].ok, false);
            if (!missing[0].ok) {
                assert.strictEqual(missing[0].errorType, 'contract');
                assert.match(missing[0].error, /getSize/);
            }

            const blocked = await runInstanceParams(baseParamInput(dir, [paramEntry('p', 'N', 'ok.js')], { trusted: false }));
            assert.deepStrictEqual(blocked, [
                { pinId: 'p', param: 'N', ok: false, error: 'Workspace not trusted', errorType: 'cancel' },
            ]);
        } finally { rmDir(dir); }
    });

    test('entries above the batch bound get a row-level error without running', async () => {
        const dir = tmpDir();
        try {
            const entries = Array.from({ length: MAX_INSTANCE_PARAM_ENTRIES + 1 }, (_, i) =>
                paramEntry(`p${i}`, 'N', 'nope.js'));
            const results = await runInstanceParams(baseParamInput(dir, entries));

            assert.strictEqual(results.length, entries.length);
            const last = results[MAX_INSTANCE_PARAM_ENTRIES];
            assert.strictEqual(last.ok, false);
            if (!last.ok) {
                assert.strictEqual(last.errorType, 'contract');
                assert.match(last.error, /Too many parameters/);
            }
        } finally { rmDir(dir); }
    });
});

suite('withRelativeAddressSources()', () => {
    const root = path.resolve('/workspace/project');

    test('normalizes an absolute path to workspace-relative posix and keeps addr', () => {
        const pin: TypeInstance = {
            id: 'p', typeId: 't', addr: 0x100, name: 'p',
            addressSource: { scriptPath: path.join(root, '.hexscope', 'scripts', 'follow.js') },
        };
        const result = withRelativeAddressSources(root, [pin]);
        assert.deepStrictEqual(result[0].addressSource, { scriptPath: '.hexscope/scripts/follow.js' });
        assert.strictEqual(result[0].addr, 0x100);
    });

    test('returns the same array when every source is already clean', () => {
        const pin: TypeInstance = { id: 'p', typeId: 't', addr: 0, name: 'p', addressSource: { scriptPath: 'follow.js' } };
        const pins = [pin];
        assert.strictEqual(withRelativeAddressSources(root, pins), pins);
        assert.strictEqual(withRelativeAddressSources(root, [pin])[0], pin);
    });

    test('drops an empty source or one that conflicts with pointer metadata', () => {
        const empty: TypeInstance = { id: 'e', typeId: 't', addr: 0, name: 'e', addressSource: { scriptPath: '  ' } };
        const conflict: TypeInstance = {
            id: 'c', typeId: 't', addr: 1, name: 'c', addressSource: { scriptPath: 'follow.js' },
            pointerSources: [{
                sourcePinId: 's', sourcePinName: 'S', sourceTypeId: 't',
                sourceFieldPath: 'next', pointerStorageAddress: 0, targetAddress: 1,
            }],
        };
        const result = withRelativeAddressSources(root, [empty, conflict]);
        assert.strictEqual('addressSource' in result[0], false);
        assert.strictEqual('addressSource' in result[1], false);
        assert.strictEqual(result[1].pointerSources?.length, 1);
    });

    test('normalizes parameter-source paths and drops empty entries', () => {
        const pin: TypeInstance = {
            id: 'p', typeId: 't', addr: 0x100, name: 'p',
            paramSources: {
                N: { scriptPath: path.join(root, '.hexscope', 'scripts', 'size.js') },
                EMPTY: { scriptPath: '  ' },
            },
        };
        const result = withRelativeAddressSources(root, [pin]);
        assert.deepStrictEqual(result[0].paramSources, { N: { scriptPath: '.hexscope/scripts/size.js' } });
        assert.strictEqual(result[0].addr, 0x100);
    });

    test('returns the same instance when clean parameter sources are already relative', () => {
        const pin: TypeInstance = {
            id: 'p', typeId: 't', addr: 0, name: 'p', paramSources: { N: { scriptPath: 'size.js' } },
        };
        const pins = [pin];
        const result = withRelativeAddressSources(root, pins);
        assert.strictEqual(result, pins);
        assert.strictEqual(result[0], pin);
    });
});
