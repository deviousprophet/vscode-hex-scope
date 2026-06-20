import * as assert from 'assert';
import { JSDOM } from 'jsdom';

import { esc, fmtB, byteClass } from '../webview/utils';
import { S, BPR } from '../webview/state';
import { initFlatBytes, buildMemRows, getByte } from '../webview/data';
import { rerender } from '../webview/render';
import {
    calcRowOffset,
    calcScrollLayout,
    calcTotalHeight,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollState,
} from '../webview/virtualScroll';

function resetState(): void {
    S.parseResult  = null;
    S.labels       = [];
    S.segmentIndex = [];
    S.memRows      = [];
    S.selStart     = null;
    S.selEnd       = null;
    S.matchAddrs   = [];
    S.matchIdx     = -1;
    S.currentView  = 'memory';
    S.editMode     = false;
    S.edits.clear();
    S.undoStack.length = 0;
    S.structs          = [];

    S.activeStructAddr = null;
    S.structPins       = [];
    S.sidebarTab       = 'inspector';
}

function installWebviewDom(markup: string): JSDOM {
    const dom = new JSDOM(markup);
    const globals = globalThis as unknown as {
        window: Window;
        document: Document;
        getComputedStyle: typeof getComputedStyle;
        acquireVsCodeApi: () => unknown;
    };
    globals.window = dom.window as unknown as Window;
    globals.document = dom.window.document as unknown as Document;
    globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    globals.acquireVsCodeApi = () => ({
        postMessage: (_msg: unknown) => {},
        getState: () => ({}),
        setState: (_state: unknown) => {},
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
        value: () => {},
        configurable: true,
    });
    return dom;
}

function cleanupWebviewDom(dom: JSDOM): void {
    resetState();
    dom.window.close();
    delete (globalThis as unknown as { window?: Window }).window;
    delete (globalThis as unknown as { document?: Document }).document;
    delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
    delete (globalThis as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi;
}

// ── HTML escaping ───────────────────────────────────────────────

suite('esc()', () => {
    test('plain text is returned unchanged', () => {
        assert.strictEqual(esc('Hello, World!'), 'Hello, World!');
    });
    test('empty string is returned unchanged', () => {
        assert.strictEqual(esc(''), '');
    });
    test('& is escaped to &amp;', () => {
        assert.strictEqual(esc('bread & butter'), 'bread &amp; butter');
    });
    test('< and > are escaped', () => {
        assert.strictEqual(esc('<em>'), '&lt;em&gt;');
    });
    test('" is escaped to &quot;', () => {
        assert.strictEqual(esc('"quoted"'), '&quot;quoted&quot;');
    });
    test('all special characters together', () => {
        assert.strictEqual(esc('<a href="x&y">'), '&lt;a href=&quot;x&amp;y&quot;&gt;');
    });
});

// ── Byte size formatting ────────────────────────────────────────

suite('fmtB()', () => {
    test('0 bytes', () => { assert.strictEqual(fmtB(0), '0 B'); });
    test('1 byte', () => { assert.strictEqual(fmtB(1), '1 B'); });
    test('1023 bytes stays in B', () => { assert.strictEqual(fmtB(1023), '1023 B'); });
    test('1024 bytes is 1.0 KB', () => { assert.strictEqual(fmtB(1024), '1.0 KB'); });
    test('1536 bytes is 1.5 KB', () => { assert.strictEqual(fmtB(1536), '1.5 KB'); });
    test('1 MB', () => { assert.strictEqual(fmtB(1024 * 1024), '1.0 MB'); });
    test('2.5 MB', () => { assert.strictEqual(fmtB(1024 * 1024 * 2.5), '2.5 MB'); });
});

// ── Byte CSS class ──────────────────────────────────────────────

suite('byteClass()', () => {
    test('0x00 → "bz" (zero)', () => {
        assert.strictEqual(byteClass(0x00), 'bz');
    });
    test('0x20 (space) → "bp" (printable)', () => {
        assert.strictEqual(byteClass(0x20), 'bp');
    });
    test('0x41 ("A") → "bp"', () => {
        assert.strictEqual(byteClass(0x41), 'bp');
    });
    test('0x7E ("~") → "bp"', () => {
        assert.strictEqual(byteClass(0x7E), 'bp');
    });
    test('0x7F (DEL) → "bn" (non-printable)', () => {
        assert.strictEqual(byteClass(0x7F), 'bn');
    });
    test('0x01 (control) → "bn"', () => {
        assert.strictEqual(byteClass(0x01), 'bn');
    });
    test('0x80 → "bh" (high byte)', () => {
        assert.strictEqual(byteClass(0x80), 'bh');
    });
    test('0xFF → "bh"', () => {
        assert.strictEqual(byteClass(0xFF), 'bh');
    });
});

// ── State initial values ────────────────────────────────────────

suite('state constants and defaults', () => {
    test('BPR is 16', () => {
        assert.strictEqual(BPR, 16);
    });
    test('default view is "memory"', () => {
        assert.strictEqual(S.currentView, 'memory');
    });
    test('default byte order is little-endian', () => {
        assert.strictEqual(S.endian, 'le');
    });
    test('default bit-field allocation is MSB-first', () => {
        assert.strictEqual(S.bitFieldAllocation, 'msb');
    });
    test('default search mode is "bytes"', () => {
        assert.strictEqual(S.searchMode, 'bytes');
    });
});

// ── initFlatBytes() / segment index ─────────────────────────────

suite('initFlatBytes() - segment index', () => {
    setup(resetState);

    test('clears index when parseResult is null', () => {
        initFlatBytes();
        assert.strictEqual(S.segmentIndex.length, 0);
    });

    test('builds index from a single segment', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xDE, 0xAD, 0xBE, 0xEF] }],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        assert.strictEqual(S.segmentIndex.length, 1);
        assert.strictEqual(S.segmentIndex[0].startAddr, 0x1000);
        assert.strictEqual(S.segmentIndex[0].endAddr, 0x1003);
    });

    test('getByte returns correct values from single segment', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xDE, 0xAD, 0xBE, 0xEF] }],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        assert.strictEqual(getByte(0x1000), 0xDE);
        assert.strictEqual(getByte(0x1001), 0xAD);
        assert.strictEqual(getByte(0x1002), 0xBE);
        assert.strictEqual(getByte(0x1003), 0xEF);
        assert.strictEqual(getByte(0x1004), undefined);
    });

    test('getByte works with two non-contiguous segments', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0000, data: [0x01, 0x02] },
                { startAddress: 0x0200, data: [0x03, 0x04] },
            ],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        assert.strictEqual(getByte(0x0000), 0x01);
        assert.strictEqual(getByte(0x0001), 0x02);
        assert.strictEqual(getByte(0x0100), undefined);
        assert.strictEqual(getByte(0x0200), 0x03);
        assert.strictEqual(getByte(0x0201), 0x04);
    });

    test('segmentIndex is in ascending address order', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0300, data: [0xAA] },
                { startAddress: 0x0100, data: [0xBB] },
            ],
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        assert.strictEqual(S.segmentIndex[0].startAddr, 0x0100);
        assert.strictEqual(S.segmentIndex[1].startAddr, 0x0300);
    });
});

// ── buildMemRows() ──────────────────────────────────────────────

suite('buildMemRows()', () => {
    setup(resetState);

    test('produces no rows when parseResult is empty', () => {
        buildMemRows();
        assert.strictEqual(S.memRows.length, 0);
    });

    test('a single 16-byte segment produces one data row, no gap', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x0000, data: new Array(16).fill(0xAA) }],
            totalDataBytes: 16, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        buildMemRows();
        assert.strictEqual(S.memRows.filter(r => r.type === 'data').length, 1);
        assert.strictEqual(S.memRows.filter(r => r.type === 'gap').length, 0);
    });

    test('data row addresses are BPR-aligned', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x0007, data: [0x01, 0x02, 0x03] }],
            totalDataBytes: 3, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        buildMemRows();
        const row = S.memRows.find(r => r.type === 'data');
        assert.ok(row && row.type === 'data');
        assert.strictEqual(row.address % BPR, 0);
    });

    test('two adjacent BPR-rows produce no gap', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x0000, data: new Array(32).fill(0xFF) }],
            totalDataBytes: 32, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        buildMemRows();
        assert.strictEqual(S.memRows.filter(r => r.type === 'gap').length, 0);
        assert.strictEqual(S.memRows.filter(r => r.type === 'data').length, 2);
    });

    test('address skip of one BPR row inserts exactly one gap row', () => {
        // row 0x0000 and row 0x0020 with row 0x0010 missing
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0000, data: [0x01] },
                { startAddress: 0x0020, data: [0x02] },
            ],
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        buildMemRows();
        const gaps = S.memRows.filter(r => r.type === 'gap');
        assert.strictEqual(gaps.length, 1);
        const g = gaps[0];
        assert.ok(g.type === 'gap');
        assert.strictEqual(g.from, 0x0010);
        assert.strictEqual(g.to, 0x001F);
        assert.strictEqual(g.bytes, 16);
    });

    test('rows are ordered by ascending address regardless of segment order', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0040, data: [0x01] },
                { startAddress: 0x0000, data: [0x02] },
            ],
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        buildMemRows();
        const dataRows = S.memRows.filter(r => r.type === 'data');
        assert.ok(dataRows.length >= 2);
        for (let i = 1; i < dataRows.length; i++) {
            assert.ok(dataRows[i].type === 'data' && dataRows[i - 1].type === 'data');
            assert.ok(dataRows[i].address > dataRows[i - 1].address);
        }
    });
});

suite('virtual scroll metrics', () => {
    setup(resetState);

    test('recalculates cached offsets when row heights change', () => {
        S.memRows = [
            { type: 'data', address: 0x0000 },
            { type: 'gap', from: 0x0010, to: 0x001F, bytes: 16 },
            { type: 'data', address: 0x0020 },
        ];

        const state: VirtualScrollState = {
            containerHeight: 100,
            rowHeight: 20,
            gapHeight: 30,
            scrollTop: 0,
            bufferSize: 10,
            visibleRowIndices: [0, 0],
        };

        assert.strictEqual(calcTotalHeight(state), 70);

        state.rowHeight = 32;
        state.gapHeight = 52;

        assert.strictEqual(calcTotalHeight(state), 116);
        assert.strictEqual(calcRowOffset(2, state), 84);
    });

    test('maps large logical scroll ranges onto capped physical height', () => {
        S.memRows = Array.from({ length: 200_000 }, (_, i) => ({ type: 'data', address: i * BPR }));

        const state: VirtualScrollState = {
            containerHeight: 100,
            rowHeight: 100,
            gapHeight: 150,
            scrollTop: 0,
            bufferSize: 10,
            visibleRowIndices: [0, 0],
        };

        const layout = calcScrollLayout(state);
        assert.strictEqual(layout.totalHeight, 20_000_000);
        assert.strictEqual(layout.physicalHeight, 16_000_000);
        assert.strictEqual(layout.isCompressed, true);

        assert.strictEqual(logicalToPhysicalScroll(layout.logicalScrollable, state), layout.physicalScrollable);
        assert.strictEqual(physicalToLogicalScroll(layout.physicalScrollable, state), layout.logicalScrollable);
    });
});

suite('Memory View navigation', () => {
    let dom: JSDOM;

    setup(() => {
        resetState();
        dom = installWebviewDom(`<!doctype html><html><body>
            <div id="mem-header"></div>
            <div id="mem-scroll"><div id="mem-rows"></div></div>
        </body></html>`);
        Object.defineProperty(document.getElementById('mem-scroll')!, 'clientHeight', {
            value: 600,
            configurable: true,
        });

        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x08000000, data: new Array(128).fill(0) },
                { startAddress: 0x080000C0, data: new Array(70).fill(0) },
                { startAddress: 0x08000100, data: new Array(48).fill(0) },
                { startAddress: 0x08010000, data: new Array(16).fill(0) },
            ],
            totalDataBytes: 262,
            checksumErrors: 0,
            malformedLines: 0,
            format: 'ihex',
        };
        initFlatBytes();
        buildMemRows();
    });

    teardown(() => {
        cleanupWebviewDom(dom);
    });

    test('keeps all rows rendered when jumping in a viewport taller than the content', async () => {
        const { renderMemBody, scrollTo } = await import('../webview/memoryView.js');
        renderMemBody(() => {}, () => {});

        scrollTo(0x08010000);

        assert.strictEqual(document.getElementById('mem-scroll')!.scrollTop, 0);
        assert.ok(document.querySelector('.data-row[data-row="134217728"]'), 'first row should remain rendered');
        assert.ok(document.querySelector('.data-row[data-row="134283264"]'), 'target row should be rendered');
    });
});

suite('Parsed Segment Navigator', () => {
    let dom: JSDOM;
    let originalJumpTo: typeof rerender.jumpTo;

    setup(() => {
        resetState();
        dom = installWebviewDom('<!doctype html><html><body><div class="sb-section" id="s-segments"></div></body></html>');
        originalJumpTo = rerender.jumpTo;
    });

    teardown(() => {
        rerender.jumpTo = originalJumpTo;
        cleanupWebviewDom(dom);
    });

    test('sorts segments, renders inclusive ranges and size, and jumps to start', async () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x2000, data: [1, 2, 3, 4] },
                { startAddress: 0x1000, data: [5, 6] },
            ],
            totalDataBytes: 6,
            checksumErrors: 0,
            malformedLines: 0,
            format: 'ihex',
        };
        let jumpedTo: number | null = null;
        rerender.jumpTo = address => { jumpedTo = address; };

        const { renderSegments } = await import('../webview/sidebar.js');
        renderSegments();

        const items = document.querySelectorAll<HTMLElement>('.segment-item');
        assert.strictEqual(items.length, 2);
        assert.strictEqual(document.querySelector('.sb-badge')!.textContent, '2');
        assert.strictEqual(items[0].querySelector('.segment-nm')!.textContent, 'Segment 1');
        assert.strictEqual(items[0].querySelector('.segment-rng')!.textContent, '0x00001000–0x00001001 · 2 B');
        assert.strictEqual(items[1].querySelector('.segment-rng')!.textContent, '0x00002000–0x00002003 · 4 B');

        items[0].click();
        assert.strictEqual(jumpedTo, 0x1000);
    });

    test('renders empty state and preserves collapsed state', async () => {
        const { renderSegments } = await import('../webview/sidebar.js');
        renderSegments();

        const section = document.getElementById('s-segments')!;
        assert.strictEqual(section.dataset.collapsed, 'false');
        assert.strictEqual(section.querySelector('.sb-empty')?.textContent, 'No segments');
        assert.strictEqual(section.querySelector('.sb-badge'), null);

        section.querySelector<HTMLElement>('.sb-hdr')!.click();
        assert.strictEqual(section.dataset.collapsed, 'true');
        renderSegments();
        assert.strictEqual(section.dataset.collapsed, 'true');
        assert.ok(section.classList.contains('collapsed'));
    });
});

suite('Record View rendering', () => {
    let dom: JSDOM;

    setup(() => {
        resetState();
        dom = installWebviewDom('<!doctype html><html><body><div id="record-view"></div></body></html>');
    });

    teardown(() => {
        cleanupWebviewDom(dom);
    });

    test('renders records as table rows instead of escaped markup text', async () => {
        S.parseResult = {
            records: [
                {
                    lineNumber: 1,
                    raw: ':0400000001020304F2',
                    byteCount: 4,
                    address: 0,
                    recordType: 0,
                    data: [1, 2, 3, 4],
                    checksum: 0xF2,
                    checksumValid: true,
                    resolvedAddress: 0x08000000,
                },
            ],
            recordCount: 1,
            segments: [{ startAddress: 0x08000000, data: [1, 2, 3, 4] }],
            totalDataBytes: 4,
            checksumErrors: 0,
            malformedLines: 0,
            format: 'ihex',
        };

        const { renderRecordView } = await import('../webview/hexViewer.js');
        renderRecordView();

        const rows = document.querySelectorAll('#record-view tbody tr');
        assert.strictEqual(rows.length, 1, 'record view should render a real table row');
        assert.strictEqual(document.querySelector('#record-view .raddr')?.textContent, '08000000');
        assert.ok(!(document.getElementById('record-view')?.textContent ?? '').includes('<tr'), 'record markup should not be escaped as text');
    });
});
