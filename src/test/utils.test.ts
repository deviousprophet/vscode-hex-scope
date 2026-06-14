import * as assert from 'assert';

import { formatDecimal, formatHex, formatHexHtml, asUint64 } from '../webview/utils';

suite('webview utils formatting', () => {
    test('formatDecimal number uses en locale grouping', () => {
        assert.strictEqual(formatDecimal(1234), '1,234');
        assert.strictEqual(formatDecimal(42), '42');
    });

    test('formatDecimal preserves BigInt precision', () => {
        assert.strictEqual(formatDecimal(12345678901234567890n), '12345678901234567890');
    });

    test('formatHex produces padded uppercase hex with 0x prefix', () => {
        assert.strictEqual(formatHex(0xFF, 2), '0xFF');
        assert.strictEqual(formatHex(0x1, 4), '0x0000');
        assert.strictEqual(formatHex(0xABCDEF01, 8), '0xABCDEF01');
    });

    test('formatHex handles BigInt correctly', () => {
        assert.strictEqual(formatHex(1n, 16), '0x0000000000000001');
    });

    test('formatHexHtml splits prefix and body into spans', () => {
        const html = formatHexHtml('0x1A2B');
        assert.ok(html.includes('<span class="si-hex-prefix">0x</span>'));
        assert.ok(html.includes('<span class="si-hex-body">1A2B</span>'));
    });

    test('asUint64 converts negative BigInt to two\'s-complement unsigned', () => {
        const u = asUint64(-1n);
        assert.strictEqual(u, BigInt('0xFFFFFFFFFFFFFFFF'));
    });
});
