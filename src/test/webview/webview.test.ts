import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import './cssImportHook';

import { esc, fmtB, byteClass } from '../../webview/utils';
import { S, BPR } from '../../webview/state';
import { initFlatBytes, buildMemRows, getByte } from '../../webview/memory/memoryData';
import { integrityHighlightClass } from '../../webview/memory/integrityHighlight';
import { memRerender, mountHexView, scrollTo } from '../../webview/memory/memoryGrid';
import { rerender } from '../../webview/render/registry';
import {
    calcRowOffset,
    calcScrollLayout,
    calcTotalHeight,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollState,
} from '../../webview/render/virtualScroll';
import { fillSelectionTransaction, redoLastEditTransaction, stageIntegrityEdit, stageIntegrityEditTransaction, undoLastEditTransaction } from '../../webview/editTransactions';
import { parsePasteText, pasteOverflowNotice } from '../../webview/pasteUtils';
import { mappedSelectionRange, selectedBytes } from '../../webview/memory/selection';
import { copyCommandResult, contextCommandResult } from '../../webview/contextCommands';

function resetState(): void {
    S.parseResult  = null;
    S.labels       = [];
    S.segmentIndex = [];
    S.memRows      = [];
    S.selStart     = null;
    S.selEnd       = null;
    S.matchAddrs   = [];
    S.matchIdx     = -1;
    S.searchMatchSpan = 0;
    S.currentView  = 'memory';
    S.editMode     = false;
    S.edits.clear();
    S.undoStack.length = 0;
    S.redoStack.length = 0;
    S.structs          = [];

    S.structPins       = [];
    S.integrityHighlight = null;
    S.sidebarTab       = 'inspector';
    S.lastClickColumn  = null;
    S.endian           = 'le';
}

function installWebviewDom(markup: string): JSDOM {
    const dom = new JSDOM(markup, { url: 'https://hexscope.test/' });
    const globals = globalThis as unknown as {
        window: Window;
        document: Document;
        getComputedStyle: typeof getComputedStyle;
        localStorage: Storage;
        acquireVsCodeApi: () => unknown;
        requestAnimationFrame: (cb: (t: number) => void) => number;
    };
    globals.window = dom.window as unknown as Window;
    globals.document = dom.window.document as unknown as Document;
    globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    globals.localStorage = dom.window.localStorage;
    globals.acquireVsCodeApi = () => ({
        postMessage: (_msg: unknown) => {},
        getState: () => ({}),
        setState: (_state: unknown) => {},
    });
    // jsdom has no rAF; inlineConfirm needs it to finish attaching its Yes/No handlers.
    globals.requestAnimationFrame = cb => { cb(0); return 0; };
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
        value: () => {},
        configurable: true,
    });
    return dom;
}

function cleanupWebviewDom(dom: JSDOM): void {
    resetState();
    rerender.memory = () => {};
    rerender.labels = () => {};
    rerender.inspector = () => {};
    rerender.toMemory = () => {};
    rerender.jumpTo = () => {};
    dom.window.close();
    delete (globalThis as unknown as { window?: Window }).window;
    delete (globalThis as unknown as { document?: Document }).document;
    delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    delete (globalThis as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi;
    delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
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

    test('getByte returns unsaved edits without changing original data', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xDE, 0xAD] }],
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.edits.set(0x1001, 0x42);

        assert.strictEqual(getByte(0x1001), 0x42);
        assert.strictEqual(S.parseResult.segments[0].data[1], 0xAD);
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
        const rowTypes = ['data', 'gap', 'data'];
        let rowHeight = 20;
        let gapHeight = 30;

        const state: VirtualScrollState = {
            containerHeight: 100,
            scrollTop: 0,
            bufferSize: 10,
            visibleRowIndices: [0, 0],
            rowCount: rowTypes.length,
            heightVersion: '20:30',
            getRowHeight: rowIndex => rowTypes[rowIndex] === 'gap' ? gapHeight : rowHeight,
        };

        assert.strictEqual(calcTotalHeight(state), 70);

        rowHeight = 32;
        gapHeight = 52;
        state.heightVersion = '32:52';

        assert.strictEqual(calcTotalHeight(state), 116);
        assert.strictEqual(calcRowOffset(2, state), 84);
    });

    test('maps large logical scroll ranges onto capped physical height', () => {
        const state: VirtualScrollState = {
            containerHeight: 100,
            scrollTop: 0,
            bufferSize: 10,
            visibleRowIndices: [0, 0],
            rowCount: 200_000,
            heightVersion: '100',
            getRowHeight: () => 100,
        };

        const layout = calcScrollLayout(state);
        assert.strictEqual(layout.totalHeight, 20_000_000);
        assert.strictEqual(layout.physicalHeight, 16_000_000);
        assert.strictEqual(layout.isCompressed, true);

        assert.strictEqual(logicalToPhysicalScroll(layout.logicalScrollable, state), layout.physicalScrollable);
        assert.strictEqual(physicalToLogicalScroll(layout.physicalScrollable, state), layout.logicalScrollable);
    });
});

suite('Memory View rerender stability', () => {
    let dom: JSDOM;

    setup(() => {
        resetState();
        dom = installWebviewDom(`<!doctype html><html style="--vscode-editor-font-size:12.5px"><body>
            <div id="memory-view">
                <div id="mem-header"></div>
                <div id="mem-scroll"><div id="mem-rows"></div></div>
            </div>
        </body></html>`);
        Object.defineProperty(document.getElementById('mem-scroll')!, 'clientHeight', {
            value: 600,
            configurable: true,
        });
        mountHexView({});
    });

    teardown(() => cleanupWebviewDom(dom));

    test('preserves compressed scroll address when labels are added or deleted', () => {
        const byteCount = 13 * 1024 * 1024;
        S.parseResult = {
            records: [],
            recordCount: 0,
            segments: [{ startAddress: 0, data: new Uint8Array(byteCount) }],
            totalDataBytes: byteCount,
            checksumErrors: 0,
            malformedLines: 0,
            format: 'ihex',
        };
        initFlatBytes();
        buildMemRows();
        memRerender();
        scrollTo(byteCount / 2);
        const before = document.querySelector<HTMLElement>('.data-row')?.dataset.row;

        S.labels = [{ id: 'new', name: 'New label', startAddress: byteCount / 2, length: 16, color: '#fff' }];
        buildMemRows();
        memRerender();
        const afterAdd = document.querySelector<HTMLElement>('.data-row')?.dataset.row;

        S.labels = [];
        buildMemRows();
        memRerender();
        const afterDelete = document.querySelector<HTMLElement>('.data-row')?.dataset.row;

        assert.ok(before);
        assert.strictEqual(afterAdd, before);
        assert.strictEqual(afterDelete, before);
    });
});

suite('Memory View navigation', () => {
    let dom: JSDOM;

    setup(() => {
        resetState();
        dom = installWebviewDom(`<!doctype html><html><body>
            <div id="memory-view">
                <div id="mem-header"></div>
                <div id="mem-scroll"><div id="mem-rows"></div></div>
            </div>
        </body></html>`);
        Object.defineProperty(document.getElementById('mem-scroll')!, 'clientHeight', {
            value: 600,
            configurable: true,
        });
        mountHexView({});

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
        const { memRerender, scrollTo } = await import('../../webview/memory/memoryGrid.js');
        memRerender();

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
        dom = installWebviewDom('<!doctype html><html><body><div id="host"></div></body></html>');
        originalJumpTo = rerender.jumpTo;
    });

    teardown(() => {
        rerender.jumpTo = originalJumpTo;
        cleanupWebviewDom(dom);
    });

    async function mountInspector(): Promise<{ setSegments: (s: import('../../core/types').SerializedSegment[]) => void }> {
        const { InspectorPanel } = await import('../../webview/components/sidebar/inspectorPanel/inspectorPanel.js');
        const inspector = new InspectorPanel({
            readByte: getByte,
            onJumpTo: address => rerender.jumpTo(address),
        });
        inspector.mount(document.getElementById('host')!);
        return {
            setSegments: segments => inspector.setSegments(segments),
        };
    }

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

        const { setSegments } = await mountInspector();
        setSegments(S.parseResult?.segments ?? []);

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
        const { setSegments } = await mountInspector();
        setSegments([]);

        const section = document.getElementById('s-segments')!;
        assert.strictEqual(section.dataset.collapsed, 'false');
        assert.strictEqual(section.querySelector('.sb-empty')?.textContent, 'No segments');
        assert.strictEqual(section.querySelector('.sb-badge'), null);

        section.querySelector<HTMLElement>('.sb-hdr')!.click();
        assert.strictEqual(section.dataset.collapsed, 'true');
        setSegments([]);
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

        const { renderRecordView } = await import('../../webview/hexViewer.js');
        renderRecordView();

        const rows = document.querySelectorAll('#record-view tbody tr');
        assert.strictEqual(rows.length, 1, 'record view should render a real table row');
        assert.strictEqual(document.querySelector('#record-view .raddr')?.textContent, '08000000');
        assert.ok(!(document.getElementById('record-view')?.textContent ?? '').includes('<tr'), 'record markup should not be escaped as text');

        const api = await import('../../webview/vscodeApi.js');
        const originalPostMessage = api.vscode.postMessage;
        const posted: unknown[] = [];
        api.vscode.postMessage = msg => { posted.push(msg); };
        try {
            document.body.innerHTML = '<div id="app"></div>';
            window.dispatchEvent(new dom.window.MessageEvent('message', { data: {
                type: 'init', parseResult: S.parseResult, labels: [], structs: [], structPins: [], endian: 'le',
                integrityProfiles: { profiles: [], activeChecks: { schemaVersion: 1, checks: [] } },
            } }));
            assert.strictEqual(document.querySelectorAll('#sidebar-common-settings').length, 1);
            assert.ok(document.getElementById('sidebar-btn-le')!.classList.contains('active'));
            assert.strictEqual(document.getElementById('btn-le'), null);
            assert.strictEqual(document.getElementById('sa-btn-le'), null);
            assert.strictEqual(document.getElementById('integrity-btn-le'), null);
            assert.ok(document.getElementById('search-btn-auto'), 'Value Search keeps its own endian control');

            // Select the first two segment bytes and render inspector data before the toggle.
            S.selStart = 0x08000000;
            S.selEnd = 0x08000001;
            rerender.inspector();
            assert.ok(document.getElementById('insp-vals')!.querySelector('.insp-raw-dump'),
                'inspector shows selected byte data before toggle');
            assert.ok(document.querySelector('#insp-multi .mi-hex')?.textContent?.includes('0x0201'),
                'little-endian uint16 renders 0x0201');

            document.getElementById('sidebar-btn-be')!.click();
            assert.strictEqual(S.endian, 'be');
            assert.deepStrictEqual(posted.at(-1), { type: 'saveEndian', endian: 'be' });
            assert.ok(document.getElementById('insp-vals')!.querySelector('.insp-raw-dump'),
                'endian toggle does not wipe inspector selection data');
            assert.ok(document.querySelector('#insp-multi .mi-hex')?.textContent?.includes('0x0102'),
                'multi-byte interpreter re-decodes with new endian');

            // Tab round-trip must not re-mount content (mount-once parity): collapse
            // state and selection data survive switching away and back.
            const inspSection = document.getElementById('s-insp')!;
            inspSection.querySelector<HTMLElement>('.sb-hdr')!.click();
            assert.ok(inspSection.classList.contains('collapsed'), 'inspector section collapsed');
            document.getElementById('stab-struct')!.click();
            document.getElementById('stab-inspector')!.click();
            assert.ok(document.getElementById('s-insp')!.classList.contains('collapsed'),
                'collapse state survives tab round-trip');
            assert.ok(document.getElementById('insp-vals')!.querySelector('.insp-raw-dump'),
                'selection data survives tab round-trip');
        } finally {
            api.vscode.postMessage = originalPostMessage;
        }
    });
});

async function waitForIntegrityCalculation(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
}

async function assertIntegrityRecalculationCompletes(index: number): Promise<void> {
    assert.strictEqual(integrityCard(index).querySelector('[data-check-status]')!.textContent, '…');
    await waitForIntegrityCalculation();
    assert.strictEqual(integrityCard(index).querySelector('[data-check-status]')!.textContent, '✓');
}

function integrityCard(index = 0): HTMLElement {
    return document.querySelectorAll<HTMLElement>('.integrity-card')[index];
}

function integrityForm(id: string): HTMLElement {
    return document.querySelector<HTMLElement>(`[data-integrity-form="${id}"]`)!;
}

function setDraftValue(form: HTMLElement, control: string, value: string): void {
    (form.querySelector(`[data-draft-control="${control}"]`) as HTMLInputElement).value = value;
}

function assertEmptyIntegrityChecks(): void {
    assert.strictEqual(document.querySelectorAll('.integrity-card').length, 0);
    assert.strictEqual(document.querySelector('.integrity-empty')!.textContent, 'No integrity checks configured.');
    assert.ok((document.getElementById('integrity-profile-save') as HTMLButtonElement).disabled);
}

suite('Integrity Checks sidebar', () => {
    let dom: JSDOM;

    setup(() => {
        resetState();
        dom = installWebviewDom('<!doctype html><html><body><div id="s-integrity"></div></body></html>');
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [1, 2, 3, 4] }],
            totalDataBytes: 4,
            checksumErrors: 0,
            malformedLines: 0,
            format: 'ihex',
        };
        initFlatBytes();
        S.selStart = 0x1000;
        S.selEnd = 0x1002;
    });

    teardown(() => cleanupWebviewDom(dom));

    test('uses struct-style cards, shared byte order, edit forms, and profiles', async function () {
        this.timeout(5_000);
        const api = await import('../../webview/vscodeApi.js');
        const originalPostMessage = api.vscode.postMessage;
        const posted: unknown[] = [];
        api.vscode.postMessage = msg => { posted.push(msg); };

        try {
            const { IntegrityPanel } = await import('../../webview/components/sidebar/integrityPanel/integrityPanel.js');
            const { calculateIntegrity } = await import('../../core/integrity.js');
            const stagedTransactions: Array<Array<[number, number]>> = [];
            const panel = new IntegrityPanel({
                readByte: getByte,
                onStoredValueEdits: edits => {
                    stagedTransactions.push(edits);
                    edits.forEach(([address, value]) => S.edits.set(address, value));
                    panel.notifyBytesChanged();
                },
                getSelection: () => (S.selStart !== null && S.selEnd !== null ? { start: S.selStart, end: S.selEnd } : null),
                getEndian: () => S.endian,
                onHighlightChange: highlight => { S.integrityHighlight = highlight; },
                onCopyText: (text, label) => api.vscode.postMessage({ type: 'copyText', text, label }),
                onPersistChecks: state => api.vscode.postMessage({ type: 'saveIntegrityChecks', state }),
                onCreateProfile: profile => api.vscode.postMessage({ type: 'createIntegrityProfile', profile }),
                onUpdateProfile: profile => api.vscode.postMessage({ type: 'updateIntegrityProfile', profile }),
                onRenameProfile: (id, name) => api.vscode.postMessage({ type: 'renameIntegrityProfile', id, name }),
                onDeleteProfile: id => api.vscode.postMessage({ type: 'deleteIntegrityProfile', id }),
            });
            panel.setTabActive(true);
            panel.mount(document.getElementById('s-integrity')!);
            S.edits.clear();
            S.endian = 'le';
            assertEmptyIntegrityChecks();
            assert.strictEqual(document.getElementById('integrity-btn-le'), null);
            assert.strictEqual(document.getElementById('integrity-btn-be'), null);

            document.getElementById('integrity-add-btn')!.click();
            let selectedAddForm = integrityForm('add');
            assert.strictEqual((selectedAddForm.querySelector('[data-draft-control="algorithm"]') as HTMLSelectElement).value, 'crc32-iso-hdlc');
            assert.strictEqual((selectedAddForm.querySelector('[data-draft-control="start"]') as HTMLInputElement).value, '00001000');
            assert.strictEqual((selectedAddForm.querySelector('[data-draft-control="end"]') as HTMLInputElement).value, '00001002');
            S.selStart = 0x1001;
            S.selEnd = 0x1001;
            S.endian = 'be';
            panel.notifyEndianChanged();
            selectedAddForm = integrityForm('add');
            assert.strictEqual((selectedAddForm.querySelector('[data-draft-control="start"]') as HTMLInputElement).value, '00001000');
            assert.strictEqual((selectedAddForm.querySelector('[data-draft-control="end"]') as HTMLInputElement).value, '00001002');
            integrityForm('add').querySelector<HTMLElement>('[data-form-action="cancel"]')!.click();
            assert.strictEqual(document.querySelectorAll('.integrity-card').length, 0);

            S.selStart = null;
            S.selEnd = null;
            document.getElementById('integrity-add-btn')!.click();
            const blankAddForm = integrityForm('add');
            assert.strictEqual((blankAddForm.querySelector('[data-draft-control="start"]') as HTMLInputElement).value, '');
            assert.strictEqual((blankAddForm.querySelector('[data-draft-control="end"]') as HTMLInputElement).value, '');
            blankAddForm.querySelector<HTMLElement>('[data-form-action="cancel"]')!.click();

            S.selStart = 0x1000;
            S.selEnd = 0x1002;
            document.getElementById('integrity-add-btn')!.click();
            integrityForm('add').querySelector<HTMLElement>('[data-form-action="save"]')!.click();
            assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);
            assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.textContent, '…');
            assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.calculated code')!.textContent, '0x—');
            assert.deepStrictEqual(posted.at(-1), {
                type: 'saveIntegrityChecks',
                state: {
                    schemaVersion: 1,
                    checks: [{ algorithm: 'crc32-iso-hdlc', startAddress: 0x1000, endAddress: 0x1002, autoFixStoredValue: false }],
                },
            });
            assert.ok(!integrityCard().querySelector<HTMLElement>('[data-check-body]')!.hidden, 'comparison is always visible');
            assert.strictEqual(integrityCard().querySelector('.si-expand-btn'), null);
            assert.strictEqual(integrityCard().querySelector('[data-auto-fix]'), null);
            assert.ok((document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);
            await waitForIntegrityCalculation();
            assert.strictEqual(
                integrityCard().querySelector('[data-check-status]')!.textContent,
                '∑',
                integrityCard().textContent ?? '',
            );
            assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Calculated');

            integrityCard().querySelector<HTMLElement>('[data-check-toggle]')!.click();
            assert.deepStrictEqual(S.integrityHighlight, {
                rangeStart: 0x1000,
                rangeEnd: 0x1002,
                status: 'unverified',
            });
            assert.strictEqual(integrityHighlightClass(0x1001), ' integrity-range');
            const expectedInitial = await calculateIntegrity('crc32-iso-hdlc', new Uint8Array([1, 2, 3]));
            assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.calculated code')!.textContent, `0x${expectedInitial.value}`);

            integrityCard().querySelector<HTMLElement>('.act-btn-edit')!.click();
            const editForm = integrityForm('edit-1');
            setDraftValue(editForm, 'start', 'ABCD');
            panel.setProfiles([]);
            assert.strictEqual((integrityForm('edit-1').querySelector('[data-draft-control="start"]') as HTMLInputElement).value, 'ABCD');
            setDraftValue(editForm, 'start', '1001');
            setDraftValue(editForm, 'end', 'not-hex');
            editForm.querySelector<HTMLElement>('[data-form-action="save"]')!.click();
            assert.match(editForm.querySelector('[data-form-error]')!.textContent!, /hexadecimal/);
            setDraftValue(editForm, 'end', '1002');
            editForm.querySelector<HTMLElement>('[data-form-action="save"]')!.click();
            assert.ok(!integrityCard().querySelector<HTMLElement>('[data-check-body]')!.hidden, 'save restores visible comparison');
            await waitForIntegrityCalculation();
            const expectedBeforeEdit = await calculateIntegrity('crc32-iso-hdlc', new Uint8Array([2, 3]));

            S.edits.set(0x1001, 0xFF);
            panel.notifyBytesChanged();
            assert.strictEqual(integrityCard().querySelector('[data-check-status]')!.textContent, '…');
            assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.calculated code')!.textContent, `0x${expectedBeforeEdit.value}`);
            await waitForIntegrityCalculation();
            const expectedEdited = await calculateIntegrity('crc32-iso-hdlc', new Uint8Array([0xFF, 3]));
            assert.strictEqual(integrityCard().querySelector('.integrity-value-pane.calculated code')!.textContent, `0x${expectedEdited.value}`);
            assert.strictEqual(integrityCard().querySelector('[data-result-action="copy"]'), null);
            integrityCard().querySelector<HTMLElement>('[data-copy-calculated]')!.click();
            assert.deepStrictEqual(posted.at(-1), {
                type: 'copyText',
                text: `0x${expectedEdited.value}`,
                label: 'CRC32/ISO-HDLC calculated value',
            });

            document.getElementById('integrity-add-btn')!.click();
            const addForm = integrityForm('add');
            setDraftValue(addForm, 'start', '1000');
            setDraftValue(addForm, 'end', '1003');
            setDraftValue(addForm, 'stored', '1000');
            const hashAlgorithm = addForm.querySelector<HTMLSelectElement>('[data-draft-control="algorithm"]')!;
            hashAlgorithm.value = 'sha-256';
            hashAlgorithm.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            assert.ok(addForm.querySelector<HTMLElement>('[data-stored-field]')!.hidden);
            addForm.querySelector<HTMLElement>('[data-form-action="save"]')!.click();
            assert.strictEqual(document.querySelectorAll('.integrity-card').length, 2);
            assert.ok(!integrityCard(1).querySelector<HTMLElement>('[data-check-body]')!.hidden);
            assert.strictEqual(integrityCard(1).querySelector('[data-auto-fix]'), null);
            const hashConfig = (posted.at(-1) as { state: { checks: Array<{ storedAddress?: number; autoFixStoredValue: boolean }> } }).state.checks[1];
            assert.deepStrictEqual(hashConfig, {
                algorithm: 'sha-256', startAddress: 0x1000, endAddress: 0x1003, autoFixStoredValue: false,
            });
            integrityCard(1).querySelector<HTMLElement>('.act-btn-edit')!.click();
            integrityForm('edit-2').querySelector<HTMLElement>('[data-form-action="cancel"]')!.click();
            integrityCard(1).querySelector<HTMLElement>('.act-btn-del')!.click();
            assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);

            S.edits.clear();
            S.endian = 'le';
            panel.notifyEndianChanged();
            panel.setProfiles([{
                schemaVersion: 1,
                id: 'stm32-profile',
                name: 'STM32 Layout',
                checks: [
                    { algorithm: 'crc32-iso-hdlc', startAddress: 0x1000, endAddress: 0x1001, autoFixStoredValue: false },
                    { algorithm: 'crc16-ccitt-false', startAddress: 0x1002, endAddress: 0x1003, storedAddress: 0x1000, autoFixStoredValue: false },
                ],
            }]);
            const profileSelect = document.getElementById('integrity-profile-select') as HTMLSelectElement;
            profileSelect.value = 'stm32-profile';
            profileSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            document.getElementById('integrity-profile-apply')!.click();
            const applyConfirm = document.querySelector('#del-confirm-pop .dcp-yes') as HTMLElement | null;
            if (applyConfirm) { applyConfirm.click(); }
            assert.strictEqual(document.querySelectorAll('.integrity-card').length, 2);
            assert.strictEqual(S.endian, 'le', 'applying a profile does not change shared endian');
            assert.strictEqual(integrityCard(1).querySelector('[data-check-status]')!.textContent, '…');
            assert.strictEqual(integrityCard(1).querySelector('.integrity-value-pane.calculated code')!.textContent, '0x—');
            assert.strictEqual(integrityCard(1).querySelector('.integrity-value-pane.stored code')!.textContent, '0x—');
            await waitForIntegrityCalculation();
            assert.strictEqual(integrityCard(1).querySelector('[data-check-status]')!.textContent, '✕');
            assert.strictEqual(integrityCard(1).querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Mismatch');
            assert.ok(integrityCard(1).querySelector('[data-check-toggle]')!.firstElementChild!.matches('[data-check-status]'));
            assert.match(integrityCard(1).querySelector('.integrity-value-pane.stored code')!.textContent!, /^0x/);
            assert.ok(integrityCard(1).querySelector('.integrity-value-pane.stored')!.classList.contains('mismatch'));
            assert.ok(integrityCard(1).querySelector('.integrity-value-pane.stored [data-auto-fix]'));
            assert.ok(!(document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);
            const canonicalStoredChecksum = await calculateIntegrity('crc16-ccitt-false', new Uint8Array([3, 4]));
            assert.strictEqual(integrityCard(1).querySelector('.integrity-value-pane.calculated code')!.textContent, `0x${canonicalStoredChecksum.value}`);
            assert.strictEqual(integrityCard(1).querySelector('.integrity-value-hdr span')!.textContent, 'Calculated');
            assert.strictEqual(integrityCard(1).querySelector('.integrity-value-pane.stored code')!.textContent, '0x0201');
            assert.strictEqual(integrityCard(1).querySelector('.integrity-value-pane.stored code')!.getAttribute('title'), 'Raw bytes: 0x0102');
            assert.strictEqual(integrityCard(1).querySelectorAll('.integrity-value-hdr span')[1].textContent, 'Stored (LE)');
            integrityCard(1).querySelector<HTMLElement>('[data-copy-calculated]')!.click();
            assert.strictEqual((posted.at(-1) as { text: string }).text, `0x${canonicalStoredChecksum.value}`);

            integrityCard(1).querySelector<HTMLElement>('[data-check-toggle]')!.click();
            assert.strictEqual(S.integrityHighlight?.status, 'mismatch');
            assert.strictEqual(integrityHighlightClass(0x1000), ' integrity-stored-mismatch');
            assert.strictEqual(integrityHighlightClass(0x1002), ' integrity-range');
            integrityCard(1).querySelector<HTMLElement>('[data-check-toggle]')!.click();
            assert.strictEqual(S.integrityHighlight, null);
            assert.strictEqual(integrityCard(1).querySelector('[data-check-fix]'), null);
            const autoFix = integrityCard(1).querySelector<HTMLInputElement>('[data-auto-fix]')!;
            autoFix.checked = true;
            autoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            await assertIntegrityRecalculationCompletes(1);
            assert.strictEqual(integrityCard(1).querySelector('[data-check-status]')!.getAttribute('aria-label'), 'Match');
            assert.strictEqual(
                integrityCard(1).querySelector('.integrity-value-pane.stored code')!.textContent,
                integrityCard(1).querySelector('.integrity-value-pane.calculated code')!.textContent,
            );
            assert.strictEqual(stagedTransactions.length, 1);
            assert.ok((document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);
            assert.ok((posted.at(-1) as { state: { checks: Array<{ autoFixStoredValue: boolean }> } }).state.checks[1].autoFixStoredValue);

            S.edits.clear();
            panel.notifyEditsDiscarded();
            await waitForIntegrityCalculation();
            assert.strictEqual(integrityCard(1).querySelector('[data-check-status]')!.textContent, '✕');
            assert.strictEqual(stagedTransactions.length, 1, 'Discard must not immediately re-stage Auto fix');
            assert.ok(integrityCard(1).querySelector('.integrity-auto-fix')!.classList.contains('paused'));
            assert.ok(integrityCard(1).querySelector<HTMLInputElement>('[data-auto-fix]')!.checked);
            panel.notifyBytesChanged();
            await waitForIntegrityCalculation();
            assert.strictEqual(stagedTransactions.length, 1, 'identical mismatch remains suppressed');
            assert.ok(!(document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);
            document.getElementById('integrity-fix-all')!.click();
            assert.strictEqual(stagedTransactions.length, 2);
            await assertIntegrityRecalculationCompletes(1);
            assert.ok((document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);

            S.edits.clear();
            panel.notifyEditsDiscarded();
            await waitForIntegrityCalculation();
            const rearmAutoFix = integrityCard(1).querySelector<HTMLInputElement>('[data-auto-fix]')!;
            rearmAutoFix.checked = false;
            rearmAutoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            rearmAutoFix.checked = true;
            rearmAutoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            assert.strictEqual(stagedTransactions.length, 3, 'toggle off/on overrides suppression');
            await assertIntegrityRecalculationCompletes(1);

            S.endian = 'be';
            panel.notifyEndianChanged();
            await waitForIntegrityCalculation();
            await waitForIntegrityCalculation();
            assert.strictEqual(stagedTransactions.length, 4, 'endian change re-arms Auto fix');
            const beCalculated = integrityCard(1).querySelector('.integrity-value-pane.calculated code')!;
            assert.strictEqual(beCalculated.textContent, integrityCard(1).querySelector('.integrity-value-pane.stored code')!.textContent);
            assert.strictEqual(integrityCard(1).querySelector('.integrity-value-hdr span')!.textContent, 'Calculated');
            assert.strictEqual(integrityCard(1).querySelectorAll('.integrity-value-hdr span')[1].textContent, 'Stored (BE)');

            document.getElementById('integrity-profile-update')!.click();
            const updatedProfile = (posted.at(-1) as { type: string; profile: { checks: Array<{ autoFixStoredValue: boolean }> } }).profile;
            assert.strictEqual(updatedProfile.checks[1].autoFixStoredValue, true);
            document.getElementById('integrity-profile-rename')!.click();
            const renameInput = document.getElementById('integrity-profile-name') as HTMLInputElement;
            assert.strictEqual(renameInput.value, 'STM32 Layout');
            renameInput.value = 'Renamed Layout';
            document.getElementById('integrity-profile-name-save')!.click();
            assert.deepStrictEqual(posted.at(-1), {
                type: 'renameIntegrityProfile', id: 'stm32-profile', name: 'Renamed Layout',
            });
            document.getElementById('integrity-profile-delete')!.click();
            assert.ok(document.querySelector('#del-confirm-pop'), 'delete waits for the inline confirm');
            (document.querySelector('#del-confirm-pop .dcp-yes') as HTMLElement).click();
            await new Promise(resolve => setTimeout(resolve, 0));
            assert.deepStrictEqual(posted.at(-1), { type: 'deleteIntegrityProfile', id: 'stm32-profile' });
            document.getElementById('integrity-profile-save')!.click();
            const saveInput = document.getElementById('integrity-profile-name') as HTMLInputElement;
            saveInput.value = 'New Layout';
            saveInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            const created = posted.at(-1) as { type: string; profile: { name: string; checks: unknown[] } };
            assert.strictEqual(created.type, 'createIntegrityProfile');
            assert.strictEqual(created.profile.name, 'New Layout');
            assert.strictEqual(created.profile.checks.length, 2);

            integrityCard().querySelector<HTMLElement>('.act-btn-del')!.click();
            integrityCard().querySelector<HTMLElement>('.act-btn-del')!.click();
            assertEmptyIntegrityChecks();
            assert.ok((document.getElementById('integrity-profile-update') as HTMLButtonElement).disabled);

            panel.setChecks({
                schemaVersion: 1,
                checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1002, autoFixStoredValue: false }],
            });
            panel.render();
            assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);
            assert.strictEqual(document.getElementById('integrity-btn-le'), null);
        } finally {
            api.vscode.postMessage = originalPostMessage;
        }
    });

    test('stageIntegrityEdit one byte', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xDE, 0xAD] }],
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        const result = stageIntegrityEdit(0x1000, 0x42);
        assert.deepStrictEqual(result, [0x1000, 0xDE]);
        assert.strictEqual(S.edits.get(0x1000), 0x42);
        assert.strictEqual(S.editMode, false);
    });

    test('stageIntegrityEdit skips unmapped address', () => {
        resetState();
        S.parseResult = null;
        const result = stageIntegrityEdit(0x9999, 0x42);
        assert.strictEqual(result, null);
    });

    test('stageIntegrityEdit reverts to original when re-editing to same value', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xDE] }],
            totalDataBytes: 1, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.edits.set(0x1000, 0x42);
        const result = stageIntegrityEdit(0x1000, 0xDE);
        assert.deepStrictEqual(result, [0x1000, 0x42]);
        assert.strictEqual(S.edits.has(0x1000), false);
    });

    test('stageIntegrityEditTransaction multiple edits', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0x00, 0x01, 0x02] }],
            totalDataBytes: 3, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        const ok = stageIntegrityEditTransaction([[0x1000, 0xFF], [0x1002, 0xEE]]);
        assert.ok(ok);
        assert.strictEqual(S.edits.get(0x1000), 0xFF);
        assert.strictEqual(S.edits.get(0x1002), 0xEE);
        assert.strictEqual(S.editMode, true);
    });

    test('fillSelectionTransaction fills range', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0x00, 0x00, 0x00, 0x00] }],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        fillSelectionTransaction({ start: 0x1001, end: 0x1002 }, 0xFF);
        assert.strictEqual(S.edits.get(0x1001), 0xFF);
        assert.strictEqual(S.edits.get(0x1002), 0xFF);
        assert.strictEqual(S.edits.has(0x1000), false);
    });

    test('fillSelectionTransaction skips bytes already equal to fill value', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0x00, 0xAA, 0xAA, 0x00] }],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        fillSelectionTransaction({ start: 0x1000, end: 0x1003 }, 0xAA);
        assert.strictEqual(S.edits.size, 2);
        assert.strictEqual(S.edits.get(0x1000), 0xAA);
        assert.strictEqual(S.edits.get(0x1003), 0xAA);
        assert.strictEqual(S.edits.has(0x1001), false);
        assert.strictEqual(S.edits.has(0x1002), false);
    });

    test('fillSelectionTransaction skips whole range when fill value unchanged', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xAA, 0xAA, 0xAA] }],
            totalDataBytes: 3, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        fillSelectionTransaction({ start: 0x1000, end: 0x1002 }, 0xAA);
        assert.strictEqual(S.edits.size, 0);
        assert.strictEqual(S.undoStack.length, 0);
    });

    test('fillSelectionTransaction reverts edited byte to original value', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xDE, 0xAD] }],
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.edits.set(0x1000, 0x42);
        fillSelectionTransaction({ start: 0x1000, end: 0x1001 }, 0xDE);
        assert.strictEqual(S.edits.has(0x1000), false);
        assert.strictEqual(S.edits.get(0x1001), 0xDE);
        assert.strictEqual(S.undoStack.length, 1);
        assert.deepStrictEqual(S.undoStack[0], [[0x1000, 0x42], [0x1001, 0xAD]]);
    });

    test('undoLastEditTransaction restores fill', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0x00] }],
            totalDataBytes: 1, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.editMode = true;
        S.edits.set(0x1000, 0x42);
        S.undoStack.push([[0x1000, 0x00]]);
        const ok = undoLastEditTransaction();
        assert.ok(ok);
        assert.strictEqual(S.edits.has(0x1000), false);
    });

    test('redoLastEditTransaction re-applies an undone edit', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0x00] }],
            totalDataBytes: 1, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.editMode = true;
        S.edits.set(0x1000, 0x42);
        S.undoStack.push([[0x1000, 0x00]]);
        assert.ok(undoLastEditTransaction());
        assert.strictEqual(S.edits.has(0x1000), false);
        assert.ok(redoLastEditTransaction());
        assert.strictEqual(S.edits.get(0x1000), 0x42);
    });

    test('redoLastEditTransaction re-pushes undo so undo-after-redo works', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0x00] }],
            totalDataBytes: 1, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.editMode = true;
        S.edits.set(0x1000, 0x42);
        S.undoStack.push([[0x1000, 0x00]]);
        assert.ok(undoLastEditTransaction());
        assert.strictEqual(S.edits.has(0x1000), false);
        assert.ok(redoLastEditTransaction());
        assert.strictEqual(S.edits.get(0x1000), 0x42);
        assert.strictEqual(S.undoStack.length, 1);
        assert.deepStrictEqual(S.undoStack[0], [[0x1000, 0x00]]);
        assert.ok(undoLastEditTransaction());
        assert.strictEqual(S.edits.has(0x1000), false);
    });

    test('staging a new edit clears the redo stack', () => {
        resetState();
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0x00] }],
            totalDataBytes: 1, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.editMode = true;
        S.edits.set(0x1000, 0x42);
        S.undoStack.push([[0x1000, 0x00]]);
        assert.ok(undoLastEditTransaction());
        assert.strictEqual(S.redoStack.length, 1);
        stageIntegrityEditTransaction([[0x1000, 0x77]]);
        assert.strictEqual(S.redoStack.length, 0);
    });

    // ── Paste parsing ────────────────────────────────────────────────

    test('parsePasteText hex spaced pairs', () => {
        assert.deepStrictEqual(parsePasteText('0A 1B 2C'), [10, 27, 44]);
    });

    test('parsePasteText hex raw concatenated', () => {
        assert.deepStrictEqual(parsePasteText('0A1B2C'), [10, 27, 44]);
    });

    test('parsePasteText hex with 0x prefix', () => {
        assert.deepStrictEqual(parsePasteText('0x0A 0x1B 0x2C'), [10, 27, 44]);
    });

    test('parsePasteText hex mixed whitespace', () => {
        assert.deepStrictEqual(parsePasteText('0A 1B\t2C\n3D'), [10, 27, 44, 61]);
    });

    test('parsePasteText hex comma separated', () => {
        assert.deepStrictEqual(parsePasteText('0A,1B,2C'), [10, 27, 44]);
    });

    test('parsePasteText hex semicolon separated', () => {
        assert.deepStrictEqual(parsePasteText('0A;1B;2C'), [10, 27, 44]);
    });

    test('parsePasteText returns null for ASCII text', () => {
        assert.strictEqual(parsePasteText('hello world'), null);
    });

    test('parsePasteText returns null for random non-hex', () => {
        assert.strictEqual(parsePasteText('https://example.com'), null);
    });

    test('parsePasteText returns null for empty string', () => {
        assert.strictEqual(parsePasteText(''), null);
    });

    test('parsePasteText returns null for odd hex digit count', () => {
        assert.strictEqual(parsePasteText('A B C'), null);
    });

    test('parsePasteText parses single hex pair', () => {
        assert.deepStrictEqual(parsePasteText('FF'), [255]);
    });

    test('pasteOverflowNotice is null when nothing was pasted or nothing truncated', () => {
        assert.strictEqual(pasteOverflowNotice(0, 0), null);
        assert.strictEqual(pasteOverflowNotice(5, 5), null);
        assert.strictEqual(pasteOverflowNotice(5, 3), null);
    });

    test('pasteOverflowNotice reports a partial paste', () => {
        assert.match(pasteOverflowNotice(2, 5)!, /Pasted 2 of 5 bytes/);
    });

    test('pasteOverflowNotice reports a fully-blocked paste', () => {
        assert.match(pasteOverflowNotice(0, 5)!, /Nothing pasted/);
    });
});

// ── selectedBytes() gap filtering ───────────────────────────────

suite('selectedBytes() - gap filtering', () => {
    setup(resetState);

    test('no selection returns empty', () => {
        assert.deepStrictEqual(selectedBytes(), []);
    });

    test('skips unmapped gap addresses in spanning selection', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0000, data: [0x01, 0x02] },
                { startAddress: 0x0200, data: [0x03, 0x04] },
            ],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.selStart = 0x0000;
        S.selEnd = 0x0201;
        assert.deepStrictEqual(selectedBytes(), [0x01, 0x02, 0x03, 0x04]);
    });

    test('selection fully inside unmapped gap returns empty', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0000, data: [0x01, 0x02] },
                { startAddress: 0x0200, data: [0x03, 0x04] },
            ],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.selStart = 0x0100;
        S.selEnd = 0x0102;
        assert.deepStrictEqual(selectedBytes(), []);
    });

    test('uses edited bytes and skips in-range unmapped addresses', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xDE, 0xAD] }],
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.edits.set(0x1001, 0x42);
        S.selStart = 0x1000;
        S.selEnd = 0x1003; // 0x1002-0x1003 unmapped (past segment end)
        assert.deepStrictEqual(selectedBytes(), [0xDE, 0x42]);
    });

    test('copyCommandResult over gap-spanning bytes formats mapped bytes only', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0000, data: [0x01, 0x02] },
                { startAddress: 0x0200, data: [0x03, 0x04] },
            ],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.selStart = 0x0000;
        S.selEnd = 0x0201;
        const result = copyCommandResult('hex', selectedBytes());
        assert.strictEqual(result.type, 'copyText');
        assert.strictEqual((result as { type: 'copyText'; text: string }).text, '01 02 03 04');
    });

    test('all-unmapped selection yields copy no-op', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0000, data: [0x01, 0x02] },
                { startAddress: 0x0200, data: [0x03, 0x04] },
            ],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.selStart = 0x0100;
        S.selEnd = 0x0102;
        assert.deepStrictEqual(selectedBytes(), []);
        assert.deepStrictEqual(copyCommandResult('hex', selectedBytes()), { type: 'none' });
        assert.deepStrictEqual(contextCommandResult('hex', selectedBytes(), false), { type: 'none' });
    });

    test('analyze over gap-spanning selection computes on mapped bytes only', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0000, data: [0x01, 0x02] },
                { startAddress: 0x0200, data: [0x03, 0x04] },
            ],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        initFlatBytes();
        S.selStart = 0x0000;
        S.selEnd = 0x0201;
        const result = contextCommandResult('an-xor', selectedBytes(), false);
        assert.strictEqual(result.type, 'copyText');
        const text = (result as { type: 'copyText'; text: string }).text;
        assert.strictEqual(text, '0x04'); // 0x01 ^ 0x02 ^ 0x03 ^ 0x04
    });
});

suite('mappedSelectionRange() - row shift-extend', () => {
    teardown(resetState);

    test('plain click returns the mapped span as-is', () => {
        S.selStart = null;
        assert.deepStrictEqual(mappedSelectionRange(0x1020, 0x102F, false), [0x1020, 0x102F]);
    });

    test('shift-click on a row below the anchor extends to that row end', () => {
        S.selStart = 0x1000;
        assert.deepStrictEqual(mappedSelectionRange(0x1020, 0x102F, true), [0x1000, 0x102F]);
    });

    test('shift-click on a row above the anchor extends from that row start', () => {
        S.selStart = 0x1020;
        assert.deepStrictEqual(mappedSelectionRange(0x1000, 0x100F, true), [0x1000, 0x1020]);
    });

    test('same-row shift keeps the merged span', () => {
        S.selStart = 0x1008;
        assert.deepStrictEqual(mappedSelectionRange(0x1000, 0x100F, true), [0x1000, 0x100F]);
    });
});

// ── Regression: container resize re-slices the memory grid (B1) ─────

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    observed: HTMLElement[] = [];
    constructor(private cb: () => void) { FakeResizeObserver.instances.push(this); }
    observe(el: HTMLElement): void { this.observed.push(el); }
    disconnect(): void { this.observed = []; }
    fire(): void { this.cb(); }
}

suite('memory grid container-resize handling (regression B1)', () => {
    test('a container height change re-renders the visible slice via ResizeObserver', async () => {
        resetState();
        const dom = installWebviewDom(`<!doctype html><html><body>
            <div id="memory-view"><div id="mem-header"></div><div id="mem-scroll"><div id="mem-rows"></div></div></div>
        </body></html>`);
        try {
            (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
            FakeResizeObserver.instances = [];
            S.parseResult = {
                records: [], recordCount: 0,
                segments: [{ startAddress: 0x08000000, data: Uint8Array.from({ length: 256 }, (_, i) => i) }],
                totalDataBytes: 256, checksumErrors: 0, malformedLines: 0, format: 'ihex',
            };
            const { initFlatBytes, buildMemRows } = await import('../../webview/memory/memoryData.js');
            initFlatBytes();
            buildMemRows();
            const { memRerender } = await import('../../webview/memory/memoryGrid.js');
            memRerender();

            const obs = FakeResizeObserver.instances.find(o => o.observed.some(el => el.id === 'mem-scroll'));
            assert.ok(obs, 'resize observer targets the memory scroll container');
            const rows = document.getElementById('mem-rows');
            assert.ok(rows, 'memory rows rendered');
            const before = rows!.innerHTML;

            Object.defineProperty(document.getElementById('mem-scroll')!, 'clientHeight', { value: 600, configurable: true });
            obs!.fire();
            assert.notStrictEqual(rows!.innerHTML, before, 'slice re-renders after a container height change');
        } finally {
            delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
            cleanupWebviewDom(dom);
        }
    });
});

// ── Regression: match highlight truth = executed search (B2) ───────

suite('search match truth follows the executed search (B2)', () => {
    test('span comes from the executed search; a diverged query clears stale matches', async () => {
        resetState();
        const dom = installWebviewDom('<!doctype html><html><body><div id="app"></div></body></html>');
        try {
            S.parseResult = {
                records: [], recordCount: 0,
                segments: [{ startAddress: 0x08000000, data: [0xDE, 0xAD, 0xDE, 0xAD] }],
                totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
            };
            const { initSearch, runSearch, invalidateSearchIfDiverged } = await import('../../webview/search/searchEngine.js');
            initSearch(() => {});
            runSearch('DE AD', 'bytes', 'auto', 'button');
            // debounce (120ms) + chunked scan must fully complete before invalidation asserts.
            await new Promise(resolve => setTimeout(resolve, 400));

            assert.ok(S.matchAddrs.length >= 1, 'bytes search finds the pattern');
            assert.strictEqual(S.searchMatchSpan, 2, 'span is the executed needle length');

            invalidateSearchIfDiverged('DE AD', 'bytes', 'auto');
            assert.ok(S.matchAddrs.length >= 1, 'unchanged query keeps its match set');

            invalidateSearchIfDiverged('AA', 'bytes', 'auto');
            assert.strictEqual(S.matchAddrs.length, 0, 'diverged query clears the match set');
            assert.strictEqual(S.searchMatchSpan, 0, 'span clears with the match set');

            runSearch('DE AD', 'bytes', 'auto', 'button');
            await new Promise(resolve => setTimeout(resolve, 400));
            assert.ok(S.matchAddrs.length >= 1, 're-run after divergence re-searches');
            invalidateSearchIfDiverged('', 'bytes', 'auto');
            assert.strictEqual(S.matchAddrs.length, 0, 'emptied query clears the stale match set');
            assert.strictEqual(S.searchMatchSpan, 0, 'span clears when the query is emptied');
        } finally {
            cleanupWebviewDom(dom);
        }
    });

    test('mid-run divergence cancels the in-flight search; a matching key keeps it running', async () => {
        resetState();
        const dom = installWebviewDom('<!doctype html><html><body><div id="app"></div></body></html>');
        try {
            S.parseResult = {
                records: [], recordCount: 0,
                segments: [{ startAddress: 0x08000000, data: [0xDE, 0xAD, 0xDE, 0xAD] }],
                totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
            };
            const { initSearch, runSearch, invalidateSearchIfDiverged } = await import('../../webview/search/searchEngine.js');
            initSearch(() => {});

            runSearch('DE AD', 'bytes', 'auto', 'button');
            invalidateSearchIfDiverged('AA', 'bytes', 'auto'); // inside the debounce window
            await new Promise(resolve => setTimeout(resolve, 400));
            assert.strictEqual(S.matchAddrs.length, 0, 'diverged query cancels the in-flight search');

            runSearch('DE AD', 'bytes', 'auto', 'button');
            invalidateSearchIfDiverged('DE AD', 'bytes', 'auto'); // same key, still running
            await new Promise(resolve => setTimeout(resolve, 400));
            assert.ok(S.matchAddrs.length >= 1, 'matching key does not cancel the running search');
        } finally {
            cleanupWebviewDom(dom);
        }
    });
});

// ── Regression: edit refresh re-renders the grid only in memory view (C1) ─
suite('edit refresh gate (C1)', () => {
    test('refreshAfterLocalEdit re-renders the grid only in memory view', async () => {
        resetState();
        const dom = installWebviewDom(`<!doctype html><html><body><div id="app">
            <div id="memory-view"><div id="mem-header"></div><div id="mem-scroll"><div id="mem-rows"></div></div></div>
        </div></body></html>`);
        try {
            S.parseResult = {
                records: [], recordCount: 0,
                segments: [{ startAddress: 0x08000000, data: Uint8Array.from({ length: 64 }, (_, i) => i) }],
                totalDataBytes: 64, checksumErrors: 0, malformedLines: 0, format: 'ihex',
            };
            const { initFlatBytes, buildMemRows } = await import('../../webview/memory/memoryData.js');
            initFlatBytes();
            buildMemRows();
            const { refreshAfterLocalEdit } = await import('../../webview/hexViewer.js');
            const rows = document.getElementById('mem-rows')!;

            S.currentView = 'record';
            refreshAfterLocalEdit();
            assert.strictEqual(rows.innerHTML, '', 'no grid re-render while in record view');

            S.currentView = 'memory';
            refreshAfterLocalEdit();
            assert.ok(rows.innerHTML.includes('data-row'), 'grid re-renders in memory view');
        } finally {
            cleanupWebviewDom(dom);
        }
    });
});

// ── Grid keyboard selection: walkMappedAddress skips unmapped gaps ─

suite('grid keyboard navigation (walkMappedAddress)', () => {
    setup(resetState);

    test('walks contiguous mapped bytes', async () => {
        S.parseResult = {
            records: [], recordCount: 0,
            segments: [{ startAddress: 0x1000, data: [1, 2, 3, 4] }],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        const { initFlatBytes } = await import('../../webview/memory/memoryData.js');
        initFlatBytes();
        const { walkMappedAddress } = await import('../../webview/hexViewer.js');
        assert.strictEqual(walkMappedAddress(0x1001, 'right'), 0x1002);
        assert.strictEqual(walkMappedAddress(0x1002, 'left'), 0x1001);
        assert.strictEqual(walkMappedAddress(0x1003, 'right'), null, 'beyond the last mapped byte');
        assert.strictEqual(walkMappedAddress(0x1000, 'left'), null, 'before the first mapped byte');
    });

    test('skips an unmapped gap to the next mapped byte', async () => {
        S.parseResult = {
            records: [], recordCount: 0,
            segments: [
                { startAddress: 0x1000, data: [1, 2] },
                { startAddress: 0x1100, data: [3, 4] },
            ],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        const { initFlatBytes } = await import('../../webview/memory/memoryData.js');
        initFlatBytes();
        const { walkMappedAddress } = await import('../../webview/hexViewer.js');
        assert.strictEqual(walkMappedAddress(0x1001, 'right'), 0x1100, 'jumps the gap');
        assert.strictEqual(walkMappedAddress(0x1100, 'left'), 0x1001, 'jumps the gap backwards');
    });

    test('vertical movement preserves the column across a gap', async () => {
        S.parseResult = {
            records: [], recordCount: 0,
            segments: [
                { startAddress: 0x1000, data: Array.from({ length: 16 }, (_, i) => i) },
                { startAddress: 0x1020, data: Array.from({ length: 16 }, (_, i) => i) },
            ],
            totalDataBytes: 32, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        const { initFlatBytes } = await import('../../webview/memory/memoryData.js');
        initFlatBytes();
        const { walkMappedAddress } = await import('../../webview/hexViewer.js');
        assert.strictEqual(walkMappedAddress(0x102B, 'up'), 0x100B, 'up keeps column 0B, not the 0F row edge');
        assert.strictEqual(walkMappedAddress(0x100B, 'down'), 0x102B, 'down keeps column 0B, not the 00 row start');
    });

    test('vertical movement falls back to the row edge when the column is unmapped in a short row', async () => {
        S.parseResult = {
            records: [], recordCount: 0,
            segments: [
                { startAddress: 0x1000, data: Array.from({ length: 16 }, (_, i) => i) },
                { startAddress: 0x1010, data: [1, 2, 3] },
                { startAddress: 0x1020, data: Array.from({ length: 16 }, (_, i) => i) },
            ],
            totalDataBytes: 35, checksumErrors: 0, malformedLines: 0, format: 'ihex',
        };
        const { initFlatBytes } = await import('../../webview/memory/memoryData.js');
        initFlatBytes();
        const { walkMappedAddress } = await import('../../webview/hexViewer.js');
        assert.strictEqual(walkMappedAddress(0x1012, 'up'), 0x1002, 'same column mapped above');
        assert.strictEqual(walkMappedAddress(0x100B, 'down'), 0x1010, 'column 0B unmapped below — falls back to row start');
    });
});

