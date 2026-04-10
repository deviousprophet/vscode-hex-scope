import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseIntelHex } from '../parser/IntelHexParser';
import { parseSRec } from '../parser/SRecParser';

// Sample files are at <workspace-root>/sample/; tests compile to out/test/
const SAMPLES     = path.resolve(__dirname, '..', '..', 'sample');
const IHEX_DIR    = path.join(SAMPLES, 'ihex');
const SREC_DIR    = path.join(SAMPLES, 'srec');
const loadHex     = (name: string) => fs.readFileSync(path.join(IHEX_DIR, name), 'utf8');
const loadSrec    = (name: string) => fs.readFileSync(path.join(SREC_DIR, name), 'utf8');

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
        assert.ok(elaCount >= 2, `expected \u22652 ELA records, got ${elaCount}`);
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

// ════════════════════════════════════════════════════════════════════════════
// SREC sample files
// ════════════════════════════════════════════════════════════════════════════

// ── minimal.srec ─────────────────────────────────────────────────────────────
// Simplest valid SREC file: S0 header + 2 contiguous S1 data records +
// S5 record count + S9 end-of-file.
// Single segment at 0x0000 totalling 16 bytes.

suite('sample/srec: minimal.srec', () => {
    let r: ReturnType<typeof parseSRec>;
    setup(() => { r = parseSRec(loadSrec('minimal.srec')); });

    test('no parse errors', () => {
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
    });

    test('yields exactly 5 records (S0 + 2×S1 + S5 + S9)', () => {
        assert.strictEqual(r.records.length, 5);
    });

    test('contains an S0 header record', () => {
        assert.ok(r.records.some(rec => rec.recordType === 0));
    });

    test('contains an S9 end-of-file record', () => {
        assert.ok(r.records.some(rec => rec.recordType === 9));
    });

    test('produces exactly 1 segment', () => {
        assert.strictEqual(r.segments.length, 1);
    });

    test('segment starts at address 0x0000', () => {
        assert.strictEqual(r.segments[0].startAddress, 0x0000);
    });

    test('total data bytes is 16', () => {
        assert.strictEqual(r.totalDataBytes, 16);
    });

    test('totalDataBytes equals sum of segment lengths', () => {
        const sum = r.segments.reduce((acc, s) => acc + s.data.length, 0);
        assert.strictEqual(r.totalDataBytes, sum);
    });

    test('all S1 records fit within 16-bit address space', () => {
        for (const rec of r.records.filter(rec => rec.recordType === 1)) {
            assert.ok(rec.resolvedAddress <= 0xFFFF,
                `address 0x${rec.resolvedAddress.toString(16)} exceeds 16-bit range`);
        }
    });

    test('all record checksums are valid', () => {
        for (const rec of r.records.filter(rec => !rec.error)) {
            assert.ok(rec.checksumValid,
                `checksum invalid on line ${rec.lineNumber}: ${rec.raw}`);
        }
    });
});

// ── firmware_s1.srec ──────────────────────────────────────────────────────────
// 8051-style SREC using S1 (2-byte address) records.
// Mirrors the content of ihex/minimal.hex.
// Two segments: 0x0000–0x0007 (reset + padding) and 0x0030–0x004F (code).

suite('sample/srec: firmware_s1.srec', () => {
    let r: ReturnType<typeof parseSRec>;
    setup(() => { r = parseSRec(loadSrec('firmware_s1.srec')); });

    test('no parse errors', () => {
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
    });

    test('yields 7 records (S0 + 4×S1 + S5 + S9)', () => {
        assert.strictEqual(r.records.length, 7);
    });

    test('uses only S1 data records', () => {
        const dataRecs = r.records.filter(rec => !rec.error && rec.recordType !== 0
            && rec.recordType !== 5 && rec.recordType !== 9);
        assert.ok(dataRecs.every(rec => rec.recordType === 1),
            'expected only S1 data records');
    });

    test('produces 2 segments', () => {
        assert.strictEqual(r.segments.length, 2);
    });

    test('first segment starts at 0x0000', () => {
        assert.strictEqual(r.segments[0].startAddress, 0x0000);
    });

    test('second segment starts at 0x0030', () => {
        assert.strictEqual(r.segments[1].startAddress, 0x0030);
    });

    test('total data bytes is 40', () => {
        assert.strictEqual(r.totalDataBytes, 40);
    });

    test('start address matches S9 execution address 0x0030', () => {
        assert.strictEqual(r.startAddress, 0x0030);
    });

    test('reset vector bytes 0x02,0x00,0x30 present at start of first segment', () => {
        assert.deepStrictEqual(
            Array.from(r.segments[0].data.slice(0, 3)),
            [0x02, 0x00, 0x30]
        );
    });
});

// ── firmware_s3.srec ──────────────────────────────────────────────────────────
// STM32-style SREC using S3 (4-byte address) records.
// Three segments at 0x08000000, 0x08002000, 0x08010000.
// Contains 0xDEADBEEF sentinel in the second segment.

suite('sample/srec: firmware_s3.srec', () => {
    let r: ReturnType<typeof parseSRec>;
    setup(() => { r = parseSRec(loadSrec('firmware_s3.srec')); });

    test('no parse errors', () => {
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
    });

    test('yields 9 records (S0 + 6×S3 + S5 + S7)', () => {
        assert.strictEqual(r.records.length, 9);
    });

    test('uses only S3 data records', () => {
        const dataRecs = r.records.filter(rec => !rec.error
            && rec.recordType !== 0 && rec.recordType !== 5 && rec.recordType !== 7);
        assert.ok(dataRecs.every(rec => rec.recordType === 3), 'expected only S3 data records');
    });

    test('produces 3 non-contiguous segments', () => {
        assert.strictEqual(r.segments.length, 3);
    });

    test('first segment starts at 0x08000000', () => {
        assert.strictEqual(r.segments[0].startAddress, 0x08000000);
    });

    test('second segment starts at 0x08002000', () => {
        assert.strictEqual(r.segments[1].startAddress, 0x08002000);
    });

    test('third segment starts at 0x08010000', () => {
        assert.strictEqual(r.segments[2].startAddress, 0x08010000);
    });

    test('total data bytes is 103', () => {
        assert.strictEqual(r.totalDataBytes, 103);
    });

    test('S7 end record carries start address 0x08000141', () => {
        assert.strictEqual(r.startAddress, 0x08000141);
    });

    test('0xDEADBEEF sentinel bytes are present in parsed memory', () => {
        const flat: number[] = [];
        for (const seg of r.segments) { flat.push(...seg.data); }
        const magic = [0xDE, 0xAD, 0xBE, 0xEF];
        const found = flat.some((_, i) => magic.every((b, j) => flat[i + j] === b));
        assert.ok(found, '0xDEADBEEF bytes not found in any segment');
    });

    test('all records use 32-bit addresses (fits in 4-byte S3 addr field)', () => {
        for (const rec of r.records.filter(rec => rec.recordType === 3)) {
            assert.ok(rec.resolvedAddress >= 0x08000000,
                `address 0x${rec.resolvedAddress.toString(16)} unexpectedly small`);
        }
    });
});

// ── stm32_s3.srec ─────────────────────────────────────────────────────────────
// Realistic STM32F103-class image in S3 format:
// vector table at 0x08000000, code at 0x080000C0, flash/string data
// at 0x08010000 onward. 264 total bytes across 5 segments.

suite('sample/srec: stm32_s3.srec', () => {
    let r: ReturnType<typeof parseSRec>;
    setup(() => { r = parseSRec(loadSrec('stm32_s3.srec')); });

    test('no parse errors', () => {
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
    });

    test('all records have valid checksums', () => {
        for (const rec of r.records.filter(rec => !rec.error)) {
            assert.ok(rec.checksumValid, `checksum invalid on line ${rec.lineNumber}`);
        }
    });

    test('produces 20 records', () => {
        assert.strictEqual(r.records.length, 20);
    });

    test('total data bytes is 264', () => {
        assert.strictEqual(r.totalDataBytes, 264);
    });

    test('first segment starts at 0x08000000 (vector table)', () => {
        assert.strictEqual(r.segments[0].startAddress, 0x08000000);
    });

    test('vector table segment is 128 bytes', () => {
        assert.strictEqual(r.segments[0].data.length, 128);
    });

    test('code segment starts at 0x080000C0', () => {
        const codeSeg = r.segments.find(s => s.startAddress === 0x080000C0);
        assert.ok(codeSeg, 'code segment at 0x080000C0 not found');
    });

    test('code segment is 70 bytes', () => {
        const codeSeg = r.segments.find(s => s.startAddress === 0x080000C0);
        assert.strictEqual(codeSeg!.data.length, 70);
    });

    test('there is a large address gap between code and flash config', () => {
        const codeSeg = r.segments.find(s => s.startAddress === 0x080000C0)!;
        const flashSeg = r.segments.find(s => s.startAddress === 0x08010000);
        assert.ok(flashSeg, 'flash config segment at 0x08010000 not found');
        assert.ok(flashSeg!.startAddress > codeSeg.startAddress + codeSeg.data.length,
            'expected address gap between code and flash config');
    });

    test('S7 end record carries start address 0x080000C1', () => {
        assert.strictEqual(r.startAddress, 0x080000C1);
    });
});

// ── mixed_addr.srec ───────────────────────────────────────────────────────────
// File combining S1, S2, and S3 record types within the same image.
// Tests that the parser resolves all three address sizes correctly.

suite('sample/srec: mixed_addr.srec', () => {
    let r: ReturnType<typeof parseSRec>;
    setup(() => { r = parseSRec(loadSrec('mixed_addr.srec')); });

    test('no parse errors', () => {
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
    });

    test('contains S1, S2, and S3 data records', () => {
        const types = new Set(r.records.filter(rec => !rec.error).map(rec => rec.recordType));
        assert.ok(types.has(1), 'missing S1 record');
        assert.ok(types.has(2), 'missing S2 record');
        assert.ok(types.has(3), 'missing S3 record');
    });

    test('produces 3 segments across distinct address ranges', () => {
        assert.strictEqual(r.segments.length, 3);
    });

    test('S1 data record resolves to 16-bit address 0x0100', () => {
        const seg = r.segments.find(s => s.startAddress === 0x0100);
        assert.ok(seg, 'segment at 0x0100 not found');
    });

    test('S2 data record resolves to 24-bit address 0x100000', () => {
        const seg = r.segments.find(s => s.startAddress === 0x100000);
        assert.ok(seg, 'segment at 0x100000 not found');
    });

    test('S3 data record resolves to 32-bit address 0x08000000', () => {
        const seg = r.segments.find(s => s.startAddress === 0x08000000);
        assert.ok(seg, 'segment at 0x08000000 not found');
    });

    test('S3 segment data contains 0xDEADBEEF 0xCAFEBABE', () => {
        const seg = r.segments.find(s => s.startAddress === 0x08000000)!;
        assert.deepStrictEqual(
            Array.from(seg.data),
            [0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE]
        );
    });

    test('total data bytes equals sum of all segment lengths', () => {
        const sum = r.segments.reduce((acc, s) => acc + s.data.length, 0);
        assert.strictEqual(r.totalDataBytes, sum);
    });
});

// ── errors.srec ───────────────────────────────────────────────────────────────
// Deliberately broken file: 2 records with corrupt checksums and 1
// malformed (non-SREC) line. Only the single valid data record contributes
// to segments.

suite('sample/srec: errors.srec', () => {
    let r: ReturnType<typeof parseSRec>;
    setup(() => { r = parseSRec(loadSrec('errors.srec')); });

    test('detects exactly 2 checksum errors', () => {
        assert.strictEqual(r.checksumErrors, 2);
    });

    test('detects exactly 1 malformed line', () => {
        assert.strictEqual(r.malformedLines, 1);
    });

    test('malformed record carries a "Missing S start code" error', () => {
        const bad = r.records.find(rec => rec.error !== undefined && !/^S[0-9]/i.test(rec.raw));
        assert.ok(bad, 'no malformed record found');
        assert.ok(bad!.error!.toLowerCase().includes('missing'), `unexpected error: ${bad!.error}`);
    });

    test('only valid checksum records contribute bytes to segments', () => {
        const validBytes = r.records
            .filter(rec => (rec.recordType === 1 || rec.recordType === 2 || rec.recordType === 3)
                && rec.checksumValid && !rec.error)
            .reduce((sum, rec) => sum + rec.byteCount - 3, 0); // subtract 2-byte addr + 1-byte chk
        const segBytes = r.segments.reduce((sum, s) => sum + s.data.length, 0);
        assert.strictEqual(segBytes, validBytes);
    });

    test('exactly 1 segment from the single valid data record', () => {
        assert.strictEqual(r.segments.length, 1);
    });

    test('that segment starts at 0x0020', () => {
        assert.strictEqual(r.segments[0].startAddress, 0x0020);
    });

    test('that segment contains exactly 3 bytes', () => {
        assert.strictEqual(r.segments[0].data.length, 3);
        assert.deepStrictEqual(Array.from(r.segments[0].data), [0x44, 0x55, 0x66]);
    });
});

// ── Edge cases across SREC samples ────────────────────────────────────────────

suite('sample/srec: cross-file edge cases', () => {

    test('S1 and S3 files produce structurally equivalent segments when data is the same', () => {
        // firmware_s1 and ihex/minimal both encode LJMP+padding at 0x0000 and code at 0x0030
        const sri = parseSRec(loadSrec('firmware_s1.srec'));
        const ihx = parseIntelHex(loadHex('minimal.hex'));
        assert.strictEqual(sri.totalDataBytes, ihx.totalDataBytes,
            'SREC and IHEX should have same total bytes for equivalent content');
        assert.strictEqual(sri.segments.length, ihx.segments.length,
            'SREC and IHEX should produce the same number of segments');
        for (let i = 0; i < sri.segments.length; i++) {
            assert.strictEqual(sri.segments[i].startAddress, ihx.segments[i].startAddress,
                `segment ${i} start address mismatch`);
            assert.deepStrictEqual(
                Array.from(sri.segments[i].data),
                Array.from(ihx.segments[i].data),
                `segment ${i} data mismatch`
            );
        }
    });

    test('mixed_addr: all three address width records parse without errors', () => {
        const r = parseSRec(loadSrec('mixed_addr.srec'));
        assert.strictEqual(r.checksumErrors, 0);
        assert.strictEqual(r.malformedLines, 0);
        assert.strictEqual(r.records.filter(rec => rec.error).length, 0);
    });

    test('errors.srec: no valid data from corrupt records', () => {
        const r = parseSRec(loadSrec('errors.srec'));
        const corruptRecs = r.records.filter(rec => !rec.checksumValid && !rec.error);
        assert.ok(corruptRecs.length === 2, 'expected exactly 2 records with bad checksums');
        // Corrupt records must not appear in any segment data
        for (const rec of corruptRecs) {
            const inSeg = r.segments.some(s =>
                rec.resolvedAddress >= s.startAddress &&
                rec.resolvedAddress < s.startAddress + s.data.length
            );
            assert.ok(!inSeg,
                `corrupt record at 0x${rec.resolvedAddress.toString(16)} should not be in segments`);
        }
    });

    test('stm32_s3: start address from S7 record is reasonable (code region)', () => {
        const r = parseSRec(loadSrec('stm32_s3.srec'));
        assert.ok(r.startAddress !== undefined, 'startAddress should be set from S7 record');
        assert.ok(r.startAddress! >= 0x08000000 && r.startAddress! < 0x08020000,
            `start address 0x${r.startAddress!.toString(16)} is outside expected STM32 flash range`);
    });

    test('firmware_s3: each segment occupies a distinct address range with no overlap', () => {
        const r = parseSRec(loadSrec('firmware_s3.srec'));
        const sorted = [...r.segments].sort((a, b) => a.startAddress - b.startAddress);
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            assert.ok(curr.startAddress >= prev.startAddress + prev.data.length,
                `segments ${i-1} and ${i} overlap`);
        }
    });

    test('all SREC sample files parse without throwing', () => {
        const files = ['minimal.srec','firmware_s1.srec','firmware_s3.srec','stm32_s3.srec','mixed_addr.srec','errors.srec'];
        for (const f of files) {
            assert.doesNotThrow(() => parseSRec(loadSrec(f)), `parseSRec threw on ${f}`);
        }
    });
});

