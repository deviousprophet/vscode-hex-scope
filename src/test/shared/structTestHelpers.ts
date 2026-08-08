import { initFlatBytes } from '../../webview/memory/memoryData';
import { S } from '../../webview/state';

export function setBytesInSegment(baseAddr: number, bytes: number[]): void {
    S.parseResult = {
        records: [],
        segments: [{ startAddress: baseAddr, data: bytes }],
        totalDataBytes: bytes.length,
        checksumErrors: 0,
        malformedLines: 0,
        format: 'ihex',
    };
    initFlatBytes();
}
