import * as assert from 'assert';
import { structuralSegmentPayloads } from '../../hexEditorSession';

suite('structural save payload boundary', () => {
    test('accepts an empty list and valid segments', () => {
        assert.deepStrictEqual(structuralSegmentPayloads([]), []);
        const data = new ArrayBuffer(2);
        const result = structuralSegmentPayloads([{ startAddress: 0x1000, data }]);
        assert.ok(result);
        assert.strictEqual(result!.length, 1);
        assert.strictEqual(result![0].startAddress, 0x1000);
        assert.strictEqual(result![0].data, data);
    });

    test('rejects a non-array payload', () => {
        assert.strictEqual(structuralSegmentPayloads(null), null);
        assert.strictEqual(structuralSegmentPayloads({}), null);
        assert.strictEqual(structuralSegmentPayloads('nope'), null);
    });

    test('rejects invalid start addresses', () => {
        const data = new ArrayBuffer(1);
        for (const startAddress of [-1, 0x1_0000_0000, 1.5, NaN, '0x1000', undefined]) {
            assert.strictEqual(structuralSegmentPayloads([{ startAddress, data }]), null, String(startAddress));
        }
    });

    test('rejects non-ArrayBuffer data and any invalid item in the list', () => {
        assert.strictEqual(structuralSegmentPayloads([{ startAddress: 0x1000, data: new Uint8Array(1) }]), null);
        assert.strictEqual(structuralSegmentPayloads([{ startAddress: 0x1000, data: new ArrayBuffer(1) }, null]), null);
        assert.strictEqual(structuralSegmentPayloads([{ startAddress: 0x1000, data: new ArrayBuffer(1) }, { startAddress: 0x1001 }]), null);
    });
});
