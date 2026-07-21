import { crc8 as coreCrc8, crc16 as coreCrc16, crc32 as coreCrc32 } from '../../byte-tools/crc';

function toNumbers(data: Uint8Array | number[]): number[] {
    return data instanceof Uint8Array ? [...data] : data;
}

export function crcAPI() {
    return {
        crc8(data: Uint8Array | number[]): number { return coreCrc8(toNumbers(data)); },
        crc16(data: Uint8Array | number[]): number { return coreCrc16(toNumbers(data)); },
        crc32(data: Uint8Array | number[]): number { return coreCrc32(toNumbers(data)); },
    };
}
