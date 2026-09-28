import * as assert from 'assert';

import { normalizeStructDefsValue } from '../../core/structNormalization';
import type { StructDef, StructField } from '../../core/types';

function enumDef(): StructDef {
    return {
        id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [],
        entries: [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }],
    };
}

function userDef(): StructDef {
    return {
        id: 'user', name: 'User', fields: [
            { name: 'state', type: 'enum', refStructId: 'mode', count: 1 },
            { name: 'after', type: 'uint8', count: 1 },
        ],
    };
}

suite('normalizeStructDefsValue() — enum sanitization', () => {
    test('keeps a well-formed enum and its referencing field (no change)', () => {
        const defs = [enumDef(), userDef()];
        const result = normalizeStructDefsValue(defs);
        assert.strictEqual(result.changed, false, 'clean pool should not signal a self-heal write');
        assert.strictEqual(result.defs[0], defs[0], 'clean enum def keeps its reference');
        assert.strictEqual(result.defs[1], defs[1], 'clean user def keeps its reference');
    });

    test('drops enum entries that do not fit the base width', () => {
        const bad: StructDef = {
            id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [],
            entries: [
                { name: 'OFF', value: 0 },
                { name: 'TOO_BIG', value: 256 },
                { name: 'NEG', value: -1 },
                { name: 'ON', value: 1 },
            ],
        };
        const result = normalizeStructDefsValue([bad]);
        assert.strictEqual(result.changed, true);
        assert.deepStrictEqual(result.defs[0].entries, [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }]);
    });

    test('drops a scalar enum field whose reference is missing or not an enum', () => {
        const dangling: StructDef = {
            id: 'user', name: 'User', fields: [
                { name: 'state', type: 'enum', refStructId: 'missing', count: 1 },
                { name: 'after', type: 'uint8', count: 1 },
            ],
        };
        const result = normalizeStructDefsValue([dangling]);
        assert.strictEqual(result.changed, true);
        assert.deepStrictEqual(result.defs[0].fields.map(f => f.name), ['after']);

        const notEnum: StructDef = { id: 'plain', name: 'Plain', fields: [] };
        const pointsAtStruct: StructDef = {
            id: 'user', name: 'User', fields: [{ name: 'state', type: 'enum', refStructId: 'plain', count: 1 }],
        };
        const second = normalizeStructDefsValue([notEnum, pointsAtStruct]);
        assert.strictEqual(second.changed, true);
        assert.deepStrictEqual(second.defs[1].fields, []);
    });

    test('clears a bit-field child enum ref that does not resolve (child itself stays)', () => {
        const bits: StructDef = {
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'lo', bitWidth: 4, refStructId: 'missing' }, { name: 'hi', bitWidth: 4 }],
        };
        const result = normalizeStructDefsValue([bits]);
        assert.strictEqual(result.changed, true);
        assert.strictEqual(result.defs[0].bitFields![0].refStructId, undefined);
        assert.strictEqual(result.defs[0].bitFields![0].bitWidth, 4);
        assert.strictEqual(result.defs[0].bitFields![1].refStructId, undefined);
    });

    test('keeps a valid bit-field child enum ref', () => {
        const bits: StructDef = {
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'lo', bitWidth: 4, refStructId: 'mode' }],
        };
        const result = normalizeStructDefsValue([enumDef(), bits]);
        assert.strictEqual(result.changed, false);
        assert.strictEqual(result.defs[1], bits);
    });
});

suite('normalizeStructDefsValue() — old pool load', () => {
    test('a struct-only pool loads unchanged and does not signal a write', () => {
        const legacy: StructDef[] = [
            { id: 'header', name: 'Header', packed: true, fields: [
                { name: 'tag', type: 'uint8', count: 1 },
                { name: 'size', type: 'uint16', count: 1, endian: 'be' },
            ] },
            { id: 'leaf', name: 'Leaf', fields: [{ name: 'next', type: 'struct', refStructId: 'header', isPointer: true, count: 1 }] },
        ];
        const result = normalizeStructDefsValue(legacy);
        assert.strictEqual(result.changed, false);
        assert.deepStrictEqual(result.defs, legacy);
        assert.strictEqual(result.defs[0], legacy[0]);
    });

    test('an already-reusable pool loads unchanged and does not signal a write', () => {
        const reusable: StructDef[] = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }] },
            { id: 'header', name: 'Header', fields: [{ name: 'flags', type: 'bitfield', refStructId: 'bits', count: 1 }] },
        ];
        const result = normalizeStructDefsValue(reusable);
        assert.strictEqual(result.changed, false);
        assert.strictEqual(result.defs[0], reusable[0]);
        assert.strictEqual(result.defs[1], reusable[1]);
    });
});

suite('normalizeStructDefsValue() — inline bit-field migration', () => {
    function legacyPool(): StructDef[] {
        const container = () => [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }];
        return [
            { id: 'header', name: 'Header', fields: [
                { name: 'flags', type: 'uint8', count: 1, bitFields: container() },
                { name: 'tail', type: 'uint16', count: 1 },
            ] },
            { id: 'other', name: 'Other', fields: [
                { name: 'flags', type: 'uint8', count: 2, endian: 'be', bitFields: container() },
            ] },
        ];
    }

    test('collapses identical inline containers onto one shared standalone type', () => {
        const result = normalizeStructDefsValue(legacyPool());
        assert.strictEqual(result.changed, true);
        const generated = result.defs.filter(d => d.kind === 'bitfield');
        assert.strictEqual(generated.length, 1, 'one shared def for identical containers');
        assert.strictEqual(generated[0].id, 'migrated_bitfield_1', 'lowest unused generated id');
        assert.strictEqual(generated[0].name, 'flags', 'name from the first matching field');
        assert.deepStrictEqual(generated[0].bitFields, [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }]);
        assert.strictEqual(generated[0].baseType, 'uint8');
        assert.deepStrictEqual(generated[0].fields, []);

        const header = result.defs.find(d => d.id === 'header')!;
        assert.deepStrictEqual(header.fields[0], { name: 'flags', type: 'bitfield', refStructId: 'migrated_bitfield_1', count: 1 });
        const other = result.defs.find(d => d.id === 'other')!;
        assert.strictEqual(other.fields[0].type, 'bitfield');
        assert.strictEqual(other.fields[0].refStructId, 'migrated_bitfield_1');
        assert.strictEqual(other.fields[0].count, 2, 'array count override preserved');
        assert.strictEqual(other.fields[0].endian, 'be', 'endian override preserved');
        assert.strictEqual(other.fields[0].bitFields, undefined, 'inline children cleared');
    });

    test('preserves usage-scoped overrides (name/count/endian/allocation/hidden) and clears the collapse flag', () => {
        // `hidden` is not declared on StructField but legacy pools may carry it;
        // migration must pass every usage-scoped key through on the referencing field.
        const legacyField: StructField & { hidden?: boolean } = {
            name: 'status', type: 'uint16', count: 1, endian: 'be', allocation: 'lsb', hidden: true,
            bitFieldsCollapsed: true,
            bitFields: [{ name: 'lo', bitWidth: 4 }, { name: 'hi', bitWidth: 4 }],
        };
        const legacy: StructDef[] = [{ id: 'regs', name: 'Regs', fields: [legacyField] }];
        const result = normalizeStructDefsValue(legacy);
        const field = result.defs[0].fields[0] as StructField & { hidden?: boolean };
        assert.strictEqual(field.type, 'bitfield');
        assert.strictEqual(field.name, 'status', 'field name preserved');
        assert.strictEqual(field.count, 1, 'count preserved');
        assert.strictEqual(field.endian, 'be', 'endian override preserved');
        assert.strictEqual(field.allocation, 'lsb', 'allocation override preserved');
        assert.strictEqual(field.hidden, true, 'hidden flag preserved');
        assert.strictEqual(field.bitFields, undefined, 'inline children cleared');
        assert.strictEqual(field.bitFieldsCollapsed, undefined, 'collapse flag cleared');
        assert.strictEqual(result.defs[0].kind, undefined, 'containing def stays a plain struct');
    });

    test('is idempotent: a second run over the migrated pool is a no-op', () => {
        const first = normalizeStructDefsValue(legacyPool());
        const second = normalizeStructDefsValue(first.defs);
        assert.strictEqual(second.changed, false);
        assert.deepStrictEqual(second.defs, first.defs, 'second run is a no-op');
    });

    test('keeps containers distinct when they differ by a child enum label', () => {
        const withEnums: StructDef[] = [
            { id: 'e1', name: 'E1', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'OFF', value: 0 }] },
            { id: 'e2', name: 'E2', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'ON', value: 1 }] },
            { id: 'a', name: 'A', fields: [
                { name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'x', bitWidth: 3, refStructId: 'e1' }, { name: 'y', bitWidth: 5 }] },
            ] },
            { id: 'b', name: 'B', fields: [
                { name: 'mode', type: 'uint8', count: 1, bitFields: [{ name: 'x', bitWidth: 3, refStructId: 'e2' }, { name: 'y', bitWidth: 5 }] },
            ] },
        ];
        const result = normalizeStructDefsValue(withEnums);
        const generated = result.defs.filter(d => d.kind === 'bitfield');
        assert.strictEqual(generated.length, 2, 'child enum refs keep distinct containers distinct');
        assert.deepStrictEqual(generated.map(d => d.bitFields![0].refStructId).sort(), ['e1', 'e2'], 'each child enum label survives');
    });

    test('dedupes onto an existing reusable def with the same signature', () => {
        const existing: StructDef[] = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }] },
            { id: 'leaf', name: 'Leaf', fields: [{ name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }] }] },
        ];
        const result = normalizeStructDefsValue(existing);
        assert.strictEqual(result.changed, true);
        assert.strictEqual(result.defs.filter(d => d.kind === 'bitfield').length, 1, 'reuses the existing def');
        assert.strictEqual(result.defs.find(d => d.id === 'leaf')!.fields[0].refStructId, 'bits');
    });
});
