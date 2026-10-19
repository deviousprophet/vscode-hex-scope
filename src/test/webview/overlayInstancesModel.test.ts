import * as assert from 'assert';

import type { TypeDef, TypeInstance } from '../../core/types';
import {
    makeTypeInstance,
    parseTypeInstanceAddressInput,
    samePointerSource,
    uniqueTypeInstanceName,
    upsertPointerTypeInstance,
    withEditedTypeInstance,
    withoutTypeDefinition,
    withoutTypeInstance,
} from '../../webview/components/sidebar/overlayPanel/overlayInstancesModel';

suite('instance model', () => {
    test('parses full hex address input only', () => {
        assert.strictEqual(parseTypeInstanceAddressInput('123'), 0x123);
        assert.strictEqual(parseTypeInstanceAddressInput(' 0xDEADBEEF '), 0xDEADBEEF);
        assert.strictEqual(parseTypeInstanceAddressInput('123xyz'), null);
        assert.strictEqual(parseTypeInstanceAddressInput(''), null);
        assert.strictEqual(parseTypeInstanceAddressInput('0x100000000'), null);
    });

    test('creates pins with injected ids', () => {
        const pin = makeTypeInstance({ typeId: 's1', addr: 0x20, name: 'inst' }, () => 'pin_test');

        assert.deepStrictEqual(pin, {
            id: 'pin_test',
            typeId: 's1',
            addr: 0x20,
            name: 'inst',
        });
    });

    test('keeps generated names unique', () => {
        const pins: TypeInstance[] = [
            { id: 'p1', typeId: 's1', addr: 0, name: 'Packet_0' },
            { id: 'p2', typeId: 's1', addr: 1, name: 'Packet_1' },
        ];

        assert.strictEqual(uniqueTypeInstanceName(pins, 'Packet_0', n => `Packet_${n}`), 'Packet_2');
    });

    test('edits and removes pins immutably', () => {
        const pins: TypeInstance[] = [
            { id: 'p1', typeId: 'old', addr: 0x10, name: 'oldName' },
            { id: 'p2', typeId: 'keep', addr: 0x20, name: 'keepName' },
        ];

        const edited = withEditedTypeInstance(pins, 0, { name: '', addr: 0x30, typeId: 'new' });
        assert.notStrictEqual(edited, pins);
        assert.deepStrictEqual(edited[0], { id: 'p1', typeId: 'new', addr: 0x30, name: 'oldName' });
        assert.deepStrictEqual(withoutTypeInstance(edited, 0), [pins[1]]);
    });

    test('removes type definitions and dependent pins together', () => {
        const types: TypeDef[] = [
            { id: 'dead', name: 'Dead', fields: [] },
            { id: 'live', name: 'Live', fields: [] },
        ];
        const pins: TypeInstance[] = [
            { id: 'p1', typeId: 'dead', addr: 0, name: 'deadPin' },
            { id: 'p2', typeId: 'live', addr: 1, name: 'livePin' },
        ];

        assert.deepStrictEqual(withoutTypeDefinition(types, pins, 'dead'), {
            types: [types[1]],
            pins: [pins[1]],
        });
    });

    test('strips fields that reference a deleted type (no orphan refs)', () => {
        const types: TypeDef[] = [
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'a', bitWidth: 1 }] },
            { id: 'user', name: 'User', fields: [
                { name: 'ctl', type: 'bitfield', refTypeId: 'bits', count: 1 },
                { name: 'keep', type: 'uint8', count: 1 },
            ] },
        ];

        const result = withoutTypeDefinition(types, [], 'bits');

        assert.deepStrictEqual(result.types.map(d => d.id), ['user']);
        assert.deepStrictEqual(result.types[0].fields.map(f => f.name), ['keep']);
    });

    test('strips nested type:type fields that reference a deleted type', () => {
        const types: TypeDef[] = [
            { id: 'inner', name: 'Inner', fields: [{ name: 'tag', type: 'uint8', count: 1 }] },
            { id: 'holder', name: 'Holder', fields: [
                { name: 'kid', type: 'struct', refTypeId: 'inner', count: 1 },
                { name: 'after', type: 'uint8', count: 1 },
            ] },
        ];

        const result = withoutTypeDefinition(types, [], 'inner');

        assert.deepStrictEqual(result.types.map(d => d.id), ['holder']);
        assert.deepStrictEqual(result.types[0].fields.map(f => f.name), ['after'], 'orphan nested type:struct ref stripped, sibling kept');
    });

    test('leaves referencing defs untouched when the deleted type is not referenced', () => {
        const types: TypeDef[] = [
            { id: 'a', name: 'A', fields: [] },
            { id: 'b', name: 'B', fields: [{ name: 'x', type: 'uint8', count: 1 }] },
        ];

        const result = withoutTypeDefinition(types, [], 'a');
        assert.strictEqual(result.types[0], types[1]);
    });

    test('strips scalar enum fields and clears bit-child enum refs to a deleted enum', () => {
        const types: TypeDef[] = [
            { id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'ON', value: 1 }] },
            { id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [], bitFields: [{ name: 'lo', bitWidth: 4, refTypeId: 'mode' }, { name: 'hi', bitWidth: 4 }] },
            { id: 'user', name: 'User', fields: [
                { name: 'state', type: 'enum', refTypeId: 'mode', count: 1 },
                { name: 'ctl', type: 'uint8', count: 1, bitFields: [{ name: 'lo', bitWidth: 4, refTypeId: 'mode' }] },
                { name: 'keep', type: 'uint8', count: 1 },
            ] },
        ];

        const result = withoutTypeDefinition(types, [], 'mode');

        assert.deepStrictEqual(result.types.map(d => d.id), ['bits', 'user']);
        assert.deepStrictEqual(result.types[0].bitFields!.map(c => c.refTypeId), [undefined, undefined]);
        assert.deepStrictEqual(result.types[1].fields.map(f => f.name), ['ctl', 'keep']);
        assert.strictEqual(result.types[1].fields[0].bitFields![0].refTypeId, undefined);
        assert.strictEqual(result.types[1].fields[0].bitFields![0].bitWidth, 4);
    });

    test('adds pointer source to existing target pin once', () => {
        const pins: TypeInstance[] = [
            { id: 'target', typeId: 'child', addr: 0x200, name: 'child' },
        ];
        const result = upsertPointerTypeInstance(pins, {
            sourcePin: { id: 'root', name: 'Root' },
            sourceTypeId: 'rootType',
            sourceFieldPath: 'next',
            sourceFieldByteOffset: 4,
            sourceBaseAddr: 0x100,
            targetAddress: 0x200,
            targetTypeId: 'child',
        }, () => 'unused');

        assert.strictEqual(result.pin.id, 'target');
        assert.strictEqual(result.pins.length, 1);
        assert.deepStrictEqual(result.pin.pointerSources, [{
            sourcePinId: 'root',
            sourcePinName: 'Root',
            sourceTypeId: 'rootType',
            sourceFieldPath: 'next',
            pointerStorageAddress: 0x104,
            targetAddress: 0x200,
        }]);

        const duplicate = upsertPointerTypeInstance(result.pins, {
            sourcePin: { id: 'root', name: 'Root' },
            sourceTypeId: 'rootType',
            sourceFieldPath: 'next',
            sourceFieldByteOffset: 4,
            sourceBaseAddr: 0x100,
            targetAddress: 0x200,
            targetTypeId: 'child',
        }, () => 'unused');
        assert.strictEqual(duplicate.pin.pointerSources?.length, 1);
    });

    test('creates pointer target pins with source identity and unique name', () => {
        const pins: TypeInstance[] = [
            { id: 'existing', typeId: 'child', addr: 0x300, name: 'Root.next @00000200' },
        ];
        const result = upsertPointerTypeInstance(pins, {
            sourcePin: { id: 'root', name: 'Root' },
            sourceTypeId: 'rootType',
            sourceFieldPath: 'next',
            sourceFieldByteOffset: 8,
            sourceBaseAddr: 0x100,
            targetAddress: 0x200,
            targetTypeId: 'child',
        }, () => 'newPin');

        assert.strictEqual(result.pins.length, 2);
        assert.strictEqual(result.pin.id, 'newPin');
        assert.strictEqual(result.pin.name, 'Root.next @00000200_1');
        assert.strictEqual(result.pin.pointerSources?.[0]?.pointerStorageAddress, 0x108);
        assert.ok(samePointerSource(result.pin.pointerSources![0], {
            sourcePinId: 'root',
            sourcePinName: 'different display name is ignored',
            sourceTypeId: 'rootType',
            sourceFieldPath: 'next',
            pointerStorageAddress: 0x108,
            targetAddress: 0x200,
        }));
    });
});
