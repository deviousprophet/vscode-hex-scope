import type { DiffModel } from './core/diff';
import type { HexScopeFormat } from './core/document';
import type { SegmentLabel, WireParseResult } from './core/types';

export interface DiffSide {
    name: string;
    /** Full path, always available for tooltips and same-name disambiguation. */
    path: string;
    format: HexScopeFormat;
    parseResult: WireParseResult;
    labels: SegmentLabel[];
    /** Comparison-only raw-binary base override; never persisted. */
    baseOverride?: boolean;
}

export type DiffSideKey = 'a' | 'b';

export type DiffProgressStage = 'read' | 'parse' | 'diff';

export type DiffProviderToWebview =
    | { type: 'diffInit'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffError'; generation?: number; message: string }
    | { type: 'diffProgress'; stage: DiffProgressStage; completed: number; total: number }
    | { type: 'diffExternalChange'; generation: number; a: DiffSide; b: DiffSide; diff: DiffModel }
    | { type: 'diffExternalChangeError'; generation: number; side: 'a' | 'b'; checksumErrors: number; malformedLines: number; canQuickRepair: boolean }
    /** One side rebuilt at a new comparison-only base; the other side, swap order, and view mode survive. */
    | { type: 'diffBaseChanged'; side: DiffSide };

export type DiffWebviewToProvider =
    | { type: 'ready' }
    | { type: 'copyText'; text: string; label?: string }
    | { type: 'reloadAccepted' }
    | { type: 'repairAndReload' }
    | { type: 'viewInNormalEditor' }
    | { type: 'setDiffBaseAddress'; path: string; value: number }
    | { type: 'resetDiffBaseAddress'; path: string };

/**
 * A well-formed comparison-only base request. The target is the file `path`
 * (the displayed side's path, so a swap never retargets the wrong file) and
 * `value` is a 32-bit address.
 */
export type DiffBaseRequest =
    | { type: 'setDiffBaseAddress'; path: string; value: number }
    | { type: 'resetDiffBaseAddress'; path: string };

export function diffMessageType(message: unknown): string | undefined {
    return typeof (message as { type?: unknown })?.type === 'string'
        ? (message as { type: string }).type
        : undefined;
}

function isTargetPath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

/** Shape parser for the raw-side base editor messages; null for any other shape. */
export function diffBaseRequest(message: unknown): DiffBaseRequest | null {
    const value = message as DiffBaseRequestShape | null;
    if (!value || !isTargetPath(value.path)) { return null; }
    return baseRequestFor(value, value.path);
}

interface DiffBaseRequestShape {
    type?: unknown;
    path?: unknown;
    value?: unknown;
}

function baseRequestFor(value: DiffBaseRequestShape, path: string): DiffBaseRequest | null {
    return value.type === 'resetDiffBaseAddress' ? resetBaseRequest(path) : setBaseRequest(value, path);
}

function resetBaseRequest(path: string): DiffBaseRequest {
    return { type: 'resetDiffBaseAddress', path };
}

function setBaseRequest(value: DiffBaseRequestShape, path: string): DiffBaseRequest | null {
    if (value.type !== 'setDiffBaseAddress' || !isValidBaseAddress(value.value)) { return null; }
    return { type: 'setDiffBaseAddress', path, value: value.value };
}

function isValidBaseAddress(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFF_FFFF;
}

/** Copy payload from a webview `copyText` message; null for any other shape. */
export function diffCopyText(message: unknown): string | null {
    const value = message as { type?: unknown; text?: unknown } | null;
    return !!value && value.type === 'copyText' && typeof value.text === 'string' ? value.text : null;
}
