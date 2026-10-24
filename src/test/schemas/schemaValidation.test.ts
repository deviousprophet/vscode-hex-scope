// ── JSON Schema contract tests (plain Node; runs in the vscode-test host) ──
// Validates the three bundled .hexscope schemas against representative
// fixtures and anchors them to the TS types (version const + enums) so
// schema/type drift is caught at test time.

import * as assert from 'assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv = require('ajv');
import { DATA_SCHEMA_VERSION, DATA_VERSION } from '../../hexScopeStorage';
import { INTEGRITY_ALGORITHMS } from '../../core/integrity';
import { TYPE_BASE_TYPES, TYPE_FIELD_TYPES } from '../../core/types';

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

/** Envelope + data payload with the current data-schema version and payload key. */
const typesEnvelope = (defs: unknown) => ({ version: DATA_VERSION, data: { schemaVersion: DATA_SCHEMA_VERSION, defs }, $schema: 'schemas/types.schema.json' });
const profileEnvelope = (records: unknown) => ({ version: DATA_VERSION, data: { schemaVersion: DATA_SCHEMA_VERSION, records }, $schema: 'schemas/profiles.schema.json' });
const bindingsEnvelope = (bindings: unknown) => ({ version: DATA_VERSION, data: { schemaVersion: DATA_SCHEMA_VERSION, bindings }, $schema: 'schemas/bindings.schema.json' });

suite('hexScope schemas — positive fixtures', () => {
    test('profiles.json accepts a full ProfileRecord[] (with unique ids)', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [
            {
                id: 'profile_1',
                name: 'Boot',
                labels: [{ id: 'l1', name: 'Boot', startAddress: 0, length: 256, color: '#ff0000', hidden: true }],
                segmentNames: { '0': 'Boot' },
                typeInstances: [{
                    id: 'p1',
                    typeId: 's1',
                    addr: 0,
                    name: 'Pin A',
                    pointerSources: [{
                        sourcePinId: 'p0', sourcePinName: 'Target', sourceTypeId: 's2',
                        sourceFieldPath: 'ptr', pointerStorageAddress: 4, targetAddress: 0x1000,
                    }],
                }],
                activeChecks: {
                    schemaVersion: 1,
                    checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0, endAddress: 255, storedAddress: 260, autoFixStoredValue: true, name: 'CRC' }],
                },
                endian: 'be',
                bitAllocation: 'lsb',
            },
            { id: 'profile_2', name: 'App', labels: [], segmentNames: {}, typeInstances: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb' },
        ];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('profiles.json rejects duplicate (deep-equal) items via uniqueItems', () => {
        const { schema } = loadSchema('profiles.schema.json');
        // JSON Schema uniqueItems compares item equality; id/name uniqueness
        // beyond exact duplicates is enforced at runtime by normalizeProfilesRegistry.
        const record = { id: 'profile_1', name: 'Boot', labels: [], segmentNames: {}, typeInstances: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb' };
        const data = [record, { ...record, labels: [] }];
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('profiles.json accepts the deprecated v1 `structPins` key on a record', () => {
        const { schema } = loadSchema('profiles.schema.json');
        // The schema keeps typeInstances required for new files but declares the
        // legacy `structPins` (v1) and `pins` (v0) properties as deprecated
        // (additionalProperties: false would otherwise reject them). They describe
        // the v1 on-disk shape only: `MIGRATIONS[1]` renames them for a recorded
        // v1 payload, while the general profile reader no longer tolerates them.
        const data = [{
            id: 'profile_1', name: 'Legacy', labels: [], segmentNames: {},
            typeInstances: [], structPins: [{ id: 'p1', typeId: 's1', addr: 0, name: 'Pin A' }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'lsb',
        }];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('profiles.json accepts the deprecated pre-rename `pins` key on a record', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{
            id: 'profile_1', name: 'Legacy', labels: [], segmentNames: {},
            typeInstances: [], pins: [{ id: 'p1', typeId: 's1', addr: 0, name: 'Pin A' }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'lsb',
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

    test('types.json accepts a full TypeDef[]', () => {
        const { schema } = loadSchema('types.schema.json');
        const data = [
            {
                id: 's1', name: 'Config', packed: true,
                fields: [
                    { name: 'magic', type: 'uint8', count: 1 },
                    { name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'enabled', bitWidth: 1 }], bitFieldsCollapsed: true },
                    { name: 'next', type: 'struct', refTypeId: 's2', count: 1, isPointer: true },
                ],
            },
            { id: 's2', name: 'Inner', fields: [{ name: 'value', type: 'float32', count: 4 }] },
        ];
        assert.deepStrictEqual(errorsFor(schema, typesEnvelope(data)), []);
    });

    test('types.json accepts endian/allocation overrides on types and fields', () => {
        const { schema } = loadSchema('types.schema.json');
        const data = [
            {
                id: 's1', name: 'Config', endian: 'be', allocation: 'msb',
                fields: [
                    { name: 'word', type: 'uint16', count: 1, endian: 'le' },
                    { name: 'flags', type: 'uint8', count: 1, allocation: 'lsb', bitFields: [{ name: 'enabled', bitWidth: 1 }] },
                ],
            },
        ];
        assert.deepStrictEqual(errorsFor(schema, typesEnvelope(data)), []);
    });

    test('types.json accepts a hidden field flag on a leaf and a bit-field container', () => {
        const { schema } = loadSchema('types.schema.json');
        const data = [
            {
                id: 's1', name: 'Config', fields: [
                    { name: 'reserved', type: 'uint8', count: 1, hidden: true },
                    { name: 'ctrl', type: 'uint8', count: 1, hidden: true, bitFields: [{ name: 'lo', bitWidth: 4 }, { name: 'hi', bitWidth: 4 }] },
                    { name: 'tag', type: 'uint8', count: 1, hidden: false },
                ],
            },
        ];
        assert.deepStrictEqual(errorsFor(schema, typesEnvelope(data)), []);
    });

    test('types.json accepts a hidden flag on a bit-field child (inline and reusable)', () => {
        const { schema } = loadSchema('types.schema.json');
        const data = [
            {
                id: 's1', name: 'Config', fields: [
                    { name: 'ctrl', type: 'uint8', count: 1, bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4, hidden: false }] },
                ],
            },
            {
                id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
                bitFields: [{ name: 'a', bitWidth: 3, hidden: true }, { name: 'b', bitWidth: 5 }],
            },
        ];
        assert.deepStrictEqual(errorsFor(schema, typesEnvelope(data)), []);
    });

    test('types.json accepts size parameters and a countParam reference', () => {
        const { schema } = loadSchema('types.schema.json');
        const data = [
            {
                id: 'templated', name: 'Config',
                params: [
                    { name: 'ITEM_COUNT', kind: 'size', default: 4 },
                    { name: 'TAIL_COUNT', kind: 'size' },
                ],
                fields: [
                    { name: 'items', type: 'uint8', count: 4, countParam: 'ITEM_COUNT' },
                    { name: 'tail', type: 'uint16', count: 1, countParam: 'TAIL_COUNT' },
                ],
            },
        ];
        assert.deepStrictEqual(errorsFor(schema, typesEnvelope(data)), []);
    });

    test('profiles.json accepts instance paramValues', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{
            id: 'profile_1', name: 'Boot', labels: [], segmentNames: {},
            typeInstances: [{ id: 'p1', typeId: 'templated', addr: 0, name: 'cfg', paramValues: { ITEM_COUNT: 8 } }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb',
        }];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('profiles.json accepts an optional script addressSource on an instance', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{
            id: 'profile_1', name: 'Boot', labels: [], segmentNames: {},
            typeInstances: [{
                id: 'p1', typeId: 'templated', addr: 0x100, name: 'cfg',
                addressSource: { scriptPath: '.hexscope/scripts/follow.js' },
            }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb',
        }];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('profiles.json accepts optional paramSources on an instance', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{
            id: 'profile_1', name: 'Boot', labels: [], segmentNames: {},
            typeInstances: [{
                id: 'p1', typeId: 'templated', addr: 0, name: 'cfg',
                paramValues: { OTHER: 4 },
                paramSources: { ITEM_COUNT: { scriptPath: '.hexscope/scripts/size.js' } },
            }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb',
        }];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('profiles.json accepts a showHiddenFields profile flag', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [
            { id: 'profile_1', name: 'Boot', labels: [], segmentNames: {}, typeInstances: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb', showHiddenFields: true },
            { id: 'profile_2', name: 'App', labels: [], segmentNames: {}, typeInstances: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb' },
        ];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('integrity checks nested in a profile accept full configs', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{
            id: 'profile_1', name: 'Firmware', labels: [], segmentNames: {}, typeInstances: [], endian: 'le', bitAllocation: 'msb',
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

    test('built-in and script check kinds author with their own required fields', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{
            id: 'profile_1', name: 'Firmware', labels: [], segmentNames: {}, typeInstances: [], endian: 'le', bitAllocation: 'msb',
            activeChecks: {
                schemaVersion: 1,
                checks: [
                    { kind: 'builtin', algorithm: 'sha-256', startAddress: 0, endAddress: 1023, autoFixStoredValue: false },
                    {
                        kind: 'script', scriptPath: '.hexscope/scripts/verify-integrity.ts',
                        startAddress: 0, endAddress: 1023, storedAddress: 1024, autoFixStoredValue: true, name: 'Script check',
                    },
                ],
            },
        }];
        assert.deepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });
});

suite('hexScope schemas — negative cases', () => {
    test('wrong envelope version is refused everywhere', () => {
        const payloads: Array<[string, Record<string, unknown>]> = [
            ['profiles.schema.json', { schemaVersion: DATA_SCHEMA_VERSION, records: [] }],
            ['types.schema.json', { schemaVersion: DATA_SCHEMA_VERSION, defs: [] }],
            ['bindings.schema.json', { schemaVersion: DATA_SCHEMA_VERSION, bindings: [] }],
        ];
        for (const [name, data] of payloads) {
            const { schema } = loadSchema(name);
            assert.deepStrictEqual(errorsFor(schema, { version: DATA_VERSION, data }), [], `${name} accepts a valid payload at version 1`);
            assert.notDeepStrictEqual(errorsFor(schema, { version: 2, data }), [], `${name} rejects version 2`);
        }
    });

    test('bad endian fails profiles.json', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{ id: 'profile_1', name: 'P', labels: [], segmentNames: {}, typeInstances: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'big', bitAllocation: 'msb' }];
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('bad allocation fails profiles.json', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{ id: 'profile_1', name: 'P', labels: [], segmentNames: {}, typeInstances: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'sideways' }];
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('an empty or malformed addressSource fails profiles.json', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const profile = (addressSource: unknown) => [{
            id: 'profile_1', name: 'P', labels: [], segmentNames: {},
            typeInstances: [{ id: 'p', typeId: 't', addr: 0, name: 'p', addressSource }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb',
        }];
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(profile({ scriptPath: '' }))), [], 'empty path');
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(profile({ path: 'x.js' }))), [], 'missing scriptPath');
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(profile('follow.js'))), [], 'not an object');
    });

    test('an empty or malformed paramSources entry fails profiles.json', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const profile = (paramSources: unknown) => [{
            id: 'profile_1', name: 'P', labels: [], segmentNames: {},
            typeInstances: [{ id: 'p', typeId: 't', addr: 0, name: 'p', paramSources }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb',
        }];
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(profile({ N: { scriptPath: '' } }))), [], 'empty path');
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(profile({ N: 'size.js' }))), [], 'not an object');
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(profile({ N: { path: 'x.js' } }))), [], 'missing scriptPath');
    });

    test('non-boolean hidden fails types.json and non-boolean showHiddenFields fails profiles.json', () => {
        const types = loadSchema('types.schema.json');
        assert.notDeepStrictEqual(
            errorsFor(types.schema, typesEnvelope([{ id: 's1', name: 'S1', fields: [{ name: 'f', type: 'uint8', count: 1, hidden: 'yes' }] }])),
            [],
        );
        assert.notDeepStrictEqual(
            errorsFor(types.schema, typesEnvelope([
                { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'a', bitWidth: 3, hidden: 'yes' }] },
            ])),
            [],
            'a non-boolean bit-child hidden is rejected',
        );
        const profile = loadSchema('profiles.schema.json');
        const data = [{ id: 'profile_1', name: 'P', labels: [], segmentNames: {}, typeInstances: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb', showHiddenFields: 'yes' }];
        assert.notDeepStrictEqual(errorsFor(profile.schema, profileEnvelope(data)), []);
    });

    test('unknown type enum fails types.json', () => {
        const { schema } = loadSchema('types.schema.json');
        const data = [{ id: 's1', name: 'S1', fields: [{ name: 'f', type: 'uint7', count: 1 }] }];
        assert.notDeepStrictEqual(errorsFor(schema, typesEnvelope(data)), []);
    });

    test('types.json accepts a named bit-field type and its referencing field', () => {
        const { schema } = loadSchema('types.schema.json');
        const data = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'mode', bitWidth: 2 }, { name: 'code', bitWidth: 6 }] },
            { id: 's1', name: 'S1', fields: [{ name: 'ctl', type: 'bitfield', refTypeId: 'bits', count: 1 }] },
        ];
        assert.deepStrictEqual(errorsFor(schema, typesEnvelope(data)), []);
    });

    test('types.json rejects an unknown kind / baseType / field kind', () => {
        const { schema } = loadSchema('types.schema.json');
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 'b', name: 'B', kind: 'sideways', fields: [] }])),
            [],
        );
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 'b', name: 'B', kind: 'bitfield', baseType: 'int8', fields: [] }])),
            [],
        );
    });

    test('types.json accepts a named enum, its referencing field, and a bit-child ref', () => {
        const { schema } = loadSchema('types.schema.json');
        const data = [
            { id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }] },
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'lo', bitWidth: 4, refTypeId: 'mode' }] },
            { id: 's1', name: 'S1', fields: [{ name: 'state', type: 'enum', refTypeId: 'mode', count: 1 }] },
        ];
        assert.deepStrictEqual(errorsFor(schema, typesEnvelope(data)), []);
    });

    test('types.json rejects a malformed enum entry and a non-string child ref', () => {
        const { schema } = loadSchema('types.schema.json');
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 'e', name: 'E', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'A' }] }])),
            [],
        );
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 'b', name: 'B', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'lo', bitWidth: 4, refTypeId: 7 }] }])),
            [],
        );
    });

    test('types.json rejects a malformed parameter and a non-string countParam', () => {
        const { schema } = loadSchema('types.schema.json');
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 't', name: 'T', params: [{ name: 'N', kind: 'count' }], fields: [] }])),
            [],
        );
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 't', name: 'T', params: [{ name: 'N', kind: 'size', extra: 1 }], fields: [] }])),
            [],
        );
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 't', name: 'T', fields: [{ name: 'a', type: 'uint8', count: 1, countParam: 4 }] }])),
            [],
        );
    });

    test('profiles.json rejects a non-numeric paramValues entry', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{
            id: 'profile_1', name: 'Boot', labels: [], segmentNames: {},
            typeInstances: [{ id: 'p1', typeId: 't', addr: 0, name: 'cfg', paramValues: { ITEM_COUNT: '8' } }],
            activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb',
        }];
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
    });

    test('invalid endian/allocation enums fail types.json', () => {
        const { schema } = loadSchema('types.schema.json');
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 's1', name: 'S1', endian: 'big', fields: [] }])),
            [],
        );
        assert.notDeepStrictEqual(
            errorsFor(schema, typesEnvelope([{ id: 's1', name: 'S1', fields: [{ name: 'f', type: 'uint8', count: 1, allocation: 'sideways' }] }])),
            [],
        );
    });

    test('missing required field fails profiles.json and bindings.json', () => {
        const { schema } = loadSchema('profiles.schema.json');
        const data = [{ id: 'profile_1' }]; // name/typeInstances/activeChecks/endian/segmentNames/labels missing
        assert.notDeepStrictEqual(errorsFor(schema, profileEnvelope(data)), []);
        const bindings = loadSchema('bindings.schema.json');
        assert.notDeepStrictEqual(errorsFor(bindings.schema, bindingsEnvelope([{ fileKey: 'a.hex' }])), []);
    });

    test('a bare-array (legacy) data payload fails the object-form schemas', () => {
        // The schemas describe the versioned object form `{ schemaVersion, <payload> }`;
        // a legacy bare array is readable at runtime but no longer schema-valid.
        const types = loadSchema('types.schema.json');
        assert.notDeepStrictEqual(errorsFor(types.schema, { version: DATA_VERSION, data: [{ id: 's1' }] }), []);
        const bindings = loadSchema('bindings.schema.json');
        assert.notDeepStrictEqual(errorsFor(bindings.schema, { version: DATA_VERSION, data: [{ fileKey: 'a.hex' }] }), []);
        const profile = loadSchema('profiles.schema.json');
        assert.notDeepStrictEqual(errorsFor(profile.schema, { version: DATA_VERSION, data: [{ id: 'x' }] }), []);
    });

    test('a data payload missing schemaVersion or its payload key fails every schema', () => {
        const types = loadSchema('types.schema.json');
        assert.notDeepStrictEqual(errorsFor(types.schema, { version: DATA_VERSION, data: { defs: [] } }), [], 'missing schemaVersion');
        assert.notDeepStrictEqual(errorsFor(types.schema, { version: DATA_VERSION, data: { schemaVersion: DATA_SCHEMA_VERSION } }), [], 'missing defs');
        const profile = loadSchema('profiles.schema.json');
        assert.notDeepStrictEqual(errorsFor(profile.schema, { version: DATA_VERSION, data: { records: [] } }), [], 'missing schemaVersion');
        const bindings = loadSchema('bindings.schema.json');
        assert.notDeepStrictEqual(errorsFor(bindings.schema, { version: DATA_VERSION, data: { bindings: [] } }), [], 'missing schemaVersion');
    });

    test('a non-integer / sub-1 schemaVersion fails every schema', () => {
        for (const [name, key] of [['types.schema.json', 'defs'], ['profiles.schema.json', 'records'], ['bindings.schema.json', 'bindings']] as const) {
            const { schema } = loadSchema(name);
            assert.notDeepStrictEqual(errorsFor(schema, { version: DATA_VERSION, data: { schemaVersion: 1.5, [key]: [] } }), [], `${name} rejects fractional schemaVersion`);
            assert.notDeepStrictEqual(errorsFor(schema, { version: DATA_VERSION, data: { schemaVersion: 0, [key]: [] } }), [], `${name} rejects schemaVersion 0`);
        }
    });
});

suite('hexScope schemas — drift guard against TS types', () => {
    test('every schema pins version to DATA_VERSION', () => {
        for (const name of ['profiles.schema.json', 'types.schema.json', 'bindings.schema.json']) {
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

    test('typeFieldType enum matches TYPE_FIELD_TYPES', () => {
        const types = loadSchema('types.schema.json');
        const enumValue = (types.defs['typeFieldType'] as { enum: unknown[] }).enum;
        assert.deepStrictEqual(enumValue, Array.from(TYPE_FIELD_TYPES));
    });

    test('typeDef baseType enum matches TYPE_BASE_TYPES', () => {
        const types = loadSchema('types.schema.json');
        const typeDef = types.defs['typeDef'] as { properties: { baseType: { enum: unknown[] } } };
        assert.deepStrictEqual(typeDef.properties.baseType.enum, Array.from(TYPE_BASE_TYPES));
    });

    test('the three schemas declare an identical data.schemaVersion rule and the runtime constant is accepted', () => {
        const keys: Record<string, string> = {
            'profiles.schema.json': 'records',
            'types.schema.json': 'defs',
            'bindings.schema.json': 'bindings',
        };
        const rules: Array<{ schemaVersion: unknown; requiresVersion: boolean }> = [];
        for (const [name, payloadKey] of Object.entries(keys)) {
            const { schema } = loadSchema(name);
            const data = (schema as { properties: { data: { required?: string[]; properties?: Record<string, unknown> } } }).properties.data;
            assert.ok(data.required?.includes('schemaVersion'), `${name} requires data.schemaVersion`);
            assert.ok(data.required?.includes(payloadKey), `${name} requires data.${payloadKey}`);
            assert.deepStrictEqual(Object.keys(data.properties ?? {}).sort(), ['schemaVersion', payloadKey].sort(), `${name} declares exactly schemaVersion + ${payloadKey}`);
            rules.push({ schemaVersion: (data.properties as Record<string, unknown>).schemaVersion, requiresVersion: !!data.required?.includes('schemaVersion') });
        }
        assert.deepStrictEqual(rules[1], rules[0], 'types and profiles declare the same data.schemaVersion rule');
        assert.deepStrictEqual(rules[2], rules[0], 'bindings and profiles declare the same data.schemaVersion rule');
        // The schemas pin `minimum: 1` and no `const` (older files stay authorable);
        // the runtime constant must satisfy that floor, and a payload stamped with
        // it must validate for all three — the drift guard against a bare bump.
        assert.deepStrictEqual(rules[0].schemaVersion, { type: 'integer', minimum: 1, description: 'Data-schema version of the payload. The current build migrates older values forward on load; a newer value is left untouched (forward-only).' }, 'the shared data.schemaVersion rule is the version floor (no const)');
        for (const [name, payloadKey] of Object.entries(keys)) {
            const { schema } = loadSchema(name);
            assert.deepStrictEqual(
                errorsFor(schema, { version: DATA_VERSION, data: { schemaVersion: DATA_SCHEMA_VERSION, [payloadKey]: [] } }),
                [],
                `${name} accepts a DATA_SCHEMA_VERSION payload`,
            );
        }
    });
});
suite('hexScope schemas — integrity check kinds', () => {
    const profile = (check: Record<string, unknown>) => [{
        id: 'profile_1', name: 'Firmware', labels: [], segmentNames: {}, typeInstances: [], endian: 'le', bitAllocation: 'msb',
        activeChecks: { schemaVersion: 1, checks: [check] },
    }];
    const envelope = (check: Record<string, unknown>) => ({
        version: DATA_VERSION,
        data: { schemaVersion: DATA_SCHEMA_VERSION, records: profile(check) },
        $schema: 'schemas/profiles.schema.json',
    });

    test('a script check without a path fails authoring', () => {
        const { schema } = loadSchema('profiles.schema.json');
        assert.notDeepStrictEqual(errorsFor(schema, envelope({
            kind: 'script', startAddress: 0, endAddress: 1, autoFixStoredValue: false,
        })), []);
    });

    test('a script check carrying an algorithm fails authoring', () => {
        const { schema } = loadSchema('profiles.schema.json');
        assert.notDeepStrictEqual(errorsFor(schema, envelope({
            kind: 'script', scriptPath: 'a.js', algorithm: 'md5', startAddress: 0, endAddress: 1, autoFixStoredValue: false,
        })), []);
    });

    test('a built-in check carrying a scriptPath fails authoring', () => {
        const { schema } = loadSchema('profiles.schema.json');
        assert.notDeepStrictEqual(errorsFor(schema, envelope({
            kind: 'builtin', algorithm: 'md5', scriptPath: 'a.js', startAddress: 0, endAddress: 1, autoFixStoredValue: false,
        })), []);
    });

    test('an unknown kind fails authoring', () => {
        const { schema } = loadSchema('profiles.schema.json');
        assert.notDeepStrictEqual(errorsFor(schema, envelope({
            kind: 'plugin', algorithm: 'md5', startAddress: 0, endAddress: 1, autoFixStoredValue: false,
        })), []);
    });

    test('older checks without kind still author with an algorithm or a scriptPath', () => {
        const { schema } = loadSchema('profiles.schema.json');
        assert.deepStrictEqual(errorsFor(schema, envelope({
            algorithm: 'md5', startAddress: 0, endAddress: 1, autoFixStoredValue: false,
        })), []);
        assert.deepStrictEqual(errorsFor(schema, envelope({
            scriptPath: 'a.js', startAddress: 0, endAddress: 1, autoFixStoredValue: false,
        })), []);
        assert.notDeepStrictEqual(errorsFor(schema, envelope({
            startAddress: 0, endAddress: 1, autoFixStoredValue: false,
        })), []);
    });
});
