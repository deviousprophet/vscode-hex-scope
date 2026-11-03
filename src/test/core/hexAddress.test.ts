import * as assert from 'assert';
import { parseHexAddress } from '../../core/byteTools/hex';

suite('parseHexAddress', () => {
    const valid: Array<[string, number]> = [
        ['0', 0],
        ['0x00000000', 0],
        ['0x1A2B', 0x1A2B],
        ['1a2b', 0x1A2B],
        ['0XFFFFFFFF', 0xFFFFFFFF],
        [' 0x1000 ', 0x1000],
    ];
    for (const [input, expected] of valid) {
        test(`accepts ${JSON.stringify(input)}`, () => {
            assert.strictEqual(parseHexAddress(input), expected);
        });
    }

    const invalid = ['', '   ', '0x', '-1', '+1', '0x1G', '1 000', '100000000', '123456789'];
    for (const input of invalid) {
        test(`rejects ${JSON.stringify(input)}`, () => {
            assert.strictEqual(parseHexAddress(input), null);
        });
    }
});
