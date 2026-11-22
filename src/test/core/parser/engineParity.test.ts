import * as assert from 'assert';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { parseIntelHexCompact, parseIntelHex, parseIntelHexLine } from '../../../core/parser/intelHexParser';
import { parseSRecCompact, parseSRec, parseSRecRecordLine } from '../../../core/parser/srecParser';
import { repairChecksums } from '../../../core/document';
import {
    serializeCompactParseResult,
    type SerializedCompactParseResult
} from '../../../core/parser/compact';
import { EngineClient, EngineError, engineBinaryPath } from '../../../host/engine/engineClient';
import { createBinParseResult } from '../../../core/parser/binImage';
import type { HexRecord } from '../../../core/parser/types';
import { loadIntelHexFixture, loadSRecFixture } from '../../shared/parserFixtures';

/** `out/test/core/parser` → repository root. */
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BINARY = engineBinaryPath(ROOT);

function available(): boolean {
    return existsSync(BINARY);
}

/** Typed arrays and ArrayBuffers become plain arrays so deep equality is content-based. */
function snapshot(payload: SerializedCompactParseResult) {
    const array = (view: Uint32Array | Uint8Array, length: number) => Array.from(view.subarray(0, length));
    return {
        recordCount: payload.recordCount,
        pages: payload.pages.map(page => ({
            length: page.length,
            sourceStart: array(page.sourceStart, page.length),
            sourceEnd: array(page.sourceEnd, page.length),
            lineNumber: array(page.lineNumber, page.length),
            address: array(page.address, page.length),
            resolvedAddress: array(page.resolvedAddress, page.length),
            byteCount: array(page.byteCount, page.length),
            recordType: array(page.recordType, page.length),
            checksum: array(page.checksum, page.length),
            flags: array(page.flags, page.length)
        })),
        segments: payload.segments.map(segment => ({
            startAddress: segment.startAddress,
            data: Array.from(new Uint8Array(segment.data))
        })),
        totalDataBytes: payload.totalDataBytes,
        checksumErrors: payload.checksumErrors,
        malformedLines: payload.malformedLines,
        startAddress: payload.startAddress,
        baseAddress: payload.baseAddress
    };
}

function recordSnapshot(record: HexRecord) {
    return { ...record, data: Array.from(record.data) };
}

suite('Rust engine parity', () => {
    let client: EngineClient | undefined;

    suiteSetup(async function (this: Mocha.Context) {
        if (!available()) {
            this.skip();
        }
        client = await EngineClient.start({ binary: BINARY });
    });

    suiteTeardown(() => {
        client?.dispose();
    });

    function engine(): EngineClient {
        assert.ok(client, 'engine client was not started');
        return client;
    }

    const intelHexNames = ['minimal.hex', 'firmware.hex', 'stm32_16bpr.hex', 'stm32_32bpr.hex', 'errors.hex'];
    for (const name of intelHexNames) {
        test(`Intel HEX compact payload matches TypeScript for ${name}`, async () => {
            const source = loadIntelHexFixture(name);
            const expected = serializeCompactParseResult(await parseIntelHexCompact(source));
            const actual = await engine().parse({ format: 'ihex', source });
            assert.deepStrictEqual(snapshot(actual), snapshot(expected));
        });
    }

    const srecNames = ['minimal.srec', 'firmware_s1.srec', 'firmware_s3.srec', 'stm32_s3.srec', 'mixed_addr.srec', 'errors.srec'];
    for (const name of srecNames) {
        test(`SREC compact payload matches TypeScript for ${name}`, async () => {
            const source = loadSRecFixture(name);
            const expected = serializeCompactParseResult(await parseSRecCompact(source));
            const actual = await engine().parse({ format: 'srec', source });
            assert.deepStrictEqual(snapshot(actual), snapshot(expected));
        });
    }

    test('multi-page metadata matches the TypeScript compactor', async () => {
        const source = `${':00000001FF\n'.repeat(66_000)}`;
        const expected = serializeCompactParseResult(await parseIntelHexCompact(source));
        const actual = await engine().parse({ format: 'ihex', source });
        assert.strictEqual(actual.pages.length, 2);
        assert.deepStrictEqual(snapshot(actual), snapshot(expected));
    });

    test('segment addressing, start-segment offsets and a generated corpus match', async () => {
        const checksum = (bytes: number[]) => (-bytes.reduce((sum, byte) => sum + byte, 0)) & 0xff;
        const record = (address: number, type: number, data: number[]) => {
            const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
            const text = bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join('');
            return `:${text}${checksum(bytes).toString(16).padStart(2, '0').toUpperCase()}`;
        };
        const lines = [record(0, 0x02, [0x10, 0x00]), record(0, 0x04, [0x08, 0x00])];
        for (let index = 0; index < 500; index++) {
            const address = (index * 16) & 0xffff;
            lines.push(record(address, 0, Array.from({ length: 16 }, (_, offset) => (index * 7 + offset) & 0xff)));
        }
        lines.push(record(0, 0x03, [0x01, 0x01, 0x00, 0x11]));
        lines.push(record(0, 0x05, [0x08, 0x00, 0x01, 0x39]));
        lines.push(':0400100001020304E3'); // bad checksum
        lines.push('not a record');
        lines.push(record(0, 0x01, []));
        const source = lines.join('\n');
        const expected = serializeCompactParseResult(await parseIntelHexCompact(source));
        const actual = await engine().parse({ format: 'ihex', source });
        assert.strictEqual(actual.checksumErrors, expected.checksumErrors);
        assert.strictEqual(actual.malformedLines, expected.malformedLines);
        assert.deepStrictEqual(snapshot(actual), snapshot(expected));
    });

    test('raw binary payload matches the TypeScript bin image', async () => {
        const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
        const expected = serializeCompactParseResult(createBinParseResult(bytes, 0x1000));
        const actual = await engine().parse({ format: 'bin', bytes, baseAddress: 0x1000 });
        assert.deepStrictEqual(snapshot(actual), snapshot(expected));
    });

    test('checksum repair matches the TypeScript repairer', async () => {
        const ihex = loadIntelHexFixture('errors.hex');
        const ihexExpected = repairChecksums(ihex, parseIntelHex(ihex));
        const ihexActual = await engine().repair('ihex', ihex);
        assert.strictEqual(ihexActual.text, ihexExpected);
        assert.ok(ihexActual.repaired > 0);

        const srec = loadSRecFixture('errors.srec');
        const srecExpected = repairChecksums(srec, parseSRec(srec));
        const srecActual = await engine().repair('srec', srec);
        assert.strictEqual(srecActual.text, srecExpected);
        assert.ok(srecActual.repaired > 0);
    });

    test('record-line parsing matches the TypeScript line parsers', async () => {
        const ihexSource = loadIntelHexFixture('errors.hex');
        const ihexLines = ihexSource.split(/\r?\n/).filter(line => line.trim() !== '');
        const ihexExpected = ihexLines.map((raw, index) => parseIntelHexLine(raw.trim(), index + 1));
        const ihexActual = await engine().parseLines(
            'ihex',
            ihexLines.map((raw, index) => ({ lineNumber: index + 1, raw: raw.trim() }))
        );
        assert.deepStrictEqual(ihexActual.map(recordSnapshot), ihexExpected.map(recordSnapshot));

        const srecSource = loadSRecFixture('errors.srec');
        const srecLines = srecSource.split(/\r?\n/).filter(line => line.trim() !== '');
        const srecExpected = srecLines.map((raw, index) => parseSRecRecordLine(raw.trim(), index + 1));
        const srecActual = await engine().parseLines(
            'srec',
            srecLines.map((raw, index) => ({ lineNumber: index + 1, raw: raw.trim() }))
        );
        assert.deepStrictEqual(srecActual.map(recordSnapshot), srecExpected.map(recordSnapshot));
    });

    test('engine client record lines and repair match the TypeScript reference', async () => {
        const client = await EngineClient.start({ binary: BINARY });
        try {
            const records = await client.parseLines('ihex', [{ lineNumber: 1, raw: ':0400100001020304E2' }]);
            assert.deepStrictEqual(recordSnapshot(records[0]), recordSnapshot(parseIntelHexLine(':0400100001020304E2', 1)));

            const repaired = await client.repair('ihex', ':0400100001020304E3\n:00000001FF\n');
            assert.strictEqual(repaired.repaired, 1);
            assert.strictEqual(repaired.text, ':0400100001020304E2\n:00000001FF\n');
        } finally {
            client.dispose();
        }
    });

    test('a missing binary is a typed, actionable error', async () => {
        const missing = path.join(ROOT, 'dist', 'engine', 'no-such-target', 'hex-engine');
        await assert.rejects(() => EngineClient.start({ binary: missing }), (error: unknown) => {
            assert.ok(error instanceof EngineError);
            assert.match(error.message, /not built/);
            return true;
        });
    });
});
