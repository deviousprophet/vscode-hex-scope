import * as assert from 'assert';

import { normalizeStructDefsValue } from '../../core/structNormalization';
import type { StructDef } from '../../core/types';

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
                { name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }] },
            ] },
            { id: 'leaf', name: 'Leaf', fields: [{ name: 'next', type: 'struct', refStructId: 'header', isPointer: true, count: 1 }] },
        ];
        const result = normalizeStructDefsValue(legacy);
        assert.strictEqual(result.changed, false);
        assert.deepStrictEqual(result.defs, legacy);
        assert.strictEqual(result.defs[0], legacy[0]);
    });
});
