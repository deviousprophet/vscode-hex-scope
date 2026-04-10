import * as assert from 'assert';
import { detectFormatFromParts, buildSRecDataRecord, serializeSRec, repairChecksums } from '../HexEditorProvider';
import { parseSRec } from '../parser/SRecParser';
import { parseIntelHex } from '../parser/IntelHexParser';

// ── detectFormatFromParts ─────────────────────────────────────────────────────

suite('detectFormatFromParts()', () => {

    // Extension-based detection
    test('".srec" extension → srec', () => {
        assert.strictEqual(detectFormatFromParts('srec', ''), 'srec');
    });

    test('".mot" extension → srec', () => {
        assert.strictEqual(detectFormatFromParts('mot', ''), 'srec');
    });

    test('".s19" extension → srec', () => {
        assert.strictEqual(detectFormatFromParts('s19', ''), 'srec');
    });

    test('".s28" extension → srec', () => {
        assert.strictEqual(detectFormatFromParts('s28', ''), 'srec');
    });

    test('".s37" extension → srec', () => {
        assert.strictEqual(detectFormatFromParts('s37', ''), 'srec');
    });

    test('".hex" extension → ihex', () => {
        assert.strictEqual(detectFormatFromParts('hex', ':020000040800F2\n'), 'ihex');
    });

    test('unknown extension with IHEX content → ihex', () => {
        assert.strictEqual(detectFormatFromParts('bin', ':020000040800F2\n'), 'ihex');
    });

    // Content-sniff fallback
    test('content starting with "S0" → srec (sniff)', () => {
        assert.strictEqual(detectFormatFromParts('hex', 'S00600004844521B\n'), 'srec');
    });

    test('content starting with "S1" → srec (sniff)', () => {
        assert.strictEqual(detectFormatFromParts('txt', 'S1070100112233444D\n'), 'srec');
    });

    test('content starting with "S9" → srec (sniff)', () => {
        assert.strictEqual(detectFormatFromParts('', 'S9030000FC\n'), 'srec');
    });

    test('content sniff is case-insensitive', () => {
        assert.strictEqual(detectFormatFromParts('', 's1070100112233444d\n'), 'srec');
    });

    test('empty content with no recognised extension → ihex', () => {
        assert.strictEqual(detectFormatFromParts('', ''), 'ihex');
    });

    test('leading whitespace is skipped during content sniff', () => {
        assert.strictEqual(detectFormatFromParts('', '\n\nS1070100112233444D\n'), 'srec');
    });

    test('IHEX content that begins with ":" is not mistaken for SREC', () => {
        assert.strictEqual(detectFormatFromParts('', ':020000040800F2\n'), 'ihex');
    });

    // Extension takes priority over content
    test('SREC extension overrides IHEX content', () => {
        assert.strictEqual(detectFormatFromParts('srec', ':020000040800F2\n'), 'srec');
    });
});

// ── buildSRecDataRecord ───────────────────────────────────────────────────────

suite('buildSRecDataRecord()', () => {

    function parseChk(rec: string, asz: number): { chkOk: boolean; data: number[] } {
        const hex = rec.slice(2); // strip "Sn"
        const byteCount = parseInt(hex.slice(0, 2), 16);
        const addrHex = hex.slice(2, 2 + asz * 2);
        const dataEnd = 2 + asz * 2 + (byteCount - asz - 1) * 2;
        const dataHex = hex.slice(2 + asz * 2, dataEnd);
        const chk = parseInt(hex.slice(dataEnd), 16);
        let sum = byteCount;
        for (let i = 0; i < asz; i++) {
            sum += parseInt(addrHex.slice(i * 2, i * 2 + 2), 16);
        }
        for (let i = 0; i < dataHex.length; i += 2) {
            sum += parseInt(dataHex.slice(i, i + 2), 16);
        }
        const expected = (~sum) & 0xFF;
        const data: number[] = [];
        for (let i = 0; i < dataHex.length; i += 2) {
            data.push(parseInt(dataHex.slice(i, i + 2), 16));
        }
        return { chkOk: chk === expected, data };
    }

    test('builds a valid S1 record (2-byte address)', () => {
        const rec = buildSRecDataRecord(1, 0x0010, [0xCA, 0xFE, 0xBA, 0xBE]);
        assert.ok(rec.startsWith('S1'), `expected S1, got ${rec.slice(0, 2)}`);
        const { chkOk, data } = parseChk(rec, 2);
        assert.ok(chkOk, 'checksum invalid');
        assert.deepStrictEqual(data, [0xCA, 0xFE, 0xBA, 0xBE]);
    });

    test('builds a valid S2 record (3-byte address)', () => {
        const rec = buildSRecDataRecord(2, 0xAB1234, [0x01, 0x02]);
        assert.ok(rec.startsWith('S2'));
        const { chkOk, data } = parseChk(rec, 3);
        assert.ok(chkOk, 'checksum invalid');
        assert.deepStrictEqual(data, [0x01, 0x02]);
    });

    test('builds a valid S3 record (4-byte address)', () => {
        const rec = buildSRecDataRecord(3, 0x08000000, [0xDE, 0xAD, 0xBE, 0xEF]);
        assert.ok(rec.startsWith('S3'));
        const { chkOk, data } = parseChk(rec, 4);
        assert.ok(chkOk, 'checksum invalid');
        assert.deepStrictEqual(data, [0xDE, 0xAD, 0xBE, 0xEF]);
    });

    test('round-trips through parseSRec for S1', () => {
        const rec = buildSRecDataRecord(1, 0x0010, [0xAA, 0xBB, 0xCC]);
        const result = parseSRec(rec + '\nS9030000FC');
        assert.strictEqual(result.checksumErrors, 0);
        assert.strictEqual(result.malformedLines, 0);
        assert.deepStrictEqual(Array.from(result.segments[0].data), [0xAA, 0xBB, 0xCC]);
    });

    test('round-trips through parseSRec for S3', () => {
        const rec = buildSRecDataRecord(3, 0x08001000, [0x11, 0x22]);
        const result = parseSRec(rec + '\nS70508000000F2');
        assert.strictEqual(result.checksumErrors, 0);
        assert.strictEqual(result.malformedLines, 0);
        assert.strictEqual(result.segments[0].startAddress, 0x08001000);
    });

    test('address is zero-padded to the correct width', () => {
        const rec = buildSRecDataRecord(1, 0x0001, [0xFF]);
        assert.ok(rec.includes('0001'), `expected "0001" in "${rec}"`);
    });

    test('byte count field equals addrBytes + dataBytes + 1 (checksum)', () => {
        const data = [0x01, 0x02, 0x03];
        const rec = buildSRecDataRecord(1, 0x0000, data); // asz=2
        const byteCount = parseInt(rec.slice(2, 4), 16);
        assert.strictEqual(byteCount, 2 + 3 + 1);
    });
});

// ── serializeSRec ─────────────────────────────────────────────────────────────

suite('serializeSRec()', () => {

    // Build a minimal two-record SREC file and its ParseResult
    const RAW_SREC = [
        'S00600004844521B',       // S0 header
        'S10B00000102030405060708D0',  // S1: addr=0x0000, data=[01..08]
        'S10B0008090A0B0C0D0E0F1088',  // S1: addr=0x0008, data=[09..10]
        'S5030002FA',             // S5 count
        'S9030000FC',             // S9 EOF
    ].join('\n');

    function makeParseResult() {
        return parseSRec(RAW_SREC);
    }

    test('returns original raw when edits map is empty', () => {
        const result = makeParseResult();
        assert.strictEqual(serializeSRec(RAW_SREC, result, new Map()), RAW_SREC);
    });

    test('applies a single byte edit to an S1 record', () => {
        const result = makeParseResult();
        const edits = new Map<number, number>([[0x0000, 0xFF]]);
        const out = serializeSRec(RAW_SREC, result, edits);
        // Re-parse the output and verify the edited byte
        const reparsed = parseSRec(out);
        assert.strictEqual(reparsed.checksumErrors, 0);
        assert.strictEqual(reparsed.segments[0].data[0], 0xFF);
        // Surrounding bytes must be unchanged
        assert.strictEqual(reparsed.segments[0].data[1], 0x02);
    });

    test('applies edits across multiple records', () => {
        const result = makeParseResult();
        const edits = new Map<number, number>([[0x0000, 0xAA], [0x000F, 0xBB]]);
        const out = serializeSRec(RAW_SREC, result, edits);
        const reparsed = parseSRec(out);
        assert.strictEqual(reparsed.checksumErrors, 0);
        assert.strictEqual(reparsed.segments[0].data[0x00], 0xAA);
        assert.strictEqual(reparsed.segments[0].data[0x0F], 0xBB);
    });

    test('non-data records (S0, S5, S9) are preserved verbatim', () => {
        const result = makeParseResult();
        // Edit one data byte so the function doesn't short-circuit
        const edits = new Map<number, number>([[0x0000, 0xFF]]);
        const out = serializeSRec(RAW_SREC, result, edits);
        assert.ok(out.includes('S00600004844521B'), 'S0 header should be unchanged');
        assert.ok(out.includes('S5030002FA'), 'S5 count should be unchanged');
        assert.ok(out.includes('S9030000FC'), 'S9 EOF should be unchanged');
    });

    test('edited output parses with zero checksum errors', () => {
        const result = makeParseResult();
        const edits = new Map<number, number>([[0x0003, 0xDE], [0x0004, 0xAD]]);
        const out = serializeSRec(RAW_SREC, result, edits);
        const reparsed = parseSRec(out);
        assert.strictEqual(reparsed.checksumErrors, 0);
        assert.strictEqual(reparsed.malformedLines, 0);
    });

    test('preserves LF line endings', () => {
        const result = makeParseResult();
        const edits = new Map<number, number>([[0x0001, 0x99]]);
        const out = serializeSRec(RAW_SREC, result, edits);
        assert.ok(!out.includes('\r\n'), 'should not contain CRLF when input uses LF');
    });

    test('preserves CRLF line endings', () => {
        const crlf = RAW_SREC.replace(/\n/g, '\r\n');
        const result = parseSRec(crlf);
        const edits = new Map<number, number>([[0x0001, 0x99]]);
        const out = serializeSRec(crlf, result, edits);
        assert.ok(out.includes('\r\n'), 'should preserve CRLF when input uses CRLF');
    });
});

// ── repairChecksums ───────────────────────────────────────────────────────────

suite('repairChecksums()', () => {

    // ── Intel HEX ────────────────────────────────────────────────────────────

    test('fixes a single bad checksum in an IHEX file', () => {
        // Valid ELA + data record with corrupted checksum + EOF
        const raw = ':020000040800F2\n:10000000DEADBEEFCAFEBABE0102030405060708FF\n:00000001FF';
        const result = parseIntelHex(raw);
        assert.strictEqual(result.checksumErrors, 1);
        const repaired = repairChecksums(raw, result);
        assert.strictEqual(parseIntelHex(repaired).checksumErrors, 0);
    });

    test('fixes all bad checksums, leaves valid records unchanged', () => {
        // Two bad, two good
        const good1 = ':020000040800F2';
        const bad1  = ':10000000DEADBEEFCAFEBABE0102030405060708FF'; // wrong chk
        const good2 = ':1000200048656C6C6F20576F726C640000000000B4';
        const bad2  = ':10003000AABBCCDDEEFF001122334455667788' + '9900'; // wrong chk
        const eof   = ':00000001FF';
        const raw = [good1, bad1, good2, bad2, eof].join('\n');
        const result = parseIntelHex(raw);
        assert.strictEqual(result.checksumErrors, 2);
        const repaired = repairChecksums(raw, result);
        const rr = parseIntelHex(repaired);
        assert.strictEqual(rr.checksumErrors, 0);
        assert.strictEqual(rr.malformedLines, 0);
    });

    test('leaves malformed IHEX lines untouched', () => {
        const raw = ':020000040800F2\n;; malformed line\n:00000001FF';
        const result = parseIntelHex(raw);
        assert.strictEqual(result.malformedLines, 1);
        const repaired = repairChecksums(raw, result);
        assert.ok(repaired.includes(';; malformed line'), 'malformed line must be preserved');
        assert.strictEqual(parseIntelHex(repaired).malformedLines, 1);
    });

    test('returns the original string unchanged when there are no checksum errors', () => {
        const raw = ':020000040800F2\n:00000001FF';
        const result = parseIntelHex(raw);
        assert.strictEqual(result.checksumErrors, 0);
        assert.strictEqual(repairChecksums(raw, result), raw);
    });

    test('preserves LF line endings for IHEX', () => {
        const raw = ':10000000DEADBEEFCAFEBABE0102030405060708FF\n:00000001FF';
        const result = parseIntelHex(raw);
        const repaired = repairChecksums(raw, result);
        assert.ok(!repaired.includes('\r\n'), 'should not introduce CRLF');
    });

    test('preserves CRLF line endings for IHEX', () => {
        const raw = ':10000000DEADBEEFCAFEBABE0102030405060708FF\r\n:00000001FF';
        const result = parseIntelHex(raw);
        const repaired = repairChecksums(raw, result);
        assert.ok(repaired.includes('\r\n'), 'should preserve CRLF');
    });

    // ── Motorola SREC ─────────────────────────────────────────────────────────

    test('fixes a single bad checksum in an SREC file', () => {
        // S1 record with corrupted checksum (last two chars set to 00)
        const good = 'S1060000AABBCC';
        const chkBad = good + '00';
        const raw = [chkBad, 'S9030000FC'].join('\n');
        const result = parseSRec(raw);
        assert.strictEqual(result.checksumErrors, 1);
        const repaired = repairChecksums(raw, result);
        assert.strictEqual(parseSRec(repaired).checksumErrors, 0);
    });

    test('repaired SREC file produces the same segments as the uncorrupted version', () => {
        // Correct checksum for S1060000AABBCC: sum=0x06+0x00+0x00+0xAA+0xBB+0xCC=0x237 → ~0x37=0xC8
        const rawGood = 'S1060000AABBCCC8\nS9030000FC';
        const rawBad  = 'S1060000AABBCC00\nS9030000FC'; // wrong checksum
        const rGood   = parseSRec(rawGood);
        const rBad    = parseSRec(rawBad);
        const repaired = repairChecksums(rawBad, rBad);
        const rRepaired = parseSRec(repaired);
        assert.strictEqual(rRepaired.checksumErrors, 0);
        assert.deepStrictEqual(
            Array.from(rRepaired.segments[0].data),
            Array.from(rGood.segments[0].data)
        );
    });

    test('leaves malformed SREC lines untouched', () => {
        const raw = 'S9030000FC\n;; bad line';
        const result = parseSRec(raw);
        assert.strictEqual(result.malformedLines, 1);
        const repaired = repairChecksums(raw, result);
        assert.ok(repaired.includes(';; bad line'), 'malformed line must be preserved');
    });
});
