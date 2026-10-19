import * as assert from 'assert';

import { normalizeTypeDefsValue } from '../../core/overlay/overlayNormalization';
import type { TypeDef, TypeField } from '../../core/types';

function enumDef(): TypeDef {
    return {
        id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [],
        entries: [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }],
    };
}

function userDef(): TypeDef {
    return {
        id: 'user', name: 'User', fields: [
            { name: 'state', type: 'enum', refTypeId: 'mode', count: 1 },
            { name: 'after', type: 'uint8', count: 1 },
        ],
    };
}

suite('normalizeTypeDefsValue() — enum sanitization', () => {
    test('keeps a well-formed enum and its referencing field (no change)', () => {
        const defs = [enumDef(), userDef()];
        const result = normalizeTypeDefsValue(defs);
        assert.strictEqual(result.changed, false, 'clean pool should not signal a self-heal write');
        assert.strictEqual(result.defs[0], defs[0], 'clean enum def keeps its reference');
        assert.strictEqual(result.defs[1], defs[1], 'clean user def keeps its reference');
    });

    test('drops enum entries that do not fit the base width', () => {
        const bad: TypeDef = {
            id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [],
            entries: [
                { name: 'OFF', value: 0 },
                { name: 'TOO_BIG', value: 256 },
                { name: 'NEG', value: -1 },
                { name: 'ON', value: 1 },
            ],
        };
        const result = normalizeTypeDefsValue([bad]);
        assert.strictEqual(result.changed, true);
        assert.deepStrictEqual(result.defs[0].entries, [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }]);
    });

    test('drops a scalar enum field whose reference is missing or not an enum', () => {
        const dangling: TypeDef = {
            id: 'user', name: 'User', fields: [
                { name: 'state', type: 'enum', refTypeId: 'missing', count: 1 },
                { name: 'after', type: 'uint8', count: 1 },
            ],
        };
        const result = normalizeTypeDefsValue([dangling]);
        assert.strictEqual(result.changed, true);
        assert.deepStrictEqual(result.defs[0].fields.map(f => f.name), ['after']);

        const notEnum: TypeDef = { id: 'plain', name: 'Plain', fields: [] };
        const pointsAtType: TypeDef = {
            id: 'user', name: 'User', fields: [{ name: 'state', type: 'enum', refTypeId: 'plain', count: 1 }],
        };
        const second = normalizeTypeDefsValue([notEnum, pointsAtType]);
        assert.strictEqual(second.changed, true);
        assert.deepStrictEqual(second.defs[1].fields, []);
    });

    test('clears a bit-field child enum ref that does not resolve (child itself stays)', () => {
        const bits: TypeDef = {
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'lo', bitWidth: 4, refTypeId: 'missing' }, { name: 'hi', bitWidth: 4 }],
        };
        const result = normalizeTypeDefsValue([bits]);
        assert.strictEqual(result.changed, true);
        assert.strictEqual(result.defs[0].bitFields![0].refTypeId, undefined);
        assert.strictEqual(result.defs[0].bitFields![0].bitWidth, 4);
        assert.strictEqual(result.defs[0].bitFields![1].refTypeId, undefined);
    });

    test('keeps a valid bit-field child enum ref', () => {
        const bits: TypeDef = {
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'lo', bitWidth: 4, refTypeId: 'mode' }],
        };
        const result = normalizeTypeDefsValue([enumDef(), bits]);
        assert.strictEqual(result.changed, false);
        assert.strictEqual(result.defs[1], bits);
    });
});

suite('normalizeTypeDefsValue() — old pool load', () => {
    test('a plain-type pool loads unchanged and does not signal a write', () => {
        const legacy: TypeDef[] = [
            { id: 'header', name: 'Header', packed: true, fields: [
                { name: 'tag', type: 'uint8', count: 1 },
                { name: 'size', type: 'uint16', count: 1, endian: 'be' },
            ] },
            { id: 'leaf', name: 'Leaf', fields: [{ name: 'next', type: 'struct', refTypeId: 'header', isPointer: true, count: 1 }] },
        ];
        const result = normalizeTypeDefsValue(legacy);
        assert.strictEqual(result.changed, false);
        assert.deepStrictEqual(result.defs, legacy);
        assert.strictEqual(result.defs[0], legacy[0]);
    });

    test('an already-reusable pool loads unchanged and does not signal a write', () => {
        const reusable: TypeDef[] = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }] },
            { id: 'header', name: 'Header', fields: [{ name: 'flags', type: 'bitfield', refTypeId: 'bits', count: 1 }] },
        ];
        const result = normalizeTypeDefsValue(reusable);
        assert.strictEqual(result.changed, false);
        assert.strictEqual(result.defs[0], reusable[0]);
        assert.strictEqual(result.defs[1], reusable[1]);
    });
});

suite('normalizeTypeDefsValue() — inline bit-field migration', () => {
    function legacyPool(): TypeDef[] {
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
        const result = normalizeTypeDefsValue(legacyPool());
        assert.strictEqual(result.changed, true);
        const generated = result.defs.filter(d => d.kind === 'bitfield');
        assert.strictEqual(generated.length, 1, 'one shared def for identical containers');
        assert.strictEqual(generated[0].id, 'migrated_bitfield_1', 'lowest unused generated id');
        assert.strictEqual(generated[0].name, 'flags', 'name from the first matching field');
        assert.deepStrictEqual(generated[0].bitFields, [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }]);
        assert.strictEqual(generated[0].baseType, 'uint8');
        assert.deepStrictEqual(generated[0].fields, []);

        const header = result.defs.find(d => d.id === 'header')!;
        assert.deepStrictEqual(header.fields[0], { name: 'flags', type: 'bitfield', refTypeId: 'migrated_bitfield_1', count: 1 });
        const other = result.defs.find(d => d.id === 'other')!;
        assert.strictEqual(other.fields[0].type, 'bitfield');
        assert.strictEqual(other.fields[0].refTypeId, 'migrated_bitfield_1');
        assert.strictEqual(other.fields[0].count, 2, 'array count override preserved');
        assert.strictEqual(other.fields[0].endian, 'be', 'endian override preserved');
        assert.strictEqual(other.fields[0].bitFields, undefined, 'inline children cleared');
    });

    test('preserves usage-scoped overrides (name/count/endian/allocation/hidden) and clears the collapse flag', () => {
        // Every usage-scoped key (now including the first-class `hidden`) must
        // pass through onto the referencing field.
        const legacyField: TypeField = {
            name: 'status', type: 'uint16', count: 1, endian: 'be', allocation: 'lsb', hidden: true,
            bitFieldsCollapsed: true,
            bitFields: [{ name: 'lo', bitWidth: 4 }, { name: 'hi', bitWidth: 4 }],
        };
        const legacy: TypeDef[] = [{ id: 'regs', name: 'Regs', fields: [legacyField] }];
        const result = normalizeTypeDefsValue(legacy);
        const field = result.defs[0].fields[0];
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

    test('aliases a legacy inline bit-child enum ref before migrating the container', () => {
        // A pre-rename pool wrote the bit child's enum ref as `refStructId`. The
        // alias must run before `migrateInlineBitFields` reads the container
        // signature and copies the children, otherwise the label ref is lost and
        // the stale key would be re-emitted into the strict schema.
        const legacy = [
            { id: 'regs', name: 'Regs', fields: [
                { name: 'ctrl', type: 'uint8', count: 1, bitFields: [
                    { name: 'mode', bitWidth: 2, refStructId: 'mode' },
                    { name: 'code', bitWidth: 6 },
                ] },
            ] },
            { id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }] },
        ];
        const result = normalizeTypeDefsValue(legacy as unknown as TypeDef[]);
        assert.strictEqual(result.changed, true);
        const generated = result.defs.find(d => d.kind === 'bitfield')!;
        assert.deepStrictEqual(
            generated.bitFields,
            [{ name: 'mode', bitWidth: 2, refTypeId: 'mode' }, { name: 'code', bitWidth: 6 }],
            'the inline child enum ref survives the container migration under the new key',
        );
        assert.strictEqual(result.defs.find(d => d.id === 'mode')!.kind, 'enum', 'the enum def is kept');
        assert.ok(!JSON.stringify(result.defs).includes('refStructId'), 'no legacy ref key is re-emitted');
    });

    test('is idempotent: a second run over the migrated pool is a no-op', () => {
        const first = normalizeTypeDefsValue(legacyPool());
        const second = normalizeTypeDefsValue(first.defs);
        assert.strictEqual(second.changed, false);
        assert.deepStrictEqual(second.defs, first.defs, 'second run is a no-op');
    });

    test('keeps containers distinct when they differ by a child enum label', () => {
        const withEnums: TypeDef[] = [
            { id: 'e1', name: 'E1', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'OFF', value: 0 }] },
            { id: 'e2', name: 'E2', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'ON', value: 1 }] },
            { id: 'a', name: 'A', fields: [
                { name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'x', bitWidth: 3, refTypeId: 'e1' }, { name: 'y', bitWidth: 5 }] },
            ] },
            { id: 'b', name: 'B', fields: [
                { name: 'mode', type: 'uint8', count: 1, bitFields: [{ name: 'x', bitWidth: 3, refTypeId: 'e2' }, { name: 'y', bitWidth: 5 }] },
            ] },
        ];
        const result = normalizeTypeDefsValue(withEnums);
        const generated = result.defs.filter(d => d.kind === 'bitfield');
        assert.strictEqual(generated.length, 2, 'child enum refs keep distinct containers distinct');
        assert.deepStrictEqual(generated.map(d => d.bitFields![0].refTypeId).sort(), ['e1', 'e2'], 'each child enum label survives');
    });

    test('dedupes onto an existing reusable def with the same signature', () => {
        const existing: TypeDef[] = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }] },
            { id: 'leaf', name: 'Leaf', fields: [{ name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }] }] },
        ];
        const result = normalizeTypeDefsValue(existing);
        assert.strictEqual(result.changed, true);
        assert.strictEqual(result.defs.filter(d => d.kind === 'bitfield').length, 1, 'reuses the existing def');
        assert.strictEqual(result.defs.find(d => d.id === 'leaf')!.fields[0].refTypeId, 'bits');
    });
});

suite('normalizeTypeDefsValue() — hidden field flag', () => {
    test('keeps hidden:true on a plain field through a clean round-trip', () => {
        const pool: TypeDef[] = [
            { id: 'header', name: 'Header', fields: [
                { name: 'reserved', type: 'uint8', count: 1, hidden: true },
                { name: 'tag', type: 'uint8', count: 1 },
            ] },
        ];
        const result = normalizeTypeDefsValue(pool);
        assert.strictEqual(result.changed, false, 'hidden is a supported key: no self-heal write');
        assert.strictEqual(result.defs[0], pool[0], 'clean pool keeps its reference');
        assert.strictEqual(result.defs[0].fields[0].hidden, true, 'hidden survives the round-trip');
    });

    test('an old file without hidden loads unchanged with every field visible', () => {
        const legacy: TypeDef[] = [
            { id: 'header', name: 'Header', packed: true, fields: [
                { name: 'tag', type: 'uint8', count: 1 },
                { name: 'size', type: 'uint16', count: 1, endian: 'be' },
            ] },
        ];
        const result = normalizeTypeDefsValue(legacy);
        assert.strictEqual(result.changed, false, 'old file stays minimal (no key added)');
        assert.strictEqual(result.defs[0], legacy[0], 'old def keeps its reference');
        for (const field of result.defs[0].fields) {
            assert.strictEqual(field.hidden, undefined, 'absent hidden means visible');
        }
        assert.strictEqual('hidden' in result.defs[0].fields[0], false, 'no hidden key is materialized');
    });

    test('keeps hidden:true on a bit child through a clean round-trip', () => {
        const pool: TypeDef[] = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
              bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4 }] },
            { id: 'header', name: 'Header', fields: [{ name: 'flags', type: 'bitfield', refTypeId: 'bits', count: 1 }] },
        ];
        const result = normalizeTypeDefsValue(pool);
        assert.strictEqual(result.changed, false, 'hidden is a supported bit-child key: no self-heal write');
        assert.strictEqual(result.defs[0], pool[0], 'clean pool keeps its reference');
        assert.strictEqual(result.defs[0].bitFields![0].hidden, true, 'bit-child hidden survives the round-trip');
        assert.strictEqual('hidden' in result.defs[0].bitFields![1], false, 'absent stays absent');
    });

    test('drops an explicit hidden:false on a bit child (absent = visible)', () => {
        const pool: TypeDef[] = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
              bitFields: [{ name: 'lo', bitWidth: 4, hidden: false }, { name: 'hi', bitWidth: 4 }] },
        ];
        const result = normalizeTypeDefsValue(pool);
        assert.strictEqual(result.changed, true, 'dropping the redundant key signals a self-heal write');
        assert.strictEqual('hidden' in result.defs[0].bitFields![0], false, 'explicit false is dropped');
        assert.strictEqual(result.defs[0].bitFields![0].name, 'lo', 'the child itself is preserved');
        assert.deepStrictEqual(result.defs[0].bitFields![1], { name: 'hi', bitWidth: 4 }, 'sibling untouched');
    });

    test('a legacy inline bit-field pool without hidden migrates with every bit visible', () => {
        const legacy: TypeDef[] = [
            { id: 'header', name: 'Header', fields: [
                { name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }] },
            ] },
        ];
        const result = normalizeTypeDefsValue(legacy);
        assert.strictEqual(result.changed, true, 'legacy inline container migrates once');
        const bits = result.defs.find(d => d.kind === 'bitfield')!;
        assert.strictEqual(bits.bitFields!.every(child => !('hidden' in child)), true, 'no hidden key is materialized');
    });

    test('inline containers differing only by a hidden bit child migrate to separate types', () => {
        const legacy: TypeDef[] = [
            { id: 'a', name: 'A', fields: [
                { name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4 }] },
            ] },
            { id: 'b', name: 'B', fields: [
                { name: 'flags', type: 'uint8', count: 1, bitFields: [{ name: 'lo', bitWidth: 4 }, { name: 'hi', bitWidth: 4 }] },
            ] },
        ];
        const result = normalizeTypeDefsValue(legacy);
        const byId = new Map(result.defs.filter(d => d.kind === 'bitfield').map(d => [d.id, d]));
        const refs = result.defs.slice(0, 2).map(d => d.fields[0].refTypeId);

        assert.strictEqual(byId.size, 2, 'a hidden bit is part of the container signature, so the two containers do not collapse');
        assert.notStrictEqual(refs[0], refs[1], 'each container keeps its own bit-field type');
        assert.strictEqual(byId.get(refs[0]!)!.bitFields![0].hidden, true, 'the hidden container keeps its hidden bit');
        assert.strictEqual('hidden' in byId.get(refs[1]!)!.bitFields![0], false, 'the visible container stays fully visible');
    });
});
