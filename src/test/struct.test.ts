import * as assert from 'assert';

import {
    fieldByteSize, structByteSize, decodeField, decodeStruct,
    allStructs, parseStructText, fieldsToText, validateStructs, structToC, resolveStructFieldByPath,
} from '../core/struct-codec';
import { S } from '../webview/state';
import { getByte } from '../webview/data';
import type { StructDef, StructField } from '../core/types';
import { setBytesInSegment } from './struct-test-helpers';

function resetStructState(): void {
    S.structs           = [];
    S.activeStructAddr  = null;
    S.parseResult       = null;
    S.segmentIndex      = [];
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
        S.structs = [child, parent];
        assert.strictEqual(structByteSize(parent, S.structs), 8);
        S.structs = [];
    });
});

// ── decodeField ───────────────────────────────────────────────────

suite('decodeField()', () => {

    test('uint8 0x42 returns "66  (0x42)"', () => {
        const r = decodeField([0x42], 'uint8', 'le');
        assert.ok(r.startsWith('66'), `got: ${r}`);
        assert.ok(r.includes('0x42'), `got: ${r}`);
    });

    test('uint16 LE 0x0102 → 258', () => {
        const r = decodeField([0x02, 0x01], 'uint16', 'le');
        assert.ok(r.startsWith('258'), `got: ${r}`);
    });

    test('uint16 BE 0x0102 → 258', () => {
        const r = decodeField([0x01, 0x02], 'uint16', 'be');
        assert.ok(r.startsWith('258'), `got: ${r}`);
    });

    test('uint32 LE 0x00000001 → 1', () => {
        const r = decodeField([0x01, 0x00, 0x00, 0x00], 'uint32', 'le');
        assert.ok(r.startsWith('1'), `got: ${r}`);
    });

    test('uint32 LE 0x08000000 shows correct hex in output', () => {
        const r = decodeField([0x00, 0x00, 0x00, 0x08], 'uint32', 'le');
        assert.ok(r.includes('08000000'), `got: ${r}`);
    });

    test('uint64 LE 0x0000000000000001 → 1', () => {
        const r = decodeField([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 'uint64', 'le');
        assert.ok(r.startsWith('1'), `got: ${r}`);
    });

    test('int8 0xFF → -1', () => {
        assert.strictEqual(decodeField([0xFF], 'int8', 'le'), '-1');
    });

    test('int16 LE 0xFFFF → -1', () => {
        assert.strictEqual(decodeField([0xFF, 0xFF], 'int16', 'le'), '-1');
    });

    test('int32 LE 0xFFFFFFFF → -1', () => {
        assert.strictEqual(decodeField([0xFF, 0xFF, 0xFF, 0xFF], 'int32', 'le'), '-1');
    });

    test('int64 LE 0xFFFFFFFFFFFFFFFF → -1', () => {
        const r = decodeField([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], 'int64', 'le');
        assert.strictEqual(r, '-1');
    });

    test('uint64 BE 0x0000000000000001 → 1', () => {
        const r = decodeField([0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01], 'uint64', 'be');
        assert.ok(r.startsWith('1'), `got: ${r}`);
    });

    test('int64 BE 0xFFFFFFFFFFFFFFFF → -1', () => {
        const r = decodeField([0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF], 'int64', 'be');
        assert.strictEqual(r, '-1');
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

    test('float32 LE 1.0 (0x3F800000)', () => {
        // 1.0f LE bytes: 00 00 80 3F
        const r = decodeField([0x00, 0x00, 0x80, 0x3F], 'float32', 'le');
        assert.strictEqual(parseFloat(r), 1);
    });

    test('float64 LE 1.0', () => {
        // 1.0 double LE bytes: 00 00 00 00 00 00 F0 3F
        const r = decodeField([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xF0, 0x3F], 'float64', 'le');
        assert.strictEqual(parseFloat(r), 1);
    });

    test('returns "??" when a byte is missing (value -1)', () => {
        assert.strictEqual(decodeField([-1], 'uint8', 'le'), '??');
    });

    test('returns "??" for partial uint32 (only 2 bytes provided)', () => {
        assert.strictEqual(decodeField([0x01, 0x02], 'uint32', 'le'), '??');
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
        // Do NOT populate parseResult; getBy te will return undefined
        S.parseResult = null;
        S.segmentIndex = [];
        const rows = decodeStruct(def, 0x200, getByte, 'le');
        assert.strictEqual(rows[0].hasData, false);
        assert.strictEqual(rows[0].decoded, '??');
    });

    test('shared big-endian setting applies to scalar fields', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint16', count: 1 },
        ]};
        setBytesInSegment(0, [0x01, 0x00]);
        const rows = decodeStruct(def, 0, getByte, 'be');
        assert.ok(rows[0].decoded.startsWith('256'), rows[0].decoded);
    });

    test('shared little-endian setting applies to scalar fields', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: [
            { name: 'a', type: 'uint16', count: 1 },
        ]};
        setBytesInSegment(0, [0x00, 0x01]);
        const rows = decodeStruct(def, 0, getByte, 'le');
        assert.ok(rows[0].decoded.startsWith('256'), rows[0].decoded);
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
        S.structs = [child, parent];
        setBytesInSegment(0, [
            0x34, 0x12,
            0x12, 0x34,
            0x56, 0x78,
            0x3F, 0x80, 0x00, 0x00,
            0x12, 0x34, 0x56, 0x78,
        ]);

        const rows = decodeStruct(parent, 0, getByte, 'be', 'msb', S.structs);
        assert.strictEqual(rows[0].fieldName, 'word');
        assert.ok(rows[0].decoded.startsWith('13330'), rows[0].decoded);
        assert.ok(rows[1].decoded.startsWith('4660'), rows[1].decoded);
        assert.ok(rows[2].decoded.startsWith('22136'), rows[2].decoded);
        assert.strictEqual(parseFloat(rows[3].decoded), 1);
        assert.strictEqual(rows[4].decoded, '0x12345678');
    });

    test('byte offsets accumulate correctly (packed)', () => {
        const def: StructDef = { id: 'x', name: 'S', packed: true, fields: layoutFields() };
        const rows = decodeStruct(def, 0, getByte, 'le');
        assert.strictEqual(rows[0].byteOffset, 0);
        assert.strictEqual(rows[1].byteOffset, 1);
        assert.strictEqual(rows[2].byteOffset, 5);
    });

    test('byte offsets with alignment (not packed)', () => {
        const def: StructDef = { id: 'x', name: 'S', fields: layoutFields() };
        const rows = decodeStruct(def, 0, getByte, 'le');
        assert.strictEqual(rows[0].byteOffset, 0);
        assert.strictEqual(rows[1].byteOffset, 4);
        assert.strictEqual(rows[2].byteOffset, 8);
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
        S.structs = [child, parent];
        setBytesInSegment(0, [0x11, 0x22, 0x33]);

        const rows = decodeStruct(parent, 0, getByte, 'le', 'msb', S.structs);
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[0].fieldName, 'nodes[0].v');
        assert.strictEqual(rows[1].fieldName, 'nodes[1].v');
        assert.strictEqual(rows[2].fieldName, 'nodes[2].v');
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

        S.structs = [child, parent];

        const resolved = resolveStructFieldByPath(parent, 'nodes', S.structs);
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

        S.structs = [leaf, mid, top];

        const resolved = resolveStructFieldByPath(top, 'wrappers[0].nodes', S.structs);
        assert.ok(resolved);
        assert.strictEqual(resolved!.field.type, 'struct');
        assert.strictEqual(resolved!.field.count, 4);
        assert.strictEqual(resolved!.structName, 'Leaf');
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
});

// ── allStructs ────────────────────────────────────────────────────

suite('allStructs(S.structs)', () => {
    setup(() => resetStructState());

    test('returns empty array when no user structs', () => {
        assert.strictEqual(allStructs(S.structs).length, 0);
    });

    test('returns user structs in insertion order', () => {
        const a: StructDef = { id: 'a', name: 'A', fields: [] };
        const b: StructDef = { id: 'b', name: 'B', fields: [] };
        S.structs = [a, b];
        const all = allStructs(S.structs);
        assert.strictEqual(all.length, 2);
        assert.strictEqual(all[0].id, 'a');
        assert.strictEqual(all[1].id, 'b');
    });

    test('user struct appended when another already exists', () => {
        const custom: StructDef = { id: 'u1', name: 'Custom', fields: [] };
        S.structs = [custom];
        const all = allStructs(S.structs);
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

    test('float maps to float32', () => {
        const { fields } = parseStructText('float temp;');
        assert.strictEqual(fields[0].type, 'float32');
    });

    test('double maps to float64', () => {
        const { fields } = parseStructText('double val;');
        assert.strictEqual(fields[0].type, 'float64');
    });

    test('uint64_t maps to uint64', () => {
        const { fields } = parseStructText('uint64_t big;');
        assert.strictEqual(fields[0].type, 'uint64');
    });

    test('unsigned char maps to uint8', () => {
        const { fields } = parseStructText('unsigned char flag;');
        assert.strictEqual(fields[0].type, 'uint8');
    });

    test('unsigned int maps to uint32', () => {
        const { fields } = parseStructText('unsigned int count;');
        assert.strictEqual(fields[0].type, 'uint32');
    });

    test('int maps to int32', () => {
        const { fields } = parseStructText('int value;');
        assert.strictEqual(fields[0].type, 'int32');
    });

    test('short maps to int16', () => {
        const { fields } = parseStructText('short val;');
        assert.strictEqual(fields[0].type, 'int16');
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

    test('float32 maps to float keyword', () => {
        const f: StructField[] = [{ name: 'temp', type: 'float32', count: 1 }];
        assert.ok(fieldsToText(f).startsWith('float '));
    });

    test('float64 maps to double keyword', () => {
        const f: StructField[] = [{ name: 'val', type: 'float64', count: 1 }];
        assert.ok(fieldsToText(f).startsWith('double '));
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
