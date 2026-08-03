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

type IntegrityHighlight = NonNullable<typeof S.integrityHighlight>;

function isStoredIntegrityAddress(highlight: IntegrityHighlight, address: number): boolean {
    if (highlight.storedStart === undefined) { return false; }
    if (highlight.storedLength === undefined) { return false; }
    return address >= highlight.storedStart && address < highlight.storedStart + highlight.storedLength;
}

function isIntegrityRangeAddress(highlight: IntegrityHighlight, address: number): boolean {
    return address >= highlight.rangeStart && address <= highlight.rangeEnd;
}

/** Integrity highlight class suffix for a byte cell (host-side cell-class input). */
export function integrityHighlightClass(address: number): string {
    const highlight = S.integrityHighlight;
    if (!highlight) { return ''; }
    if (isStoredIntegrityAddress(highlight, address)) { return ` integrity-stored-${highlight.status}`; }
    if (isIntegrityRangeAddress(highlight, address)) { return ' integrity-range'; }
    return '';
}
