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
    const parts = text.split(' ');
    const bytes: number[] = [];
    for (const p of parts) {
        if (p.length === 0) { continue; }
        if (!HEX_PAIR.test(p)) { return null; }
        bytes.push(parseInt(p, 16));
    }
    return bytes.length > 0 ? bytes : null;
}

function parseRawHex(text: string): number[] | null {
    if (!HEX_ONLY.test(text) || text.length < 2 || text.length % 2 !== 0) { return null; }
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i += 2) {
        bytes.push(parseInt(text.slice(i, i + 2), 16));
    }
    return bytes;
}

export function parsePasteText(text: string): number[] | null {
    const normalized = normalizePasteText(text);
    if (!normalized) { return null; }
    if (normalized.includes(' ')) { return parseSpaceSeparatedHex(normalized); }
    return parseRawHex(normalized);
}
