import * as assert from 'assert';
import { parseSRec, SREC_ADDR_SIZES, srecIsData } from '../parser/SRecParser';

suite('SRecParser', () => {

    // ── Test record builders ──────────────────────────────────────────────

    /**
     * Build a valid S1 (2-byte address) data record.
     */
    function s1Rec(addr: number, bytes: number[]): string {
        const asz = 2;
        const byteCount = asz + bytes.length + 1;
        let sum = byteCount;
        sum += (addr >> 8) & 0xFF;
        sum += addr & 0xFF;
        for (const b of bytes) { sum += b; }
        const chk = (~sum) & 0xFF;
        const addrHex = addr.toString(16).toUpperCase().padStart(4, '0');
        const dataHex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        const bcHex = byteCount.toString(16).toUpperCase().padStart(2, '0');
        const chkHex = chk.toString(16).toUpperCase().padStart(2, '0');
        return `S1${bcHex}${addrHex}${dataHex}${chkHex}`;
    }

    /**
     * Build a valid S2 (3-byte address) data record.
     */
    function s2Rec(addr: number, bytes: number[]): string {
        const asz = 3;
        const byteCount = asz + bytes.length + 1;
        let sum = byteCount;
        sum += (addr >> 16) & 0xFF;
        sum += (addr >> 8) & 0xFF;
        sum += addr & 0xFF;
        for (const b of bytes) { sum += b; }
        const chk = (~sum) & 0xFF;
        const addrHex = addr.toString(16).toUpperCase().padStart(6, '0');
        const dataHex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        const bcHex = byteCount.toString(16).toUpperCase().padStart(2, '0');
        const chkHex = chk.toString(16).toUpperCase().padStart(2, '0');
        return `S2${bcHex}${addrHex}${dataHex}${chkHex}`;
    }

    /**
     * Build a valid S3 (4-byte address) data record.
     */
    function s3Rec(addr: number, bytes: number[]): string {
        const asz = 4;
        const byteCount = asz + bytes.length + 1;
        let sum = byteCount;
        sum += (addr >>> 24) & 0xFF;
        sum += (addr >> 16) & 0xFF;
        sum += (addr >> 8) & 0xFF;
        sum += addr & 0xFF;
        for (const b of bytes) { sum += b; }
        const chk = (~sum) & 0xFF;
        const addrHex = (addr >>> 0).toString(16).toUpperCase().padStart(8, '0');
        const dataHex = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        const bcHex = byteCount.toString(16).toUpperCase().padStart(2, '0');
        const chkHex = chk.toString(16).toUpperCase().padStart(2, '0');
        return `S3${bcHex}${addrHex}${dataHex}${chkHex}`;
    }

    /** Build a valid S9 end-of-file record (2-byte start address). */
    function s9Rec(startAddr: number = 0): string {
        const asz = 2;
        const byteCount = asz + 1;
        let sum = byteCount + ((startAddr >> 8) & 0xFF) + (startAddr & 0xFF);
        const chk = (~sum) & 0xFF;
        const addrHex = startAddr.toString(16).toUpperCase().padStart(4, '0');
        return `S903${addrHex}${chk.toString(16).toUpperCase().padStart(2, '0')}`;
    }

    /** Build a valid S0 header record. */
    function s0Rec(name: string): string {
        const asz = 2;
        const dataBytes = Array.from(new TextEncoder().encode(name));
        const byteCount = asz + dataBytes.length + 1;
        let sum = byteCount + 0 + 0; // address = 0x0000
        for (const b of dataBytes) { sum += b; }
        const chk = (~sum) & 0xFF;
        const dataHex = dataBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        const bcHex = byteCount.toString(16).toUpperCase().padStart(2, '0');
        const chkHex = chk.toString(16).toUpperCase().padStart(2, '0');
        return `S0${bcHex}0000${dataHex}${chkHex}`;
    }

    // ── Basic parsing ─────────────────────────────────────────────────────

    test('parses a well-formed S1 data record', () => {
        const src = [s1Rec(0x0010, [0xCA, 0xFE, 0xBA, 0xBE]), s9Rec()].join('\n');
        const result = parseSRec(src);

        assert.strictEqual(result.records.length, 2);
        const r = result.records[0];
        assert.strictEqual(r.recordType, 1);
        assert.strictEqual(r.byteCount, 7); // 2 addr + 4 data + 1 chk
        assert.strictEqual(r.address, 0x0010);
        assert.strictEqual(r.resolvedAddress, 0x0010);
        assert.deepStrictEqual(Array.from(r.data), [0xCA, 0xFE, 0xBA, 0xBE]);
        assert.strictEqual(r.checksumValid, true);
        assert.strictEqual(r.error, undefined);
    });

    test('parses a well-formed S2 data record (3-byte address)', () => {
        const src = [s2Rec(0xAB1234, [0x01, 0x02]), s9Rec()].join('\n');
        const result = parseSRec(src);
        const r = result.records[0];
        assert.strictEqual(r.recordType, 2);
        assert.strictEqual(r.address, 0xAB1234);
        assert.strictEqual(r.resolvedAddress, 0xAB1234);
        assert.deepStrictEqual(Array.from(r.data), [0x01, 0x02]);
        assert.strictEqual(r.checksumValid, true);
    });

    test('parses a well-formed S3 data record (4-byte address)', () => {
        const src = [s3Rec(0x08001000, [0xDE, 0xAD, 0xBE, 0xEF]), s9Rec()].join('\n');
        const result = parseSRec(src);
        const r = result.records[0];
        assert.strictEqual(r.recordType, 3);
        assert.strictEqual(r.address, 0x08001000);
        assert.strictEqual(r.resolvedAddress, 0x08001000);
        assert.deepStrictEqual(Array.from(r.data), [0xDE, 0xAD, 0xBE, 0xEF]);
        assert.strictEqual(r.checksumValid, true);
    });

    test('parses S0 header record', () => {
        const src = [s0Rec('HDR'), s1Rec(0, [0x01]), s9Rec()].join('\n');
        const result = parseSRec(src);
        const r = result.records[0];
        assert.strictEqual(r.recordType, 0);
        assert.strictEqual(r.checksumValid, true);
        assert.strictEqual(r.error, undefined);
    });

    test('parses S9 end-of-file record', () => {
        const src = [s1Rec(0, [0xFF]), s9Rec(0x0100)].join('\n');
        const result = parseSRec(src);
        const eof = result.records[1];
        assert.strictEqual(eof.recordType, 9);
        assert.strictEqual(eof.checksumValid, true);
        assert.strictEqual(result.startAddress, 0x0100);
    });

    test('blank lines are silently skipped', () => {
        const src = `\n${s1Rec(0, [0x11])}\n\n${s9Rec()}\n`;
        assert.strictEqual(parseSRec(src).records.length, 2);
    });

    test('CRLF line endings are handled', () => {
        const src = [s1Rec(0x0000, [0x01]), s1Rec(0x0001, [0x02]), s9Rec()].join('\r\n');
        const result = parseSRec(src);
        assert.strictEqual(result.records.length, 3);
        assert.strictEqual(result.records[0].checksumValid, true);
        assert.strictEqual(result.records[1].checksumValid, true);
    });

    // ── Checksum validation ───────────────────────────────────────────────

    test('detects a bad checksum', () => {
        const valid = s1Rec(0x0000, [0xAA, 0xBB]);
        // Flip the last two chars (checksum)
        const bad = valid.slice(0, -2) + '00';
        const result = parseSRec([bad, s9Rec()].join('\n'));
        assert.strictEqual(result.records[0].checksumValid, false);
        assert.strictEqual(result.checksumErrors, 1);
        assert.strictEqual(result.malformedLines, 0);
    });

    test('checksum-invalid records are excluded from segments', () => {
        const valid = s1Rec(0x0000, [0xAA]);
        const bad   = valid.slice(0, -2) + '00';
        const result = parseSRec([bad, s9Rec()].join('\n'));
        assert.strictEqual(result.segments.length, 0);
        assert.strictEqual(result.totalDataBytes, 0);
    });

    // ── Error handling ────────────────────────────────────────────────────

    test('detects missing S start code', () => {
        const result = parseSRec(':00000001FF\n' + s9Rec());
        assert.strictEqual(result.records[0].error, 'Missing "S" start code or line too short');
        assert.strictEqual(result.malformedLines, 1);
    });

    test('detects invalid record type character', () => {
        const result = parseSRec('SX0300001C\n' + s9Rec());
        assert.ok(result.records[0].error?.includes('Invalid record type character'));
        assert.strictEqual(result.malformedLines, 1);
    });

    test('detects non-hex characters', () => {
        const result = parseSRec('S10ZXXXX0102030405060708ZZ\n' + s9Rec());
        assert.ok(result.records[0].error);
        assert.strictEqual(result.malformedLines, 1);
    });

    test('detects wrong byte count', () => {
        // Build a record then truncate it
        const rec = s1Rec(0x0000, [0x01, 0x02, 0x03]);
        const truncated = rec.slice(0, -4); // remove 2 bytes
        const result = parseSRec([truncated, s9Rec()].join('\n'));
        assert.ok(result.records[0].error);
        assert.strictEqual(result.malformedLines, 1);
    });

    test('reserved S4 record type is flagged as malformed', () => {
        // S4 with byteCount=3, addr=0x0000, chk=0xFC
        const result = parseSRec(['S4030000FC', s9Rec()].join('\n'));
        assert.strictEqual(result.malformedLines, 1);
        assert.ok(result.records[0].error?.includes('Reserved record type'));
    });

    test('byte count too small for record type is flagged as malformed', () => {
        // S1 (asz=2) with byteCount=2—below minimum of 3; hex length=6 passes length check
        const result = parseSRec(['S10200FF', s9Rec()].join('\n'));
        assert.strictEqual(result.malformedLines, 1);
        assert.ok(result.records[0].error?.includes('too small'));
    });

    test('S9 end record with a data payload is flagged as malformed', () => {
        // S9 (asz=2) requires byteCount=3 exactly; byteCount=5 carries extra bytes
        // sum = 5+0x00+0x00+0xAA+0xBB = 362 → chk = (~362)&0xFF = 0x95
        const result = parseSRec(['S9050000AABB95', s9Rec()].join('\n'));
        assert.strictEqual(result.malformedLines, 1);
        assert.ok(result.records[0].error?.includes('byte count'));
    });

    // ── Segment building ──────────────────────────────────────────────────

    test('builds a single contiguous segment from adjacent records', () => {
        const src = [
            s1Rec(0x0000, [0x01, 0x02, 0x03, 0x04]),
            s1Rec(0x0004, [0x05, 0x06, 0x07, 0x08]),
            s9Rec(),
        ].join('\n');
        const result = parseSRec(src);
        assert.strictEqual(result.segments.length, 1);
        assert.strictEqual(result.segments[0].startAddress, 0x0000);
        assert.deepStrictEqual(Array.from(result.segments[0].data), [1, 2, 3, 4, 5, 6, 7, 8]);
        assert.strictEqual(result.totalDataBytes, 8);
    });

    test('builds two segments when there is an address gap', () => {
        const src = [
            s1Rec(0x0000, [0xAA, 0xBB]),
            s1Rec(0x0010, [0xCC, 0xDD]), // gap at 0x0002–0x000F
            s9Rec(),
        ].join('\n');
        const result = parseSRec(src);
        assert.strictEqual(result.segments.length, 2);
        assert.strictEqual(result.segments[0].startAddress, 0x0000);
        assert.strictEqual(result.segments[1].startAddress, 0x0010);
    });

    test('builds segments from mixed S1/S2/S3 records', () => {
        const src = [
            s1Rec(0x0000, [0x01]),
            s2Rec(0x001000, [0x02]),
            s3Rec(0x08000000, [0x03]),
            s9Rec(),
        ].join('\n');
        const result = parseSRec(src);
        assert.strictEqual(result.segments.length, 3);
    });

    // ── Stats ─────────────────────────────────────────────────────────────

    test('counts total data bytes correctly', () => {
        const src = [
            s1Rec(0x0000, [0x01, 0x02]),
            s1Rec(0x0002, [0x03, 0x04, 0x05]),
            s9Rec(),
        ].join('\n');
        assert.strictEqual(parseSRec(src).totalDataBytes, 5);
    });

    test('counts multiple checksum errors', () => {
        const bad = (rec: string) => rec.slice(0, -2) + '00';
        const src = [
            bad(s1Rec(0x0000, [0xAA])),
            bad(s1Rec(0x0010, [0xBB])),
            s9Rec(),
        ].join('\n');
        assert.strictEqual(parseSRec(src).checksumErrors, 2);
    });

    test('counts malformed lines without corrupting valid records', () => {
        const src = [
            'NOT_A_RECORD',
            s1Rec(0x0000, [0xFF]),
            s9Rec(),
        ].join('\n');
        const result = parseSRec(src);
        assert.strictEqual(result.malformedLines, 1);
        assert.strictEqual(result.records[1].checksumValid, true);
        assert.strictEqual(result.totalDataBytes, 1);
    });

    // ── Utility exports ───────────────────────────────────────────────────

    test('srecIsData returns true only for types 1, 2, 3', () => {
        assert.strictEqual(srecIsData(0), false);
        assert.strictEqual(srecIsData(1), true);
        assert.strictEqual(srecIsData(2), true);
        assert.strictEqual(srecIsData(3), true);
        assert.strictEqual(srecIsData(5), false);
        assert.strictEqual(srecIsData(7), false);
        assert.strictEqual(srecIsData(9), false);
    });

    test('SREC_ADDR_SIZES has correct values', () => {
        assert.strictEqual(SREC_ADDR_SIZES[0], 2);
        assert.strictEqual(SREC_ADDR_SIZES[1], 2);
        assert.strictEqual(SREC_ADDR_SIZES[2], 3);
        assert.strictEqual(SREC_ADDR_SIZES[3], 4);
        assert.strictEqual(SREC_ADDR_SIZES[7], 4);
        assert.strictEqual(SREC_ADDR_SIZES[8], 3);
        assert.strictEqual(SREC_ADDR_SIZES[9], 2);
    });

    // ── Edge cases ────────────────────────────────────────────────────────

    test('handles S3 record with 32-bit address near 0xFFFFFFFF', () => {
        const src = [s3Rec(0xFFFF0000, [0xAB, 0xCD]), s9Rec()].join('\n');
        const result = parseSRec(src);
        assert.strictEqual(result.records[0].resolvedAddress, 0xFFFF0000);
        assert.strictEqual(result.records[0].checksumValid, true);
        assert.strictEqual(result.totalDataBytes, 2);
    });

    test('S0 header record does not contribute to data segments', () => {
        const src = [s0Rec('test'), s1Rec(0x0000, [0x01]), s9Rec()].join('\n');
        const result = parseSRec(src);
        assert.strictEqual(result.segments.length, 1);
        assert.strictEqual(result.totalDataBytes, 1);
    });

    test('empty source returns empty parse result', () => {
        const result = parseSRec('');
        assert.strictEqual(result.records.length, 0);
        assert.strictEqual(result.segments.length, 0);
        assert.strictEqual(result.totalDataBytes, 0);
    });
});
