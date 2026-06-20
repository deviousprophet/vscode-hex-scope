import * as assert from 'assert';

import {
    calculateIntegrity,
    collectIntegrityBytes,
    integrityBytesEqual,
    integrityValueToBytes,
    normalizeIntegrityProfiles,
    parseIntegrityAddress,
    readStoredIntegrityBytes,
    type IntegrityAlgorithm,
    validateIntegrityRange,
} from '../webview/integrity';

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

    test('encodes calculated values in selectable stored byte order', () => {
        assert.deepStrictEqual(integrityValueToBytes('1234ABCD', 'be'), new Uint8Array([0x12, 0x34, 0xAB, 0xCD]));
        assert.deepStrictEqual(integrityValueToBytes('1234ABCD', 'le'), new Uint8Array([0xCD, 0xAB, 0x34, 0x12]));
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
            byteOrder: 'le',
        }],
    };

    test('normalizes valid versioned profiles', () => {
        const profiles = normalizeIntegrityProfiles([validProfile]);
        assert.strictEqual(profiles.length, 1);
        assert.strictEqual(profiles[0].name, 'STM32 App');
        assert.strictEqual(profiles[0].checks[0].storedAddress, 0x08000100);
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
});
