import type { DiffModel } from './core/diff';
import type { SegmentLabel, WireParseResult } from './core/types';

export interface DiffSide {
    name: string;
    format: 'ihex' | 'srec';
    parseResult: WireParseResult;
    labels: SegmentLabel[];
}

export type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string };

export type DiffWebviewToProvider = { type: 'ready' };

export function diffMessageType(message: unknown): string | undefined {
    return typeof (message as { type?: unknown })?.type === 'string'
        ? (message as { type: string }).type
        : undefined;
}
