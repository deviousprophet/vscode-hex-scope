export function hexByte(b: number): string {
    return b.toString(16).toUpperCase().padStart(2, '0');
}

export function formatHexArrayByte(b: number): string {
    return `0x${hexByte(b)}`;
}

export function formatAsciiByte(b: number): string {
    return (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
}

export function hexValue(value: number, width = 2): string {
    return value.toString(16).toUpperCase().padStart(width, '0');
}

/**
 * Parse a user-entered full hexadecimal address (`0x`/`0X` optional, 1-8
 * digits, case-insensitive). Returns null for signs, separators, decimal-only
 * text, empty input, or values outside the 32-bit address space.
 */
export function parseHexAddress(input: string): number | null {
    const match = /^(?:0[xX])?([0-9a-fA-F]{1,8})$/.exec(input.trim());
    if (!match) { return null; }
    const value = parseInt(match[1], 16);
    return value <= 0xFFFFFFFF ? value : null;
}
