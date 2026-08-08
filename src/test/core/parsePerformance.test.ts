import * as assert from 'assert';
import { parseIntelHex } from '../../core/parser/intelHexParser';
import { parseSRec } from '../../core/parser/srecParser';

const DATA_BYTES_PER_RECORD = 16;
const TARGET_DATA_MIB = 4;

function ihexChecksum(bytes: number[]): number {
    let sum = 0;
    for (const b of bytes) { sum += b; }
    return (~sum + 1) & 0xFF;
}

function generateIhexRecord(address: number, data: number[]): string {
    const bc = data.length;
    const bytes = [bc, (address >> 8) & 0xFF, address & 0xFF, 0x00, ...data];
    return ':' + [...bytes, ihexChecksum(bytes)].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

function generateIhexExtAddr(upper: number): string {
    const bytes = [0x02, 0x00, 0x00, 0x04, (upper >> 8) & 0xFF, upper & 0xFF];
    return ':' + [...bytes, ihexChecksum(bytes)].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

function generateIhexSource(dataBytes: number): string {
    const records: string[] = [];
    let address = 0;
    let remaining = dataBytes;
    let lastUpper = -1;

    while (remaining > 0) {
        const upper = (address >> 16) & 0xFFFF;
        if (upper !== lastUpper) {
            records.push(generateIhexExtAddr(upper));
            lastUpper = upper;
        }

        const localAddr = address & 0xFFFF;
        const chunk = Math.min(DATA_BYTES_PER_RECORD, remaining);
        const data: number[] = [];
        for (let i = 0; i < chunk; i++) { data.push((address + i) & 0xFF); }

        records.push(generateIhexRecord(localAddr, data));

        address += chunk;
        remaining -= chunk;
    }

    records.push(':00000001FF');
    return records.join('\n');
}

function generateSrecSource(dataBytes: number): string {
    const records: string[] = ['S00F000048657853636F70652054657374B0'];
    let address = 0;
    let remaining = dataBytes;

    while (remaining > 0) {
        const chunk = Math.min(DATA_BYTES_PER_RECORD, remaining);
        const data: number[] = [];
        for (let i = 0; i < chunk; i++) { data.push((address + i) & 0xFF); }

        const addrBytes = 4;
        const byteCount = addrBytes + chunk + 1;
        const addr = address >>> 0;
        let sum = byteCount + ((addr >> 24) & 0xFF) + ((addr >> 16) & 0xFF) + ((addr >> 8) & 0xFF) + (addr & 0xFF);
        for (const b of data) { sum += b; }
        const chk = (~sum) & 0xFF;

        const hex = data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
        records.push(`S3${byteCount.toString(16).toUpperCase().padStart(2, '0')}${addr.toString(16).toUpperCase().padStart(8, '0')}${hex}${chk.toString(16).toUpperCase().padStart(2, '0')}`);

        address += chunk;
        remaining -= chunk;
    }

    records.push('S70500000000FA');
    return records.join('\n');
}

suite('Large-file parse performance', () => {
    const dataBytes = TARGET_DATA_MIB * 1024 * 1024;

    test(`parses ${TARGET_DATA_MIB} MiB IHEX within time budget`, () => {
        const source = generateIhexSource(dataBytes);
        const started = performance.now();
        const result = parseIntelHex(source);
        const elapsed = performance.now() - started;

        assert.ok(result.segments.length > 0);
        assert.strictEqual(result.totalDataBytes, dataBytes);
        assert.ok(elapsed < 1000, `${TARGET_DATA_MIB} MiB IHEX parse took ${Math.round(elapsed)} ms`);
    });

    test(`parses ${TARGET_DATA_MIB} MiB SREC within time budget`, () => {
        const source = generateSrecSource(dataBytes);
        const started = performance.now();
        const result = parseSRec(source);
        const elapsed = performance.now() - started;

        assert.ok(result.segments.length > 0);
        assert.strictEqual(result.totalDataBytes, dataBytes);
        assert.ok(elapsed < 1000, `${TARGET_DATA_MIB} MiB SREC parse took ${Math.round(elapsed)} ms`);
    });
});
