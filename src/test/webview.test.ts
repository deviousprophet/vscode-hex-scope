import * as assert from 'assert';

import { esc, fmtB, byteClass } from '../webview/utils';
import { S, BPR } from '../webview/state';
import { initFlatBytes, buildMemRows } from '../webview/data';

function resetState(): void {
    S.parseResult  = null;
    S.labels       = [];
    S.flatBytes.clear();
    S.sortedAddrs  = [];
    S.memRows      = [];
    S.selStart     = null;
    S.selEnd       = null;
    S.matchAddrs   = [];
    S.matchIdx     = -1;
    S.currentView  = 'memory';
}

// ── HTML escaping \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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

// ── Byte size formatting \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

suite('fmtB()', () => {
    test('0 bytes', () => { assert.strictEqual(fmtB(0), '0 B'); });
    test('1 byte', () => { assert.strictEqual(fmtB(1), '1 B'); });
    test('1023 bytes stays in B', () => { assert.strictEqual(fmtB(1023), '1023 B'); });
    test('1024 bytes is 1.0 KB', () => { assert.strictEqual(fmtB(1024), '1.0 KB'); });
    test('1536 bytes is 1.5 KB', () => { assert.strictEqual(fmtB(1536), '1.5 KB'); });
    test('1 MB', () => { assert.strictEqual(fmtB(1024 * 1024), '1.0 MB'); });
    test('2.5 MB', () => { assert.strictEqual(fmtB(1024 * 1024 * 2.5), '2.5 MB'); });
});

// ── Byte CSS class \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

suite('byteClass()', () => {
    test('0x00 \u2192 "bz" (zero)', () => {
        assert.strictEqual(byteClass(0x00), 'bz');
    });
    test('0x20 (space) \u2192 "bp" (printable)', () => {
        assert.strictEqual(byteClass(0x20), 'bp');
    });
    test('0x41 ("A") \u2192 "bp"', () => {
        assert.strictEqual(byteClass(0x41), 'bp');
    });
    test('0x7E ("~") \u2192 "bp"', () => {
        assert.strictEqual(byteClass(0x7E), 'bp');
    });
    test('0x7F (DEL) \u2192 "bn" (non-printable)', () => {
        assert.strictEqual(byteClass(0x7F), 'bn');
    });
    test('0x01 (control) \u2192 "bn"', () => {
        assert.strictEqual(byteClass(0x01), 'bn');
    });
    test('0x80 \u2192 "bh" (high byte)', () => {
        assert.strictEqual(byteClass(0x80), 'bh');
    });
    test('0xFF \u2192 "bh"', () => {
        assert.strictEqual(byteClass(0xFF), 'bh');
    });
});

// ── State initial values \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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
    test('default search mode is "hex"', () => {
        assert.strictEqual(S.searchMode, 'hex');
    });
});

// ── initFlatBytes() \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

suite('initFlatBytes()', () => {
    setup(resetState);

    test('clears map when parseResult is null', () => {
        S.flatBytes.set(0, 0xFF);
        initFlatBytes();
        assert.strictEqual(S.flatBytes.size, 0);
        assert.strictEqual(S.sortedAddrs.length, 0);
    });

    test('populates flatBytes from a single segment', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x1000, data: [0xDE, 0xAD, 0xBE, 0xEF] }],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0,
        };
        initFlatBytes();
        assert.strictEqual(S.flatBytes.get(0x1000), 0xDE);
        assert.strictEqual(S.flatBytes.get(0x1001), 0xAD);
        assert.strictEqual(S.flatBytes.get(0x1002), 0xBE);
        assert.strictEqual(S.flatBytes.get(0x1003), 0xEF);
        assert.strictEqual(S.flatBytes.size, 4);
    });

    test('populates flatBytes from two non-contiguous segments', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0000, data: [0x01, 0x02] },
                { startAddress: 0x0200, data: [0x03, 0x04] },
            ],
            totalDataBytes: 4, checksumErrors: 0, malformedLines: 0,
        };
        initFlatBytes();
        assert.strictEqual(S.flatBytes.size, 4);
        assert.strictEqual(S.flatBytes.get(0x0000), 0x01);
        assert.strictEqual(S.flatBytes.get(0x0200), 0x03);
        assert.strictEqual(S.flatBytes.get(0x0100), undefined);
    });

    test('sortedAddrs is in ascending address order', () => {
        S.parseResult = {
            records: [],
            segments: [
                { startAddress: 0x0300, data: [0xAA] },
                { startAddress: 0x0100, data: [0xBB] },
            ],
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0,
        };
        initFlatBytes();
        assert.deepStrictEqual(S.sortedAddrs, [0x0100, 0x0300]);
    });
});

// ── buildMemRows() \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

suite('buildMemRows()', () => {
    setup(resetState);

    test('produces no rows when flatBytes is empty', () => {
        buildMemRows();
        assert.strictEqual(S.memRows.length, 0);
    });

    test('a single 16-byte segment produces one data row, no gap', () => {
        S.parseResult = {
            records: [],
            segments: [{ startAddress: 0x0000, data: new Array(16).fill(0xAA) }],
            totalDataBytes: 16, checksumErrors: 0, malformedLines: 0,
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
            totalDataBytes: 3, checksumErrors: 0, malformedLines: 0,
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
            totalDataBytes: 32, checksumErrors: 0, malformedLines: 0,
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
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0,
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
            totalDataBytes: 2, checksumErrors: 0, malformedLines: 0,
        };
        initFlatBytes();
        buildMemRows();
        const dataRows = S.memRows.filter(r => r.type === 'data');
        assert.ok(dataRows.length >= 2);
        for (let i = 1; i < dataRows.length; i++) {
            assert.ok(dataRows[i].type === 'data' && dataRows[i-1].type === 'data');
            assert.ok(dataRows[i].address > dataRows[i-1].address);
        }
    });
});

