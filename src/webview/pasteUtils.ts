const HEX_ONLY = /^[0-9a-fA-F]+$/;
const HEX_PAIR = /^[0-9a-fA-F]{2}$/;
const PREFIX_RE = /\b0x/gi;
const SEP_RE = /[\s,;]+/g;

function normalizePasteText(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) { return null; }
    return trimmed.replace(PREFIX_RE, '').replace(SEP_RE, ' ').trim();
}

function parseSpaceSeparatedHex(text: string): number[] | null {
    const parts = text.split(' ').filter(p => p.length > 0);
    if (parts.length === 0) { return null; }
    if (!parts.every(p => HEX_PAIR.test(p))) { return null; }
    return parts.map(p => parseInt(p, 16));
}

function isEvenLengthHex(text: string): boolean {
    return HEX_ONLY.test(text) && text.length >= 2 && text.length % 2 === 0;
}

function parseRawHex(text: string): number[] | null {
    if (!isEvenLengthHex(text)) { return null; }
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i += 2) { bytes.push(parseInt(text.slice(i, i + 2), 16)); }
    return bytes;
}

export function parsePasteText(text: string): number[] | null {
    const normalized = normalizePasteText(text);
    if (!normalized) { return null; }
    if (normalized.includes(' ')) { return parseSpaceSeparatedHex(normalized); }
    return parseRawHex(normalized);
}

/** Status message when a paste was truncated at an unmapped byte (null = no notice needed). */
export function pasteOverflowNotice(editsLength: number, bytesLength: number): string | null {
    if (bytesLength === 0 || editsLength >= bytesLength) { return null; }
    return editsLength > 0
        ? `Pasted ${editsLength} of ${bytesLength} bytes \u2014 hit an unmapped region`
        : 'Nothing pasted \u2014 selection starts at an unmapped region';
}
