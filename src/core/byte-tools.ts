const COPY_COMMANDS = ['hex', 'hex-raw', 'binary', 'ascii', 'dec-array', 'hex-array', 'base64', 'dec', 'c-array'] as const;
export type CopyCommand = typeof COPY_COMMANDS[number];
const COPY_COMMAND_SET = new Set<string>(COPY_COMMANDS);

const COPY_FORMATTERS: Record<CopyCommand, (bytes: number[]) => string> = {
    hex: bytes => bytes.map(hexByte).join(' '),
    'hex-raw': bytes => bytes.map(hexByte).join(''),
    binary: bytes => bytes.map(b => b.toString(2).padStart(8, '0')).join(' '),
    ascii: bytes => bytes.map(formatAsciiByte).join(''),
    'dec-array': bytes => `[${bytes.join(', ')}]`,
    'hex-array': bytes => `[${bytes.map(formatHexArrayByte).join(', ')}]`,
    base64: bytesToBase64,
    dec: bytes => `${bytes[0]}`,
    'c-array': bytes => `{${bytes.map(formatHexArrayByte).join(', ')}}`,
};

export function isCopyCommand(cmd: string): cmd is CopyCommand {
    return COPY_COMMAND_SET.has(cmd);
}

export function formatCopyCommand(cmd: CopyCommand, bytes: number[]): string {
    return COPY_FORMATTERS[cmd](bytes);
}

export function hexByte(b: number): string {
    return b.toString(16).toUpperCase().padStart(2, '0');
}

export function formatHexArrayByte(b: number): string {
    return `0x${hexByte(b)}`;
}

export function formatAsciiByte(b: number): string {
    return (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
}

function bytesToBase64(bytes: number[]): string {
    const binary = String.fromCharCode(...bytes);
    if (typeof btoa === 'function') { return btoa(binary); }
    return Buffer.from(bytes).toString('base64');
}

export function crc8(data: number[]): number {
    let c = 0;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF; }
    }
    return c;
}

export function crc16(data: number[]): number {
    let c = 0;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 1 ? ((c >>> 1) ^ 0xA001) : c >>> 1; }
    }
    return c & 0xFFFF;
}

export function crc32(data: number[]): number {
    let c = 0xFFFFFFFF;
    for (const b of data) {
        c ^= b;
        for (let i = 0; i < 8; i++) { c = c & 1 ? ((c >>> 1) ^ 0xEDB88320) : c >>> 1; }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

export type AnalyzeResult = { text: string; label: string };
const ANALYZE_COMMANDS = ['an-sum', 'an-xor', 'an-crc8', 'an-crc16', 'an-crc32'] as const;
export type AnalyzeCommand = typeof ANALYZE_COMMANDS[number];
const ANALYZE_COMMAND_SET = new Set<string>(ANALYZE_COMMANDS);

const ANALYZE_FORMATTERS: Record<AnalyzeCommand, (bytes: number[]) => AnalyzeResult> = {
    'an-sum': formatAnalyzeSum,
    'an-xor': formatAnalyzeXor,
    'an-crc8': bytes => ({ text: `0x${hexValue(crc8(bytes))}`, label: 'CRC-8' }),
    'an-crc16': bytes => ({ text: `0x${hexValue(crc16(bytes), 4)}`, label: 'CRC-16' }),
    'an-crc32': bytes => ({ text: `0x${hexValue(crc32(bytes), 8)}`, label: 'CRC-32' }),
};

export function isAnalyzeCommand(cmd: string): cmd is AnalyzeCommand {
    return ANALYZE_COMMAND_SET.has(cmd);
}

export function formatAnalyzeCommand(cmd: AnalyzeCommand, bytes: number[]): AnalyzeResult {
    return ANALYZE_FORMATTERS[cmd](bytes);
}

function formatAnalyzeSum(bytes: number[]): AnalyzeResult {
    const sum = bytes.reduce((a, b) => a + b, 0);
    const width = Math.max(4, sum.toString(16).length + (sum.toString(16).length % 2));
    return { text: `0x${hexValue(sum, width)} (${sum})`, label: 'sum' };
}

function formatAnalyzeXor(bytes: number[]): AnalyzeResult {
    const xor = bytes.reduce((a, b) => a ^ b, 0);
    return { text: `0x${hexValue(xor)}`, label: 'XOR' };
}

export function hexValue(value: number, width = 2): string {
    return value.toString(16).toUpperCase().padStart(width, '0');
}
