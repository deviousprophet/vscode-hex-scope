import { formatAnalyzeCommand, isAnalyzeCommand } from '../core/byte-tools/analysis';
import { formatCopyCommand } from '../core/byte-tools/copy';
import { isCopyCommand } from '../core/byte-tools/copyCommand';
import { hexByte } from '../core/byte-tools/hex';

export type ContextCommandResult =
    | { type: 'none' }
    | { type: 'copyText'; text: string; label: string }
    | { type: 'fill'; value: number };

type ContextCommandHandler = (cmd: string, bytes: number[], editMode: boolean) => ContextCommandResult;

const CONTEXT_COMMAND_HANDLERS: readonly ContextCommandHandler[] = [
    copyCommandHandler,
    analyzeCommandHandler,
    fillCommandHandler,
];

export function copyCommandResult(cmd: string, bytes: number[]): ContextCommandResult {
    if (bytes.length === 0 || !isCopyCommand(cmd)) { return { type: 'none' }; }

    return {
        type: 'copyText',
        text: formatCopyCommand(cmd, bytes),
        label: `${bytes.length} bytes as ${cmd}`,
    };
}

export function contextCommandResult(cmd: string, bytes: number[], editMode: boolean): ContextCommandResult {
    if (bytes.length === 0) { return { type: 'none' }; }
    for (const handler of CONTEXT_COMMAND_HANDLERS) {
        const result = handler(cmd, bytes, editMode);
        if (result.type !== 'none') { return result; }
    }
    return { type: 'none' };
}

function copyCommandHandler(cmd: string, bytes: number[]): ContextCommandResult {
    return copyCommandResult(cmd, bytes);
}

function analyzeCommandHandler(cmd: string, bytes: number[]): ContextCommandResult {
    if (!isAnalyzeCommand(cmd)) { return { type: 'none' }; }

    const { text, label } = formatAnalyzeCommand(cmd, bytes);
    return { type: 'copyText', text, label };
}

function fillCommandHandler(cmd: string, _bytes: number[], editMode: boolean): ContextCommandResult {
    if (!editMode) { return { type: 'none' }; }
    if (!cmd.startsWith('fill-')) { return { type: 'none' }; }

    const value = parseInt(cmd.slice(5), 16);
    return isValidFillValue(value) ? { type: 'fill', value } : { type: 'none' };
}

function isValidFillValue(value: number): boolean {
    return value >= 0 && value <= 0xFF;
}

export function fillCommand(value: number): string {
    return `fill-${hexByte(value)}`;
}
