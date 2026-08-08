import * as assert from 'assert';

import { contextCommandResult, copyCommandResult } from '../../webview/contextCommands';

suite('webview contextCommands mapping', () => {
    test('copy-hex/ascii/c-array map to existing contextCommandResult formats', () => {
        const bytes = [0xDE, 0xAD, 0xBE, 0xEF];
        assert.deepStrictEqual(copyCommandResult('hex', bytes), {
            type: 'copyText',
            text: 'DE AD BE EF',
            label: '4 bytes as hex',
        });
        assert.deepStrictEqual(copyCommandResult('ascii', bytes), {
            type: 'copyText',
            text: '....',
            label: '4 bytes as ascii',
        });
        assert.deepStrictEqual(copyCommandResult('c-array', bytes), {
            type: 'copyText',
            text: '{0xDE, 0xAD, 0xBE, 0xEF}',
            label: '4 bytes as c-array',
        });
        assert.strictEqual(contextCommandResult('fill-00', bytes, true).type, 'fill');
        assert.strictEqual(contextCommandResult('fill-00', bytes, false).type, 'none');
    });

    test('contextCommandResult normalizes copy-hex/ascii/c-array menu cmds', () => {
        const bytes = [0xDE, 0xAD, 0xBE, 0xEF];
        assert.strictEqual(contextCommandResult('copy-hex', bytes, false).type, 'copyText');
        assert.strictEqual(contextCommandResult('copy-ascii', bytes, false).type, 'copyText');
        assert.strictEqual(contextCommandResult('copy-c-array', bytes, false).type, 'copyText');
    });
});
