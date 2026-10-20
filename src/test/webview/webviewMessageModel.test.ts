import * as assert from 'assert';

import type { ProviderMessageHandlers } from '../../webview/webviewMessageDispatcher';
import type { IntegrityCheckSet } from '../../core/integrity';
import type { SegmentLabel, WireParseResult } from '../../core/types';
import { dispatchProviderMessage } from '../../webview/webviewMessageDispatcher';
import { S } from '../../webview/state';
import { applyProviderMessageToModel } from '../../webview/webviewMessageModel';
import { bitAllocationOrDefault, endianOrDefault, showHiddenFieldsOrDefault } from '../../webviewProtocol';

function resetState(): void {
    S.parseResult = null;
    S.labels = [];
    S.segmentIndex = [];
    S.memRows = [];
    S.currentView = 'memory';
    S.editMode = false;
    S.edits.clear();
    S.undoStack.length = 0;
    S.types = [];
    S.typeInstances = [];
    S.lockedDueToExternalChange = false;
    S.endian = 'le';
    S.bitFieldAllocation = 'msb';
}

suite('webview message dispatcher', () => {
    setup(resetState);

    test('ignores unknown and malformed provider messages', () => {
        const handlers = noOpHandlers();

        assert.strictEqual(dispatchProviderMessage({ type: 'unknown' }, handlers), false);
        assert.strictEqual(dispatchProviderMessage({ nope: true }, handlers), false);
        assert.strictEqual(dispatchProviderMessage(null, handlers), false);
    });

    test('dispatches known provider message types', () => {
        let called = false;
        const handlers = {
            ...noOpHandlers(),
            loadError: msg => {
                called = true;
                assert.strictEqual(msg.message, 'boom');
            },
        } satisfies ProviderMessageHandlers;

        assert.strictEqual(dispatchProviderMessage({ type: 'loadError', message: 'boom' }, handlers), true);
        assert.strictEqual(called, true);
    });

    test('dispatches the script permission request, grant list, and writes commit', () => {
        const seen: string[] = [];
        const handlers = {
            ...noOpHandlers(),
            scriptPermissionRequest: msg => { seen.push(`perm:${msg.requestId}:${msg.capability}:${msg.scopes.length}`); },
            scriptPermissions: msg => { seen.push(`grants:${msg.grants.length}`); },
            scriptWritesCommit: msg => { seen.push(`commit:${msg.scriptPath}:${msg.writes.length}`); },
        } satisfies ProviderMessageHandlers;

        assert.strictEqual(dispatchProviderMessage({
            type: 'scriptPermissionRequest',
            requestId: 4,
            capability: 'write',
            detail: 'Write 1 bytes at 0x0',
            scriptPath: 'a.js',
            scriptName: 'a.js',
            fingerprint: 'fp',
            scopes: ['once', 'script', 'session', 'workspace'],
        }, handlers), true);
        assert.strictEqual(dispatchProviderMessage({
            type: 'scriptPermissions',
            grants: [{ scriptPath: 'a.js', capability: 'write' }],
        }, handlers), true);
        assert.strictEqual(dispatchProviderMessage({
            type: 'scriptWritesCommit',
            scriptPath: 'a.js',
            writes: [[0, 255]],
        }, handlers), true);
        assert.deepStrictEqual(seen, ['perm:4:write:4', 'grants:1', 'commit:a.js:1']);
    });

    test('dispatches batched instance address results', () => {
        let seen = '';
        const handlers = {
            ...noOpHandlers(),
            instanceAddressesResolved: msg => {
                seen = `${msg.requestId}:${msg.generation}:${msg.results.length}:${msg.results[0]?.ok}`;
            },
        } satisfies ProviderMessageHandlers;

        assert.strictEqual(dispatchProviderMessage({
            type: 'instanceAddressesResolved',
            requestId: 7,
            generation: 2,
            results: [{ pinId: 'p', ok: true, addr: 0x20 }],
        }, handlers), true);
        assert.strictEqual(seen, '7:2:1:true');
    });

    test('dispatches batched instance parameter results', () => {
        let seen = '';
        const handlers = {
            ...noOpHandlers(),
            instanceParamsResolved: msg => {
                seen = `${msg.requestId}:${msg.generation}:${msg.results.length}:${msg.results[0]?.ok}`;
            },
        } satisfies ProviderMessageHandlers;

        assert.strictEqual(dispatchProviderMessage({
            type: 'instanceParamsResolved',
            requestId: 8,
            generation: 3,
            results: [{ pinId: 'p', param: 'N', ok: true, value: 4 }],
        }, handlers), true);
        assert.strictEqual(seen, '8:3:1:true');
    });
});

suite('applyProviderMessageToModel()', () => {
    setup(resetState);
    teardown(resetState);

    test('init loads parse state and requests a full render', () => {
        const parseResult = parseResultForTest({
            segments: [{ startAddress: 0x1000, data: new Uint8Array([1, 2]).buffer }],
            totalDataBytes: 2,
        });
        const update = applyProviderMessageToModel({
            type: 'init',
            generation: 1,
            parseResult,
            labels: [labelForTest()],
            types: [],
            typeInstances: [],
            endian: 'be',
            bitAllocation: 'msb',
            showHiddenFields: false,
            activeChecks: { schemaVersion: 1, checks: [] },
            profile: { profiles: [], current: null, boundFileCount: 0 },
        });

        assert.strictEqual(S.parseResult?.totalDataBytes, parseResult.totalDataBytes);
        assert.strictEqual(S.labels.length, 1);
        assert.strictEqual(S.endian, 'be');
        assert.strictEqual(S.bitFieldAllocation, 'msb');
        assert.strictEqual(S.showHiddenFields, false, 'showHiddenFields defaults off on init');
        assert.strictEqual(update.invalidations.fullRender, true);
        assert.deepStrictEqual(update.activeChecks, { schemaVersion: 1, checks: [] });
    });

    test('init hydrates S.profileState so the fresh-open dropdown is populated', () => {
        // Regression (#1): a fresh open sends only `init`; applyInitMessage must
        // assign S.profileState (like applyProfilesStateMessage does) and return
        // the profileState update field so the toolbar re-renders. Without it the
        // dropdown reads the module default and shows "No Profile" + no options.
        const update = applyProviderMessageToModel({
            type: 'init',
            generation: 1,
            parseResult: parseResultForTest(),
            labels: [],
            types: [],
            typeInstances: [],
            endian: 'le',
            bitAllocation: 'msb',
            showHiddenFields: false,
            activeChecks: { schemaVersion: 1, checks: [] },
            profile: { profiles: [{ id: 'p1', name: 'Bootloader v3' }], current: 'p1', boundFileCount: 2 },
        });

        assert.deepStrictEqual(S.profileState, {
            profiles: [{ id: 'p1', name: 'Bootloader v3' }],
            current: 'p1',
            boundFileCount: 2,
        });
        assert.deepStrictEqual(update.profileState, {
            profiles: [{ id: 'p1', name: 'Bootloader v3' }],
            current: 'p1',
            boundFileCount: 2,
        }, 'profileState returned so applyProfileStateUpdate re-renders');
    });

    test('label messages rebuild memory and invalidate labels plus memory', () => {
        const label = labelForTest({ id: 'a', name: 'A' });
        const update = applyProviderMessageToModel({ type: 'addLabel', label });

        assert.deepStrictEqual(S.labels, [label]);
        assert.strictEqual(update.invalidations.labelsAndMemory, true);
    });

    test('loadError preserves an empty provider message', () => {
        const update = applyProviderMessageToModel({ type: 'loadError', message: '' });

        assert.strictEqual(update.loadErrorMessage, '');
    });

    test('savedEdits reloads parsed memory and clears edit state', () => {
        S.editMode = true;
        S.edits.set(0x1000, 0xAA);

        const parseResult = parseResultForTest({ totalDataBytes: 1 });
        const update = applyProviderMessageToModel({ type: 'savedEdits', generation: 2, parseResult });

        assert.strictEqual(S.parseResult?.totalDataBytes, parseResult.totalDataBytes);
        assert.strictEqual(S.editMode, false);
        assert.strictEqual(S.edits.size, 0);
        assert.strictEqual(update.invalidations.editControls, true);
        assert.strictEqual(update.invalidations.integrityBytesChanged, true);
    });

    test('light savedEdits (no parseResult) folds bytes, keeps undo/edit state, no reload', () => {
        applyProviderMessageToModel({
            type: 'init',
            generation: 1,
            parseResult: parseResultForTest({
                segments: [{ startAddress: 0x1000, data: new Uint8Array([1, 2, 3]).buffer }],
                totalDataBytes: 3,
            }),
            labels: [],
            types: [],
            typeInstances: [],
            endian: 'le',
            bitAllocation: 'msb',
            showHiddenFields: false,
            activeChecks: { schemaVersion: 1, checks: [] },
            profile: { profiles: [], current: null, boundFileCount: 0 },
        });
        S.editMode = true;
        S.edits.set(0x1001, 0xAA);
        const memRowsBefore = S.memRows;

        const update = applyProviderMessageToModel({ type: 'savedEdits', generation: 7 });

        assert.strictEqual(S.documentGeneration, 7);
        assert.strictEqual(S.editMode, true, 'undo remains available after save');
        assert.strictEqual(S.edits.size, 0, 'overlay cleared');
        assert.strictEqual((S.parseResult!.segments[0].data as Uint8Array)[1], 0xAA, 'saved byte folded into segments');
        assert.strictEqual((S.parseResult!.segments[0].data as Uint8Array)[0], 1, 'untouched byte intact');
        assert.strictEqual(S.memRows, memRowsBefore, 'memory rows not rebuilt (no reload)');
        assert.strictEqual(update.invalidations.segments, undefined, 'no segment invalidation');
        assert.strictEqual(update.invalidations.dirtyBar, true);
    });

    test('externalChange records lock state and conflict decision', () => {
        S.editMode = true;
        S.edits.set(0x1000, 0xAA);
        const parseResult = parseResultForTest();
        const labels = [labelForTest()];

        const update = applyProviderMessageToModel({ type: 'externalChange', generation: 3, parseResult, labels });

        assert.strictEqual(S.lockedDueToExternalChange, true);
        assert.strictEqual(update.invalidations.lockState, true);
        assert.strictEqual(update.removeExternalChangeBanners, true);
        assert.strictEqual(update.externalChange?.incoming.generation, 3);
        assert.deepStrictEqual(update.externalChange?.incoming.labels, labels);
        assert.strictEqual(update.externalChange?.hasUnsavedEdits, true);
    });

    test('typesExternalChange replaces types and prunes orphaned pins', () => {
        S.types = [{ id: 'gone', name: 'Gone', fields: [] }];
        S.typeInstances = [
            { id: 'p1', typeId: 'gone', addr: 0, name: 'P1' },
            { id: 'p2', typeId: 'kept', addr: 8, name: 'P2' },
        ];

        const update = applyProviderMessageToModel({
            type: 'typesExternalChange',
            types: [{ id: 'kept', name: 'Kept', fields: [] }],
        });

        assert.deepStrictEqual(S.types.map(def => def.id), ['kept']);
        assert.deepStrictEqual(S.typeInstances.map(pin => pin.id), ['p2'], 'pin of vanished typeId pruned');
        assert.strictEqual(update.invalidations.typeInstances, true);
    });

    test('perFileDataChange replaces labels, segment names, pins, endian, allocation, and active checks', () => {
        applyProviderMessageToModel({
            type: 'init',
            generation: 1,
            parseResult: parseResultForTest(),
labels: [],
            types: [],
            typeInstances: [],
            endian: 'le',
            bitAllocation: 'msb',
            showHiddenFields: false,
            activeChecks: { schemaVersion: 1, checks: [] },
            profile: { profiles: [], current: null, boundFileCount: 0 },
        });

        const labels = [labelForTest({ id: 'x', name: 'X' })];
        const segmentNames = { '0': 'Boot' };
        const pins = [{ id: 'pin', typeId: 's', addr: 0, name: 'P' }];
        const activeChecks: IntegrityCheckSet = { schemaVersion: 1, checks: [] };

        const update = applyProviderMessageToModel({
            type: 'perFileDataChange',
            labels,
            segmentNames,
            pins,
            endian: 'be',
            bitAllocation: 'lsb',
            showHiddenFields: true,
            activeChecks,
        });

        assert.deepStrictEqual(S.labels, labels);
        assert.deepStrictEqual(S.segmentNames, segmentNames);
        assert.deepStrictEqual(S.typeInstances, pins);
        assert.strictEqual(S.endian, 'be');
        assert.strictEqual(S.bitFieldAllocation, 'lsb');
        assert.strictEqual(S.showHiddenFields, true, 'showHiddenFields round-trips from perFileDataChange');
        assert.deepStrictEqual(update.activeChecks, activeChecks);
        assert.strictEqual(update.invalidations.labelsAndMemory, true);
        assert.strictEqual(update.invalidations.typeInstances, true);
        assert.strictEqual(update.invalidations.endianChanged, true);
        assert.strictEqual(update.invalidations.bitFieldAllocationChanged, true);
        assert.strictEqual(update.invalidations.showHiddenFieldsChanged, true);
    });

    test('profilesState update returns the profileState field so the dropdown re-renders', () => {
        const update = applyProviderMessageToModel({
            type: 'profilesState',
            profiles: [{ id: 'p1', name: 'Bootloader v3' }],
            current: 'p1',
            boundFileCount: 2,
        });

        assert.deepStrictEqual(S.profileState, {
            profiles: [{ id: 'p1', name: 'Bootloader v3' }],
            current: 'p1',
            boundFileCount: 2,
        });
        // Regression: without `profileState` in the update, the toolbar select is
        // never re-rendered and a freshly created profile cannot be selected.
        assert.deepStrictEqual(update.profileState, {
            profiles: [{ id: 'p1', name: 'Bootloader v3' }],
            current: 'p1',
            boundFileCount: 2,
        });
    });

    test('endianOrDefault is the shared single normalizer (defaults to le)', () => {
        assert.strictEqual(endianOrDefault('be'), 'be');
        assert.strictEqual(endianOrDefault('le'), 'le');
        assert.strictEqual(endianOrDefault(undefined), 'le');
        assert.strictEqual(endianOrDefault('bogus'), 'le');
        assert.strictEqual(endianOrDefault(42), 'le');
    });

    test('bitAllocationOrDefault is the shared single normalizer (defaults to msb)', () => {
        assert.strictEqual(bitAllocationOrDefault('lsb'), 'lsb');
        assert.strictEqual(bitAllocationOrDefault('msb'), 'msb');
        assert.strictEqual(bitAllocationOrDefault('bogus'), 'msb');
        assert.strictEqual(bitAllocationOrDefault(undefined), 'msb');
    });

    test('showHiddenFieldsOrDefault is the shared single normalizer (defaults off)', () => {
        assert.strictEqual(showHiddenFieldsOrDefault(true), true);
        assert.strictEqual(showHiddenFieldsOrDefault(false), false);
        assert.strictEqual(showHiddenFieldsOrDefault('true'), false);
        assert.strictEqual(showHiddenFieldsOrDefault(1), false);
        assert.strictEqual(showHiddenFieldsOrDefault(undefined), false);
    });

    test('script permission + commit messages are passive model updates', () => {
        const request = applyProviderMessageToModel({
            type: 'scriptPermissionRequest', requestId: 1, capability: 'fetch', detail: 'https://x.test',
            scriptPath: 'a.js', scriptName: 'a.js', fingerprint: 'fp', scopes: ['once'],
        });
        const permissions = applyProviderMessageToModel({ type: 'scriptPermissions', grants: [] });
        const commit = applyProviderMessageToModel({ type: 'scriptWritesCommit', scriptPath: 'a.js', writes: [[0, 1]] });
        for (const update of [request, permissions, commit]) {
            assert.deepStrictEqual(update.invalidations, {});
        }
    });
});

function noOpHandlers(): ProviderMessageHandlers {
    return {
        init: () => {},
        loadProgress: () => {},
        recordPage: () => {},
        loadError: () => {},
        addLabel: () => {},
        updateLabel: () => {},
        copyCommand: () => {},
        savedEdits: () => {},
        typesExternalChange: () => {},
        perFileDataChange: () => {},
        externalChange: () => {},
        externalChangeError: () => {},
        repairComplete: () => {},
        profilesState: () => {},
        activateProfilePicker: () => {},
        scriptInfo: () => {},
        scriptResult: () => {},
        integrityScriptResult: () => {},
        instanceAddressesResolved: () => {},
        instanceParamsResolved: () => {},
        scriptOutput: () => {},
        scriptPermissionRequest: () => {},
        scriptPermissions: () => {},
        scriptWritesCommit: () => {},
        activateScriptsTab: () => {},
    };
}

function parseResultForTest(overrides: Partial<WireParseResult> = {}): WireParseResult {
    return {
        recordCount: 0,
        segments: [],
        totalDataBytes: 0,
        checksumErrors: 0,
        malformedLines: 0,
        format: 'ihex',
        ...overrides,
    };
}

function labelForTest(overrides: Partial<SegmentLabel> = {}): SegmentLabel {
    return {
        id: 'label-1',
        name: 'Label 1',
        startAddress: 0,
        length: 1,
        color: '#ff0000',
        ...overrides,
    };
}
