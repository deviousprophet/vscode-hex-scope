import * as assert from 'assert';

import type { ProviderMessageHandlers } from '../../webview/webviewMessageDispatcher';
import type { IntegrityCheckSet } from '../../core/integrity';
import type { SegmentLabel, WireParseResult } from '../../core/types';
import { dispatchProviderMessage } from '../../webview/webviewMessageDispatcher';
import { S } from '../../webview/state';
import { applyProviderMessageToModel } from '../../webview/webviewMessageModel';
import { endianOrDefault } from '../../webviewProtocol';

function resetState(): void {
    S.parseResult = null;
    S.labels = [];
    S.segmentIndex = [];
    S.memRows = [];
    S.currentView = 'memory';
    S.editMode = false;
    S.edits.clear();
    S.undoStack.length = 0;
    S.structs = [];
    S.structPins = [];
    S.lockedDueToExternalChange = false;
    S.endian = 'le';
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
            structs: [],
            structPins: [],
            endian: 'be',
            integrityProfiles: { profiles: [], activeChecks: { schemaVersion: 1, checks: [] } },
        });

        assert.strictEqual(S.parseResult?.totalDataBytes, parseResult.totalDataBytes);
        assert.strictEqual(S.labels.length, 1);
        assert.strictEqual(S.endian, 'be');
        assert.strictEqual(update.invalidations.fullRender, true);
        assert.ok(update.integrityProfiles);
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
            structs: [],
            structPins: [],
            endian: 'le',
            integrityProfiles: { profiles: [], activeChecks: { schemaVersion: 1, checks: [] } },
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

    test('structsExternalChange replaces structs and prunes orphaned pins', () => {
        S.structs = [{ id: 'gone', name: 'Gone', fields: [] }];
        S.structPins = [
            { id: 'p1', structId: 'gone', addr: 0, name: 'P1' },
            { id: 'p2', structId: 'kept', addr: 8, name: 'P2' },
        ];

        const update = applyProviderMessageToModel({
            type: 'structsExternalChange',
            structs: [{ id: 'kept', name: 'Kept', fields: [] }],
        });

        assert.deepStrictEqual(S.structs.map(def => def.id), ['kept']);
        assert.deepStrictEqual(S.structPins.map(pin => pin.id), ['p2'], 'pin of vanished structId pruned');
        assert.strictEqual(update.invalidations.structPins, true);
    });

    test('perFileDataChange replaces labels, segment names, pins, endian, and active checks', () => {
        applyProviderMessageToModel({
            type: 'init',
            generation: 1,
            parseResult: parseResultForTest(),
            labels: [],
            structs: [],
            structPins: [],
            endian: 'le',
            integrityProfiles: { profiles: [], activeChecks: { schemaVersion: 1, checks: [] } },
        });
        const labels = [labelForTest({ id: 'x', name: 'X' })];
        const segmentNames = { '0': 'Boot' };
        const pins = [{ id: 'pin', structId: 's', addr: 0, name: 'P' }];
        const activeChecks: IntegrityCheckSet = { schemaVersion: 1, checks: [] };

        const update = applyProviderMessageToModel({
            type: 'perFileDataChange',
            labels,
            segmentNames,
            pins,
            endian: 'be',
            activeChecks,
        });

        assert.deepStrictEqual(S.labels, labels);
        assert.deepStrictEqual(S.segmentNames, segmentNames);
        assert.deepStrictEqual(S.structPins, pins);
        assert.strictEqual(S.endian, 'be');
        assert.deepStrictEqual(update.activeChecks, activeChecks);
        assert.strictEqual(update.invalidations.labelsAndMemory, true);
        assert.strictEqual(update.invalidations.structPins, true);
        assert.strictEqual(update.invalidations.endianChanged, true);
    });

    test('endianOrDefault is the shared single normalizer (defaults to le)', () => {
        assert.strictEqual(endianOrDefault('be'), 'be');
        assert.strictEqual(endianOrDefault('le'), 'le');
        assert.strictEqual(endianOrDefault(undefined), 'le');
        assert.strictEqual(endianOrDefault('bogus'), 'le');
        assert.strictEqual(endianOrDefault(42), 'le');
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
        structsExternalChange: () => {},
        perFileDataChange: () => {},
        externalChange: () => {},
        externalChangeError: () => {},
        repairComplete: () => {},
        integrityProfiles: () => {},
        scriptInfo: () => {},
        scriptResult: () => {},
        scriptOutput: () => {},
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
