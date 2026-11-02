import * as assert from 'assert';
import { S } from '../../webview/state';
import { clearEditModel } from '../../webview/appModel';
import { initFlatBytes, getByte } from '../../webview/memory/memoryData';
import { applyStructuralDelete, applyStructuralInsert, applyStructuralReplace, effectiveSegments, mappedSelectionBounds } from '../../webview/structuralEdit';
import { undoLastEditTransaction, redoLastEditTransaction } from '../../webview/editTransactions';
import { parseClipboardBytes } from '../../webview/pasteUtils';
import {
    copyRegion,
    copySelection,
    cutRegion,
    cutSelection,
    pasteAtAddress,
    pasteSelection,
} from '../../webview/clipboardEdit';

class FakeClipboard {
    public text = '';
    public failWrite = false;

    async readText(): Promise<string> { return this.text; }
    async writeText(text: string): Promise<void> {
        if (this.failWrite) { throw new Error('denied'); }
        this.text = text;
    }
}

let clipboard: FakeClipboard;

function reset(): void {
    S.parseResult = {
        records: [],
        segments: [{ startAddress: 0x1000, data: Uint8Array.from([0x11, 0x22, 0x33, 0x44]) }],
        totalDataBytes: 4,
        checksumErrors: 0,
        malformedLines: 0,
        format: 'ihex',
    };
    S.savedSegments = S.parseResult.segments;
    S.edits.clear();
    S.undoStack.length = 0;
    S.redoStack.length = 0;
    S.editMode = true;
    S.structuralDirty = false;
    S.lockedDueToExternalChange = false;
    S.selStart = null;
    S.selEnd = null;
    S.lastClickColumn = null;
    initFlatBytes();
}

function select(start: number, end = start): void {
    S.selStart = start;
    S.selEnd = end;
}

function bytes(): number[] {
    const out: number[] = [];
    for (let addr = 0x1000; addr <= 0x1020; addr++) {
        const byte = getByte(addr);
        if (byte !== undefined) { out.push(byte); }
    }
    return out;
}

suite('clipboard edit', () => {
    setup(() => {
        clipboard = new FakeClipboard();
        Object.defineProperty(globalThis, 'navigator', {
            value: { clipboard },
            configurable: true,
            writable: true,
        });
    });

    teardown(() => {
        reset();
    });

    test('parseClipboardBytes prefers spaced hex and falls back to ASCII', () => {
        assert.deepStrictEqual(parseClipboardBytes('0A 1B'), [10, 27]);
        assert.deepStrictEqual(parseClipboardBytes('AB'), [0xAB]);
        assert.deepStrictEqual(parseClipboardBytes('hi'), [0x68, 0x69]);
    });

    test('replace with an equal length stages bytes without a structural change', async () => {
        reset();
        select(0x1001, 0x1002);
        clipboard.text = 'AA BB';
        const result = await pasteSelection('replace');
        assert.ok(result.ok);
        assert.strictEqual(S.structuralDirty, false);
        assert.deepStrictEqual(Array.from(S.edits.entries()), [[0x1001, 0xAA], [0x1002, 0xBB]]);
        assert.strictEqual(S.undoStack[0].kind, 'bytes');
    });

    test('replace with a longer clipboard grows the document and shifts later bytes', async () => {
        reset();
        select(0x1001, 0x1002);
        clipboard.text = 'AA BB CC DD';
        const result = await pasteSelection('replace');
        assert.ok(result.ok);
        assert.strictEqual(S.structuralDirty, true);
        assert.deepStrictEqual(bytes(), [0x11, 0xAA, 0xBB, 0xCC, 0xDD, 0x44]);
        assert.strictEqual(S.undoStack[0].kind, 'structure');
        assert.ok(undoLastEditTransaction());
        assert.deepStrictEqual(bytes(), [0x11, 0x22, 0x33, 0x44]);
        assert.ok(redoLastEditTransaction());
        assert.deepStrictEqual(bytes(), [0x11, 0xAA, 0xBB, 0xCC, 0xDD, 0x44]);
    });

    test('insert before and after place bytes at the selection edges', async () => {
        reset();
        select(0x1001, 0x1002);
        clipboard.text = 'AA';
        assert.ok((await pasteSelection('insert-before')).ok);
        assert.deepStrictEqual(bytes(), [0x11, 0xAA, 0x22, 0x33, 0x44]);

        reset();
        select(0x1001, 0x1002);
        clipboard.text = 'BB';
        assert.ok((await pasteSelection('insert-after')).ok);
        assert.deepStrictEqual(bytes(), [0x11, 0x22, 0x33, 0xBB, 0x44]);
    });

    test('paste at an unmapped address creates a new segment', async () => {
        reset();
        clipboard.text = 'DE AD';
        assert.ok((await pasteAtAddress(0x2000)).ok);
        assert.strictEqual(getByte(0x2000), 0xDE);
        assert.strictEqual(getByte(0x2001), 0xAD);
        assert.strictEqual(getByte(0x1003), 0x44);
    });

    test('cut copies then removes the selected bytes', async () => {
        reset();
        select(0x1001, 0x1002);
        const result = await cutSelection();
        assert.ok(result.ok);
        assert.strictEqual(clipboard.text, '22 33');
        assert.deepStrictEqual(bytes(), [0x11, 0x44]);
        assert.strictEqual(S.structuralDirty, true);
    });

    test('cut refuses to delete when the clipboard write fails', async () => {
        reset();
        select(0x1001, 0x1002);
        clipboard.failWrite = true;
        const result = await cutSelection();
        assert.strictEqual(result.ok, false);
        assert.deepStrictEqual(bytes(), [0x11, 0x22, 0x33, 0x44]);
        assert.strictEqual(S.structuralDirty, false);
    });

    test('region copy does not change the selection or document', async () => {
        reset();
        select(0x1000, 0x1000);
        const result = await copyRegion(0x1001, 0x1002);
        assert.ok(result.ok);
        assert.strictEqual(clipboard.text, '22 33');
        assert.deepStrictEqual(bytes(), [0x11, 0x22, 0x33, 0x44]);
        assert.deepStrictEqual([S.selStart, S.selEnd], [0x1000, 0x1000]);
    });

    test('region cut removes only the inclusive region', async () => {
        reset();
        const result = await cutRegion(0x1001, 0x1002);
        assert.ok(result.ok);
        assert.strictEqual(clipboard.text, '22 33');
        assert.deepStrictEqual(bytes(), [0x11, 0x44]);
    });

    test('invalid region is rejected', async () => {
        reset();
        const result = await cutRegion(0x1002, 0x1001);
        assert.strictEqual(result.ok, false);
    });

    test('cut and paste require edit mode', async () => {
        reset();
        S.editMode = false;
        select(0x1000, 0x1000);
        clipboard.text = 'AA';
        assert.strictEqual((await cutSelection()).ok, false);
        assert.strictEqual((await pasteSelection('replace')).ok, false);
        assert.strictEqual((await pasteAtAddress(0x1000)).ok, false);
    });

    test('raw binary refuses a target outside its single segment', () => {
        reset();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: Uint8Array.from([1, 2]) }],
            totalDataBytes: 2,
            checksumErrors: 0,
            malformedLines: 0,
            format: 'bin',
        };
        initFlatBytes();
        assert.strictEqual(applyStructuralInsert(0x2000, [3]), false);
        assert.strictEqual(getByte(0x2000), undefined);
        assert.strictEqual(applyStructuralInsert(0x1001, [9]), true);
        assert.deepStrictEqual(Array.from(S.parseResult.segments[0].data), [1, 9, 2]);
    });

    test('structural replace/delete are undoable as one transaction', () => {
        reset();
        assert.ok(applyStructuralReplace(0x1001, 0x1002, [0xAA, 0xBB, 0xCC]));
        assert.deepStrictEqual(bytes(), [0x11, 0xAA, 0xBB, 0xCC, 0x44]);
        assert.ok(applyStructuralDelete(0x1000, 0x1000));
        assert.deepStrictEqual(bytes(), [0xAA, 0xBB, 0xCC, 0x44]);
        assert.ok(undoLastEditTransaction());
        assert.deepStrictEqual(bytes(), [0x11, 0xAA, 0xBB, 0xCC, 0x44]);
        assert.ok(undoLastEditTransaction());
        assert.deepStrictEqual(bytes(), [0x11, 0x22, 0x33, 0x44]);
    });

    test('structural edits remap pending byte edits and undo restores them', () => {
        reset();
        S.edits.set(0x1003, 0xEE);
        assert.ok(applyStructuralInsert(0x1001, [0xAA]));
        assert.strictEqual(S.edits.has(0x1003), false);
        assert.strictEqual(S.edits.get(0x1004), 0xEE);
        assert.ok(undoLastEditTransaction());
        assert.strictEqual(S.edits.get(0x1003), 0xEE);
        assert.strictEqual(S.edits.has(0x1004), false);
    });
});

suite('clipboard edit helpers', () => {
    setup(() => {
        clipboard = new FakeClipboard();
        Object.defineProperty(globalThis, 'navigator', {
            value: { clipboard },
            configurable: true,
            writable: true,
        });
        reset();
    });

    teardown(reset);

    test('copySelection writes hex or ASCII and leaves the document alone', async () => {
        select(0x1000, 0x1001);
        assert.ok((await copySelection('hex')).ok);
        assert.strictEqual(clipboard.text, '11 22');
        assert.ok((await copySelection('ascii')).ok);
        assert.strictEqual(clipboard.text, '."');
        assert.deepStrictEqual(bytes(), [0x11, 0x22, 0x33, 0x44]);
    });

    test('replace with a shorter clipboard shrinks the document', async () => {
        select(0x1000, 0x1003);
        clipboard.text = 'AA';
        const result = await pasteSelection('replace');
        assert.ok(result.ok);
        assert.deepStrictEqual(bytes(), [0xAA]);
        assert.strictEqual(S.structuralDirty, true);
    });

    test('mappedSelectionBounds skips gaps and reports the mapped span', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x1000, data: Uint8Array.from([1, 2]) },
                { startAddress: 0x1010, data: Uint8Array.from([3, 4]) },
            ],
            totalDataBytes: 4,
            checksumErrors: 0,
            malformedLines: 0,
            format: 'ihex',
        };
        initFlatBytes();
        select(0x0FFF, 0x1011);
        assert.deepStrictEqual(mappedSelectionBounds(), { start: 0x1000, end: 0x1011 });
        select(0x1002, 0x100F);
        assert.strictEqual(mappedSelectionBounds(), null);
    });

    test('effectiveSegments folds the pending byte overlay into a copy', () => {
        S.edits.set(0x1001, 0xEE);
        const segments = effectiveSegments();
        assert.deepStrictEqual(Array.from(segments[0].data), [0x11, 0xEE, 0x33, 0x44]);
        assert.deepStrictEqual(Array.from(S.parseResult!.segments[0].data), [0x11, 0x22, 0x33, 0x44]);
    });
});

suite('clipboard edit edge cases', () => {
    setup(() => {
        clipboard = new FakeClipboard();
        Object.defineProperty(globalThis, 'navigator', {
            value: { clipboard },
            configurable: true,
            writable: true,
        });
        reset();
    });

    teardown(reset);

    test('copy reads pending byte edits, not just the base segments', async () => {
        select(0x1000, 0x1001);
        S.edits.set(0x1001, 0xEE);
        assert.ok((await copySelection('hex')).ok);
        assert.strictEqual(clipboard.text, '11 EE');
    });

    test('insert/replace refuse to overflow the 32-bit address space', () => {
        assert.strictEqual(applyStructuralInsert(0xFFFFFFFF, [1, 2]), false);
        assert.strictEqual(applyStructuralReplace(0xFFFFFFFF, 0xFFFFFFFF, [1, 2]), false);
        assert.deepStrictEqual(bytes(), [0x11, 0x22, 0x33, 0x44]);
    });

    test('discard restores the saved segments and clears structural dirtiness', () => {
        assert.ok(applyStructuralReplace(0x1001, 0x1002, [0xAA, 0xBB, 0xCC]));
        assert.strictEqual(S.structuralDirty, true);
        clearEditModel();
        assert.deepStrictEqual(bytes(), [0x11, 0x22, 0x33, 0x44]);
        assert.strictEqual(S.structuralDirty, false);
        assert.strictEqual(S.editMode, false);
    });

    test('undo of the only structural edit clears structural dirtiness', () => {
        assert.ok(applyStructuralInsert(0x1001, [0xAA]));
        assert.strictEqual(S.structuralDirty, true);
        assert.ok(undoLastEditTransaction());
        assert.strictEqual(S.structuralDirty, false);
        assert.ok(redoLastEditTransaction());
        assert.strictEqual(S.structuralDirty, true);
    });
});
