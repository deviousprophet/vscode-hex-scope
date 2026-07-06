export function crc8(data: number[]): number {
    let c = 0;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF; }
    }
    return c;
}

export function crc16(data: number[]): number {
    let c = 0;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 1 ? ((c >>> 1) ^ 0xA001) : c >>> 1; }
    }
    return c & 0xFFFF;
}

export function crc32(data: number[]): number {
    let c = 0xFFFFFFFF;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 1 ? ((c >>> 1) ^ 0xEDB88320) : c >>> 1; }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}
