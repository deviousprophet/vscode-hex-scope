// Integrity-highlight cell-class helper (webview paint input).
// Split out of memoryData.ts to keep the memory adapter single-concern.

import { S } from '../state';

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
