import * as assert from 'assert';
import { JSDOM } from 'jsdom';

import { esc, fmtB, byteClass } from '../../webview/utils';
import { S, BPR } from '../../webview/state';
import { initFlatBytes, buildMemRows, getByte } from '../../webview/memory/memoryData';
import { integrityHighlightClass } from '../../webview/memory/memoryView';
import { rerender } from '../../webview/render/registry';
import {
    calcRowOffset,
    calcScrollLayout,
    calcTotalHeight,
    logicalToPhysicalScroll,
    physicalToLogicalScroll,
    type VirtualScrollState,
} from '../../webview/render/memoryVirtualScroll';

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
    S.integrityHighlight = null;
    S.sidebarTab       = 'inspector';
}

function installWebviewDom(markup: string): JSDOM {
    const dom = new JSDOM(markup, { url: 'https://hexscope.test/' });
    const globals = globalThis as unknown as {
        window: Window;
        document: Document;
        getComputedStyle: typeof getComputedStyle;
        localStorage: Storage;
        acquireVsCodeApi: () => unknown;
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
    rerender.toMemory = () => {};
    rerender.jumpTo = () => {};
    dom.window.close();
    delete (globalThis as unknown as { window?: Window }).window;
    delete (globalThis as unknown as { document?: Document }).document;
    delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
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
        const { renderMemBody, scrollTo } = await import('../../webview/memory/memoryView.js');
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

        const { renderSegments } = await import('../../webview/sidebar/sidebar.js');
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
        const { renderSegments } = await import('../../webview/sidebar/sidebar.js');
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
            document.getElementById('sidebar-btn-be')!.click();
            assert.strictEqual(S.endian, 'be');
            assert.deepStrictEqual(posted.at(-1), { type: 'saveEndian', endian: 'be' });
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
            const view = await import('../../webview/sidebar/integrity/index.js');
            const { calculateIntegrity } = await import('../../core/integrity.js');
            S.edits.clear();
            S.endian = 'le';
            view.renderIntegrity();
            view.activateIntegrity();
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
            view.notifyIntegrityEndianChanged();
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
            view.setIntegrityProfiles([]);
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
            view.notifyIntegrityBytesChanged();
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
            view.notifyIntegrityEndianChanged();
            view.setIntegrityProfiles([{
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

            const stagedTransactions: Array<Array<[number, number]>> = [];
            view.setIntegrityEditHandler(edits => {
                stagedTransactions.push(edits);
                edits.forEach(([address, value]) => S.edits.set(address, value));
                view.notifyIntegrityBytesChanged();
            });
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
            view.notifyIntegrityEditsDiscarded();
            await waitForIntegrityCalculation();
            assert.strictEqual(integrityCard(1).querySelector('[data-check-status]')!.textContent, '✕');
            assert.strictEqual(stagedTransactions.length, 1, 'Discard must not immediately re-stage Auto fix');
            assert.ok(integrityCard(1).querySelector('.integrity-auto-fix')!.classList.contains('paused'));
            assert.ok(integrityCard(1).querySelector<HTMLInputElement>('[data-auto-fix]')!.checked);
            view.notifyIntegrityBytesChanged();
            await waitForIntegrityCalculation();
            assert.strictEqual(stagedTransactions.length, 1, 'identical mismatch remains suppressed');
            assert.ok(!(document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);
            document.getElementById('integrity-fix-all')!.click();
            assert.strictEqual(stagedTransactions.length, 2);
            await assertIntegrityRecalculationCompletes(1);
            assert.ok((document.getElementById('integrity-fix-all') as HTMLButtonElement).disabled);

            S.edits.clear();
            view.notifyIntegrityEditsDiscarded();
            await waitForIntegrityCalculation();
            const rearmAutoFix = integrityCard(1).querySelector<HTMLInputElement>('[data-auto-fix]')!;
            rearmAutoFix.checked = false;
            rearmAutoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            rearmAutoFix.checked = true;
            rearmAutoFix.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
            assert.strictEqual(stagedTransactions.length, 3, 'toggle off/on overrides suppression');
            await assertIntegrityRecalculationCompletes(1);

            S.endian = 'be';
            view.notifyIntegrityEndianChanged();
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

            view.setIntegrityChecks({
                schemaVersion: 1,
                checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x1002, autoFixStoredValue: false }],
            });
            view.renderIntegrity();
            assert.strictEqual(document.querySelectorAll('.integrity-card').length, 1);
            assert.strictEqual(document.getElementById('integrity-btn-le'), null);
        } finally {
            api.vscode.postMessage = originalPostMessage;
        }
    });
});
