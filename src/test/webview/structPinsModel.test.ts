import * as assert from 'assert';

import type { StructDef, StructPin } from '../../core/types';
import {
    makeStructPin,
    parseStructPinAddressInput,
    samePointerSource,
    uniqueStructPinName,
    upsertPointerStructPin,
    withEditedStructPin,
    withoutStructDefinition,
    withoutStructPin,
} from '../../webview/components/sidebar/structPanel/structPinsModel';

suite('struct pin model', () => {
    test('parses full hex address input only', () => {
        assert.strictEqual(parseStructPinAddressInput('123'), 0x123);
        assert.strictEqual(parseStructPinAddressInput(' 0xDEADBEEF '), 0xDEADBEEF);
        assert.strictEqual(parseStructPinAddressInput('123xyz'), null);
        assert.strictEqual(parseStructPinAddressInput(''), null);
        assert.strictEqual(parseStructPinAddressInput('0x100000000'), null);
    });

    test('creates pins with injected ids', () => {
        const pin = makeStructPin({ structId: 's1', addr: 0x20, name: 'inst' }, () => 'pin_test');

        assert.deepStrictEqual(pin, {
            id: 'pin_test',
            structId: 's1',
            addr: 0x20,
            name: 'inst',
        });
    });

    test('keeps generated names unique', () => {
        const pins: StructPin[] = [
            { id: 'p1', structId: 's1', addr: 0, name: 'Packet_0' },
            { id: 'p2', structId: 's1', addr: 1, name: 'Packet_1' },
        ];

        assert.strictEqual(uniqueStructPinName(pins, 'Packet_0', n => `Packet_${n}`), 'Packet_2');
    });

    test('edits and removes pins immutably', () => {
        const pins: StructPin[] = [
            { id: 'p1', structId: 'old', addr: 0x10, name: 'oldName' },
            { id: 'p2', structId: 'keep', addr: 0x20, name: 'keepName' },
        ];

        const edited = withEditedStructPin(pins, 0, { name: '', addr: 0x30, structId: 'new' });
        assert.notStrictEqual(edited, pins);
        assert.deepStrictEqual(edited[0], { id: 'p1', structId: 'new', addr: 0x30, name: 'oldName' });
        assert.deepStrictEqual(withoutStructPin(edited, 0), [pins[1]]);
    });

    test('removes struct definitions and dependent pins together', () => {
        const structs: StructDef[] = [
            { id: 'dead', name: 'Dead', fields: [] },
            { id: 'live', name: 'Live', fields: [] },
        ];
        const pins: StructPin[] = [
            { id: 'p1', structId: 'dead', addr: 0, name: 'deadPin' },
            { id: 'p2', structId: 'live', addr: 1, name: 'livePin' },
        ];

        assert.deepStrictEqual(withoutStructDefinition(structs, pins, 'dead'), {
            structs: [structs[1]],
            pins: [pins[1]],
        });
    });

    test('strips fields that reference a deleted type (no orphan refs)', () => {
        const structs: StructDef[] = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'a', bitWidth: 1 }] },
            { id: 'user', name: 'User', fields: [
                { name: 'ctl', type: 'bitfield', refStructId: 'bits', count: 1 },
                { name: 'keep', type: 'uint8', count: 1 },
            ] },
        ];

        const result = withoutStructDefinition(structs, [], 'bits');

        assert.deepStrictEqual(result.structs.map(d => d.id), ['user']);
        assert.deepStrictEqual(result.structs[0].fields.map(f => f.name), ['keep']);
    });

    test('strips nested type:struct fields that reference a deleted type', () => {
        const structs: StructDef[] = [
            { id: 'inner', name: 'Inner', fields: [{ name: 'tag', type: 'uint8', count: 1 }] },
            { id: 'holder', name: 'Holder', fields: [
                { name: 'kid', type: 'struct', refStructId: 'inner', count: 1 },
                { name: 'after', type: 'uint8', count: 1 },
            ] },
        ];

        const result = withoutStructDefinition(structs, [], 'inner');

        assert.deepStrictEqual(result.structs.map(d => d.id), ['holder']);
        assert.deepStrictEqual(result.structs[0].fields.map(f => f.name), ['after'], 'orphan nested type:struct ref stripped, sibling kept');
    });

    test('leaves referencing defs untouched when the deleted type is not referenced', () => {
        const structs: StructDef[] = [
            { id: 'a', name: 'A', fields: [] },
            { id: 'b', name: 'B', fields: [{ name: 'x', type: 'uint8', count: 1 }] },
        ];

        const result = withoutStructDefinition(structs, [], 'a');
        assert.strictEqual(result.structs[0], structs[1]);
    });

    test('strips scalar enum fields and clears bit-child enum refs to a deleted enum', () => {
        const structs: StructDef[] = [
            { id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'ON', value: 1 }] },
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'lo', bitWidth: 4, refStructId: 'mode' }, { name: 'hi', bitWidth: 4 }] },
            { id: 'user', name: 'User', fields: [
                { name: 'state', type: 'enum', refStructId: 'mode', count: 1 },
                { name: 'ctl', type: 'uint8', count: 1, bitFields: [{ name: 'lo', bitWidth: 4, refStructId: 'mode' }] },
                { name: 'keep', type: 'uint8', count: 1 },
            ] },
        ];

        const result = withoutStructDefinition(structs, [], 'mode');

        assert.deepStrictEqual(result.structs.map(d => d.id), ['bits', 'user']);
        assert.deepStrictEqual(result.structs[0].bitFields!.map(c => c.refStructId), [undefined, undefined]);
        assert.deepStrictEqual(result.structs[1].fields.map(f => f.name), ['ctl', 'keep']);
        assert.strictEqual(result.structs[1].fields[0].bitFields![0].refStructId, undefined);
        assert.strictEqual(result.structs[1].fields[0].bitFields![0].bitWidth, 4);
    });

    test('adds pointer source to existing target pin once', () => {
        const pins: StructPin[] = [
            { id: 'target', structId: 'child', addr: 0x200, name: 'child' },
        ];
        const result = upsertPointerStructPin(pins, {
            sourcePin: { id: 'root', name: 'Root' },
            sourceStructId: 'rootStruct',
            sourceFieldPath: 'next',
            sourceFieldByteOffset: 4,
            sourceBaseAddr: 0x100,
            targetAddress: 0x200,
            targetStructId: 'child',
        }, () => 'unused');

        assert.strictEqual(result.pin.id, 'target');
        assert.strictEqual(result.pins.length, 1);
        assert.deepStrictEqual(result.pin.pointerSources, [{
            sourcePinId: 'root',
            sourcePinName: 'Root',
            sourceStructId: 'rootStruct',
            sourceFieldPath: 'next',
            pointerStorageAddress: 0x104,
            targetAddress: 0x200,
        }]);

        const duplicate = upsertPointerStructPin(result.pins, {
            sourcePin: { id: 'root', name: 'Root' },
            sourceStructId: 'rootStruct',
            sourceFieldPath: 'next',
            sourceFieldByteOffset: 4,
            sourceBaseAddr: 0x100,
            targetAddress: 0x200,
            targetStructId: 'child',
        }, () => 'unused');
        assert.strictEqual(duplicate.pin.pointerSources?.length, 1);
    });

    test('creates pointer target pins with source identity and unique name', () => {
        const pins: StructPin[] = [
            { id: 'existing', structId: 'child', addr: 0x300, name: 'Root.next @00000200' },
        ];
        const result = upsertPointerStructPin(pins, {
            sourcePin: { id: 'root', name: 'Root' },
            sourceStructId: 'rootStruct',
            sourceFieldPath: 'next',
            sourceFieldByteOffset: 8,
            sourceBaseAddr: 0x100,
            targetAddress: 0x200,
            targetStructId: 'child',
        }, () => 'newPin');

        assert.strictEqual(result.pins.length, 2);
        assert.strictEqual(result.pin.id, 'newPin');
        assert.strictEqual(result.pin.name, 'Root.next @00000200_1');
        assert.strictEqual(result.pin.pointerSources?.[0]?.pointerStorageAddress, 0x108);
        assert.ok(samePointerSource(result.pin.pointerSources![0], {
            sourcePinId: 'root',
            sourcePinName: 'different display name is ignored',
            sourceStructId: 'rootStruct',
            sourceFieldPath: 'next',
            pointerStorageAddress: 0x108,
            targetAddress: 0x200,
        }));
    });
});
