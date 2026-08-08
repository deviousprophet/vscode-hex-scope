import { crc8, crc16, crc32 } from './crc';
import { hexValue } from './hex';

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
