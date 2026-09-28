import * as assert from 'assert';

import {
    fieldByteSize, structByteSize, decodeField, decodeStruct,
    allStructs, parseStructText, fieldsToText, validateStructs, structToC, resolveStructFieldByPath,
    structDefKind, materializeBitFieldRefs, migrateInlineBitFields, formatEnumLabel, matchEnumEntry,
    normalizeStructField,
} from '../../core/structCodec';
import { getByte, setBytesInSegment } from '../shared/structTestHelpers';
import type { StructDef, StructField } from '../../core/types';

let structs: StructDef[] = [];

function resetStructState(): void {
    structs = [];
    setBytesInSegment(0, []);
}

function layoutFields(): StructField[] {
    return [
        { name: 'a', type: 'uint8', count: 1 },
        { name: 'b', type: 'uint32', count: 1 },
        { name: 'c', type: 'uint16', count: 1 },
    ];
}

function bitFieldStruct(): StructDef {
    return {
        id: 'x', name: 'Bits', packed: true, fields: [{
            name: 'bits', type: 'uint8', count: 1,
            bitFields: [{ name: 'a', bitWidth: 3 }, { name: 'b', bitWidth: 5 }],
        }],
    };
}

// ── fieldByteSize ─────────────────────────────────────────────────

suite('fieldByteSize()', () => {
    test('uint8   → 1', () => assert.strictEqual(fieldByteSize('uint8'),   1));
    test('uint16  → 2', () => assert.strictEqual(fieldByteSize('uint16'),  2));
    test('uint32  → 4', () => assert.strictEqual(fieldByteSize('uint32'),  4));
    test('uint64  → 8', () => assert.strictEqual(fieldByteSize('uint64'),  8));
    test('int8    → 1', () => assert.strictEqual(fieldByteSize('int8'),    1));
    test('int16   → 2', () => assert.strictEqual(fieldByteSize('int16'),   2));
    test('int32   → 4', () => assert.strictEqual(fieldByteSize('int32'),   4));
    test('int64   → 8', () => assert.strictEqual(fieldByteSize('int64'),   8));
    test('float32 → 4', () => assert.strictEqual(fieldByteSize('float32'), 4));
    test('float64 → 8', () => assert.strictEqual(fieldByteSize('float64'), 8));
    test('pointer → 4', () => assert.strictEqual(fieldByteSize('pointer'), 4));
});

// ── structByteSize ────────────────────────────────────────────────

suite('structByteSize()', () => {
    test('empty struct is 0 bytes', () => {
        const def: StructDef = { id: 'x', name: 'Empty', fields: [] };
        assert.strictEqual(structByteSize(def), 0);
    });

    test('single uint32 field is 4 bytes', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint32', count: 1 },
        ]};
        assert.strictEqual(structByteSize(def), 4);
    });

    test('mixed field types packed: no padding (7 bytes)', () => {
        const def: StructDef = { id: 'x', name: 'S', packed: true, fields: [
            { name: 'a', type: 'uint8',  count: 1 },  // 1
            { name: 'b', type: 'uint16', count: 1 },  // 2
            { name: 'c', type: 'uint32', count: 1 },  // 4
        ]};
        assert.strictEqual(structByteSize(def), 7);
    });

    test('mixed field types aligned: uint8+uint16+uint32 = 8 bytes', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint8',  count: 1 },  // +0
            { name: 'b', type: 'uint16', count: 1 },  // +2 (1B pad)
            { name: 'c', type: 'uint32', count: 1 },  // +4
        ]};
        assert.strictEqual(structByteSize(def), 8);
    });

    test('aligned struct has trailing padding to max alignment', () => {
        // uint32 then uint8: size = 4+1 padded to 8 (align=4)
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint32', count: 1 },  // +0
            { name: 'b', type: 'uint8',  count: 1 },  // +4
        ]};
        assert.strictEqual(structByteSize(def), 8);
    });

    test('array field multiplies by count', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'v', type: 'uint32', count: 4 },  // 4 × 4 = 16
        ]};
        assert.strictEqual(structByteSize(def), 16);
    });

    test('uint64 alignment (not packed): uint32 then uint64 → 16', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint32', count: 1 },
            { name: 'b', type: 'uint64', count: 1 },
        ]};
        assert.strictEqual(structByteSize(def), 16);
    });

    test('uint64 alignment (packed): uint32 then uint64 → 12', () => {
        const def: StructDef = { id: 'x', name: 'S', packed: true, fields: [
            { name: 'a', type: 'uint32', count: 1 },
            { name: 'b', type: 'uint64', count: 1 },
        ]};
        assert.strictEqual(structByteSize(def), 12);
    });

    test('bit fields share storage unit for same base type', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            {
                name: 'bits',
                type: 'uint16',
                count: 1,
                bitFields: [
                    { name: 'a', bitWidth: 3 },
                    { name: 'b', bitWidth: 5 },
                    { name: 'c', bitWidth: 4 },
                ],
            },
        ]};
        assert.strictEqual(structByteSize(def), 2);
    });

    test('bit fields followed by normal field align to next natural boundary', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            {
                name: 'bits',
                type: 'uint16',
                count: 1,
                bitFields: [
                    { name: 'a', bitWidth: 3 },
                    { name: 'b', bitWidth: 5 },
                ],
            },
            { name: 'c', type: 'uint32', count: 1 },
        ]};
        assert.strictEqual(structByteSize(def), 8);
    });

    test('bit-field containers can be arrays', () => {
        const def: StructDef = { id: 'x', name: 'Bits', fields: [
            {
                name: 'flags',
                type: 'uint8',
                count: 2,
                bitFields: [
                    { name: 'enabled', bitWidth: 1 },
                    { name: 'mode', bitWidth: 7 },
                ],
            },
        ]};
        assert.strictEqual(structByteSize(def), 2);

        setBytesInSegment(0, [0x81, 0x7F]);
        const rows = decodeStruct(def, 0, getByte, 'le', 'lsb');
        assert.strictEqual(rows.length, 4);
        assert.strictEqual(rows[0].fieldName, 'flags[0].enabled');
        assert.strictEqual(rows[1].fieldName, 'flags[0].mode');
        assert.strictEqual(rows[2].fieldName, 'flags[1].enabled');
        assert.strictEqual(rows[3].fieldName, 'flags[1].mode');
        assert.strictEqual(rows[0].bitValueUnsigned, '1');
        assert.strictEqual(rows[1].bitValueUnsigned, '64');
    });

    test('nested struct contributes child size and alignment', () => {
        const child: StructDef = {
            id: 'child',
            name: 'Child',
            fields: [
                { name: 'x', type: 'uint16', count: 1 },
                { name: 'y', type: 'uint16', count: 1 },
            ],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'head', type: 'uint32', count: 1 },
                { name: 'c', type: 'struct', refStructId: 'child', count: 1 },
            ],
        };
        structs = [child, parent];
        assert.strictEqual(structByteSize(parent, structs), 8);
        structs = [];
    });
});

// ── decodeField ───────────────────────────────────────────────────

suite('decodeField()', () => {

    test('uint8 0x42 returns "66  (0x42)"', () => {
        const r = decodeField([0x42], 'uint8', 'le');
        assert.ok(r.startsWith('66'), `got: ${r}`);
        assert.ok(r.includes('0x42'), `got: ${r}`);
    });

    test('scalar types decode to expected values across endianness', () => {
        // check: 'exact' | 'prefix' | 'includes'
        const cases: { bytes: number[]; type: 'uint16' | 'uint32' | 'uint64' | 'int8' | 'int16' | 'int32' | 'int64'; endian: 'le' | 'be'; check: 'exact' | 'prefix' | 'includes'; expect: string }[] = [
            { bytes: [0x02, 0x01], type: 'uint16', endian: 'le', check: 'prefix', expect: '258' },
            { bytes: [0x01, 0x02], type: 'uint16', endian: 'be', check: 'prefix', expect: '258' },
            { bytes: [0x01, 0x00, 0x00, 0x00], type: 'uint32', endian: 'le', check: 'prefix', expect: '1' },
            { bytes: [0x00, 0x00, 0x00, 0x08], type: 'uint32', endian: 'le', check: 'includes', expect: '08000000' },
            { bytes: [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], type: 'uint64', endian: 'le', check: 'prefix', expect: '1' },
            { bytes: [0xFF], type: 'int8', endian: 'le', check: 'exact', expect: '-1' },
            { bytes: [0xFF, 0xFF], type: 'int16', endian: 'le', check: 'exact', expect: '-1' },
            { bytes: [0xFF, 0xFF, 0xFF, 0xFF], type: 'int32', endian: 'le', check: 'exact', expect: '-1' },
            { bytes: [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], type: 'int64', endian: 'le', check: 'exact', expect: '-1' },
            { bytes: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01], type: 'uint64', endian: 'be', check: 'prefix', expect: '1' },
            { bytes: [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], type: 'int64', endian: 'be', check: 'exact', expect: '-1' },
        ];
        for (const c of cases) {
            const label = `${c.type} ${c.endian}`;
            const r = decodeField(c.bytes, c.type, c.endian);
            if (c.check === 'exact') {
                assert.strictEqual(r, c.expect, label);
            } else if (c.check === 'prefix') {
                assert.ok(r.startsWith(c.expect), `${label} got: ${r}`);
            } else {
                assert.ok(r.includes(c.expect), `${label} got: ${r}`);
            }
        }
    });

    test('all multi-byte scalar types honor little and big endian byte order', () => {
        assert.ok(decodeField([0x34, 0x12], 'uint16', 'le').startsWith('4660'), 'uint16 LE');
        assert.ok(decodeField([0x12, 0x34], 'uint16', 'be').startsWith('4660'), 'uint16 BE');
        assert.strictEqual(decodeField([0xFE, 0xFF], 'int16', 'le'), '-2', 'int16 LE');
        assert.strictEqual(decodeField([0xFF, 0xFE], 'int16', 'be'), '-2', 'int16 BE');
        assert.ok(decodeField([0x78, 0x56, 0x34, 0x12], 'uint32', 'le').startsWith('305419896'), 'uint32 LE');
        assert.ok(decodeField([0x12, 0x34, 0x56, 0x78], 'uint32', 'be').startsWith('305419896'), 'uint32 BE');
        assert.strictEqual(decodeField([0xFE, 0xFF, 0xFF, 0xFF], 'int32', 'le'), '-2', 'int32 LE');
        assert.strictEqual(decodeField([0xFF, 0xFF, 0xFF, 0xFE], 'int32', 'be'), '-2', 'int32 BE');
        assert.ok(decodeField([0x08,0x07,0x06,0x05,0x04,0x03,0x02,0x01], 'uint64', 'le').startsWith('72623859790382856'), 'uint64 LE');
        assert.ok(decodeField([0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08], 'uint64', 'be').startsWith('72623859790382856'), 'uint64 BE');
        assert.strictEqual(decodeField([0xFE,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF], 'int64', 'le'), '-2', 'int64 LE');
        assert.strictEqual(decodeField([0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFE], 'int64', 'be'), '-2', 'int64 BE');
        assert.strictEqual(parseFloat(decodeField([0x00, 0x00, 0x80, 0x3F], 'float32', 'le')), 1, 'float32 LE');
        assert.strictEqual(parseFloat(decodeField([0x3F, 0x80, 0x00, 0x00], 'float32', 'be')), 1, 'float32 BE');
        assert.strictEqual(parseFloat(decodeField([0x00,0x00,0x00,0x00,0x00,0x00,0xF0,0x3F], 'float64', 'le')), 1, 'float64 LE');
        assert.strictEqual(parseFloat(decodeField([0x3F,0xF0,0x00,0x00,0x00,0x00,0x00,0x00], 'float64', 'be')), 1, 'float64 BE');
        assert.strictEqual(decodeField([0x78, 0x56, 0x34, 0x12], 'pointer', 'le'), '0x12345678', 'pointer LE');
        assert.strictEqual(decodeField([0x12, 0x34, 0x56, 0x78], 'pointer', 'be'), '0x12345678', 'pointer BE');
    });

    test('float32 and float64 decode 1.0 (LE)', () => {
        for (const [type, bytes] of [
            ['float32', [0x00, 0x00, 0x80, 0x3F]],
            ['float64', [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xF0, 0x3F]],
        ] as ['float32' | 'float64', number[]][]) {
            const r = decodeField(bytes, type, 'le');
            assert.strictEqual(parseFloat(r), 1, type);
        }
    });

    test('returns "??" when a byte is missing (value -1)', () => {
        assert.strictEqual(decodeField([-1], 'uint8', 'le'), '??');
        assert.strictEqual(decodeField([0x01, 0x02], 'uint32', 'le'), '??', 'partial bytes');
    });
});

// ── decodeStruct ──────────────────────────────────────────────────

suite('decodeStruct()', () => {
    setup(() => resetStructState());

    test('produces one row per scalar field', () => {
        const def: StructDef = { id: 'x', name: 'S', packed: true, fields: [
            { name: 'a', type: 'uint8',  count: 1 },
            { name: 'b', type: 'uint16', count: 1 },
        ]};
        // populate parseResult at base 0x100
        setBytesInSegment(0x100, [0x01, 0x02, 0x03]);

        const rows = decodeStruct(def, 0x100, getByte, 'le');
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].fieldName, 'a');
        assert.strictEqual(rows[0].byteOffset, 0);
        assert.strictEqual(rows[1].fieldName, 'b');
        assert.strictEqual(rows[1].byteOffset, 1);
    });

    test('aligned struct: uint8 then uint16 at offset 2', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint8',  count: 1 },
            { name: 'b', type: 'uint16', count: 1 },
        ]};
        const rows = decodeStruct(def, 0, getByte, 'le');
        assert.strictEqual(rows[0].byteOffset, 0);
        assert.strictEqual(rows[1].byteOffset, 2);
    });

    test('array field expands to count rows named field[0], field[1]...', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'v', type: 'uint8', count: 3 },
        ]};
        setBytesInSegment(0, [0x0A, 0x0B, 0x0C]);

        const rows = decodeStruct(def, 0, getByte, 'le');
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[0].fieldName, 'v[0]');
        assert.strictEqual(rows[1].fieldName, 'v[1]');
        assert.strictEqual(rows[2].fieldName, 'v[2]');
    });

    test('hasData is false when byte is absent from segments', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint8', count: 1 },
        ]};
        // Do NOT populate any bytes; getByte will return undefined
        const rows = decodeStruct(def, 0x200, getByte, 'le');
        assert.strictEqual(rows[0].hasData, false);
        assert.strictEqual(rows[0].decoded, '??');
    });

    test('shared byte-order setting applies to scalar fields', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint16', count: 1 },
        ]};
        // 01 00 (BE) and 00 01 (LE) both decode to 256
        for (const [endian, bytes] of [['be', [0x01, 0x00]], ['le', [0x00, 0x01]]] as ['le' | 'be', number[]][]) {
            setBytesInSegment(0, bytes);
            const rows = decodeStruct(def, 0, getByte, endian);
            assert.ok(rows[0].decoded.startsWith('256'), rows[0].decoded);
        }
    });

    test('pointer modifier consumes fixed 32-bit storage and carries scalar target metadata', () => {
        const def: StructDef = { id: 'ptr_scalar', name: 'PtrScalar', packed: true, fields: [
            { name: 'next', type: 'uint16', isPointer: true, count: 1 },
            { name: 'after', type: 'uint8', count: 1 },
        ]};
        setBytesInSegment(0, [0x34, 0x12, 0x00, 0x20, 0xAA]);

        const rows = decodeStruct(def, 0, getByte, 'le');

        assert.strictEqual(rows[0].fieldName, 'next');
        assert.strictEqual(rows[0].isPointer, true);
        assert.strictEqual(rows[0].type, 'uint16');
        assert.strictEqual(rows[0].pointerTargetType, 'uint16');
        assert.strictEqual(rows[0].pointerTargetByteSize, 2);
        assert.strictEqual(rows[0].pointerValue, 0x20001234);
        assert.strictEqual(rows[1].byteOffset, 4);
    });

    test('legacy pointer fields decode as void pointers', () => {
        const def: StructDef = { id: 'legacy_ptr', name: 'LegacyPtr', packed: true, fields: [
            { name: 'raw', type: 'pointer', count: 1 },
        ]};
        setBytesInSegment(0, [0x78, 0x56, 0x34, 0x12]);

        const rows = decodeStruct(def, 0, getByte, 'le');

        assert.strictEqual(rows[0].isPointer, true);
        assert.strictEqual(rows[0].type, 'void');
        assert.strictEqual(rows[0].pointerTargetType, 'void');
        assert.strictEqual(rows[0].pointerTargetByteSize, 1);
        assert.strictEqual(rows[0].pointerValue, 0x12345678);
    });

    test('struct pointer arrays decode as independent pointer rows', () => {
        const child: StructDef = { id: 'node', name: 'Node', fields: [
            { name: 'tag', type: 'uint8', count: 1 },
        ]};
        const def: StructDef = { id: 'ptr_array', name: 'PtrArray', packed: true, fields: [
            { name: 'nodes', type: 'struct', refStructId: 'node', isPointer: true, count: 2 },
        ]};
        setBytesInSegment(0, [0x00, 0x10, 0x00, 0x20, 0x04, 0x10, 0x00, 0x20]);

        const rows = decodeStruct(def, 0, getByte, 'le', 'msb', [child, def]);

        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].fieldName, 'nodes[0]');
        assert.strictEqual(rows[1].fieldName, 'nodes[1]');
        assert.strictEqual(rows[0].pointerTargetType, 'struct');
        assert.strictEqual(rows[0].pointerTargetStructId, 'node');
        assert.strictEqual(rows[0].pointerTargetStructName, 'Node');
        assert.strictEqual(rows[0].pointerValue, 0x20001000);
        assert.strictEqual(rows[1].pointerValue, 0x20001004);
    });

    test('shared byte order applies to arrays and nested structs', () => {
        const child: StructDef = {
            id: 'endian_child',
            name: 'EndianChild',
            fields: [
                { name: 'word', type: 'uint16', count: 2 },
                { name: 'flt', type: 'float32', count: 1 },
                { name: 'ptr', type: 'pointer', count: 1 },
            ],
        };
        const parent: StructDef = {
            id: 'endian_parent',
            name: 'EndianParent',
            packed: true,
            fields: [
                { name: 'word', type: 'uint16', count: 1 },
                { name: 'node', type: 'struct', refStructId: 'endian_child', count: 1 },
            ],
        };
        structs = [child, parent];
        setBytesInSegment(0, [
            0x34, 0x12,
            0x12, 0x34,
            0x56, 0x78,
            0x3F, 0x80, 0x00, 0x00,
            0x12, 0x34, 0x56, 0x78,
        ]);

        const rows = decodeStruct(parent, 0, getByte, 'be', 'msb', structs);
        assert.strictEqual(rows[0].fieldName, 'word');
        assert.ok(rows[0].decoded.startsWith('13330'), rows[0].decoded);
        assert.ok(rows[1].decoded.startsWith('4660'), rows[1].decoded);
        assert.ok(rows[2].decoded.startsWith('22136'), rows[2].decoded);
        assert.strictEqual(parseFloat(rows[3].decoded), 1);
        assert.strictEqual(rows[4].decoded, '0x12345678');
    });

    test('byte offsets accumulate for packed and aligned layouts', () => {
        for (const [packed, expected] of [
            [true, [0, 1, 5]],
            [false, [0, 4, 8]],
        ] as [boolean, number[]][]) {
            const def: StructDef = { id: 'x', name: 'S', fields: layoutFields(), ...(packed ? { packed: true } : {}) };
            const rows = decodeStruct(def, 0, getByte, 'le');
            assert.deepStrictEqual(rows.map(r => r.byteOffset), expected, packed ? 'packed' : 'aligned');
        }
    });

    test('decodes bit fields MSB-first by default as unsigned values', () => {
        const def = bitFieldStruct();
        // 0xB1 => a=0b101=5, b=0b10001=17 in MSB-first allocation.
        setBytesInSegment(0, [0xB1]);
        const rows = decodeStruct(def, 0, getByte, 'le');
        assert.strictEqual(rows.length, 2);
        assert.strictEqual(rows[0].isBitField, true);
        assert.strictEqual(rows[0].bitOffset, 0);
        assert.strictEqual(rows[0].bitValueUnsigned, '5');
        assert.strictEqual(rows[1].bitOffset, 3);
        assert.strictEqual(rows[1].bitValueUnsigned, '17');
    });

    test('decodes bit fields LSB-first when allocation is LSB', () => {
        const def = bitFieldStruct();
        // 0b10110001 => a=0b001=1, b=0b10110=22 in LSB-first allocation.
        setBytesInSegment(0, [0xB1]);
        const rows = decodeStruct(def, 0, getByte, 'le', 'lsb');
        assert.strictEqual(rows[0].bitValueUnsigned, '1');
        assert.strictEqual(rows[1].bitValueUnsigned, '22');
    });

    test('byte endianness and bit-field allocation are independent', () => {
        const def: StructDef = { id: 'x', name: 'Bits16', packed: true, fields: [
            {
                name: 'word',
                type: 'uint16',
                count: 1,
                bitFields: [
                    { name: 'a', bitWidth: 4 },
                    { name: 'b', bitWidth: 4 },
                ],
            },
        ]};
        setBytesInSegment(0, [0x12, 0x34]);

        const leLsb = decodeStruct(def, 0, getByte, 'le', 'lsb');
        assert.strictEqual(leLsb[0].bitValueUnsigned, '2');
        assert.strictEqual(leLsb[1].bitValueUnsigned, '1');

        const beLsb = decodeStruct(def, 0, getByte, 'be', 'lsb');
        assert.strictEqual(beLsb[0].bitValueUnsigned, '4');
        assert.strictEqual(beLsb[1].bitValueUnsigned, '3');

        const leMsb = decodeStruct(def, 0, getByte, 'le', 'msb');
        assert.strictEqual(leMsb[0].bitValueUnsigned, '3');
        assert.strictEqual(leMsb[1].bitValueUnsigned, '4');

        const beMsb = decodeStruct(def, 0, getByte, 'be', 'msb');
        assert.strictEqual(beMsb[0].bitValueUnsigned, '1');
        assert.strictEqual(beMsb[1].bitValueUnsigned, '2');
    });

    test('bytesHex shows ?? for missing bytes', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint16', count: 1 },
        ]};
        setBytesInSegment(0, [0xAB]); // only first byte present
        const rows = decodeStruct(def, 0, getByte, 'le');
        assert.ok(rows[0].bytesHex.includes('??'), rows[0].bytesHex);
    });

    test('nested rows use parent[2].child path format', () => {
        const child: StructDef = {
            id: 'child',
            name: 'Child',
            fields: [{ name: 'v', type: 'uint8', count: 1 }],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [{ name: 'nodes', type: 'struct', refStructId: 'child', count: 3 }],
        };
        structs = [child, parent];
        setBytesInSegment(0, [0x11, 0x22, 0x33]);

        const rows = decodeStruct(parent, 0, getByte, 'le', 'msb', structs);
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[0].fieldName, 'nodes[0].v');
        assert.strictEqual(rows[1].fieldName, 'nodes[1].v');
        assert.strictEqual(rows[2].fieldName, 'nodes[2].v');
    });

    // ── per-field / per-struct endian + allocation overrides ──

    test('field endian beats struct endian beats global', () => {
        const def: StructDef = {
            id: 'x', name: 'EndianChain', packed: true, endian: 'be',
            fields: [
                { name: 'inherited', type: 'uint16', count: 1 },
                { name: 'overridden', type: 'uint16', count: 1, endian: 'le' },
            ],
        };
        // global is little-endian; struct declares BE; field2 declares LE.
        setBytesInSegment(0, [0x12, 0x34, 0x56, 0x78]);
        const rows = decodeStruct(def, 0, getByte, 'le', 'msb');
        assert.ok(rows[0].decoded.startsWith('4660'), rows[0].decoded);      // 0x1234 BE
        assert.ok(rows[1].decoded.startsWith('30806'), rows[1].decoded);     // 0x7856 LE
        assert.strictEqual(rows[0].endian, 'be');
        assert.strictEqual(rows[1].endian, 'le');
    });

    test('nested struct inherits containing struct override unless it declares its own', () => {
        const child: StructDef = {
            id: 'child', name: 'Child',
            fields: [{ name: 'w', type: 'uint16', count: 1 }],
        };
        const childLe: StructDef = {
            id: 'childLe', name: 'ChildLe', endian: 'le',
            fields: [{ name: 'w', type: 'uint16', count: 1 }],
        };
        const parent: StructDef = {
            id: 'parent', name: 'Parent', packed: true, endian: 'be',
            fields: [
                { name: 'inherit', type: 'struct', refStructId: 'child', count: 1 },
                { name: 'own', type: 'struct', refStructId: 'childLe', count: 1 },
                { name: 'fieldBeats', type: 'struct', refStructId: 'child', count: 1, endian: 'le' },
            ],
        };
        structs = [child, childLe, parent];
        // inherit BE: 0x1234. own LE: 0x1234. fieldBeats LE: 0x1234.
        setBytesInSegment(0, [0x12, 0x34, 0x34, 0x12, 0x34, 0x12]);
        const rows = decodeStruct(parent, 0, getByte, 'le', 'msb', structs);
        assert.ok(rows[0].decoded.startsWith('4660'), rows[0].decoded);
        assert.ok(rows[1].decoded.startsWith('4660'), rows[1].decoded);
        assert.ok(rows[2].decoded.startsWith('4660'), rows[2].decoded);
        assert.strictEqual(rows[0].endian, 'be');      // struct-level BE inherited into nested
        assert.strictEqual(rows[1].endian, 'le');      // nested struct declared its own
        assert.strictEqual(rows[2].endian, 'le');      // field endian beats containing struct
    });

    test('pointer fields inherit resolved endian (field beats struct beats global)', () => {
        // Struct default BE, pointer field Auto: pointer must decode big-endian,
        // inheriting the struct's endian rather than the global overlay.
        const def: StructDef = {
            id: 'x', name: 'Ptr', packed: true, endian: 'be',
            fields: [
                { name: 'p', type: 'void', isPointer: true, count: 1 },
            ],
        };
        setBytesInSegment(0, [0x78, 0x56, 0x34, 0x12]);
        const rows = decodeStruct(def, 0, getByte, 'le', 'msb');
        assert.strictEqual(rows[0].decoded, '0x78563412');
        assert.strictEqual(rows[0].endian, 'be');      // inherited from struct default

        // Explicit per-field endian still beats the struct default.
        const explicit: StructDef = {
            id: 'y', name: 'PtrExplicit', packed: true, endian: 'be',
            fields: [
                { name: 'p', type: 'void', isPointer: true, count: 1, endian: 'le' },
            ],
        };
        setBytesInSegment(0, [0x12, 0x34, 0x56, 0x78]);
        const explicitRows = decodeStruct(explicit, 0, getByte, 'le', 'msb');
        assert.strictEqual(explicitRows[0].decoded, '0x78563412');
        assert.strictEqual(explicitRows[0].endian, 'le');
    });

    test('bit-field unit read uses effective endian; child packing uses effective allocation', () => {
        const def: StructDef = {
            id: 'x', name: 'Bits', packed: true,
            fields: [{
                name: 'ctl', type: 'uint16', count: 1, endian: 'be', allocation: 'lsb',
                bitFields: [
                    { name: 'a', bitWidth: 4 },
                    { name: 'b', bitWidth: 12 },
                ],
            }],
        };
        // global LE/MSB would give a=3, b=1042; effective BE/LSB gives a=4, b=291.
        setBytesInSegment(0, [0x12, 0x34]);
        const rows = decodeStruct(def, 0, getByte, 'le', 'msb');
        assert.strictEqual(rows[0].bitValueUnsigned, '4');
        assert.strictEqual(rows[1].bitValueUnsigned, '291');
        assert.strictEqual(rows[0].endian, 'be');
        assert.strictEqual(rows[0].allocation, 'lsb');
    });

    test('field allocation beats struct allocation beats global', () => {
        const def: StructDef = {
            id: 'x', name: 'AllocChain', packed: true, allocation: 'msb',
            fields: [{
                name: 'ctl', type: 'uint16', count: 1, allocation: 'lsb',
                bitFields: [
                    { name: 'a', bitWidth: 4 },
                    { name: 'b', bitWidth: 12 },
                ],
            }],
        };
        // LE unit 0x3412; field LSB beats struct MSB/global MSB → a=2, b=833.
        setBytesInSegment(0, [0x12, 0x34]);
        const rows = decodeStruct(def, 0, getByte, 'le', 'msb');
        assert.strictEqual(rows[0].bitValueUnsigned, '2');
        assert.strictEqual(rows[1].bitValueUnsigned, '833');
        assert.strictEqual(rows[0].allocation, 'lsb');
    });

    test('overrides never change offsets, sizes, or alignment', () => {
        const base: StructDef = { id: 'x', name: 'S', fields: layoutFields() };
        const overridden: StructDef = {
            id: 'x', name: 'S', endian: 'be', allocation: 'lsb', fields: [
                { name: 'a', type: 'uint8', count: 1, endian: 'be' },
                { name: 'b', type: 'uint32', count: 1, allocation: 'lsb' },
                { name: 'c', type: 'uint16', count: 1 },
            ],
        };
        const packed: StructDef = { id: 'x', name: 'S', packed: true, fields: layoutFields() };
        const packedOverridden: StructDef = { ...overridden, packed: true };
        assert.strictEqual(structByteSize(overridden), structByteSize(base));
        assert.strictEqual(structByteSize(packedOverridden), structByteSize(packed));

        setBytesInSegment(0, [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
        const baseRows = decodeStruct(base, 0, getByte, 'le');
        const overrideRows = decodeStruct(overridden, 0, getByte, 'le');
        assert.deepStrictEqual(overrideRows.map(r => r.byteOffset), baseRows.map(r => r.byteOffset));
    });

    test('known mixed-endian struct decodes byte-correctly (LE global, BE nested struct, MSB children)', () => {
        const beCfg: StructDef = {
            id: 'beCfg', name: 'BeCfg', endian: 'be', allocation: 'msb',
            fields: [
                { name: 'rate', type: 'uint16', count: 1 },
                {
                    name: 'ctl', type: 'uint8', count: 1,
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'level', bitWidth: 5 },
                    ],
                },
            ],
        };
        const outer: StructDef = {
            id: 'outer', name: 'Outer', packed: true,
            fields: [
                { name: 'hdr', type: 'uint16', count: 1 },
                { name: 'base', type: 'void', isPointer: true, count: 1 },
                { name: 'cfg', type: 'struct', refStructId: 'beCfg', count: 1 },
            ],
        };
        structs = [beCfg, outer];
        setBytesInSegment(0, [
            0x34, 0x12,             // hdr: LE 0x1234
            0x78, 0x56, 0x34, 0x12, // base: pointer (global LE) 0x12345678
            0x12, 0x34,             // cfg.rate: BE 0x1234
            0xB1,                   // cfg.ctl: MSB children a=5, b=17
        ]);
        const rows = decodeStruct(outer, 0, getByte, 'le', 'msb', structs);
        assert.strictEqual(rows.length, 5);
        assert.ok(rows[0].decoded.startsWith('4660'), rows[0].decoded);   // hdr LE
        assert.strictEqual(rows[1].decoded, '0x12345678');                // pointer global LE
        assert.ok(rows[2].decoded.startsWith('4660'), rows[2].decoded);   // cfg.rate BE
        assert.strictEqual(rows[3].bitValueUnsigned, '5');                // cfg.ctl.mode MSB
        assert.strictEqual(rows[4].bitValueUnsigned, '17');               // cfg.ctl.level MSB
        assert.strictEqual(rows[0].endian, 'le');
        assert.strictEqual(rows[2].endian, 'be');
        assert.strictEqual(rows[2].allocation, 'msb');
        assert.strictEqual(rows[3].allocation, 'msb');
    });
});

suite('resolveStructFieldByPath()', () => {
    setup(() => resetStructState());

    test('resolves nested struct array field using declared type and count', () => {
        const child: StructDef = {
            id: 'child',
            name: 'ChildNode',
            fields: [{ name: 'v', type: 'uint8', count: 1 }],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [{ name: 'nodes', type: 'struct', refStructId: 'child', count: 3 }],
        };

        structs = [child, parent];

        const resolved = resolveStructFieldByPath(parent, 'nodes', structs);
        assert.ok(resolved);
        assert.strictEqual(resolved!.field.type, 'struct');
        assert.strictEqual(resolved!.field.count, 3);
        assert.strictEqual(resolved!.structName, 'ChildNode');
    });

    test('resolves path containing array indices to declared nested field', () => {
        const leaf: StructDef = {
            id: 'leaf',
            name: 'Leaf',
            fields: [{ name: 'x', type: 'uint8', count: 1 }],
        };
        const mid: StructDef = {
            id: 'mid',
            name: 'Mid',
            fields: [{ name: 'nodes', type: 'struct', refStructId: 'leaf', count: 4 }],
        };
        const top: StructDef = {
            id: 'top',
            name: 'Top',
            fields: [{ name: 'wrappers', type: 'struct', refStructId: 'mid', count: 2 }],
        };

        structs = [leaf, mid, top];

        const resolved = resolveStructFieldByPath(top, 'wrappers[0].nodes', structs);
        assert.ok(resolved);
        assert.strictEqual(resolved!.field.type, 'struct');
        assert.strictEqual(resolved!.field.count, 4);
        assert.strictEqual(resolved!.structName, 'Leaf');
    });

    test('resolves a referenced bit-field container to its inline form', () => {
        const bits: StructDef = {
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'mode', bitWidth: 2 }, { name: 'code', bitWidth: 6 }],
        };
        const parent: StructDef = {
            id: 'parent', name: 'Parent',
            fields: [{ name: 'control', type: 'bitfield', refStructId: 'bits', count: 1 }],
        };

        structs = [bits, parent];

        const resolved = resolveStructFieldByPath(parent, 'control', structs);
        assert.ok(resolved);
        assert.strictEqual(resolved!.field.type, 'uint8');
        assert.strictEqual(resolved!.field.refStructId, undefined);
        assert.deepStrictEqual(resolved!.field.bitFields, bits.bitFields);
    });
});

// ── validateStructs ───────────────────────────────────────────────

suite('validateStructs()', () => {
    test('reports cycle in nested references', () => {
        const a: StructDef = {
            id: 'a',
            name: 'A',
            fields: [{ name: 'b', type: 'struct', refStructId: 'b', count: 1 }],
        };
        const b: StructDef = {
            id: 'b',
            name: 'B',
            fields: [{ name: 'a', type: 'struct', refStructId: 'a', count: 1 }],
        };
        const errs = validateStructs([a, b], 3);
        assert.ok(errs.some(e => e.includes('cycle')), `errors: ${errs.join(' | ')}`);
    });

    test('allows self-referential struct pointer fields', () => {
        const node: StructDef = {
            id: 'node',
            name: 'Node',
            fields: [
                { name: 'next', type: 'struct', refStructId: 'node', isPointer: true, count: 1 },
            ],
        };

        assert.deepStrictEqual(validateStructs([node]), []);
    });

    test('reports nesting depth overflow when depth exceeds configured limit', () => {
        const defs: StructDef[] = [];
        const depth = 34;
        for (let i = depth; i >= 1; i--) {
            defs.push({
                id: `s${i}`,
                name: `S${i}`,
                fields: i === depth
                    ? [{ name: 'x', type: 'uint8', count: 1 }]
                    : [{ name: `s${i + 1}`, type: 'struct', refStructId: `s${i + 1}`, count: 1 }],
            });
        }
        const errs = validateStructs(defs, 32);
        assert.ok(errs.some(e => e.includes('depth')), `errors: ${errs.join(' | ')}`);
    });

    test('reports bit-field container child overflow', () => {
        const bad: StructDef = {
            id: 'bad',
            name: 'BadBits',
            fields: [
                {
                    name: 'flags',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'a', bitWidth: 9 },
                        { name: 'b', bitWidth: 1 },
                    ],
                },
            ],
        };
        const errs = validateStructs([bad]);
        assert.ok(errs.some(e => e.includes('children total 10 bits exceeds 8-bit container')), errs.join(' | '));
    });

    test('rejects invalid endian on struct and field', () => {
        const errs = validateStructs([
            { id: 'a', name: 'A', endian: 'xx' as never, fields: [] },
            { id: 'b', name: 'B', fields: [{ name: 'w', type: 'uint16', count: 1, endian: 'no' as never }] },
        ]);
        assert.ok(errs.some(e => e.includes('Struct "A": invalid endian "xx"')), errs.join(' | '));
        assert.ok(errs.some(e => e.includes('Struct "B": field "w" invalid endian "no"')), errs.join(' | '));
    });

    test('rejects invalid allocation on struct and field', () => {
        const errs = validateStructs([
            { id: 'a', name: 'A', allocation: 'sideways' as never, fields: [] },
            { id: 'b', name: 'B', fields: [{ name: 'w', type: 'uint16', count: 1, allocation: 'up' as never }] },
        ]);
        assert.ok(errs.some(e => e.includes('Struct "A": invalid allocation "sideways"')), errs.join(' | '));
        assert.ok(errs.some(e => e.includes('Struct "B": field "w" invalid allocation "up"')), errs.join(' | '));
    });

    test('accepts absent and valid endian/allocation overrides', () => {
        const defs: StructDef[] = [
            { id: 'a', name: 'A', endian: 'le', allocation: 'lsb', fields: [
                { name: 'w', type: 'uint16', count: 1, endian: 'be' },
                { name: 'bits', type: 'uint8', count: 1, allocation: 'msb', bitFields: [{ name: 'x', bitWidth: 2 }] },
            ] },
        ];
        assert.deepStrictEqual(validateStructs(defs), []);
    });

    test('reports duplicate field names within one struct', () => {
        const errs = validateStructs([
            { id: 'dup', name: 'Dup', fields: [
                { name: 'buf', type: 'uint8', count: 8 },
                { name: 'buf', type: 'uint8', count: 4 },
            ] },
        ]);
        assert.ok(errs.some(e => e.includes('Struct "Dup": duplicate field name "buf".')), errs.join(' | '));
    });

    test('allows same field name across different struct defs', () => {
        const defs: StructDef[] = [
            { id: 'a', name: 'A', fields: [{ name: 'data', type: 'uint8', count: 1 }] },
            { id: 'b', name: 'B', fields: [{ name: 'data', type: 'uint8', count: 1 }] },
        ];
        assert.deepStrictEqual(validateStructs(defs), []);
    });

    test('allows same field name under different nested structs', () => {
        const left: StructDef = { id: 'left', name: 'Left', fields: [{ name: 'x', type: 'uint8', count: 1 }] };
        const right: StructDef = { id: 'right', name: 'Right', fields: [{ name: 'x', type: 'uint8', count: 1 }] };
        const outer: StructDef = { id: 'outer', name: 'Outer', fields: [
            { name: 'a', type: 'struct', refStructId: 'left', count: 1 },
            { name: 'b', type: 'struct', refStructId: 'right', count: 1 },
        ] };
        assert.deepStrictEqual(validateStructs([outer, left, right]), []);
    });
});

// ── allStructs ────────────────────────────────────────────────────

suite('allStructs()', () => {
    setup(() => resetStructState());

    test('returns empty array when no user structs', () => {
        assert.strictEqual(allStructs(structs).length, 0);
    });

    test('returns user structs in insertion order', () => {
        const a: StructDef = { id: 'a', name: 'A', fields: [] };
        const b: StructDef = { id: 'b', name: 'B', fields: [] };
        structs = [a, b];
        const all = allStructs(structs);
        assert.strictEqual(all.length, 2);
        assert.strictEqual(all[0].id, 'a');
        assert.strictEqual(all[1].id, 'b');
    });

    test('user struct appended when another already exists', () => {
        const custom: StructDef = { id: 'u1', name: 'Custom', fields: [] };
        structs = [custom];
        const all = allStructs(structs);
        assert.strictEqual(all.length, 1);
        assert.strictEqual(all[0].id, 'u1');
    });
});

// ── parseStructText() ─────────────────────────────────────────────

suite('parseStructText()', () => {
    test('parses uint32_t scalar field', () => {
        const { fields, errors } = parseStructText('uint32_t handler;');
        assert.deepStrictEqual(fields, [{ name: 'handler', type: 'uint32', count: 1 }]);
        assert.strictEqual(errors.length, 0);
    });

    test('parses uint8_t array field', () => {
        const { fields, errors } = parseStructText('uint8_t data[16];');
        assert.deepStrictEqual(fields, [{ name: 'data', type: 'uint8', count: 16 }]);
        assert.strictEqual(errors.length, 0);
    });

    test('C type keywords map to their struct field types', () => {
        for (const [cType, fieldType] of [
            ['float', 'float32'],
            ['double', 'float64'],
            ['uint64_t', 'uint64'],
            ['unsigned char', 'uint8'],
            ['unsigned int', 'uint32'],
            ['int', 'int32'],
            ['short', 'int16'],
        ] as [string, 'float32' | 'float64' | 'uint64' | 'uint8' | 'uint32' | 'int32' | 'int16'][]) {
            const { fields } = parseStructText(`${cType} value;`);
            assert.strictEqual(fields[0].type, fieldType, cType);
        }
    });

    test('const qualifier is stripped', () => {
        const { fields, errors } = parseStructText('const uint32_t REG;');
        assert.strictEqual(errors.length, 0);
        assert.strictEqual(fields[0].type, 'uint32');
    });

    test('volatile qualifier is stripped', () => {
        const { fields, errors } = parseStructText('volatile uint32_t REG;');
        assert.strictEqual(errors.length, 0);
        assert.strictEqual(fields[0].type, 'uint32');
    });

    test('treats old endian annotations as ordinary comments', () => {
        for (const text of ['uint32_t reg; /* be */', 'uint32_t reg; // le', 'uint32_t reg; // be']) {
            const { fields, errors } = parseStructText(text);
            assert.deepStrictEqual(errors, []);
            assert.deepStrictEqual(fields, [{ name: 'reg', type: 'uint32', count: 1 }]);
        }
    });

    test('extracts structName from struct wrapper', () => {
        const { structName, fields } = parseStructText('struct GPIO_t {\n  uint32_t MODER;\n}');
        assert.strictEqual(structName, 'GPIO_t');
        assert.strictEqual(fields.length, 1);
    });

    test('extracts body from typedef struct', () => {
        const { fields, errors } = parseStructText('typedef struct S {\n  uint8_t a;\n  uint16_t b;\n} S_t;');
        assert.strictEqual(errors.length, 0);
        assert.strictEqual(fields.length, 2);
    });

    test('reports error for unknown type', () => {
        const { fields, errors } = parseStructText('foo bar;');
        assert.ok(errors.length > 0);
        assert.strictEqual(fields.length, 0);
    });

    test('ignores line comments and blank lines', () => {
        const { fields } = parseStructText('// header\n\nuint32_t a;\n// done');
        assert.strictEqual(fields.length, 1);
    });

    test('parses multiple fields', () => {
        const { fields, errors } = parseStructText('uint32_t a;\nuint16_t b;\nuint8_t c;');
        assert.strictEqual(fields.length, 3);
        assert.strictEqual(errors.length, 0);
    });

    test('structName is null when no struct wrapper', () => {
        const { structName } = parseStructText('uint32_t x;');
        assert.strictEqual(structName, null);
    });

    test('field without semicolon is still parsed', () => {
        const { fields } = parseStructText('uint32_t x');
        assert.strictEqual(fields[0].name, 'x');
    });

    test('parses fixed-width integer bit fields with :N syntax', () => {
        const { fields, errors } = parseStructText('uint16_t mode:3;\nuint16_t flags:5;');
        assert.strictEqual(errors.length, 0, errors.join(' | '));
        assert.strictEqual(fields.length, 1);
        assert.strictEqual(fields[0].name, 'mode');
        assert.strictEqual(fields[0].type, 'uint16');
        assert.strictEqual(fields[0].bitFields?.[0].bitWidth, 3);
        assert.strictEqual(fields[0].bitFields?.[1].bitWidth, 5);
        assert.strictEqual(fields[0].count, 1);
    });

    test('rejects bit field arrays', () => {
        const { fields, errors } = parseStructText('uint16_t mode:3[2];');
        assert.strictEqual(fields.length, 0);
        assert.ok(errors.some(e => e.includes('cannot be declared as an array')), errors.join(' | '));
    });

    test('parses scalar and void pointer fields', () => {
        const { fields, errors } = parseStructText('uint16_t* next;\nvoid* raw;');
        assert.strictEqual(errors.length, 0, errors.join(' | '));
        assert.deepStrictEqual(fields, [
            { name: 'next', type: 'uint16', isPointer: true, count: 1 },
            { name: 'raw', type: 'void', isPointer: true, count: 1 },
        ]);
    });

    test('parses known struct pointer and downgrades unknown pointer to void pointer', () => {
        const header: StructDef = { id: 'header', name: 'Header', fields: [] };
        const { fields, errors } = parseStructText('Header* hdr;\nFoo* missing;', [header]);
        assert.strictEqual(errors.length, 0, errors.join(' | '));
        assert.deepStrictEqual(fields, [
            { name: 'hdr', type: 'struct', isPointer: true, refStructId: 'header', count: 1 },
            { name: 'missing', type: 'void', isPointer: true, count: 1 },
        ]);
    });
});

// ── fieldsToText() ────────────────────────────────────────────────

suite('fieldsToText()', () => {
    test('empty fields produces empty string', () => {
        assert.strictEqual(fieldsToText([]), '');
    });

    test('uint32_t field emits uint32_t keyword', () => {
        const f: StructField[] = [{ name: 'handler', type: 'uint32', count: 1 }];
        assert.ok(fieldsToText(f).includes('uint32_t'));
        assert.ok(fieldsToText(f).includes('handler;'));
    });

    test('array field has [N] suffix', () => {
        const f: StructField[] = [{ name: 'data', type: 'uint8', count: 8 }];
        assert.ok(fieldsToText(f).includes('[8]'));
    });

    test('emits no field byte-order annotation', () => {
        const f: StructField[] = [{ name: 'reg', type: 'uint32', count: 1 }];
        assert.strictEqual(fieldsToText(f), 'uint32_t reg;');
    });

    test('float32/float64 fields emit float/double keywords', () => {
        for (const [type, keyword] of [['float32', 'float'], ['float64', 'double']] as ['float32' | 'float64', string][]) {
            const f: StructField[] = [{ name: 'val', type, count: 1 }];
            assert.ok(fieldsToText(f).startsWith(`${keyword} `), keyword);
        }
    });

    test('bit field emits :N suffix', () => {
        const f: StructField[] = [{
            name: 'mode',
            type: 'uint16',
            count: 1,
            bitFields: [{ name: 'mode', bitWidth: 3 }],
        }];
        assert.ok(fieldsToText(f).includes('mode:3;'));
    });

    test('pointer fields emit C-style star syntax', () => {
        const header: StructDef = { id: 'header', name: 'Header', fields: [] };
        const f: StructField[] = [
            { name: 'next', type: 'uint16', isPointer: true, count: 1 },
            { name: 'hdr', type: 'struct', refStructId: 'header', isPointer: true, count: 1 },
            { name: 'raw', type: 'pointer', count: 1 },
        ];
        assert.strictEqual(fieldsToText(f, [header]), 'uint16_t* next;\nHeader*   hdr;\nvoid*     raw;');
    });
});

// ── parseStructText() round-trip ─────────────────────────────────

suite('parseStructText() round-trip', () => {
    test('fields → text → parse produces identical fields', () => {
        const original: StructField[] = [
            { name: 'sp',   type: 'uint32',  count: 1 },
            {
                name: 'mode',
                type: 'uint16',
                count: 1,
                bitFields: [{ name: 'mode', bitWidth: 3 }],
            },
            { name: 'data', type: 'uint8',   count: 16 },
            { name: 'temp', type: 'float32', count: 1 },
            { name: 'val',  type: 'int16',   count: 2 },
        ];
        const text = fieldsToText(original);
        const { fields, errors } = parseStructText(text);
        assert.strictEqual(errors.length, 0, `Unexpected errors: ${errors.join(', ')}`);
        assert.deepStrictEqual(fields, original);
    });
});

// ── structToC() padding/packed output ───────────────────────────

suite('structToC()', () => {
    test('aligned struct emits interior padding and aligned total bytes', () => {
        const def: StructDef = {
            id: 'x',
            name: 'S',
            fields: [
                { name: 'a', type: 'uint8', count: 1 },
                { name: 'b', type: 'uint32', count: 1 },
            ],
        };
        const text = structToC(def, [def]);
        assert.ok(text.includes('_pad1[3]'), text);
        assert.ok(text.includes('/* 8B, align=4 */'), text);
    });

    test('packed struct emits no padding lines and reports unpadded total', () => {
        const def: StructDef = {
            id: 'x',
            name: 'S',
            packed: true,
            fields: [
                { name: 'a', type: 'uint8', count: 1 },
                { name: 'b', type: 'uint32', count: 1 },
            ],
        };
        const text = structToC(def, [def]);
        assert.ok(text.includes('typedef struct __attribute__((packed))'), text);
        assert.ok(!text.includes('_pad'), text);
        assert.ok(text.includes('/* 5B, packed */'), text);
    });

    test('aligned struct emits trailing padding when needed', () => {
        const def: StructDef = {
            id: 'x',
            name: 'S',
            fields: [
                { name: 'a', type: 'uint32', count: 1 },
                { name: 'b', type: 'uint8', count: 1 },
            ],
        };
        const text = structToC(def, [def]);
        assert.ok(text.includes('_pad5[3]'), text);
        assert.ok(text.includes('/* 8B, align=4 */'), text);
    });

    test('renders bit fields with :width declarations', () => {
        const def: StructDef = {
            id: 'x',
            name: 'Bits',
            fields: [
                {
                    name: 'flags',
                    type: 'uint16',
                    count: 1,
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
            ],
        };
        const text = structToC(def, [def]);
        assert.ok(text.includes('mode:3;'), text);
        assert.ok(text.includes('flags:5;'), text);
    });

    test('renders nested struct for bit-field container', () => {
        const def: StructDef = {
            id: 'x',
            name: 'Status',
            fields: [
                {
                    name: 'flags',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'enabled', bitWidth: 1 },
                        { name: 'error', bitWidth: 1 },
                        { name: 'mode', bitWidth: 2 },
                        { name: 'speed', bitWidth: 4 },
                    ],
                },
            ],
        };
        const text = structToC(def, [def]);
        assert.ok(text.includes('struct {'), text);
        assert.ok(text.includes('uint8_t enabled:1;'), text);
        assert.ok(text.includes('uint8_t error:1;'), text);
        assert.ok(text.includes('uint8_t mode:2;'), text);
        assert.ok(text.includes('uint8_t speed:4;'), text);
        assert.ok(text.includes('} flags;'), text);
    });
});

// ── Reusable bit-field types (kind: 'bitfield' + type: 'bitfield' refs) ──

function bitFieldDef(): StructDef {
    return {
        id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
        bitFields: [{ name: 'mode', bitWidth: 2 }, { name: 'code', bitWidth: 6 }],
    };
}

function inlineContainerDef(): StructDef {
    return {
        id: 'inline', name: 'Sample', packed: true, fields: [
            {
                name: 'control', type: 'uint8', count: 1,
                bitFields: [{ name: 'mode', bitWidth: 2 }, { name: 'code', bitWidth: 6 }],
            },
            { name: 'after', type: 'uint16', count: 1 },
        ],
    };
}

function referencedContainerDef(field: Partial<StructField> = {}): StructDef {
    return {
        id: 'referenced', name: 'Sample', packed: true, fields: [
            { name: 'control', type: 'bitfield', refStructId: 'bits', count: 1, ...field },
            { name: 'after', type: 'uint16', count: 1 },
        ],
    };
}

suite('structDefKind()', () => {
    test('absent kind defaults to plain struct', () => {
        assert.strictEqual(structDefKind({ id: 'x', name: 'X', fields: [] }), 'struct');
    });

    test('explicit bitfield / enum kinds are reported', () => {
        assert.strictEqual(structDefKind({ id: 'x', name: 'X', fields: [], kind: 'bitfield' }), 'bitfield');
        assert.strictEqual(structDefKind({ id: 'x', name: 'X', fields: [], kind: 'enum' }), 'enum');
    });

    test('an unrecognized kind degrades to plain struct', () => {
        const def = { id: 'x', name: 'X', fields: [], kind: 'sideways' } as unknown as StructDef;
        assert.strictEqual(structDefKind(def), 'struct');
    });
});

suite('materializeBitFieldRefs()', () => {
    test('rewrites a reference into its inline container form', () => {
        const bits = bitFieldDef();
        const field: StructField = { name: 'control', type: 'bitfield', refStructId: 'bits', count: 1 };
        const resolved = materializeBitFieldRefs({ id: 'r', name: 'R', fields: [field] }, [bits]);
        assert.strictEqual(resolved.fields[0].type, 'uint8');
        assert.strictEqual(resolved.fields[0].refStructId, undefined);
        assert.deepStrictEqual(resolved.fields[0].bitFields, bits.bitFields);
    });

    test('leaves plain structs and inline containers untouched (same reference)', () => {
        const inline = inlineContainerDef();
        assert.strictEqual(materializeBitFieldRefs(inline, [inline]), inline);
        const plain = { id: 'p', name: 'P', fields: [{ name: 'a', type: 'uint8' as const, count: 1 }] };
        assert.strictEqual(materializeBitFieldRefs(plain, [plain]), plain);
    });

    test('an unresolvable reference passes through untouched', () => {
        const def: StructDef = { id: 'r', name: 'R', fields: [{ name: 'control', type: 'bitfield', refStructId: 'missing', count: 1 }] };
        assert.strictEqual(materializeBitFieldRefs(def, [def]).fields[0].type, 'bitfield');
    });
});

suite('migrateInlineBitFields()', () => {
    test('a migrated pool decodes / sizes / emits C byte-identically to the inline form', () => {
        const inline = inlineContainerDef();
        setBytesInSegment(0, [0xAC, 0x35, 0x00, 0x00]);

        const before = decodeStruct(inline, 0, getByte, 'le', 'msb', [inline]);
        const beforeSize = structByteSize(inline, [inline]);
        const beforeC = structToC(inline, [inline]);

        const migrated = migrateInlineBitFields([inline]);
        assert.strictEqual(migrated.changed, true);
        const pool = migrated.defs;
        const migratedDef = pool.find(d => d.id === 'inline')!;
        assert.strictEqual(migratedDef.fields[0].type, 'bitfield');
        assert.strictEqual(migratedDef.fields[0].refStructId, 'migrated_bitfield_1');

        assert.deepStrictEqual(decodeStruct(migratedDef, 0, getByte, 'le', 'msb', pool), before, 'decode is unchanged');
        assert.strictEqual(structByteSize(migratedDef, pool), beforeSize, 'size is unchanged');
        assert.strictEqual(structToC(migratedDef, pool), beforeC, 'C preview is unchanged');
        assert.deepStrictEqual(validateStructs(pool), [], 'migrated pool validates cleanly');
    });

    test('leaves a pool with no inline containers untouched (same array, changed false)', () => {
        const pool: StructDef[] = [
            bitFieldDef(),
            { id: 'leaf', name: 'Leaf', fields: [{ name: 'b', type: 'bitfield', refStructId: 'bits', count: 1 }] },
        ];
        const result = migrateInlineBitFields(pool);
        assert.strictEqual(result.changed, false);
        assert.strictEqual(result.defs, pool);
    });
});

suite('reusable bit-field sizing / alignment', () => {
    test('referenced bit-field sizes identically to the inline container', () => {
        const bits = bitFieldDef();
        assert.strictEqual(structByteSize(referencedContainerDef(), [bits]), structByteSize(inlineContainerDef()));
    });

    test('array usage multiplies the referenced base width', () => {
        const bits = bitFieldDef();
        const scalars: StructDef = { id: 's', name: 'S', fields: [{ name: 'regs', type: 'bitfield', refStructId: 'bits', count: 4 }] };
        const inline: StructDef = { id: 'i', name: 'S', fields: [{ name: 'regs', type: 'uint8', count: 4, bitFields: bits.bitFields }] };
        assert.strictEqual(structByteSize(scalars, [bits]), 4);
        assert.strictEqual(structByteSize(scalars, [bits]), structByteSize(inline));
    });

    test('endianness / allocation overrides do not change size or alignment', () => {
        const bits = bitFieldDef();
        const base = structByteSize(referencedContainerDef(), [bits]);
        const overridden = structByteSize(referencedContainerDef({ endian: 'be', allocation: 'lsb' }), [bits]);
        assert.strictEqual(overridden, base);
    });

    test('one def edit is reflected in every referencing struct', () => {
        const bits = bitFieldDef();
        const a: StructDef = { id: 'a', name: 'A', packed: true, fields: [{ name: 'r', type: 'bitfield', refStructId: 'bits', count: 1 }] };
        const b: StructDef = { id: 'b', name: 'B', fields: [
            { name: 'r', type: 'bitfield', refStructId: 'bits', count: 1 },
            { name: 'x', type: 'uint8', count: 1 },
        ] };

        assert.strictEqual(structByteSize(a, [bits, a]), 1);
        assert.strictEqual(structByteSize(b, [bits, b]), 2);

        const wider: StructDef = { ...bits, baseType: 'uint16' };
        assert.strictEqual(structByteSize(a, [wider, a]), 2);
        assert.strictEqual(structByteSize(b, [wider, b]), 4);

        setBytesInSegment(0, [0xAC, 0x35, 0x00, 0x00]);
        assert.strictEqual(decodeStruct(a, 0, getByte, 'le', 'msb', [bits, a])[0].bitStorageByteSize, 1);
        assert.strictEqual(decodeStruct(a, 0, getByte, 'le', 'msb', [wider, a])[0].bitStorageByteSize, 2);
    });

    test('absent kind stays a plain struct through materialization', () => {
        const plain: StructDef = { id: 'p', name: 'Plain', fields: [{ name: 'a', type: 'uint8', count: 1 }] };
        const resolved = materializeBitFieldRefs(plain, [plain]);
        assert.strictEqual(resolved.kind, undefined);
        assert.strictEqual(resolved, plain);
    });
});

suite('reusable bit-field decode', () => {
    test('decodes byte-identically to the inline container', () => {
        const bits = bitFieldDef();
        setBytesInSegment(0, [0b1010_1100, 0x34, 0x12]);
        const inlineRows = decodeStruct(inlineContainerDef(), 0, getByte, 'le', 'msb');
        const refRows = decodeStruct(referencedContainerDef(), 0, getByte, 'le', 'msb', [bits]);
        assert.deepStrictEqual(refRows, inlineRows);
        assert.deepStrictEqual(refRows.map(r => r.fieldName), ['control.mode', 'control.code', 'after']);
        assert.strictEqual(refRows[0].bitWidth, 2);
        assert.strictEqual(refRows[1].bitWidth, 6);
    });

    test('array usage decodes one bit-unit group per element', () => {
        const bits = bitFieldDef();
        const defs: StructDef[] = [bits, { id: 's', name: 'S', packed: true, fields: [{ name: 'regs', type: 'bitfield', refStructId: 'bits', count: 2 }] }];
        setBytesInSegment(0, [0b1010_1100, 0b0011_0101]);
        const rows = decodeStruct(defs[1], 0, getByte, 'le', 'msb', defs);
        assert.deepStrictEqual(rows.map(r => [r.fieldName, r.byteOffset, r.bitWidth]), [
            ['regs[0].mode', 0, 2], ['regs[0].code', 0, 6],
            ['regs[1].mode', 1, 2], ['regs[1].code', 1, 6],
        ]);
    });

    test('field endian/allocation overrides take effect', () => {
        const bits = bitFieldDef();
        setBytesInSegment(0, [0b1010_1100, 0x00, 0x00]);
        const defs = [bits, referencedContainerDef({ endian: 'be', allocation: 'lsb' })];
        const rows = decodeStruct(defs[1], 0, getByte, 'le', 'msb', defs);
        assert.strictEqual(rows[0].allocation, 'lsb');
        assert.strictEqual(rows[0].endian, 'be');
        // lsb allocation: 'mode' takes the low 2 bits, 'code' the next 6.
        assert.strictEqual(rows[0].bitValueUnsigned, '0');
        assert.strictEqual(rows[1].bitValueUnsigned, '43');
    });
});

suite('reusable bit-field C preview', () => {
    test('referenced form emits the same C as the inline container', () => {
        const bits = bitFieldDef();
        assert.strictEqual(
            structToC(referencedContainerDef(), [bits]),
            structToC(inlineContainerDef()),
        );
    });

    test('array usage emits the container array with the referenced base type', () => {
        const bits = bitFieldDef();
        const def: StructDef = { id: 's', name: 'S', packed: true, fields: [{ name: 'regs', type: 'bitfield', refStructId: 'bits', count: 2 }] };
        const text = structToC(def, [bits, def]);
        assert.ok(text.includes('uint8_t mode:2;'), text);
        assert.ok(text.includes('uint8_t code:6;'), text);
        assert.ok(text.includes('} regs[2];'), text);
        assert.ok(text.includes('/* 2B, packed */'), text);
    });

    test('a bitfield def previews as a typedef of its storage unit', () => {
        const bits = bitFieldDef();
        const text = structToC(bits, [bits]);
        assert.ok(text.includes('typedef struct {'), text);
        assert.ok(text.includes('uint8_t mode:2;'), text);
        assert.ok(text.includes('uint8_t code:6;'), text);
        assert.ok(text.includes('} Bits;'), text);
    });
});

suite('reusable bit-field validation', () => {
    test('accepts a bitfield def referenced by a field', () => {
        assert.deepStrictEqual(validateStructs([bitFieldDef(), referencedContainerDef()]), []);
    });

    test('rejects a reference to an unknown type', () => {
        const def: StructDef = { id: 'r', name: 'R', fields: [{ name: 'ctl', type: 'bitfield', refStructId: 'nope', count: 1 }] };
        assert.ok(validateStructs([def]).some(e => e.includes('unknown bit-field type')), validateStructs([def]).join('; '));
    });

    test('rejects a reference to a non-bitfield type', () => {
        const plain: StructDef = { id: 'plain', name: 'Plain', fields: [] };
        const def: StructDef = { id: 'r', name: 'R', fields: [{ name: 'ctl', type: 'bitfield', refStructId: 'plain', count: 1 }] };
        assert.ok(validateStructs([plain, def]).some(e => e.includes('not a bit-field type')), validateStructs([plain, def]).join('; '));
    });

    test('rejects a bitfield pointer and a missing reference', () => {
        const bits = bitFieldDef();
        const pointer: StructDef = { id: 'p', name: 'P', fields: [{ name: 'ctl', type: 'bitfield', refStructId: 'bits', isPointer: true, count: 1 }] };
        assert.ok(validateStructs([bits, pointer]).some(e => e.includes('cannot be a bit-field pointer')));
        const missing: StructDef = { id: 'm', name: 'M', fields: [{ name: 'ctl', type: 'bitfield', count: 1 }] };
        assert.ok(validateStructs([bits, missing]).some(e => e.includes('missing a referenced bit-field type')));
    });

    test('rejects nesting a bit-field reference with inline bit-fields', () => {
        const bits = bitFieldDef();
        const nested: StructDef = { id: 'n', name: 'N', fields: [{ name: 'ctl', type: 'bitfield', refStructId: 'bits', count: 1, bitFields: [{ name: 'x', bitWidth: 1 }] }] };
        assert.ok(validateStructs([bits, nested]).some(e => e.includes('cannot combine a bit-field reference with inline bit-fields')));
    });

    test('rejects a bitfield def shape that is not unsigned / has fields / is over-width', () => {
        const badBase = { id: 'b', name: 'B', kind: 'bitfield', baseType: 'int8', fields: [], bitFields: [{ name: 'a', bitWidth: 1 }] } as unknown as StructDef;
        assert.ok(validateStructs([badBase]).some(e => e.includes('unsigned base type')), validateStructs([badBase]).join('; '));

        const withFields: StructDef = { id: 'f', name: 'F', kind: 'bitfield', baseType: 'uint8', fields: [{ name: 'a', type: 'uint8', count: 1 }], bitFields: [{ name: 'a', bitWidth: 1 }] };
        assert.ok(validateStructs([withFields]).some(e => e.includes('cannot contain fields')));

        const overWidth: StructDef = { id: 'o', name: 'O', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'a', bitWidth: 12 }] };
        assert.ok(validateStructs([overWidth]).some(e => e.includes('exceeds 8-bit base')));

        const empty: StructDef = { id: 'e', name: 'E', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [] };
        assert.ok(validateStructs([empty]).some(e => e.includes('at least one bit-field child')));
    });

    test('rejects an invalid kind discriminator', () => {
        const def = { id: 'k', name: 'K', fields: [], kind: 'sideways' } as unknown as StructDef;
        assert.ok(validateStructs([def]).some(e => e.includes('invalid kind')));
    });
});

// ── Enums (kind: 'enum' + type: 'enum' refs) ──────────────────────

function enumModeDef(): StructDef {
    return {
        id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [],
        entries: [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }],
    };
}

function enumUserDef(): StructDef {
    return {
        id: 'user', name: 'User', packed: true,
        fields: [
            { name: 'state', type: 'enum', refStructId: 'mode', count: 1 },
            { name: 'after', type: 'uint8', count: 1 },
        ],
    };
}

function enumBitsDef(): StructDef {
    return {
        id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
        bitFields: [{ name: 'mode', bitWidth: 2, refStructId: 'mode' }, { name: 'code', bitWidth: 6 }],
    };
}

function enumHolderDef(): StructDef {
    return {
        id: 'holder', name: 'Holder', packed: true,
        fields: [{ name: 'ctl', type: 'bitfield', refStructId: 'bits', count: 1 }],
    };
}

suite('enum label formatting', () => {
    test('formats a matched label as NAME (0xNN)', () => {
        assert.strictEqual(formatEnumLabel('ON', 1n, 2), 'ON (0x01)');
        assert.strictEqual(formatEnumLabel('MODE_LONG', 0x1234n, 4), 'MODE_LONG (0x1234)');
    });

    test('matches the first entry by numeric value', () => {
        const mode = enumModeDef();
        assert.strictEqual(matchEnumEntry(mode, 0n)?.name, 'OFF');
        assert.strictEqual(matchEnumEntry(mode, 1n)?.name, 'ON');
    });

    test('an unmatched value has no label (numeric fallback)', () => {
        assert.strictEqual(matchEnumEntry(enumModeDef(), 5n), undefined);
    });
});

suite('enum sizing / alignment', () => {
    test('a scalar enum sizes/aligns exactly like its base integer field', () => {
        const mode = enumModeDef();
        const enumUser = enumUserDef();
        const intUser: StructDef = {
            id: 'user', name: 'User', packed: true,
            fields: [{ name: 'state', type: 'uint8', count: 1 }, { name: 'after', type: 'uint8', count: 1 }],
        };
        assert.strictEqual(structByteSize(enumUser, [mode, enumUser]), structByteSize(intUser));
    });

    test('a wider base width drives size (uint32 base = 4 bytes)', () => {
        const wide: StructDef = { id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint32', fields: [], entries: [{ name: 'A', value: 1 }] };
        const def: StructDef = { id: 'd', name: 'D', packed: true, fields: [{ name: 'm', type: 'enum', refStructId: 'mode', count: 1 }] };
        assert.strictEqual(structByteSize(def, [wide, def]), 4);
    });
});

suite('enum decode', () => {
    test('carries the matched label without changing bytes/offset/decoded numerics', () => {
        const mode = enumModeDef();
        const user = enumUserDef();
        setBytesInSegment(0, [0x01, 0x34]);
        const rows = decodeStruct(user, 0, getByte, 'le', 'msb', [mode, user]);
        assert.deepStrictEqual(rows.map(r => r.fieldName), ['state', 'after']);
        assert.strictEqual(rows[0].type, 'uint8');
        assert.strictEqual(rows[0].enumLabel, 'ON');
        assert.strictEqual(rows[0].byteOffset, 0);
        assert.strictEqual(rows[0].bytesHex, '01');
        assert.strictEqual(rows[0].decoded, decodeField([0x01], 'uint8', 'le'));
    });

    test('an unmatched value carries no label', () => {
        const mode = enumModeDef();
        const user = enumUserDef();
        setBytesInSegment(0, [0x05, 0x00]);
        const rows = decodeStruct(user, 0, getByte, 'le', 'msb', [mode, user]);
        assert.strictEqual(rows[0].enumLabel, undefined);
        assert.strictEqual(rows[0].decoded, decodeField([0x05], 'uint8', 'le'));
    });

    test('a bit-field child with an enum ref carries a label per element', () => {
        const mode = enumModeDef();
        const bits = enumBitsDef();
        const holder = enumHolderDef();
        setBytesInSegment(0, [0x40]); // msb allocation: mode = 0b01
        const rows = decodeStruct(holder, 0, getByte, 'le', 'msb', [mode, bits, holder]);
        assert.deepStrictEqual(rows.map(r => r.fieldName), ['ctl.mode', 'ctl.code']);
        assert.strictEqual(rows[0].enumLabel, 'ON');
        assert.strictEqual(rows[1].enumLabel, undefined);
        assert.strictEqual(rows[0].bytesHex, '40');
        assert.strictEqual(rows[0].bitOffset, 0);
    });

    test('a bit-field child without an enum ref never carries a label', () => {
        const bits = enumBitsDef();
        const holder = enumHolderDef();
        setBytesInSegment(0, [0x40]);
        const rows = decodeStruct(holder, 0, getByte, 'le', 'msb', [bits, holder]);
        assert.strictEqual(rows[0].enumLabel, undefined);
        assert.strictEqual(rows[1].enumLabel, undefined);
    });
});

suite('enum C preview', () => {
    test('an enum def previews as a typedef enum sized to its base width', () => {
        const text = structToC(enumModeDef(), [enumModeDef()]);
        assert.ok(text.includes('typedef enum {'), text);
        assert.ok(text.includes('OFF = 0x0,'), text);
        assert.ok(text.includes('ON  = 0x1,'), text);
        assert.ok(text.includes('} Mode;'), text);
        assert.ok(text.includes('/* 1B */'), text);
    });

    test('an enum-typed field keeps the integer layout (offsets/sizes unchanged)', () => {
        const mode = enumModeDef();
        const user = enumUserDef();
        const intUser: StructDef = {
            id: 'user', name: 'User', packed: true,
            fields: [{ name: 'state', type: 'uint8', count: 1 }, { name: 'after', type: 'uint8', count: 1 }],
        };
        const enumC = structToC(user, [mode, user]);
        const intC = structToC(intUser);
        assert.strictEqual(enumC.replace('  enum Mode', ''), intC, 'enum field comment/layout must match an integer field');
        assert.ok(enumC.includes('/* +  0  1B  enum Mode */'), enumC);
        assert.ok(enumC.includes('/* 2B, packed */'), enumC);
    });
});

suite('enum validation', () => {
    test('accepts an enum def referenced by a scalar field and a bit child', () => {
        const defs = [enumModeDef(), enumBitsDef(), enumUserDef(), enumHolderDef()];
        assert.deepStrictEqual(validateStructs(defs), []);
    });

    test('rejects an unknown / non-enum / missing scalar enum reference', () => {
        const mode = enumModeDef();
        const unknown: StructDef = { id: 'u', name: 'U', fields: [{ name: 's', type: 'enum', refStructId: 'nope', count: 1 }] };
        assert.ok(validateStructs([mode, unknown]).some(e => e.includes('unknown enum type')));
        const plain: StructDef = { id: 'plain', name: 'Plain', fields: [] };
        const notEnum: StructDef = { id: 'u', name: 'U', fields: [{ name: 's', type: 'enum', refStructId: 'plain', count: 1 }] };
        assert.ok(validateStructs([plain, notEnum]).some(e => e.includes('not an enum type')));
        const missing: StructDef = { id: 'u', name: 'U', fields: [{ name: 's', type: 'enum', count: 1 }] };
        assert.ok(validateStructs([mode, missing]).some(e => e.includes('missing a referenced enum')));
        const pointer: StructDef = { id: 'u', name: 'U', fields: [{ name: 's', type: 'enum', refStructId: 'mode', isPointer: true, count: 1 }] };
        assert.ok(validateStructs([mode, pointer]).some(e => e.includes('cannot be an enum pointer')));
    });

    test('rejects enum entries that do not fit the base width', () => {
        const bad: StructDef = { id: 'e', name: 'E', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'BIG', value: 256 }] };
        assert.ok(validateStructs([bad]).some(e => e.includes('does not fit uint8')), validateStructs([bad]).join('; '));
    });

    test('rejects an enum def with a non-unsigned base or fields', () => {
        const badBase = { id: 'e', name: 'E', kind: 'enum', baseType: 'int8', fields: [], entries: [] } as unknown as StructDef;
        assert.ok(validateStructs([badBase]).some(e => e.includes('unsigned base type')));
        const withFields: StructDef = { id: 'e', name: 'E', kind: 'enum', baseType: 'uint8', fields: [{ name: 'a', type: 'uint8', count: 1 }], entries: [] };
        assert.ok(validateStructs([withFields]).some(e => e.includes('cannot contain fields')));
    });

    test('rejects a bit-field child referencing an unknown or non-enum type', () => {
        const bits: StructDef = {
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'lo', bitWidth: 4, refStructId: 'nope' }],
        };
        assert.ok(validateStructs([bits]).some(e => e.includes('references an unknown enum type')));
        const plain: StructDef = { id: 'plain', name: 'Plain', fields: [] };
        const bits2: StructDef = {
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'lo', bitWidth: 4, refStructId: 'plain' }],
        };
        assert.ok(validateStructs([plain, bits2]).some(e => e.includes('not an enum type')));
    });
});

// ── hidden field flag (instance-view only) ────────────────────────

suite('hidden field flag — model + decode/C parity', () => {
    test('normalizeStructField preserves hidden:true and drops an explicit false', () => {
        const kept = normalizeStructField({ name: 'reserved', type: 'uint8', count: 1, hidden: true });
        assert.strictEqual(kept.hidden, true, 'hidden:true is preserved');

        const dropped = normalizeStructField({ name: 'reserved', type: 'uint8', count: 1, hidden: false });
        assert.strictEqual('hidden' in dropped, false, 'hidden:false is dropped (absent = visible)');

        const absent = normalizeStructField({ name: 'tag', type: 'uint8', count: 1 });
        assert.strictEqual('hidden' in absent, false, 'an absent hidden key stays absent');
    });

    function parityDef(hidden: boolean | undefined): StructDef {
        const reserved: StructField = { name: 'reserved', type: 'uint8', count: 1 };
        if (hidden !== undefined) { reserved.hidden = hidden; }
        return {
            id: 'x', name: 'Header', packed: true, fields: [
                reserved,
                { name: 'tag', type: 'uint16', count: 1 },
                { name: 'nodes', type: 'struct', refStructId: 'child', count: 1 },
            ],
        };
    }

    const child: StructDef = { id: 'child', name: 'Child', packed: true, fields: [{ name: 'inner', type: 'uint8', count: 1 }] };

    test('decode rows, offsets, and values are identical whether or not a field is hidden', () => {
        setBytesInSegment(0, [0xAB, 0x34, 0x12, 0x7F]);
        const visible = decodeStruct(parityDef(undefined), 0, getByte, 'le', 'msb', [child]);
        const hidden = decodeStruct(parityDef(true), 0, getByte, 'le', 'msb', [child]);

        assert.deepStrictEqual(hidden.map(r => ({ name: r.fieldName, off: r.byteOffset, val: r.decoded })),
            visible.map(r => ({ name: r.fieldName, off: r.byteOffset, val: r.decoded })),
            'hidden changes neither row set, offsets, nor decoded values');
        assert.ok(hidden.length > 0, 'decode still emits the hidden field rows');
    });

    test('structByteSize and structToC are identical with a hidden field', () => {
        assert.strictEqual(structByteSize(parityDef(true), [child]), structByteSize(parityDef(undefined), [child]));
        assert.strictEqual(structToC(parityDef(true), [child]), structToC(parityDef(undefined), [child]));
    });

    test('a hidden bit-field container still decodes every child (filter is render-only)', () => {
        const def: StructDef = {
            id: 'x', name: 'Regs', packed: true, fields: [
                { name: 'ctrl', type: 'uint8', count: 1, hidden: true, bitFields: [{ name: 'lo', bitWidth: 4 }, { name: 'hi', bitWidth: 4 }] },
            ],
        };
        setBytesInSegment(0, [0xA5]);
        const rows = decodeStruct(def, 0, getByte, 'le', 'msb');
        assert.deepStrictEqual(rows.map(r => r.fieldName), ['ctrl.lo', 'ctrl.hi'], 'children decode despite the hidden container');
    });
});


