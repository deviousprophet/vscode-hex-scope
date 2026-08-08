import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../cssImportHook';

import type { SerializedRecord } from '../../../core/types';
import {
    RecordView,
    renderRecordEmptyHtml,
    renderRecordViewHtml,
    type RecordViewRenderInput,
} from '../../../webview/components/recordView/recordView';

let currentDom: JSDOM | null = null;

function installDom(): JSDOM {
    const dom = new JSDOM('<!doctype html><html><body><div id="record-view"></div></body></html>', { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as { window: Window; document: Document };
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    return dom;
}

function cleanupDom(): void {
    if (currentDom) {
        currentDom.window.close();
        currentDom = null;
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
    }
}

function record(overrides: Partial<SerializedRecord> = {}): SerializedRecord {
    return {
        lineNumber: 1,
        raw: ':0400000001020304F2',
        byteCount: 4,
        address: 0,
        recordType: 0,
        data: [1, 2, 3, 4],
        checksum: 0xF2,
        checksumValid: true,
        resolvedAddress: 0x08000000,
        ...overrides,
    };
}

function input(overrides: Partial<RecordViewRenderInput> = {}): RecordViewRenderInput {
    return {
        format: 'ihex',
        records: [record()],
        recordOffset: 0,
        totalHeight: 28,
        containerHeight: 280,
        windowTop: 0,
        compressed: false,
        topSpacer: 0,
        bottomSpacer: 0,
        ...overrides,
    };
}

suite('RecordView pure render', () => {
    test('renders table with thead and an ihex data row', () => {
        const dom = new JSDOM('<!doctype html><html><body><div id="rv"></div></body></html>', { url: 'https://hexscope.test/' });
        const div = dom.window.document.getElementById('rv')!;
        div.innerHTML = renderRecordViewHtml(input());

        const table = div.querySelector('table.rtbl')!;
        assert.ok(table, 'renders table.rtbl');
        assert.deepStrictEqual(
            Array.from(div.querySelectorAll('thead th')).map(th => th.textContent),
            ['Addr', 'Type', 'Cnt', 'Data', 'CHK'],
        );

        const row = div.querySelector('tbody tr')!;
        assert.ok(row, 'renders a real table row (not escaped text)');
        assert.strictEqual(row.className, '');
        assert.strictEqual(row.querySelector('.raddr')!.textContent, '08000000');
        assert.strictEqual(row.querySelector('.rbadge')!.className, 'rbadge rb-data');
        assert.strictEqual(row.querySelector('.rbadge')!.textContent, 'DATA');
        assert.strictEqual(row.querySelector('.rcnt')!.textContent, '4');
        assert.strictEqual(row.querySelector('.rdata')!.textContent, '01 02 03 04');
        assert.strictEqual(row.querySelector('.cok')!.textContent, 'F2');
        dom.window.close();
    });

    test('renders error row with dashed checksum and escaped message', () => {
        const dom = new JSDOM('<!doctype html><html><body><div id="rv"></div></body></html>', { url: 'https://hexscope.test/' });
        const div = dom.window.document.getElementById('rv')!;
        div.innerHTML = renderRecordViewHtml(input({
            records: [record({ error: '<bad> & record', checksumValid: false })],
        }));

        const row = div.querySelector('tbody tr')!;
        assert.ok(row.classList.contains('rerr'));
        assert.strictEqual(row.querySelector('.rdata')!.className, 'rdata rerr-msg');
        assert.strictEqual(row.querySelector('.rdata')!.textContent, '<bad> & record');
        assert.strictEqual(row.querySelector('.rbadge')!.className, 'rbadge rb-bad');
        assert.strictEqual(row.querySelector('.rerr-dash')!.textContent, '—');
        assert.strictEqual(row.querySelector('.cerr'), null);
        dom.window.close();
    });

    test('renders checksum error cell with tag when checksum is invalid', () => {
        const dom = new JSDOM('<!doctype html><html><body><div id="rv"></div></body></html>', { url: 'https://hexscope.test/' });
        const div = dom.window.document.getElementById('rv')!;
        div.innerHTML = renderRecordViewHtml(input({ records: [record({ checksumValid: false })] }));

        const row = div.querySelector('tbody tr')!;
        assert.ok(row.classList.contains('rerr'));
        assert.strictEqual(row.querySelector('.cerr')!.textContent, 'F2');
        assert.strictEqual(row.querySelector('.cerr-tag')!.textContent, 'checksum error');
        assert.strictEqual(row.querySelector('.cok'), null);
        dom.window.close();
    });

    test('renders srec rows with srec labels, badges and empty addresses', () => {
        const dom = new JSDOM('<!doctype html><html><body><div id="rv"></div></body></html>', { url: 'https://hexscope.test/' });
        const div = dom.window.document.getElementById('rv')!;
        div.innerHTML = renderRecordViewHtml(input({
            format: 'srec',
            records: [
                record({ recordType: 0 }),
                record({ recordType: 1, resolvedAddress: 0x1234 }),
                record({ recordType: 7 }),
                record({ recordType: 9 }),
            ],
        }));

        const rows = div.querySelectorAll('tbody tr');
        assert.strictEqual(rows.length, 4);
        assert.strictEqual(rows[0].querySelector('.rbadge')!.textContent, 'HEADER');
        assert.ok(rows[0].querySelector('.rbadge')!.classList.contains('rb-ext'));
        assert.strictEqual(rows[0].querySelector('.raddr')!.className, 'raddr raddr-empty');
        assert.strictEqual(rows[0].querySelector('.raddr')!.textContent, '—');
        assert.strictEqual(rows[1].querySelector('.rbadge')!.textContent, 'DATA S1');
        assert.ok(rows[1].querySelector('.rbadge')!.classList.contains('rb-data'));
        assert.strictEqual(rows[1].querySelector('.raddr')!.textContent, '00001234');
        assert.strictEqual(rows[2].querySelector('.rbadge')!.textContent, 'END S7');
        assert.ok(rows[2].querySelector('.rbadge')!.classList.contains('rb-eof'));
        assert.strictEqual(rows[3].querySelector('.rbadge')!.textContent, 'END S9');
        dom.window.close();
    });

    test('renders placeholder row for unloaded (null) records', () => {
        const dom = new JSDOM('<!doctype html><html><body><div id="rv"></div></body></html>', { url: 'https://hexscope.test/' });
        const div = dom.window.document.getElementById('rv')!;
        div.innerHTML = renderRecordViewHtml(input({ records: [null, record(), null], recordOffset: 100 }));

        const rows = div.querySelectorAll('tbody tr');
        assert.strictEqual(rows.length, 3);
        const placeholder = div.querySelector('tr.record-loading')!;
        assert.strictEqual(placeholder.querySelector('td')!.colSpan, 5);
        assert.strictEqual(placeholder.textContent, 'Loading…');
        dom.window.close();
    });

    test('renders capped spacer rows in uncompressed mode', () => {
        const dom = new JSDOM('<!doctype html><html><body><div id="rv"></div></body></html>', { url: 'https://hexscope.test/' });
        const div = dom.window.document.getElementById('rv')!;
        div.innerHTML = renderRecordViewHtml(input({ topSpacer: 1_100_000, bottomSpacer: 500, recordOffset: 100 }));

        const tbody = div.querySelector('tbody')!;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const spacer = rows.filter(r => r.getAttribute('style')?.includes('height'));
        assert.strictEqual(spacer.length, 3, '1M px cap chunks the top spacer + one bottom spacer row');
        assert.ok(spacer[0].getAttribute('style')!.includes('1000000px'));
        assert.ok(spacer[1].getAttribute('style')!.includes('100000px'));
        assert.ok(spacer[2].getAttribute('style')!.includes('500px'));
        assert.strictEqual(spacer[0].querySelector('td')!.colSpan, 5);
        dom.window.close();
    });

    test('compressed mode wraps table in relative container at windowTop without spacers', () => {
        const dom = new JSDOM('<!doctype html><html><body><div id="rv"></div></body></html>', { url: 'https://hexscope.test/' });
        const div = dom.window.document.getElementById('rv')!;
        div.innerHTML = renderRecordViewHtml(input({
            compressed: true,
            totalHeight: 1000,
            windowTop: 42,
            topSpacer: 999,
            bottomSpacer: 999,
            records: [record(), null],
        }));

        const wrapper = div.querySelector('div[style*="relative"]')!;
        assert.ok(wrapper, 'compressed mode renders a relative wrapper');
        assert.ok(wrapper.getAttribute('style')!.includes('height:1000px'));
        const table = wrapper.querySelector('table.rtbl')!;
        assert.strictEqual(table.getAttribute('style'), 'position:absolute;top:42px;left:0');
        assert.strictEqual(wrapper.querySelectorAll('tbody tr').length, 2, 'no spacer rows in compressed mode');
        assert.strictEqual(wrapper.querySelectorAll('tr[style*="height"]').length, 0);
        dom.window.close();
    });

    test('renderRecordEmptyHtml renders the unavailable node', () => {
        const dom = new JSDOM('<!doctype html><html><body><div id="rv"></div></body></html>', { url: 'https://hexscope.test/' });
        const div = dom.window.document.getElementById('rv')!;
        div.innerHTML = renderRecordEmptyHtml('not <loaded> & missing');

        const node = div.querySelector('.raw-problems')!;
        assert.ok(node, 'renders raw-problems wrapper');
        assert.strictEqual(node.querySelector('.raw-problems-title')!.textContent, 'Record View Unavailable');
        assert.strictEqual(node.textContent!.includes('not <loaded> & missing'), true);
        dom.window.close();
    });
});

suite('RecordView interaction', () => {
    let dom: JSDOM;

    setup(() => {
        dom = installDom();
        currentDom = dom;
    });

    teardown(() => {
        cleanupDom();
    });

    test('reports onScrollTop from the root scroll element (doc-delegated)', () => {
        const tops: number[] = [];
        const view = new RecordView('#record-view', { onScrollTop: top => { tops.push(top); } });
        view.mount();
        view.render(input({ records: [record(), null] }));

        const root = document.getElementById('record-view')!;
        root.scrollTop = 50;
        root.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }));
        assert.deepStrictEqual(tops, [50]);
    });

    test('reports onNeedPage for the unloaded range in the slice', () => {
        const needs: Array<[number, number]> = [];
        const view = new RecordView('#record-view', { onNeedPage: (first, last) => { needs.push([first, last]); } });
        view.mount();
        view.render(input({ records: [null, record(), null], recordOffset: 5 }));

        assert.deepStrictEqual(needs, [[5, 7]]);
    });

    test('does not report onNeedPage when the slice is fully loaded', () => {
        let called = 0;
        const view = new RecordView('#record-view', { onNeedPage: () => { called++; } });
        view.mount();
        view.render(input({ records: [record(), record()], recordOffset: 0 }));

        assert.strictEqual(called, 0);
    });

    test('renderEmpty replaces the root content', () => {
        const view = new RecordView('#record-view');
        view.mount();
        view.render(input());
        view.renderEmpty('Record details are not loaded in the webview. Use Memory view for navigation and editing.');

        const root = document.getElementById('record-view')!;
        assert.ok(root.querySelector('.raw-problems'));
        assert.strictEqual(root.querySelector('.rtbl'), null);
    });

    test('setCallbacks swaps the scroll reporter', () => {
        const first: number[] = [];
        const second: number[] = [];
        const view = new RecordView('#record-view', { onScrollTop: top => { first.push(top); } });
        view.mount();
        view.setCallbacks({ onScrollTop: top => { second.push(top); } });
        view.render(input());

        const root = document.getElementById('record-view')!;
        root.scrollTop = 7;
        root.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }));
        assert.deepStrictEqual(first, []);
        assert.deepStrictEqual(second, [7]);
    });
});
