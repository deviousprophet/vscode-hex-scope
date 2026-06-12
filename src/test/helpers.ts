import * as assert from 'assert';

export interface SegmentLike {
    data: number[] | Uint8Array;
}

export function segmentDataLengthTotal(segments: SegmentLike[]): number {
    return segments.reduce((sum, seg) => sum + seg.data.length, 0);
}

function flattenSegmentBytes(segments: SegmentLike[]): number[] {
    const flat: number[] = [];
    for (const seg of segments) { flat.push(...seg.data); }
    return flat;
}

function containsByteSequence(haystack: number[], needle: number[]): boolean {
    return haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b));
}

export function assertSegmentsContainBytes(segments: SegmentLike[], bytes: number[], label: string): void {
    assert.ok(containsByteSequence(flattenSegmentBytes(segments), bytes), `${label} bytes not found in any segment`);
}

export interface ParsedRecordLike {
    byteCount: number;
    address: number;
    data: number[] | Uint8Array;
    checksumValid: boolean;
    error?: string;
}

export function assertParsedRecordPayload(
    record: ParsedRecordLike,
    expected: { byteCount: number; address: number; data: number[] },
): void {
    assert.strictEqual(record.byteCount, expected.byteCount);
    assert.strictEqual(record.address, expected.address);
    assert.deepStrictEqual(Array.from(record.data), expected.data);
    assert.strictEqual(record.checksumValid, true);
    assert.strictEqual(record.error, undefined);
}
