import * as assert from 'assert';
import { baseAddressChangeRefusal, type BaseAddressChangeState } from '../../webview/baseAddressChange';

const CLEAN_RAW: BaseAddressChangeState = {
    format: 'bin',
    hasUnsavedEdits: false,
    lockedDueToExternalChange: false,
};

suite('webview base-address change guard', () => {
    test('a clean raw document may request the change', () => {
        assert.strictEqual(baseAddressChangeRefusal(CLEAN_RAW), null);
    });

    test('only raw binaries may change their base', () => {
        for (const format of ['ihex', 'srec', undefined] as const) {
            assert.strictEqual(
                baseAddressChangeRefusal({ ...CLEAN_RAW, format }),
                'Base address applies only to raw binary files.',
                `format ${format ?? 'unloaded'}`,
            );
        }
    });

    test('unsaved edits refuse until they are saved or discarded', () => {
        assert.strictEqual(
            baseAddressChangeRefusal({ ...CLEAN_RAW, hasUnsavedEdits: true }),
            'Save or discard your edits before changing the base address.',
        );
    });

    test('an unresolved external change refuses', () => {
        assert.strictEqual(
            baseAddressChangeRefusal({ ...CLEAN_RAW, lockedDueToExternalChange: true }),
            'Resolve the external change before changing the base address.',
        );
    });
});
