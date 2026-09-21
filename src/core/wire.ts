import type { HexScopeFormat } from './document';
import type { CompactParseResult } from './parser/compact';
import type { WireParseResult } from './types';

/** Serialize a compact parse result into the exact-ArrayBuffer webview wire shape. */
export function serializeParseResult(result: CompactParseResult, format: HexScopeFormat): WireParseResult {
    return {
        recordCount: result.records.length,
        segments: result.segments.map(s => ({
            startAddress: s.startAddress,
            data: s.data.buffer.slice(s.data.byteOffset, s.data.byteOffset + s.data.byteLength) as ArrayBuffer,
        })),
        totalDataBytes: result.totalDataBytes,
        checksumErrors: result.checksumErrors,
        malformedLines: result.malformedLines,
        startAddress: result.startAddress,
        format,
    };
}
