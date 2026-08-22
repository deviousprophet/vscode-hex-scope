import * as assert from 'assert';
import { buildSplicePlan, spliceEditedLines, type SplicePatch } from '../../core/document';
import { parseIntelHex } from '../../core/parser/intelHexParser';
import { parseSRec } from '../../core/parser/srecParser';

function intelLine(count: number, addr: number, type: number, dataHex: string): string {
    let sum = count + ((addr >> 8) & 0xFF) + (addr & 0xFF) + type;
    for (let i = 0; i < dataHex.length; i += 2) { sum += parseInt(dataHex.slice(i, i + 2), 16); }
    const chk = (~sum + 1) & 0xFF;
    return `:${count.toString(16).padStart(2, '0').toUpperCase()}`
        + addr.toString(16).padStart(4, '0').toUpperCase()
        + type.toString(16).padStart(2, '0').toUpperCase()
        + dataHex
        + chk.toString(16).padStart(2, '0').toUpperCase();
}

function srecLine(type: number, address: number, dataHex: string): string {
    const asz = type === 1 ? 2 : type === 2 ? 3 : 4;
    const byteCount = asz + dataHex.length / 2 + 1;
    let sum = byteCount;
    for (let i = asz - 1; i >= 0; i--) { sum += (address >>> (i * 8)) & 0xFF; }
    for (let i = 0; i < dataHex.length; i += 2) { sum += parseInt(dataHex.slice(i, i + 2), 16); }
    const chk = (~sum) & 0xFF;
    return `S${type}` + byteCount.toString(16).padStart(2, '0').toUpperCase()
        + address.toString(16).padStart(asz * 2, '0').toUpperCase()
        + dataHex + chk.toString(16).padStart(2, '0').toUpperCase();
}

const DATA16 = Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(2, '0')).join('');

suite('spliceEditedLines', () => {
    test('ihex: rewrites only the edited record line, recomputes checksum, keeps others', () => {
        const ela = intelLine(2, 0x0000, 4, '0000');
        const data = intelLine(16, 0x1000, 0, DATA16);
        const eof = intelLine(0, 0, 1, '');
        const raw = `${ela}\r\n${data}\r\n${eof}`;

        const out = spliceEditedLines(raw, new Map([[0x1000, 0xFF], [0x1002, 0xEE]]), 'ihex');

        const lines = out.split('\r\n');
        assert.strictEqual(lines.length, 3);
        assert.strictEqual(lines[0], ela, 'ELA record untouched');
        assert.strictEqual(lines[2], eof, 'EOF record untouched');
        assert.notStrictEqual(lines[1], data, 'data record rewritten');

        const parsed = parseIntelHex(out);
        assert.strictEqual(parsed.checksumErrors, 0, 'spliced checksum valid');
        const seg = parsed.segments[0];
        assert.strictEqual(seg.data[0], 0xFF);
        assert.strictEqual(seg.data[1], 0x01);
        assert.strictEqual(seg.data[2], 0xEE);
        assert.strictEqual(seg.data[3], 0x03);
    });

    test('ihex: edit through an extended-linear-address resolves absolute addresses', () => {
        const upper = intelLine(2, 0x0000, 4, '0800'); // base 0x08000000
        const data = intelLine(16, 0x0100, 0, DATA16); // resolved 0x08000100
        const eof = intelLine(0, 0, 1, '');
        const raw = `${upper}\r\n${data}\r\n${eof}`;

        const out = spliceEditedLines(raw, new Map([[0x08000100, 0xFE]]), 'ihex');
        const parsed = parseIntelHex(out);
        assert.strictEqual(parsed.checksumErrors, 0);
        assert.strictEqual(parsed.segments[0].data[0], 0xFE);
        assert.strictEqual(parsed.segments[0].data[1], 0x01);
    });

    test('ihex: edits outside any data record are ignored, file unchanged', () => {
        const raw = `${intelLine(16, 0x1000, 0, DATA16)}\n${intelLine(0, 0, 1, '')}`;
        const out = spliceEditedLines(raw, new Map([[0x00FF0000, 0x01]]), 'ihex');
        assert.strictEqual(out, raw);
    });

    test('srec: rewrites only the edited S1 line with a valid checksum', () => {
        const hdr = 'S00600004844521B';
        const data = srecLine(1, 0x0000, DATA16);
        const end = 'S9030000FC';
        const raw = `${hdr}\r\n${data}\r\n${end}`;

        const out = spliceEditedLines(raw, new Map([[0x0001, 0x55]]), 'srec');

        const lines = out.split('\r\n');
        assert.strictEqual(lines[0], hdr);
        assert.strictEqual(lines[2], end);
        const parsed = parseSRec(out);
        assert.strictEqual(parsed.checksumErrors, 0);
        assert.strictEqual(parsed.segments[0].data[0], 0x00);
        assert.strictEqual(parsed.segments[0].data[1], 0x55);
        assert.strictEqual(parsed.segments[0].data[2], 0x02);
    });

    test('no edits returns the original string', () => {
        const raw = `${intelLine(16, 0x1000, 0, DATA16)}\n${intelLine(0, 0, 1, '')}`;
        assert.strictEqual(spliceEditedLines(raw, new Map(), 'ihex'), raw);
    });
});

function reassemble(raw: string, patches: SplicePatch[]): string {
    const out = new Uint8Array(Buffer.byteLength(raw, 'utf-8'));
    for (let i = 0; i < out.length; i++) { out[i] = raw.charCodeAt(i) & 0xFF; }
    const enc = new TextEncoder();
    for (const p of patches) {
        const bytes = enc.encode(String.fromCharCode(...Array.from(p.bytes)));
        out.set(bytes, p.offset);
    }
    return new TextDecoder().decode(out);
}

suite('buildSplicePlan', () => {
    test('patch covers only the edited record line at its byte offset (CRLF)', () => {
        const ela = intelLine(2, 0x0000, 4, '0000');
        const data = intelLine(16, 0x1000, 0, DATA16);
        const eof = intelLine(0, 0, 1, '');
        const raw = `${ela}\r\n${data}\r\n${eof}`;

        const plan = buildSplicePlan(raw, new Map([[0x1000, 0xFF]]), 'ihex');

        assert.strictEqual(plan.patches?.length, 1, 'only the edited record line');
        assert.strictEqual(plan.patches![0].offset, ela.length + 2, 'offset = ELA line + CRLF');
        const parsed = parseIntelHex(plan.newRaw);
        assert.strictEqual(parsed.checksumErrors, 0);
        assert.strictEqual(parsed.segments[0].data[0], 0xFF);
    });

    test('parity: applying patches to the original reproduces newRaw exactly', () => {
        const raw = `${intelLine(2, 0, 4, '0000')}\r\n${intelLine(16, 0x1000, 0, DATA16)}\r\n${intelLine(0, 0, 1, '')}`;
        const plan = buildSplicePlan(raw, new Map([[0x1000, 0xFF], [0x1003, 0xEE]]), 'ihex');
        assert.ok(plan.patches);
        assert.strictEqual(
            reassemble(raw, plan.patches!).replace(/\r\n$/, ''),
            plan.newRaw.replace(/\r\n$/, ''),
            'positional chunks == whole splice result',
        );
    });

    test('non-ASCII content forces whole-write fallback', () => {
        const raw = `; café header\r\n${intelLine(16, 0x1000, 0, DATA16)}\r\n${intelLine(0, 0, 1, '')}`;
        const plan = buildSplicePlan(raw, new Map([[0x1000, 0xFF]]), 'ihex');
        assert.strictEqual(plan.patches, null, 'positional unsafe → null');
        assert.strictEqual(parseIntelHex(plan.newRaw).checksumErrors, 0, 'text still patched correctly');
    });

    test('no edits → empty patch list', () => {
        const plan = buildSplicePlan(':00000001FF', new Map(), 'ihex');
        assert.deepStrictEqual(plan.patches, []);
        assert.strictEqual(plan.newRaw, ':00000001FF');
    });
});