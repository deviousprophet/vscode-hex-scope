import type { CopyCommand } from './copyCommand';
import { formatAsciiByte, formatHexArrayByte, hexByte } from './hex';

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

export function formatCopyCommand(cmd: CopyCommand, bytes: number[]): string {
    return COPY_FORMATTERS[cmd](bytes);
}

function bytesToBase64(bytes: number[]): string {
    const binary = String.fromCharCode(...bytes);
    if (typeof btoa === 'function') { return btoa(binary); }
    return Buffer.from(bytes).toString('base64');
}
