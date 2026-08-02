// Wire-format helpers shared between the single hex editor and the diff view:
// zero-copy ArrayBuffer segment transfer and webview-side rehydration.
// Pure — no `vscode`, no DOM — testable in isolation.

import type { SerializedParseResult, WireParseResult, WireSegment } from './types';

/** Serialize parse-result segments to zero-copy ArrayBuffer wire segments. */
export function toWireSegments(segments: readonly { startAddress: number; data: Uint8Array }[]): WireSegment[] {
    return segments.map(s => ({
        startAddress: s.startAddress,
        data: s.data.buffer.slice(s.data.byteOffset, s.data.byteOffset + s.data.byteLength) as ArrayBuffer,
    }));
}

/** Rehydrate binary wire segments into byte-addressable segments. */
export function hydrateParseResult(result: WireParseResult): SerializedParseResult {
    return {
        ...result,
        records: [],
        segments: result.segments.map(segment => ({
            startAddress: segment.startAddress,
            data: new Uint8Array(segment.data),
        })),
    };
}
