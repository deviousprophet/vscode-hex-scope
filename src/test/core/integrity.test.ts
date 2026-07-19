import * as assert from 'assert';

import {
    calculateIntegrity,
    collectIntegrityBytes,
    collectIntegrityBytesAsync,
    integrityBytesEqual,
    integrityBytesToValueHex,
    integrityValueToBytes,
    isChecksumAlgorithm,
    mergeIntegrityEdits,
    normalizeIntegrityCheckSet,
    normalizeIntegrityProfiles,
    parseIntegrityAddress,
    readStoredIntegrityBytes,
    type IntegrityAlgorithm,
    validateIntegrityRange,
} from '../../core/integrity';

const VECTOR = new TextEncoder().encode('123456789');
const EXPECTED: Record<IntegrityAlgorithm, string> = {
    'crc16-ccitt-false': '29B1',
    'crc32-iso-hdlc': 'CBF43926',
    md5: '25F9E794323B453885F5181F1B624D0B',
    'sha-1': 'F7C3BC1D808E04732ADF679965CCC34CA7AE3441',
    'sha-256': '15E2B0D3C33891EBB0F1EF609EC419420C20E320CE94C65FBC8C3312448EB225',
    'sha-512': 'D9E6762DD1C8EAF6D61B3C6192FC408D4D6D5F1176D0C29169BC24E71C3F274AD27FCD5811B313D681F7E55EC02D73D499C95455B6B5BB503ACF574FBA8FFE85',
};

suite('integrity algorithms', () => {
    for (const [algorithm, expected] of Object.entries(EXPECTED) as Array<[IntegrityAlgorithm, string]>) {
        test(`${algorithm} matches the 123456789 vector`, async () => {
            const result = await calculateIntegrity(algorithm, VECTOR);
            assert.strictEqual(result.value, expected);
            assert.strictEqual(result.byteCount, 9);
        });
    }

    test('software algorithms yield on large byte arrays and preserve results', async () => {
        const data = new Uint8Array(16 * 1024);
        data.fill(0xA5);
        const algorithms: IntegrityAlgorithm[] = ['crc16-ccitt-false', 'crc32-iso-hdlc', 'md5'];
        for (const algorithm of algorithms) {
            const expected = await calculateIntegrity(algorithm, data);
            let nowTick = 0;
            let yieldCount = 0;
            const result = await calculateIntegrity(algorithm, data, {
                timeBudgetMs: 1,
                now: () => nowTick++,
                yieldControl: async () => { yieldCount++; },
            });
            assert.strictEqual(result.value, expected.value);
            assert.ok(yieldCount > 0, `expected ${algorithm} calculation to yield`);
        }
    });
});

suite('integrity range parsing', () => {
    test('accepts optional 0x and case-insensitive hexadecimal', () => {
        assert.deepStrictEqual(parseIntegrityAddress('0xAbCd', 'Start'), { ok: true, value: 0xABCD });
        assert.deepStrictEqual(parseIntegrityAddress('abcd', 'Start'), { ok: true, value: 0xABCD });
    });

    test('uses inclusive start and end addresses', () => {
        const request = validateIntegrityRange('1000', '1002', 'sha-256');
        assert.strictEqual(request.ok, true);
        if (!request.ok) { return; }
        const bytes = collectIntegrityBytes(request.value, address => address - 0x1000 + 1);
        assert.deepStrictEqual(bytes, { ok: true, value: new Uint8Array([1, 2, 3]) });
    });

    test('supports a single-byte range', () => {
        const request = validateIntegrityRange('FFFFFFFF', '0xFFFFFFFF', 'crc32-iso-hdlc');
        assert.strictEqual(request.ok, true);
        if (!request.ok) { return; }
        assert.deepStrictEqual(collectIntegrityBytes(request.value, () => 0xA5), {
            ok: true,
            value: new Uint8Array([0xA5]),
        });
    });

    test('rejects empty, malformed, overflow, and reversed ranges', () => {
        assert.strictEqual(validateIntegrityRange('', '10', 'md5').ok, false);
        assert.strictEqual(validateIntegrityRange('xyz', '10', 'md5').ok, false);
        assert.strictEqual(validateIntegrityRange('100000000', '100000000', 'md5').ok, false);
        assert.strictEqual(validateIntegrityRange('20', '10', 'md5').ok, false);
    });

    test('reports first unmapped address', () => {
        const request = validateIntegrityRange('1000', '1003', 'sha-1');
        assert.strictEqual(request.ok, true);
        if (!request.ok) { return; }
        const bytes = collectIntegrityBytes(request.value, address => address === 0x1002 ? undefined : 0);
        assert.deepStrictEqual(bytes, { ok: false, error: 'No mapped byte at 0x00001002.' });
    });

    test('read callback can apply pending edits over source bytes', () => {
        const request = validateIntegrityRange('2000', '2002', 'crc16-ccitt-false');
        assert.strictEqual(request.ok, true);
        if (!request.ok) { return; }
        const source = new Map([[0x2000, 1], [0x2001, 2], [0x2002, 3]]);
        const edits = new Map([[0x2001, 0xFF]]);
        const bytes = collectIntegrityBytes(request.value, address => edits.get(address) ?? source.get(address));
        assert.deepStrictEqual(bytes, { ok: true, value: new Uint8Array([1, 0xFF, 3]) });
    });

    test('excludes an overlapping stored field from calculation bytes', () => {
        const request = validateIntegrityRange('1000', '1005', 'crc32-iso-hdlc');
        assert.strictEqual(request.ok, true);
        if (!request.ok) { return; }
        const bytes = collectIntegrityBytes(
            request.value,
            address => address - 0x1000,
            { startAddress: 0x1002, byteLength: 2 },
        );
        assert.deepStrictEqual(bytes, { ok: true, value: new Uint8Array([0, 1, 4, 5]) });
    });

    test('async collection yields and preserves overlap exclusion', async () => {
        const request = validateIntegrityRange('1000', '5000', 'crc32-iso-hdlc');
        assert.strictEqual(request.ok, true);
        if (!request.ok) { return; }
        let nowTick = 0;
        let yieldCount = 0;
        const bytes = await collectIntegrityBytesAsync(
            request.value,
            address => address & 0xFF,
            { startAddress: 0x2000, byteLength: 4 },
            {
                timeBudgetMs: 1,
                now: () => nowTick++,
                yieldControl: async () => { yieldCount++; },
            },
        );
        assert.strictEqual(bytes.ok, true);
        if (!bytes.ok) { return; }
        assert.strictEqual(bytes.value.length, 0x4001 - 4);
        assert.strictEqual(bytes.value[0], 0);
        assert.ok(yieldCount > 0, 'expected integrity byte collection to yield');
    });

    test('encodes calculated values in selectable stored byte order', () => {
        assert.deepStrictEqual(integrityValueToBytes('1234ABCD', 'be'), new Uint8Array([0x12, 0x34, 0xAB, 0xCD]));
        assert.deepStrictEqual(integrityValueToBytes('1234ABCD', 'le'), new Uint8Array([0xCD, 0xAB, 0x34, 0x12]));
        assert.strictEqual(integrityBytesToValueHex(new Uint8Array([0x12, 0x34, 0xAB, 0xCD]), 'be'), '1234ABCD');
        assert.strictEqual(integrityBytesToValueHex(new Uint8Array([0xCD, 0xAB, 0x34, 0x12]), 'le'), '1234ABCD');
        assert.strictEqual(integrityBytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
        assert.strictEqual(integrityBytesEqual(new Uint8Array([1, 2]), new Uint8Array([2, 1])), false);
    });

    test('reads stored bytes and reports an unmapped stored address', () => {
        assert.deepStrictEqual(readStoredIntegrityBytes(
            { startAddress: 0x2000, byteLength: 2 },
            address => address === 0x2000 ? 0xAA : 0xBB,
        ), { ok: true, value: new Uint8Array([0xAA, 0xBB]) });
        assert.deepStrictEqual(readStoredIntegrityBytes(
            { startAddress: 0x2000, byteLength: 2 },
            address => address === 0x2000 ? 0xAA : undefined,
        ), { ok: false, error: 'No mapped stored byte at 0x00002001.' });
    });
});

suite('integrity profile normalization', () => {
    const validProfile = {
        schemaVersion: 1,
        id: 'profile-1',
        name: ' STM32 App ',
        checks: [{
            algorithm: 'crc32-iso-hdlc',
            startAddress: 0x08000000,
            endAddress: 0x080000FF,
            storedAddress: 0x08000100,
            autoFixStoredValue: false,
        }],
    };

    test('normalizes valid versioned profiles', () => {
        const profiles = normalizeIntegrityProfiles([validProfile]);
        assert.strictEqual(profiles.length, 1);
        assert.strictEqual(profiles[0].name, 'STM32 App');
        assert.strictEqual(profiles[0].checks[0].storedAddress, 0x08000100);
        assert.strictEqual(profiles[0].checks[0].autoFixStoredValue, false);
    });

    test('drops malformed profiles and case-insensitive duplicate names', () => {
        const profiles = normalizeIntegrityProfiles([
            validProfile,
            { ...validProfile, id: 'profile-2', name: 'stm32 app' },
            { ...validProfile, id: 'bad-version', schemaVersion: 2 },
            { ...validProfile, id: 'bad-range', name: 'Bad', checks: [{ ...validProfile.checks[0], endAddress: 1 }] },
        ]);
        assert.deepStrictEqual(profiles.map(profile => profile.id), ['profile-1']);
    });

    test('strips stored verification settings from hash profiles', () => {
        const profiles = normalizeIntegrityProfiles([{
            ...validProfile,
            checks: [{
                algorithm: 'sha-256', startAddress: 0x1000, endAddress: 0x10FF,
                storedAddress: 0x1100, autoFixStoredValue: true,
            }],
        }]);
        assert.deepStrictEqual(profiles[0].checks[0], {
            algorithm: 'sha-256', startAddress: 0x1000, endAddress: 0x10FF,
            autoFixStoredValue: false,
        });
    });

});

suite('integrity check-set normalization', () => {
    test('recognizes only CRC algorithms as stored checksums', () => {
        assert.strictEqual(isChecksumAlgorithm('crc16-ccitt-false'), true);
        assert.strictEqual(isChecksumAlgorithm('crc32-iso-hdlc'), true);
        assert.strictEqual(isChecksumAlgorithm('md5'), false);
        assert.strictEqual(isChecksumAlgorithm('sha-512'), false);
    });
    test('accepts empty and configured per-file check sets', () => {
        assert.deepStrictEqual(normalizeIntegrityCheckSet({ schemaVersion: 1, checks: [] }), {
            schemaVersion: 1, checks: [],
        });
        const normalized = normalizeIntegrityCheckSet({
            schemaVersion: 1,
            checks: [{ algorithm: 'crc16-ccitt-false', startAddress: 0x1000, endAddress: 0x10FF, autoFixStoredValue: true }],
        });
        assert.strictEqual(normalized?.checks.length, 1);
        assert.strictEqual(normalized?.checks[0].autoFixStoredValue, true);
    });

    test('rejects malformed per-file check sets', () => {
        assert.strictEqual(normalizeIntegrityCheckSet({ schemaVersion: 2, checks: [] }), null);
        assert.strictEqual(normalizeIntegrityCheckSet({ schemaVersion: 1, checks: [{}] }), null);
        assert.strictEqual(normalizeIntegrityCheckSet({
            schemaVersion: 1,
            checks: [{ algorithm: 'crc32-iso-hdlc', startAddress: 0, endAddress: 1 }],
        }), null);
    });
});

suite('integrity edit merging', () => {
    test('deduplicates compatible overlapping fixes', () => {
        assert.deepStrictEqual(mergeIntegrityEdits([
            [[0x1000, 0xAA], [0x1001, 0xBB]],
            [[0x1001, 0xBB], [0x1002, 0xCC]],
        ]), { ok: true, value: [[0x1000, 0xAA], [0x1001, 0xBB], [0x1002, 0xCC]] });
    });

    test('rejects conflicting overlaps atomically', () => {
        assert.deepStrictEqual(mergeIntegrityEdits([
            [[0x1000, 0xAA]],
            [[0x1000, 0xBB]],
        ]), { ok: false, error: 'Fix all conflict at 0x00001000.' });
    });
});
