import * as assert from 'assert';
import { parseIntelHex, RecordType } from '../parser/IntelHexParser';

suite('IntelHexParser', () => {

    // ── Test record builders ──────────────────────────────────────────────

    function dataRec(addr: number, bytes: number[]): string {
        const bc = bytes.length;
        const ah = (addr >> 8) & 0xFF;
        const al = addr & 0xFF;
        let sum = bc + ah + al;
        for (const b of bytes) { sum += b; }
        const chk = (~sum + 1) & 0xFF;
        const body = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        return `:${bc.toString(16).toUpperCase().padStart(2,'0')}${addr.toString(16).toUpperCase().padStart(4,'0')}00${body}${chk.toString(16).toUpperCase().padStart(2,'0')}`;
    }

    function elaRec(upper16: number): string {
        const hi = (upper16 >> 8) & 0xFF;
        const lo = upper16 & 0xFF;
        let sum = 0x02 + 0x00 + 0x00 + 0x04 + hi + lo;
        const chk = (~sum + 1) & 0xFF;
        return `:02000004${hi.toString(16).toUpperCase().padStart(2,'0')}${lo.toString(16).toUpperCase().padStart(2,'0')}${chk.toString(16).toUpperCase().padStart(2,'0')}`;
    }

    const EOF = ':00000001FF';

    // ── Record parsing ────────────────────────────────────────────────────

    test('reads a well-formed data record', () => {
        const rec = dataRec(0x0010, [0xCA, 0xFE, 0xBA, 0xBE]);
        const result = parseIntelHex([rec, EOF].join('\n'));

        assert.strictEqual(result.records.length, 2);
        const r = result.records[0];
        assert.strictEqual(r.recordType, RecordType.Data);
        assert.strictEqual(r.byteCount, 4);
        assert.strictEqual(r.address, 0x0010);
        assert.deepStrictEqual(Array.from(r.data), [0xCA, 0xFE, 0xBA, 0xBE]);
        assert.strictEqual(r.checksumValid, true);
        assert.strictEqual(r.error, undefined);
    });

    test('accepts the End of File record', () => {
        const result = parseIntelHex(EOF);
        assert.strictEqual(result.records.length, 1);
        assert.strictEqual(result.records[0].recordType, RecordType.EndOfFile);
        assert.strictEqual(result.records[0].checksumValid, true);
    });

    test('blank lines are silently skipped', () => {
        const src = `\n${dataRec(0x0000, [0x11])}\n\n${EOF}\n`;
        assert.strictEqual(parseIntelHex(src).records.length, 2);
    });

    test('CRLF line endings are handled correctly', () => {
        const src = [dataRec(0x0000, [0x01]), dataRec(0x0001, [0x02]), EOF].join('\r\n');
        const result = parseIntelHex(src);
        assert.strictEqual(result.records.length, 3);
        assert.strictEqual(result.records[0].lineNumber, 1);
        assert.strictEqual(result.records[2].lineNumber, 3);
    });

    // ── Checksum validation ───────────────────────────────────────────────

    test('corrupted checksum byte is flagged as invalid', () => {
        const corrupted = dataRec(0x0020, [0xAA, 0xBB]).slice(0, -2) + 'FF';
        const result = parseIntelHex(corrupted);
        assert.strictEqual(result.records[0].checksumValid, false);
        assert.strictEqual(result.checksumErrors, 1);
    });

    test('checksumErrors counts every failing record', () => {
        const bad1 = dataRec(0x0000, [0x01]).slice(0, -2) + 'FF';
        const bad2 = dataRec(0x0010, [0x02]).slice(0, -2) + 'EE';
        assert.strictEqual(
            parseIntelHex([bad1, bad2, EOF].join('\n')).checksumErrors,
            2
        );
    });

    test('cleanly parsed file reports zero checksum errors', () => {
        const result = parseIntelHex([dataRec(0x0000, [0x01, 0x02, 0x03]), EOF].join('\n'));
        assert.strictEqual(result.checksumErrors, 0);
    });

    // ── Malformed records ─────────────────────────────────────────────────

    test('line not starting with ":" is recorded as malformed', () => {
        const result = parseIntelHex('0100000000FF');
        assert.strictEqual(result.malformedLines, 1);
        assert.strictEqual(result.records[0].error, 'Missing start code ":"');
    });

    test('non-hex characters trigger a malformed error', () => {
        const result = parseIntelHex(':01000000ZZ00');
        assert.strictEqual(result.malformedLines, 1);
        assert.ok(result.records[0].error?.includes('Non-hex'));
    });

    test('record below minimum length is rejected', () => {
        const result = parseIntelHex(':0100');
        assert.strictEqual(result.malformedLines, 1);
        assert.ok(result.records[0].error?.includes('too short'));
    });

    test('byte count mismatching actual data length is rejected', () => {
        const result = parseIntelHex(':0200000001FD');
        assert.strictEqual(result.malformedLines, 1);
        assert.ok(result.records[0].error?.includes('Expected'));
    });

    // ── Address resolution ────────────────────────────────────────────────

    test('without any address extension record the address is 16-bit', () => {
        const result = parseIntelHex([dataRec(0x1234, [0xFF]), EOF].join('\n'));
        assert.strictEqual(result.records[0].resolvedAddress, 0x1234);
    });

    test('Extended Linear Address record (type 04) sets the high 16 bits', () => {
        const src = [elaRec(0x0800), dataRec(0x0000, [0x55]), EOF].join('\n');
        const result = parseIntelHex(src);
        const dr = result.records.find(r => r.recordType === RecordType.Data)!;
        assert.strictEqual(dr.resolvedAddress, 0x08000000);
    });

    test('successive Extended Linear Address records each update the base', () => {
        const src = [
            elaRec(0x0800), dataRec(0x0000, [0x01]),
            elaRec(0x0801), dataRec(0x0000, [0x02]),
            EOF,
        ].join('\n');
        const result = parseIntelHex(src);
        const drs = result.records.filter(r => r.recordType === RecordType.Data);
        assert.strictEqual(drs[0].resolvedAddress, 0x08000000);
        assert.strictEqual(drs[1].resolvedAddress, 0x08010000);
    });

    test('Extended Segment Address record (type 02) applies a 4-bit left shift', () => {
        let sum = 0x02 + 0x00 + 0x00 + 0x02 + 0x01 + 0x00;
        const chk = ((~sum + 1) & 0xFF);
        const type02 = `:020000020100${chk.toString(16).toUpperCase().padStart(2,'0')}`;
        const result = parseIntelHex([type02, dataRec(0x0004, [0xAB]), EOF].join('\n'));
        const dr = result.records.find(r => r.recordType === RecordType.Data)!;
        assert.strictEqual(dr.resolvedAddress, 0x1000 + 0x0004);
    });

    test('Start Linear Address record (type 05) sets the program entry point', () => {
        const result = parseIntelHex(':04000005000800003F\n' + EOF);
        assert.strictEqual(result.startAddress, 0x00080000);
    });

    // ── Segment assembly ──────────────────────────────────────────────────

    test('adjacent records produce a single merged segment', () => {
        const src = [
            dataRec(0x0000, [0x01, 0x02, 0x03, 0x04]),
            dataRec(0x0004, [0x05, 0x06, 0x07, 0x08]),
            EOF,
        ].join('\n');
        const result = parseIntelHex(src);
        assert.strictEqual(result.segments.length, 1);
        assert.strictEqual(result.segments[0].startAddress, 0x0000);
        assert.deepStrictEqual(Array.from(result.segments[0].data), [1,2,3,4,5,6,7,8]);
    });

    test('address gap between records produces two separate segments', () => {
        const src = [
            dataRec(0x0000, [0xAA]),
            dataRec(0x0100, [0xBB]),
            EOF,
        ].join('\n');
        const result = parseIntelHex(src);
        assert.strictEqual(result.segments.length, 2);
        assert.strictEqual(result.segments[0].startAddress, 0x0000);
        assert.strictEqual(result.segments[1].startAddress, 0x0100);
    });

    test('bad-checksum records are omitted from segments', () => {
        const bad  = dataRec(0x0000, [0x01]).slice(0, -2) + '00';
        const good = dataRec(0x0010, [0xAA]);
        const result = parseIntelHex([bad, good, EOF].join('\n'));
        assert.strictEqual(result.segments.length, 1);
        assert.strictEqual(result.segments[0].startAddress, 0x0010);
    });

    // ── Result statistics ─────────────────────────────────────────────────

    test('totalDataBytes sums the lengths of all valid segments', () => {
        const src = [
            dataRec(0x0000, [0x01, 0x02, 0x03]),
            dataRec(0x0003, [0x04, 0x05]),
            EOF,
        ].join('\n');
        assert.strictEqual(parseIntelHex(src).totalDataBytes, 5);
    });

    test('totalDataBytes is zero when the file contains only an EOF record', () => {
        assert.strictEqual(parseIntelHex(EOF).totalDataBytes, 0);
    });

    test('empty string produces no records and no segments', () => {
        const result = parseIntelHex('');
        assert.strictEqual(result.records.length, 0);
        assert.strictEqual(result.segments.length, 0);
        assert.strictEqual(result.totalDataBytes, 0);
    });

    test('whitespace-only input produces no records', () => {
        assert.strictEqual(parseIntelHex('   \n  \n').records.length, 0);
    });
});
