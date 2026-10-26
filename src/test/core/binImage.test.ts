import * as assert from 'assert';
import {
    DEFAULT_BIN_BASE_ADDRESS,
    applyBinEdits,
    binAddressRangeFits,
    createBinParseResult,
    formatBinBaseAddress,
    isValidBinBaseAddress,
    parseBinBaseAddress,
    revertBinEdits,
    validateBinBaseAddressInput,
} from '../../core/parser/binImage';
import type { MemorySegment } from '../../core/parser/types';
import { hydrateCompactParseResult, serializeCompactParseResult } from '../../core/parser/compact';

function validValue(input: string, byteLength = 16): number {
    const parsed = parseBinBaseAddress(input, byteLength);
    assert.ok(parsed.ok, `${input} should be valid: ${parsed.ok ? '' : parsed.error}`);
    return parsed.value;
}

function errorOf(input: string, byteLength = 16): string {
    const parsed = parseBinBaseAddress(input, byteLength);
    assert.ok(!parsed.ok, `${input} should be rejected`);
    return parsed.error;
}

suite('binImage — base address parsing', () => {
    test('accepts 0x-prefixed, bare, and uppercase hexadecimal', () => {
        assert.strictEqual(validValue('0'), 0);
        assert.strictEqual(validValue('0x08000000'), 0x08000000);
        assert.strictEqual(validValue('08000000'), 0x08000000);
        assert.strictEqual(validValue('0X1a2b3c4d'), 0x1A2B3C4D);
        assert.strictEqual(validValue('  0x1000  '), 0x1000);
        assert.strictEqual(DEFAULT_BIN_BASE_ADDRESS, 0);
    });

    test('accepts the highest address for an empty image', () => {
        assert.strictEqual(validValue('0xFFFFFFFF', 0), 0xFFFFFFFF);
        assert.strictEqual(validValue('FFFFFFFF', 0), 0xFFFFFFFF);
    });

    test('rejects empty, signed, malformed, decimal-only, and over-long input', () => {
        assert.match(errorOf(''), /Enter a base address/);
        assert.match(errorOf('   '), /Enter a base address/);
        for (const bad of ['+1', '-1', '0x', '0x 1000', '0xGG', '1.5', '1_000', '123456789', '0x123456789']) {
            assert.ok(errorOf(bad).length > 0, `${bad} should be rejected`);
        }
        assert.notStrictEqual(validateBinBaseAddressInput('0xGG', 16), null);
        assert.strictEqual(validateBinBaseAddressInput('0x1000', 16), null);
    });

    test('rejects a base + size that overflows the 32-bit address space', () => {
        assert.strictEqual(validValue('0xFFFFFFF0', 16), 0xFFFFFFF0, 'ends exactly at 0x100000000');
        assert.match(errorOf('0xFFFFFFF0', 17), /exceeds the 32-bit address space/);
        assert.match(errorOf('0xFFFFFFFF', 2), /exceeds the 32-bit address space/);
    });
});

suite('binImage — address helpers', () => {
    test('isValidBinBaseAddress accepts only 32-bit unsigned integers', () => {
        for (const value of [0, 1, 0x08000000, 0xFFFFFFFF]) {
            assert.strictEqual(isValidBinBaseAddress(value), true, String(value));
        }
        for (const value of [-1, 1.5, 0x1_0000_0000, NaN, Infinity, '0x1000', null, undefined]) {
            assert.strictEqual(isValidBinBaseAddress(value), false, String(value));
        }
    });

    test('binAddressRangeFits is the single range predicate', () => {
        assert.strictEqual(binAddressRangeFits(0, 0), true);
        assert.strictEqual(binAddressRangeFits(0xFFFF_FFFF, 0), true);
        assert.strictEqual(binAddressRangeFits(0xFFFF_FFF0, 16), true);
        assert.strictEqual(binAddressRangeFits(0xFFFF_FFF0, 17), false);
        assert.strictEqual(binAddressRangeFits(-1, 1), false);
        assert.strictEqual(binAddressRangeFits(0, -1), false);
        assert.strictEqual(binAddressRangeFits(0, 1.5), false);
    });

    test('formatBinBaseAddress renders 0x plus eight uppercase hex digits', () => {
        assert.strictEqual(formatBinBaseAddress(0), '0x00000000');
        assert.strictEqual(formatBinBaseAddress(0x08000000), '0x08000000');
        assert.strictEqual(formatBinBaseAddress(0xABCDEF), '0x00ABCDEF');
        assert.strictEqual(formatBinBaseAddress(0xFFFFFFFF), '0xFFFFFFFF');
    });
});

suite('binImage — parse result construction', () => {
    test('maps the whole image as one segment at the chosen base', () => {
        const bytes = Uint8Array.from([0x10, 0x20, 0x30]);
        const result = createBinParseResult(bytes, 0x08000000);

        assert.strictEqual(result.records.length, 0, 'raw images have no records');
        assert.strictEqual(result.checksumErrors, 0);
        assert.strictEqual(result.malformedLines, 0);
        assert.strictEqual(result.totalDataBytes, 3);
        assert.strictEqual(result.segments.length, 1);
        assert.strictEqual(result.segments[0].startAddress, 0x08000000);
        assert.strictEqual(result.baseAddress, 0x08000000, 'the memory-map base travels with the result');
        assert.strictEqual(result.segments[0].data, bytes, 'input bytes are kept by identity');
        assert.deepStrictEqual(Array.from(result.segments[0].data), [0x10, 0x20, 0x30]);
        assert.ok(!('startAddress' in result), 'the base is not an execution start address');
    });

    test('an empty image has no segments and no bytes', () => {
        const result = createBinParseResult(new Uint8Array(0), 0x1000);
        assert.deepStrictEqual(result.segments, []);
        assert.strictEqual(result.totalDataBytes, 0);
        assert.strictEqual(result.records.length, 0);
        assert.strictEqual(result.baseAddress, 0x1000, 'an empty image still reports its chosen base');
    });

    test('compact serialization round-trips the base and bytes', () => {
        const result = createBinParseResult(Uint8Array.from([1, 2, 3]), 0x08000000);
        const hydrated = hydrateCompactParseResult(serializeCompactParseResult(result));
        assert.strictEqual(hydrated.baseAddress, 0x08000000);
        assert.strictEqual(hydrated.segments.length, 1);
        assert.strictEqual(hydrated.segments[0].startAddress, 0x08000000);
        assert.deepStrictEqual(Array.from(hydrated.segments[0].data), [1, 2, 3]);
    });
});

suite('binImage — edit application', () => {
    function segment(): MemorySegment {
        return { startAddress: 0x1000, data: Uint8Array.from([1, 2, 3, 4]) };
    }

    test('applies only mapped integer byte values and records prior bytes', () => {
        const seg = segment();
        const outcome = applyBinEdits(seg, new Map<number, number>([
            [0x1000, 0xAA],
            [0x1003, 0xDD],
        ]));

        assert.deepStrictEqual(Array.from(seg.data), [0xAA, 2, 3, 0xDD]);
        assert.deepStrictEqual(outcome.applied, [[0x1000, 0xAA], [0x1003, 0xDD]]);
        assert.deepStrictEqual(outcome.previous, [[0x1000, 1], [0x1003, 4]]);
        assert.strictEqual(seg.data.length, 4, 'the buffer never grows or shrinks');
    });

    test('ignores unmapped addresses and non-byte values', () => {
        const seg = segment();
        const outcome = applyBinEdits(seg, new Map<number, number>([
            [0x0FFF, 0xFF],
            [0x1004, 0xFF],
            [0x1001, -1],
            [0x1001, 256],
            [0x1001, 1.5],
            [Number.NaN, 0x55],
        ]));

        assert.deepStrictEqual(outcome.applied, []);
        assert.deepStrictEqual(Array.from(seg.data), [1, 2, 3, 4]);
    });

    test('revert restores exactly the prior bytes', () => {
        const seg = segment();
        const outcome = applyBinEdits(seg, new Map<number, number>([[0x1001, 0x55], [0x1002, 0x66]]));
        revertBinEdits(seg, outcome.previous);
        assert.deepStrictEqual(Array.from(seg.data), [1, 2, 3, 4]);
        assert.strictEqual(seg.data.length, 4);
    });
});
