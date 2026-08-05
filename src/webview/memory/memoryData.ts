// Webview state adapter for core memory helpers.

import { buildMemoryRows, buildSegmentIndex, getByteAt } from '../../core/memory';
import { S, BPR } from '../state';

export function getByte(addr: number): number | undefined {
    return getByteAt(S.parseResult, S.segmentIndex, S.edits, addr);
}

export function buildMemRows(): void {
    S.memRows = buildMemoryRows(S.parseResult, BPR);
}

export function initFlatBytes(): void {
    S.segmentIndex = buildSegmentIndex(S.parseResult);
}
