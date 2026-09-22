let bytes = new Map<number, number>();

export function setBytesInSegment(baseAddr: number, data: number[]): void {
    bytes = new Map(data.map((value, index) => [baseAddr + index, value]));
}

export function getByte(addr: number): number | undefined { return bytes.get(addr); }
