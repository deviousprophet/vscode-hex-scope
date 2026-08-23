import * as assert from 'assert';

import { formatDecimal, formatHex, formatHexHtml, asUint64, flashCopied, inlineConfirm } from '../../webview/utils';
import { JSDOM } from 'jsdom';

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
        assert.strictEqual(formatHex(0x1, 4), '0x0001');
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

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('webview utils flashCopied', () => {
    let dom: JSDOM;

    setup(() => {
        dom = new JSDOM('<!doctype html><html><body><span id="t">0xAB</span></body></html>', { url: 'https://hexscope.test/' });
        Object.defineProperty(globalThis, 'window', {
            value: dom.window,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: dom.window.document,
            configurable: true,
            writable: true,
        });
    });

    teardown(() => {
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        dom.window.close();
    });

    test('flash swaps text to Copied and restores the original', async () => {
        const el = document.getElementById('t')!;
        flashCopied(el, true);
        assert.strictEqual(el.textContent, 'Copied');
        assert.ok(el.classList.contains('copied'));
        await sleep(1100);
        assert.strictEqual(el.textContent, '0xAB');
        assert.ok(!el.classList.contains('copied'));
    });

    test('rapid re-click resets the timer and restores the ORIGINAL text', async () => {
        const el = document.getElementById('t')!;
        flashCopied(el, true);
        await sleep(300);
        flashCopied(el, true); // re-click mid-flash
        assert.strictEqual(el.textContent, 'Copied');
        await sleep(1100);
        assert.strictEqual(el.textContent, '0xAB', 'restores the original text, not a stale "Copied"');
        assert.ok(!el.classList.contains('copied'));
    });

    test('stale restore is skipped when the element was re-rendered mid-flash', async () => {
        const el = document.getElementById('t')!;
        flashCopied(el, true);
        const replacement = document.createElement('span');
        replacement.id = 't';
        replacement.textContent = '0xCD';
        el.replaceWith(replacement);
        await sleep(1100);
        const live = document.getElementById('t')!;
        assert.strictEqual(live.textContent, '0xCD', 're-rendered element keeps its own text');
        assert.ok(!live.classList.contains('copied'));
    });

    test('pending flash timer does not throw after the window closes (teardown race)', async () => {
        const el = document.getElementById('t')!;
        flashCopied(el, true);
        dom.window.close();
        await sleep(1150);
        assert.ok(true);
    });
});

suite('webview utils inlineConfirm teardown race', () => {
    let dom: JSDOM;

    setup(() => {
        dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hexscope.test/' });
        Object.defineProperty(globalThis, 'window', {
            value: dom.window,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: dom.window.document,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(globalThis, 'requestAnimationFrame', {
            value: (cb: FrameRequestCallback) => { cb(0); return 0; },
            configurable: true,
        });
    });

    teardown(() => {
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
        dom.window.close();
    });

    test('deferred outside-click listener does not throw after the window closes', async () => {
        const anchor = document.createElement('button');
        document.body.appendChild(anchor);
        inlineConfirm(anchor, () => {});
        dom.window.close();
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        await sleep(20);
        assert.ok(true);
    });
});
