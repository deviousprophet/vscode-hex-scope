import * as assert from 'assert';

import { crc8, crc16, crc32 } from '../../../core/byte-tools/crc';

const VECTOR = new TextEncoder().encode('123456789');

suite('crc check vectors', () => {
    test('crc8 returns 0xF4 (CRC-8, poly x^8+x^2+x+1)', () => {
        assert.strictEqual(crc8([...VECTOR]), 0xF4);
    });

    test('crc16 returns 0x4B37 (CRC-16/Modbus, init 0xFFFF)', () => {
        assert.strictEqual(crc16([...VECTOR]), 0x4B37);
    });

    test('crc32 returns 0xCBF43926 (CRC-32/ISO-HDLC)', () => {
        assert.strictEqual(crc32([...VECTOR]), 0xCBF43926);
    });
});
