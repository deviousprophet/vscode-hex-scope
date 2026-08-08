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
