import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import type { SerializedParseResult } from '../../core/types';
import { formatLabel, renderStats } from '../../webview/statsBar';

let currentDom: JSDOM | null = null;

function installDom(): JSDOM {
    const dom = new JSDOM('<!DOCTYPE html><body><div id="stats-bar"></div></body>', { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as { window: Window; document: Document };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    return dom;
}

function cleanupDom(dom: JSDOM): void {
    dom.window.close();
    delete (globalThis as unknown as { window?: Window }).window;
    delete (globalThis as unknown as { document?: Document }).document;
}

function parseResult(format: SerializedParseResult['format'], bytes: number): SerializedParseResult {
    return {
        records: [],
        recordCount: format === 'bin' ? 0 : 7,
        segments: [{ startAddress: 0x08000000, data: new Uint8Array(bytes) }],
        totalDataBytes: bytes,
        checksumErrors: 0,
        malformedLines: 0,
        format,
    };
}

/** Each stat as `label=value`; the format pill has no label. */
function statText(item: Element): string {
    const label = textOf(item, '.slb');
    const value = textOf(item, '.svl');
    return label ? `${label}=${value}` : value;
}

function textOf(item: Element, selector: string): string {
    return item.querySelector(selector)?.textContent ?? '';
}

function stats(dom: JSDOM): string[] {
    return [...dom.window.document.querySelectorAll('#stats-bar .si')].map(statText);
}

suite('webview stats bar', () => {
    teardown(() => {
        if (currentDom) { cleanupDom(currentDom); currentDom = null; }
    });

    test('raw binaries show BIN, bytes, and segments without a record count', () => {
        currentDom = installDom();
        renderStats(parseResult('bin', 1024));
        assert.deepStrictEqual(stats(currentDom), ['BIN', 'Bytes=1.0 KB', 'Segments=1']);
    });

    test('raw binaries never show a base address in the stats bar', () => {
        currentDom = installDom();
        const result = parseResult('bin', 16);
        result.baseAddress = 0x08000000;
        renderStats(result);

        assert.deepStrictEqual(stats(currentDom), ['BIN', 'Bytes=16 B', 'Segments=1']);
        assert.strictEqual(currentDom.window.document.getElementById('stats-base-change'), null);
        assert.strictEqual(currentDom.window.document.querySelector('.base-change'), null);
    });

    test('text formats render no base-change button', () => {
        currentDom = installDom();
        renderStats(parseResult('ihex', 8));

        assert.strictEqual(currentDom.window.document.getElementById('stats-base-change'), null);
        assert.deepStrictEqual(stats(currentDom), ['IHEX', 'Bytes=8 B', 'Records=7', 'Segments=1']);
    });

    test('an empty raw image reports zero bytes and zero segments', () => {
        currentDom = installDom();
        const empty: SerializedParseResult = {
            records: [], recordCount: 0, segments: [], totalDataBytes: 0,
            checksumErrors: 0, malformedLines: 0, baseAddress: 0x1000, format: 'bin',
        };
        renderStats(empty);
        assert.deepStrictEqual(stats(currentDom), ['BIN', 'Bytes=0 B', 'Segments=0']);
    });

    test('text formats keep the record count in the stats bar', () => {
        currentDom = installDom();
        renderStats(parseResult('ihex', 8));
        assert.deepStrictEqual(stats(currentDom), ['IHEX', 'Bytes=8 B', 'Records=7', 'Segments=1']);

        renderStats(parseResult('srec', 8));
        assert.deepStrictEqual(stats(currentDom), ['SREC', 'Bytes=8 B', 'Records=7', 'Segments=1']);
    });

    test('formatLabel maps all supported formats', () => {
        assert.strictEqual(formatLabel('bin'), 'BIN');
        assert.strictEqual(formatLabel('ihex'), 'IHEX');
        assert.strictEqual(formatLabel('srec'), 'SREC');
    });

    test('a null result leaves the stats bar untouched', () => {
        currentDom = installDom();
        const el = currentDom.window.document.getElementById('stats-bar')!;
        el.textContent = 'stale';
        renderStats(null);
        assert.strictEqual(el.textContent, 'stale');
    });
});
