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

export type DiffProgressStage = 'read' | 'parse' | 'diff';

export type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string }
    | { type: 'diffProgress'; stage: DiffProgressStage; completed: number; total: number }
    | { type: 'diffExternalChange'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffExternalChangeError'; generation: number; side: 'a' | 'b'; checksumErrors: number; malformedLines: number; canQuickRepair: boolean };

export type DiffWebviewToProvider =
    | { type: 'ready' }
    | { type: 'copyText'; text: string; label?: string }
    | { type: 'reloadAccepted' }
    | { type: 'repairAndReload' }
    | { type: 'viewInNormalEditor' };

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
