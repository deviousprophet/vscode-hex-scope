import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseIntelHex } from '../parser/IntelHexParser';

// Sample files are at <workspace-root>/sample/ihex/; tests compile to out/test/
const SAMPLES  = path.resolve(__dirname, '..', '..', 'sample');
const IHEX_DIR = path.join(SAMPLES, 'ihex');
const loadHex  = (name: string) => fs.readFileSync(path.join(IHEX_DIR, name), 'utf8');

// ── minimal.hex ─────────────────────────────────────────────────────────────
// A hand-crafted file using only 16-bit addressing.  Two disjoint
// address ranges: 0x0000–0x0007 and 0x0030–0x004F (40 bytes total).

suite('sample: minimal.hex', () => {
    let r: ReturnType<typeof parseIntelHex>;
    setup(() => { r = parseIntelHex(loadHex('minimal.hex')); });

    test('no parse errors', () => {
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
    });

    test('file yields exactly 5 records (4 data + EOF)', () => {
        assert.strictEqual(r.records.length, 5);
    });

    test('all addresses fit within 16 bits (no extended addressing used)', () => {
        for (const rec of r.records.filter(rec => rec.recordType === 0x00)) {
            assert.ok(rec.resolvedAddress <= 0xFFFF,
                `address 0x${rec.resolvedAddress.toString(16)} exceeds 16-bit range`);
        }
    });

    test('two disjoint address ranges produce at least 2 segments', () => {
        assert.ok(r.segments.length >= 2);
    });

    test('totalDataBytes equals the sum of all segment data lengths', () => {
        const total = r.segments.reduce((acc, s) => acc + s.data.length, 0);
        assert.strictEqual(r.totalDataBytes, total);
    });

    test('total data byte count is 40', () => {
        assert.strictEqual(r.totalDataBytes, 40);
    });
});

// ── firmware.hex ─────────────────────────────────────────────────────────────
// STM32-style image with two Extended Linear Address records and a
// known 0xDEADBEEF sentinel in one of the data records.

suite('sample: firmware.hex', () => {
    let r: ReturnType<typeof parseIntelHex>;
    setup(() => { r = parseIntelHex(loadHex('firmware.hex')); });

    test('parses cleanly with no errors', () => {
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
    });

    test('total record count is 9', () => {
        assert.strictEqual(r.records.length, 9);
    });

    test('at least two Extended Linear Address (type 04) records are present', () => {
        const elaCount = r.records.filter(rec => rec.recordType === 0x04).length;
        assert.ok(elaCount >= 2, `expected >=2 ELA records, got ${elaCount}`);
    });

    test('first memory segment starts at 0x08000000', () => {
        assert.strictEqual(r.segments[0].startAddress, 0x08000000);
    });

    test('firmware occupies multiple non-contiguous segments', () => {
        assert.ok(r.segments.length >= 2);
    });

    test('0xDEADBEEF sentinel bytes are present in parsed memory', () => {
        const flat: number[] = [];
        for (const seg of r.segments) { flat.push(...seg.data); }
        const magic = [0xDE, 0xAD, 0xBE, 0xEF];
        const found = flat.some((_, i) => magic.every((b, j) => flat[i + j] === b));
        assert.ok(found, '0xDEADBEEF bytes not found in any segment');
    });
});

// ── stm32_16bpr.hex ──────────────────────────────────────────────────────────
// Standard 16-bytes-per-record STM32 firmware image.

suite('sample: stm32_16bpr.hex', () => {
    let r: ReturnType<typeof parseIntelHex>;
    setup(() => { r = parseIntelHex(loadHex('stm32_16bpr.hex')); });

    test('no parse errors', () => {
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
    });

    test('all data records use at most 16 bytes per row', () => {
        for (const rec of r.records.filter(rec => rec.recordType === 0x00)) {
            assert.ok(rec.byteCount <= 16,
                `unexpected byteCount ${rec.byteCount} at line ${rec.lineNumber}`);
        }
    });

    test('total data byte count is 262', () => {
        assert.strictEqual(r.totalDataBytes, 262);
    });

    test('first segment starts at 0x08000000', () => {
        assert.strictEqual(r.segments[0].startAddress, 0x08000000);
    });

    test('last segment in file order starts at 0x08010000', () => {
        assert.strictEqual(r.segments[r.segments.length - 1].startAddress, 0x08010000);
    });

    test('there is an address gap between the first and last segments', () => {
        const first = r.segments[0];
        const last  = r.segments[r.segments.length - 1];
        assert.ok(last.startAddress > first.startAddress + first.data.length,
            'expected a gap between first and last segment');
    });
});

// ── stm32_32bpr.hex ──────────────────────────────────────────────────────────
// Same firmware as stm32_16bpr.hex but encoded with 32-byte-wide records.
// The parsed memory content must be identical.

suite('sample: stm32_32bpr.hex', () => {
    let r32: ReturnType<typeof parseIntelHex>;
    let r16: ReturnType<typeof parseIntelHex>;
    setup(() => {
        r32 = parseIntelHex(loadHex('stm32_32bpr.hex'));
        r16 = parseIntelHex(loadHex('stm32_16bpr.hex'));
    });

    test('no parse errors', () => {
        assert.strictEqual(r32.checksumErrors, 0);
        assert.strictEqual(r32.malformedLines, 0);
    });

    test('at least one data record uses 32 bytes per row', () => {
        const has32 = r32.records.some(rec => rec.recordType === 0x00 && rec.byteCount === 32);
        assert.ok(has32, 'no 32-byte data record found');
    });

    test('produces the same total byte count as the 16-bpr variant', () => {
        assert.strictEqual(r32.totalDataBytes, r16.totalDataBytes);
    });

    test('produces the same number of segments as the 16-bpr variant', () => {
        assert.strictEqual(r32.segments.length, r16.segments.length);
    });

    test('segment data is byte-for-byte identical to the 16-bpr variant', () => {
        for (let i = 0; i < r32.segments.length; i++) {
            assert.strictEqual(r32.segments[i].startAddress, r16.segments[i].startAddress,
                `segment ${i}: start address mismatch`);
            assert.deepStrictEqual(
                Array.from(r32.segments[i].data),
                Array.from(r16.segments[i].data),
                `segment ${i}: data mismatch`
            );
        }
    });
});

// ── errors.hex ───────────────────────────────────────────────────────────────
// A file that deliberately contains two bad checksums and one malformed line.

suite('sample: errors.hex', () => {
    let r: ReturnType<typeof parseIntelHex>;
    setup(() => { r = parseIntelHex(loadHex('errors.hex')); });

    test('detects exactly 2 checksum errors', () => {
        assert.strictEqual(r.checksumErrors, 2);
    });

    test('detects exactly 1 malformed line', () => {
        assert.strictEqual(r.malformedLines, 1);
    });

    test('the malformed record carries a "Missing start code" message', () => {
        const bad = r.records.find(rec => rec.error !== undefined && !rec.raw.startsWith(':'));
        assert.ok(bad, 'no malformed record found');
        assert.ok(bad!.error!.includes('Missing start code'));
    });

    test('only valid records contribute bytes to segments', () => {
        const validBytes = r.records
            .filter(rec => rec.recordType === 0x00 && rec.checksumValid && !rec.error)
            .reduce((sum, rec) => sum + rec.byteCount, 0);
        const segBytes = r.segments.reduce((sum, s) => sum + s.data.length, 0);
        assert.strictEqual(segBytes, validBytes);
    });
});
