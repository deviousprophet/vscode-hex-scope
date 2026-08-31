// ── JSON Schema contract tests (plain Node; runs in the vscode-test host) ──
// Validates the three bundled .hexscope schemas against representative
// fixtures and anchors them to the TS types (version const + enums) so
// schema/type drift is caught at test time.

import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv = require('ajv');
import { DATA_VERSION } from '../../hexScopeStorage';
import { INTEGRITY_ALGORITHMS } from '../../core/integrity';
import { STRUCT_FIELD_TYPES } from '../../core/types';

const SCHEMAS_DIR = path.resolve(__dirname, '..', '..', '..', 'schemas');

function loadSchema(name: string): { defs: Record<string, unknown>; schema: object } {
    const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, name), 'utf8')) as {
        definitions?: Record<string, unknown>;
        properties?: { version?: { const?: unknown } };
    };
    return { defs: schema.definitions ?? {}, schema };
}

function errorsFor(schema: object, data: unknown): string[] {
    const ajv = new Ajv({ allErrors: true });
    const check = ajv.compile(schema);
    return check(data) ? [] : (check.errors ?? []).map(error => error.message ?? 'invalid');
}

const indexEnvelope = (data: unknown) => ({ version: DATA_VERSION, data, $schema: '../../schemas/index.schema.json' });
const structsEnvelope = (data: unknown) => ({ version: DATA_VERSION, data, $schema: '../../schemas/structs.schema.json' });
const integrityEnvelope = (data: unknown) => ({ version: DATA_VERSION, data, $schema: '../../schemas/integrity.schema.json' });

suite('hexScope schemas — positive fixtures', () => {
    test('index.json accepts a full IndexFileData', () => {
        const { schema } = loadSchema('index.schema.json');
        const data = {
            relPath: 'firmware/boot.hex',
            labels: [{ id: 'l1', name: 'Boot', startAddress: 0, length: 256, color: '#ff0000', hidden: true }],
            segmentNames: { '0': 'Boot' },
            pins: [{
                id: 'p1',
                structId: 's1',
                addr: 0,
                name: 'Pin A',
                pointerSources: [{
                    sourcePinId: 'p0', sourcePinName: 'Target', sourceStructId: 's2',
                    sourceFieldPath: 'ptr', pointerStorageAddress: 4, targetAddress: 0x1000,
                }],
            }],
            activeChecks: {
                schemaVersion: 1,
                checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0, endAddress: 255, storedAddress: 260, autoFixStoredValue: true, name: 'CRC' }],
            },
            endian: 'be',
        };
        assert.deepStrictEqual(errorsFor(schema, indexEnvelope(data)), []);
    });

    test('structs.json accepts a full StructDef[]', () => {
        const { schema } = loadSchema('structs.schema.json');
        const data = [
            {
                id: 's1', name: 'Config', packed: true,
                fields: [
                    { name: 'magic', type: 'uint8', count: 1 },
                    { name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'enabled', bitWidth: 1 }], bitFieldsCollapsed: true },
                    { name: 'next', type: 'struct', refStructId: 's2', count: 1, isPointer: true },
                ],
            },
            { id: 's2', name: 'Inner', fields: [{ name: 'value', type: 'float32', count: 4 }] },
        ];
        assert.deepStrictEqual(errorsFor(schema, structsEnvelope(data)), []);
    });

    test('integrity.json accepts a full IntegrityProfile[]', () => {
        const { schema } = loadSchema('integrity.schema.json');
        const data = [{
            schemaVersion: 1, id: 'p1', name: 'Firmware',
            checks: [
                { algorithm: 'sha-256', startAddress: 0, endAddress: 1023, autoFixStoredValue: false },
                { algorithm: 'crc32-iso-hdlc', startAddress: 0, endAddress: 1023, storedAddress: 1024, autoFixStoredValue: true, name: 'App CRC' },
            ],
        }];
        assert.deepStrictEqual(errorsFor(schema, integrityEnvelope(data)), []);
    });
});

suite('hexScope schemas — negative cases', () => {
    test('wrong envelope version is refused everywhere', () => {
        for (const name of ['index.schema.json', 'structs.schema.json', 'integrity.schema.json']) {
            const { schema } = loadSchema(name);
            assert.notDeepStrictEqual(errorsFor(schema, { version: 2, data: [] }), [], `${name} rejects version 2`);
        }
    });

    test('bad endian fails index.json', () => {
        const { schema } = loadSchema('index.schema.json');
        const data = { relPath: 'a.hex', labels: [], segmentNames: {}, pins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'big' };
        assert.notDeepStrictEqual(errorsFor(schema, indexEnvelope(data)), []);
    });

    test('unknown type enum fails structs.json', () => {
        const { schema } = loadSchema('structs.schema.json');
        const data = [{ id: 's1', name: 'S1', fields: [{ name: 'f', type: 'uint7', count: 1 }] }];
        assert.notDeepStrictEqual(errorsFor(schema, structsEnvelope(data)), []);
    });

    test('missing required field fails index.json', () => {
        const { schema } = loadSchema('index.schema.json');
        const data = { relPath: 'a.hex' }; // labels/segmentNames/pins/activeChecks/endian missing
        assert.notDeepStrictEqual(errorsFor(schema, indexEnvelope(data)), []);
    });

    test('data not an array fails structs.json and integrity.json', () => {
        const structs = loadSchema('structs.schema.json');
        assert.notDeepStrictEqual(errorsFor(structs.schema, structsEnvelope({ id: 's1' })), []);
        const integrity = loadSchema('integrity.schema.json');
        assert.notDeepStrictEqual(errorsFor(integrity.schema, integrityEnvelope({ schemaVersion: 1 })), []);
    });
});

suite('hexScope schemas — drift guard against TS types', () => {
    test('every schema pins version to DATA_VERSION', () => {
        for (const name of ['index.schema.json', 'structs.schema.json', 'integrity.schema.json']) {
            const { schema } = loadSchema(name);
            const envelope = schema as { properties?: { version?: { const?: unknown } } };
            assert.strictEqual(envelope.properties?.version?.const, DATA_VERSION, `${name} version const`);
        }
    });

    test('integrityAlgorithm enums match INTEGRITY_ALGORITHMS', () => {
        const expected = Array.from(INTEGRITY_ALGORITHMS);
        const index = loadSchema('index.schema.json');
        const integrity = loadSchema('integrity.schema.json');
        assert.deepStrictEqual((index.defs.integrityAlgorithm as { enum: unknown[] }).enum, expected);
        assert.deepStrictEqual((integrity.defs.integrityAlgorithm as { enum: unknown[] }).enum, expected);
    });

    test('structFieldType enum matches STRUCT_FIELD_TYPES', () => {
        const structs = loadSchema('structs.schema.json');
        const enumValue = (structs.defs.structFieldType as { enum: unknown[] }).enum;
        assert.deepStrictEqual(enumValue, Array.from(STRUCT_FIELD_TYPES));
    });
});