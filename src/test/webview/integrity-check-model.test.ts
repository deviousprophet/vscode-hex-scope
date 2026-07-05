import * as assert from 'assert';

import {
    applyIntegrityDraft,
    blankIntegrityDraft,
    clearIntegrityAutoFixSuppression,
    clearIntegrityCheckResult,
    draftFromIntegrityConfig,
    integrityCheckConfigFromState,
    integrityCheckConfigsFromStates,
    integrityCheckSetFromStates,
    makeIntegrityCheck,
} from '../../webview/panels/integrity/integrityCheckModel';

suite('integrity check model', () => {
    test('creates blank checks with stable defaults', () => {
        const check = makeIntegrityCheck(7);

        assert.strictEqual(check.id, 7);
        assert.deepStrictEqual(blankIntegrityDraft(), {
            algorithm: 'crc32-iso-hdlc',
            startRaw: '',
            endRaw: '',
            storedRaw: '',
        });
        assert.strictEqual(check.autoFixStoredValue, false);
        assert.strictEqual(check.result, null);
        assert.strictEqual(check.timer, null);
    });

    test('round-trips saved checksum configs through drafts and check state', () => {
        const draft = draftFromIntegrityConfig({
            algorithm: 'crc16-ccitt-false',
            startAddress: 0x1000,
            endAddress: 0x1003,
            storedAddress: 0x2000,
            autoFixStoredValue: true,
        });
        const check = makeIntegrityCheck(1, {
            algorithm: 'crc16-ccitt-false',
            startAddress: 0x1000,
            endAddress: 0x1003,
            storedAddress: 0x2000,
            autoFixStoredValue: true,
        });

        assert.deepStrictEqual(draft, {
            algorithm: 'crc16-ccitt-false',
            startRaw: '0x00001000',
            endRaw: '0x00001003',
            storedRaw: '0x00002000',
        });
        assert.deepStrictEqual(integrityCheckConfigFromState(check), {
            ok: true,
            value: {
                algorithm: 'crc16-ccitt-false',
                startAddress: 0x1000,
                endAddress: 0x1003,
                storedAddress: 0x2000,
                autoFixStoredValue: true,
            },
        });
    });

    test('drops stored checksum fields when applying a hash draft', () => {
        const check = makeIntegrityCheck(1, {
            algorithm: 'crc16-ccitt-false',
            startAddress: 0,
            endAddress: 3,
            storedAddress: 8,
            autoFixStoredValue: true,
        });
        check.result = { algorithm: 'crc16-ccitt-false', value: 'ABCD', byteCount: 4 };
        check.expectedBytes = new Uint8Array([0xab, 0xcd]);
        check.storedBytes = new Uint8Array([0, 0]);
        check.error = 'old';
        check.meta = 'old';
        check.calculating = true;
        check.suppressAutoFixOnNextResult = true;
        check.suppressedAutoFixMismatch = 'old';

        applyIntegrityDraft(check, {
            algorithm: 'sha-256',
            startRaw: '00000000',
            endRaw: '00000003',
            storedRaw: '00000008',
        });

        assert.strictEqual(check.storedRaw, '');
        assert.strictEqual(check.autoFixStoredValue, false);
        assert.strictEqual(check.result, null);
        assert.strictEqual(check.expectedBytes, null);
        assert.strictEqual(check.storedBytes, null);
        assert.strictEqual(check.error, '');
        assert.strictEqual(check.meta, '');
        assert.strictEqual(check.calculating, false);
        assert.strictEqual(check.suppressAutoFixOnNextResult, false);
        assert.strictEqual(check.suppressedAutoFixMismatch, '');
    });

    test('builds check sets and reports indexed validation errors', () => {
        const valid = makeIntegrityCheck(1, {
            algorithm: 'sha-256',
            startAddress: 0x10,
            endAddress: 0x20,
            autoFixStoredValue: false,
        });
        const invalid = makeIntegrityCheck(2);
        invalid.startRaw = '20';
        invalid.endRaw = '10';

        assert.deepStrictEqual(integrityCheckSetFromStates([valid]), {
            ok: true,
            value: {
                schemaVersion: 1,
                checks: [{
                    algorithm: 'sha-256',
                    startAddress: 0x10,
                    endAddress: 0x20,
                    autoFixStoredValue: false,
                }],
            },
        });
        assert.deepStrictEqual(integrityCheckConfigsFromStates([valid, invalid]), {
            ok: false,
            error: 'Check 2: End address must be greater than or equal to start address.',
        });
    });

    test('clears result and autofix suppression independently', () => {
        const check = makeIntegrityCheck(1);
        check.result = { algorithm: 'sha-1', value: 'AA', byteCount: 1 };
        check.expectedBytes = new Uint8Array([0xaa]);
        check.storedBytes = new Uint8Array([0xbb]);
        check.error = 'err';
        check.meta = 'meta';
        check.calculating = true;
        check.suppressAutoFixOnNextResult = true;
        check.suppressedAutoFixMismatch = 'key';

        clearIntegrityCheckResult(check);
        clearIntegrityAutoFixSuppression(check);

        assert.strictEqual(check.result, null);
        assert.strictEqual(check.expectedBytes, null);
        assert.strictEqual(check.storedBytes, null);
        assert.strictEqual(check.error, '');
        assert.strictEqual(check.meta, '');
        assert.strictEqual(check.calculating, false);
        assert.strictEqual(check.suppressAutoFixOnNextResult, false);
        assert.strictEqual(check.suppressedAutoFixMismatch, '');
    });
});
