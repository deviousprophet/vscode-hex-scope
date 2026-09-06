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

const structsEnvelope = (data: unknown) => ({ version: DATA_VERSION, data, $schema: '../../schemas/structs.schema.json' });
const profileEnvelope = (data: unknown) => ({ version: DATA_VERSION, data, $schema: '../../schemas/profiles.schema.json' });
const bindingsEnvelope = (data: unknown) => ({ version: DATA_VERSION, data, $schema: '../../schemas/bindings.schema.json' });

suite('hexScope schemas — positive fixtures', () => {
    test('profiles.json accepts a full ProfileRecord[] (with unique ids)', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [
            {
                id: 'profile_1',
                name: 'Boot',
                labels: [{ id: 'l1', name: 'Boot', startAddress: 0, length: 256, color: '#ff0000', hidden: true }],
                segmentNames: { '0': 'Boot' },
                structPins: [{
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
            },
            { id: 'profile_2', name: 'App', labels: [], segmentNames: {}, structPins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le' },
        ];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('profiles.json rejects duplicate (deep-equal) items via uniqueItems', () => {
        const { schema } = loadSchema('profiles.schema.json');
        // JSON Schema uniqueItems compares item equality; id/name uniqueness
        // beyond exact duplicates is enforced at runtime by normalizeProfilesRegistry.
        const record = { id: 'profile_1', name: 'Boot', labels: [], segmentNames: {}, structPins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le' };
        const data = [record, { ...record, labels: [] }];
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('profiles.json accepts the deprecated pre-rename `pins` key on a record', () => {
        const { schema } = loadSchema('profiles.schema.json');
        // The schema keeps structPins required for new files but declares the
        // legacy `pins` property as deprecated (additionalProperties: false
        // would otherwise reject it); the runtime normalizer reads pins via
        // `structPins ?? pins` and self-heals on the next write.
        const data = [{
            id: 'profile_1', name: 'Legacy', labels: [], segmentNames: {},
            structPins: [], pins: [{ id: 'p1', structId: 's1', addr: 0, name: 'Pin A' }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le',
        }];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('bindings.json accepts a full Binding[]', () => {
        const { schema } = loadSchema('bindings.schema.json');
        const data = [
            { fileKey: 'firmware/boot.hex', profileId: 'profile_1' },
            { fileKey: 'firmware/app.hex', profileId: 'profile_2' },
        ];
        assert.deepStrictEqual(errorsFor(schema, bindingsEnvelope(data)), []);
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

    test('structs.json accepts endian/allocation overrides on structs and fields', () => {
        const { schema } = loadSchema('structs.schema.json');
        const data = [
            {
                id: 's1', name: 'Config', endian: 'be', allocation: 'msb',
                fields: [
                    { name: 'word', type: 'uint16', count: 1, endian: 'le' },
                    { name: 'flags', type: 'uint8', count: 1, allocation: 'lsb', bitFields: [{ name: 'enabled', bitWidth: 1 }] },
                ],
            },
        ];
        assert.deepStrictEqual(errorsFor(schema, structsEnvelope(data)), []);
    });

    test('integrity checks nested in a profile accept full configs', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{
            id: 'profile_1', name: 'Firmware', labels: [], segmentNames: {}, structPins: [], endian: 'le',
            activeChecks: {
                schemaVersion: 1,
                checks: [
                    { algorithm: 'sha-256', startAddress: 0, endAddress: 1023, autoFixStoredValue: false },
                    { algorithm: 'crc32-iso-hdlc', startAddress: 0, endAddress: 1023, storedAddress: 1024, autoFixStoredValue: true, name: 'App CRC' },
                ],
            },
        }];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });
});

suite('hexScope schemas — negative cases', () => {
    test('wrong envelope version is refused everywhere', () => {
        for (const name of ['profiles.schema.json', 'structs.schema.json', 'bindings.schema.json']) {
            const { schema } = loadSchema(name);
            assert.notDeepStrictEqual(errorsFor(schema, { version: 2, data: [] }), [], `${name} rejects version 2`);
        }
    });

    test('bad endian fails profiles.json', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{ id: 'profile_1', name: 'P', labels: [], segmentNames: {}, structPins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'big' }];
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('unknown type enum fails structs.json', () => {
        const { schema } = loadSchema('structs.schema.json');
        const data = [{ id: 's1', name: 'S1', fields: [{ name: 'f', type: 'uint7', count: 1 }] }];
        assert.notDeepStrictEqual(errorsFor(schema, structsEnvelope(data)), []);
    });

    test('invalid endian/allocation enums fail structs.json', () => {
        const { schema } = loadSchema('structs.schema.json');
        assert.notDeepStrictEqual(
            errorsFor(schema, structsEnvelope([{ id: 's1', name: 'S1', endian: 'big', fields: [] }])),
            [],
        );
        assert.notDeepStrictEqual(
            errorsFor(schema, structsEnvelope([{ id: 's1', name: 'S1', fields: [{ name: 'f', type: 'uint8', count: 1, allocation: 'sideways' }] }])),
            [],
        );
    });

    test('missing required field fails profiles.json and bindings.json', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{ id: 'profile_1' }]; // name/pins/activeChecks/endian/segmentNames/labels missing
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
        const bindings = loadSchema('bindings.schema.json');
        assert.notDeepStrictEqual(errorsFor(bindings.schema, bindingsEnvelope([{ fileKey: 'a.hex' }])), []);
    });

    test('data not an array fails structs.json + bindings.json + profiles.json', () => {
        const structs = loadSchema('structs.schema.json');
        assert.notDeepStrictEqual(errorsFor(structs.schema, structsEnvelope({ id: 's1' })), []);
        const bindings = loadSchema('bindings.schema.json');
        assert.notDeepStrictEqual(errorsFor(bindings.schema, bindingsEnvelope({ fileKey: 'a.hex' })), []);
        const profile = loadSchema('profiles.schema.json');
        assert.notDeepStrictEqual(errorsFor(profile.schema, profileEnvelope({ id: 'x' })), []);
    });
});

suite('hexScope schemas — drift guard against TS types', () => {
    test('every schema pins version to DATA_VERSION', () => {
        for (const name of ['profiles.schema.json', 'structs.schema.json', 'bindings.schema.json']) {
            const { schema } = loadSchema(name);
            const envelope = schema as { properties?: { version?: { const?: unknown } } };
            assert.strictEqual(envelope.properties?.version?.const, DATA_VERSION, `${name} version const`);
        }
    });

    test('integrityAlgorithm enums match INTEGRITY_ALGORITHMS', () => {
        const expected = Array.from(INTEGRITY_ALGORITHMS);
        const profile = loadSchema('profiles.schema.json');
        assert.deepStrictEqual((profile.defs.integrityAlgorithm as { enum: unknown[] }).enum, expected);
    });

    test('structFieldType enum matches STRUCT_FIELD_TYPES', () => {
        const structs = loadSchema('structs.schema.json');
        const enumValue = (structs.defs.structFieldType as { enum: unknown[] }).enum;
        assert.deepStrictEqual(enumValue, Array.from(STRUCT_FIELD_TYPES));
    });
});