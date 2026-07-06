import * as assert from 'assert';

import type { ProviderMessageHandlers } from '../../webview/webviewMessageDispatcher';
import type { SegmentLabel, SerializedParseResult } from '../../core/types';
import { dispatchProviderMessage } from '../../webview/webviewMessageDispatcher';
import { S } from '../../webview/state';
import { applyProviderMessageToModel } from '../../webview/webviewMessageModel';

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

    test('init loads parse state and requests a full render', () => {
        const parseResult = parseResultForTest({
            segments: [{ startAddress: 0x1000, data: [1, 2] }],
            totalDataBytes: 2,
        });
        const update = applyProviderMessageToModel({
            type: 'init',
            parseResult,
            labels: [labelForTest()],
            structs: [],
            structPins: [],
            endian: 'be',
            integrityProfiles: { profiles: [], activeChecks: { schemaVersion: 1, checks: [] } },
        });

        assert.strictEqual(S.parseResult, parseResult);
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
        const update = applyProviderMessageToModel({ type: 'savedEdits', parseResult });

        assert.strictEqual(S.parseResult, parseResult);
        assert.strictEqual(S.editMode, false);
        assert.strictEqual(S.edits.size, 0);
        assert.strictEqual(update.invalidations.editControls, true);
        assert.strictEqual(update.invalidations.integrityBytesChanged, true);
    });

    test('externalChange records lock state and conflict decision', () => {
        S.editMode = true;
        S.edits.set(0x1000, 0xAA);
        const parseResult = parseResultForTest();
        const labels = [labelForTest()];

        const update = applyProviderMessageToModel({ type: 'externalChange', parseResult, labels });

        assert.strictEqual(S.lockedDueToExternalChange, true);
        assert.strictEqual(update.invalidations.lockState, true);
        assert.strictEqual(update.removeExternalChangeBanners, true);
        assert.deepStrictEqual(update.externalChange, {
            incoming: { parseResult, labels },
            hasUnsavedEdits: true,
        });
    });
});

function noOpHandlers(): ProviderMessageHandlers {
    return {
        init: () => {},
        loadError: () => {},
        addLabel: () => {},
        updateLabel: () => {},
        copyCommand: () => {},
        savedEdits: () => {},
        externalChange: () => {},
        externalChangeError: () => {},
        repairComplete: () => {},
        integrityProfiles: () => {},
    };
}

function parseResultForTest(overrides: Partial<SerializedParseResult> = {}): SerializedParseResult {
    return {
        records: [],
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
