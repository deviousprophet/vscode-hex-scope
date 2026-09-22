import { initFlatBytes } from '../../webview/memory/memoryData';
import { S } from '../../webview/state';

/**
 * Seed the webview `S` state for a struct/integrity panel test.
 *
 * NOT the same helper as `src/test/shared/structTestHelpers.ts`: that one is a
 * DOM/webview-free byte map for core tests. This one mutates `S` and rebuilds
 * the flat byte index, so it may only be used from webview tests.
 */
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
