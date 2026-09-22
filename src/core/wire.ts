import type { HexScopeFormat } from './document';
import { wireSegments, type CompactParseResult } from './parser/compact';
import type { WireParseResult } from './types';

/** Serialize a compact parse result into the exact-ArrayBuffer webview wire shape. */
export function serializeParseResult(result: CompactParseResult, format: HexScopeFormat): WireParseResult {
    return {
        recordCount: result.records.length,
        segments: wireSegments(result.segments),
        totalDataBytes: result.totalDataBytes,
        checksumErrors: result.checksumErrors,
        malformedLines: result.malformedLines,
        startAddress: result.startAddress,
        format,
    };
}
