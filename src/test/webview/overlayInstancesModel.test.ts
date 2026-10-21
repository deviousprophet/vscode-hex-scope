import * as assert from 'assert';

import type { TypeDef, TypeInstance } from '../../core/types';
import {
    addressSourceError,
    effectiveInstanceAddress,
    effectiveInstanceParams,
    instanceParamResolutionError,
    instanceUsesScriptAddress,
    instanceUsesScriptParams,
    instanceUsesScriptResolution,
    makeTypeInstance,
    paramResolutionKey,
    parseTypeInstanceAddressInput,
    resolvedInstanceParams,
    samePointerSource,
    uniqueTypeInstanceName,
    upsertPointerTypeInstance,
    validateInstanceParamConfig,
    withEditedTypeInstance,
    withoutTypeDefinition,
    withoutTypeInstance,
} from '../../webview/components/sidebar/overlayPanel/overlayInstancesModel';
import type { AddressResolution, ParamResolution, ParamResolutionKey } from '../../webview/components/sidebar/overlayPanel/overlayInstancesModel';

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

suite('instance address sources', () => {
    test('makeTypeInstance stores a trimmed source and omits an empty one', () => {
        const withSource = makeTypeInstance({
            typeId: 't', addr: 0x10, name: 'a', addressSource: { scriptPath: '  follow.js  ' },
        }, () => 'p1');
        assert.deepStrictEqual(withSource.addressSource, { scriptPath: 'follow.js' });
        assert.strictEqual(withSource.addr, 0x10, 'addr remains the authored fallback');

        const without = makeTypeInstance({
            typeId: 't', addr: 0x20, name: 'b', addressSource: { scriptPath: '   ' },
        }, () => 'p2');
        assert.strictEqual('addressSource' in without, false);
    });

    test('withEditedTypeInstance sets, replaces, and clears the source', () => {
        const pins: TypeInstance[] = [{ id: 'p1', typeId: 't', addr: 0, name: 'a' }];
        const set = withEditedTypeInstance(pins, 0, {
            name: 'a', addr: 0x10, typeId: 't', addressSource: { scriptPath: 'a.js' },
        });
        assert.deepStrictEqual(set[0].addressSource, { scriptPath: 'a.js' });
        assert.deepStrictEqual(pins[0].addressSource, undefined, 'immutable');

        const cleared = withEditedTypeInstance(set, 0, { name: 'a', addr: 0x10, typeId: 't', addressSource: null });
        assert.strictEqual('addressSource' in cleared[0], false);
    });

    test('rejects an empty source and a source combined with pointer metadata', () => {
        assert.strictEqual(addressSourceError({}), null);
        assert.ok(addressSourceError({ addressSource: { scriptPath: '  ' } }));
        assert.strictEqual(addressSourceError({ addressSource: { scriptPath: 'a.js' } }), null);
        assert.ok(addressSourceError({
            addressSource: { scriptPath: 'a.js' },
            pointerSources: [{
                sourcePinId: 's', sourcePinName: 'S', sourceTypeId: 't',
                sourceFieldPath: 'next', pointerStorageAddress: 0, targetAddress: 1,
            }],
        }));
    });

    test('effectiveInstanceAddress: fixed addr, resolved wins, no silent fallback', () => {
        const fixed: TypeInstance = { id: 'f', typeId: 't', addr: 0x100, name: 'f' };
        const dynamic: TypeInstance = {
            id: 'd', typeId: 't', addr: 0x200, name: 'd', addressSource: { scriptPath: 'a.js' },
        };
        const fixedOnly = new Map<string, AddressResolution>();
        assert.strictEqual(effectiveInstanceAddress(fixed, fixedOnly), 0x100);
        assert.strictEqual(effectiveInstanceAddress(dynamic, fixedOnly), null, 'no resolution yet = no decode');

        const resolved = new Map<string, AddressResolution>([
            ['d', { status: 'resolved', addr: 0x300, generation: 4 }],
        ]);
        assert.strictEqual(effectiveInstanceAddress(dynamic, resolved), 0x300, 'resolved wins over addr');

        const stale = new Map<string, AddressResolution>([
            ['d', { status: 'stale', addr: 0x400, generation: 5 }],
        ]);
        assert.strictEqual(effectiveInstanceAddress(dynamic, stale), null, 'stale is not current');

        const failed = new Map<string, AddressResolution>([
            ['d', { status: 'error', message: 'Invalid address from script', generation: 6 }],
        ]);
        assert.strictEqual(effectiveInstanceAddress(dynamic, failed), null, 'error never falls back to addr');

        assert.strictEqual(instanceUsesScriptAddress(dynamic), true);
        assert.strictEqual(instanceUsesScriptAddress(fixed), false);
    });
});

suite('instance parameter values', () => {
    test('makeTypeInstance stores declared paramValues (and omits an empty map)', () => {
        const withParams = makeTypeInstance({ typeId: 't', addr: 0, name: 'a', paramValues: { N: 4 } }, () => 'p1');
        assert.deepStrictEqual(withParams.paramValues, { N: 4 });
        const without = makeTypeInstance({ typeId: 't', addr: 0, name: 'b', paramValues: {} }, () => 'p2');
        assert.strictEqual('paramValues' in without, false);
    });

    test('withEditedTypeInstance sets new values and clears them when the type has none', () => {
        const pins: TypeInstance[] = [{ id: 'p1', typeId: 't', addr: 0, name: 'a', paramValues: { N: 2 } }];
        const set = withEditedTypeInstance(pins, 0, { name: 'a', addr: 0, typeId: 't', paramValues: { N: 5 } });
        assert.deepStrictEqual(set[0].paramValues, { N: 5 });
        assert.deepStrictEqual(pins[0].paramValues, { N: 2 }, 'immutable');
        const cleared = withEditedTypeInstance(pins, 0, { name: 'a', addr: 0, typeId: 'plain' });
        assert.strictEqual('paramValues' in cleared[0], false);
    });
});

suite('instance parameter sources', () => {
    const def: TypeDef = {
        id: 't', name: 'T', fields: [{ name: 'items', type: 'uint8', count: 4, countParam: 'N' }],
        params: [{ name: 'N', kind: 'size' }],
    };

    test('make/edit stores trimmed sources and clears them explicitly', () => {
        const pin = makeTypeInstance({
            typeId: 't', addr: 0, name: 'a',
            paramSources: { N: { scriptPath: '  size.js  ' }, EMPTY: { scriptPath: '  ' } },
        }, () => 'p1');
        assert.deepStrictEqual(pin.paramSources, { N: { scriptPath: 'size.js' } });

        const pins: TypeInstance[] = [{ id: 'p1', typeId: 't', addr: 0, name: 'a' }];
        const set = withEditedTypeInstance(pins, 0, {
            name: 'a', addr: 0, typeId: 't', paramValues: { N: 2 }, paramSources: { N: { scriptPath: 'size.js' } },
        });
        assert.deepStrictEqual(set[0].paramSources, { N: { scriptPath: 'size.js' } });
        const cleared = withEditedTypeInstance(set, 0, {
            name: 'a', addr: 0, typeId: 't', paramValues: {}, paramSources: null,
        });
        assert.strictEqual('paramSources' in cleared[0], false);
    });

    test('effective params: manual wins over resolved, then the type default', () => {
        const resolved = new Map<string, number>([['N', 8]]);
        const scripted: TypeInstance = {
            id: 'p', typeId: 't', addr: 0, name: 'a', paramSources: { N: { scriptPath: 'size.js' } },
        };
        assert.deepStrictEqual(effectiveInstanceParams(def, scripted, resolved), { ok: true, value: { N: 8 } });
        assert.deepStrictEqual(
            effectiveInstanceParams(def, { ...scripted, paramValues: { N: 3 } }, resolved),
            { ok: true, value: { N: 3 } },
            'manual value wins',
        );

        const defaulted: TypeDef = { ...def, params: [{ name: 'N', kind: 'size', default: 5 }] };
        assert.deepStrictEqual(effectiveInstanceParams(defaulted, scripted, new Map()), { ok: true, value: { N: 5 } });
        assert.deepStrictEqual(
            effectiveInstanceParams(def, scripted, new Map()),
            { ok: false, error: 'Type "T": parameter "N" has no value.' },
            'never a silent 0/1',
        );
    });

    test('resolved values are read per instance and only when resolved', () => {
        const resolutions = new Map<ParamResolutionKey, ParamResolution>([
            [paramResolutionKey('a', 'N'), { status: 'resolved', value: 4, generation: 1 }],
            [paramResolutionKey('a', 'M'), { status: 'stale', value: 9, generation: 1 }],
            [paramResolutionKey('b', 'N'), { status: 'resolved', value: 6, generation: 1 }],
        ]);
        const values = resolvedInstanceParams('a', resolutions);
        assert.deepStrictEqual([...values], [['N', 4]]);
    });

    test('param config rejects unknown, empty, and manual+source collisions', () => {
        assert.deepStrictEqual(validateInstanceParamConfig(def, { N: 4 }, undefined), []);
        assert.ok(validateInstanceParamConfig(def, {}, { N: { scriptPath: '' } })
            .some(error => error.includes('select a size script')));
        assert.ok(validateInstanceParamConfig(def, { N: 4 }, { N: { scriptPath: 'size.js' } })
            .some(error => error.includes('both a manual value and a script source')));
        assert.ok(validateInstanceParamConfig(def, {}, { OTHER: { scriptPath: 'size.js' } })
            .some(error => error.includes('unknown parameter')));
        assert.ok(validateInstanceParamConfig(def, {}, { N: { scriptPath: 'size.js' } })
            .every(error => !error.includes('has no value')), 'a source satisfies the parameter');
    });

    test('resolution errors block only while pending/stale/failed', () => {
        const pin: TypeInstance = {
            id: 'p', typeId: 't', addr: 0, name: 'a', paramSources: { N: { scriptPath: 'size.js' } },
        };
        const resolved = new Map<ParamResolutionKey, ParamResolution>([
            [paramResolutionKey('p', 'N'), { status: 'resolved', value: 4, generation: 1 }],
        ]);
        assert.strictEqual(instanceParamResolutionError(def, pin, resolved), undefined);
        assert.match(instanceParamResolutionError(def, pin, new Map()) ?? '', /Resolving/);
        const stale = new Map<ParamResolutionKey, ParamResolution>([
            [paramResolutionKey('p', 'N'), { status: 'stale', value: 4, generation: 2 }],
        ]);
        assert.match(instanceParamResolutionError(def, pin, stale) ?? '', /stale/);
        const failed = new Map<ParamResolutionKey, ParamResolution>([
            [paramResolutionKey('p', 'N'), { status: 'error', message: 'Invalid size from script', generation: 2 }],
        ]);
        assert.strictEqual(instanceParamResolutionError(def, pin, failed), 'Invalid size from script');
        assert.strictEqual(instanceUsesScriptParams(pin), true);
        assert.strictEqual(instanceUsesScriptResolution(pin), true);
        assert.strictEqual(instanceUsesScriptAddress(pin), false);
    });
});
