import type { DiffModel } from './core/diff';
import type { SegmentLabel, WireParseResult } from './core/types';

export interface DiffSide {
    name: string;
    /** Full path, always available for tooltips and same-name disambiguation. */
    path: string;
    format: 'ihex' | 'srec';
    parseResult: WireParseResult;
    labels: SegmentLabel[];
}

export type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string };

export type DiffWebviewToProvider =
    | { type: 'ready' }
    | { type: 'copyText'; text: string; label?: string };

export function diffMessageType(message: unknown): string | undefined {
    return typeof (message as { type?: unknown })?.type === 'string'
        ? (message as { type: string }).type
        : undefined;
}

/** Copy payload from a webview `copyText` message; null for any other shape. */
export function diffCopyText(message: unknown): string | null {
    const value = message as { type?: unknown; text?: unknown } | null;
    return !!value && value.type === 'copyText' && typeof value.text === 'string' ? value.text : null;
}
