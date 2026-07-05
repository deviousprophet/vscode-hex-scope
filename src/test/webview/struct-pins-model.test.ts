import * as assert from 'assert';

import type { StructDef, StructPin } from '../../core/types';
import {
    makeStructPin,
    samePointerSource,
    uniqueStructPinName,
    upsertPointerStructPin,
    withEditedStructPin,
    withoutStructDefinition,
    withoutStructPin,
} from '../../webview/panels/structPinsModel';

suite('struct pin model', () => {
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
