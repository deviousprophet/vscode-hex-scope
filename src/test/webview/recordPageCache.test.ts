import * as assert from 'assert';
import type { SerializedRecord } from '../../core/types';
import { RecordPageCache } from '../../webview/recordPageCache';
import { RECORD_PAGE_SIZE } from '../../webviewProtocol';

function record(lineNumber: number): SerializedRecord {
    return {
        lineNumber,
        raw: ':00000001FF',
        byteCount: 0,
        address: 0,
        recordType: 1,
        data: [],
        checksum: 0xFF,
        checksumValid: true,
        resolvedAddress: 0,
    };
}

suite('RecordPageCache', () => {
    test('validates alignment and suppresses duplicate requests', () => {
        const cache = new RecordPageCache();
        cache.reset(2);
        assert.strictEqual(cache.request(1, 2_000), false);
        assert.strictEqual(cache.request(RECORD_PAGE_SIZE, 2_000), true);
        assert.strictEqual(cache.request(RECORD_PAGE_SIZE, 2_000), false);
    });

    test('rejects stale generations', () => {
        const cache = new RecordPageCache();
        cache.reset(3);
        assert.strictEqual(cache.accept(2, 0, [record(1)]), false);
        assert.strictEqual(cache.get(0), undefined);
    });

    test('evicts least-recently-used pages', () => {
        const cache = new RecordPageCache(2);
        cache.reset(1);
        cache.accept(1, 0, [record(1)]);
        cache.accept(1, RECORD_PAGE_SIZE, [record(2)]);
        assert.strictEqual(cache.get(0)?.lineNumber, 1);
        cache.accept(1, RECORD_PAGE_SIZE * 2, [record(3)]);
        assert.strictEqual(cache.get(RECORD_PAGE_SIZE), undefined);
        assert.strictEqual(cache.get(0)?.lineNumber, 1);
    });

    test('reset drops cached and pending pages', () => {
        const cache = new RecordPageCache();
        cache.reset(1);
        cache.request(0, 1_000);
        cache.accept(1, 0, [record(1)]);
        cache.reset(2);
        assert.strictEqual(cache.get(0), undefined);
        assert.strictEqual(cache.request(0, 1_000), true);
    });
});
