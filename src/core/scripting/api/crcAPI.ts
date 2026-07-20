import { crc8, crc16, crc32 } from '../../byte-tools/crc';

export function crcAPI() {
    return { crc8, crc16, crc32 };
}
