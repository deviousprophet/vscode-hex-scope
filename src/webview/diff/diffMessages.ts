import type { DiffProviderToWebview, DiffProgressStage } from '../../diffProtocol';

export type DiffInitMessage = Extract<DiffProviderToWebview, { type: 'diffInit' }>;
export type DiffErrorMessage = Extract<DiffProviderToWebview, { type: 'diffError' }>;
export type DiffProgressMessage = Extract<DiffProviderToWebview, { type: 'diffProgress' }>;

export interface DiffMessageHandlers {
    diffInit: (message: DiffInitMessage) => void;
    diffError: (message: DiffErrorMessage) => void;
    diffProgress: (message: DiffProgressMessage) => void;
}

const DIFF_PROGRESS_STAGES: readonly DiffProgressStage[] = ['read', 'parse', 'diff'];

interface DiffInitShape {
    a?: unknown;
    b?: unknown;
    diff?: unknown;
}

function hasDiffInitFields(value: DiffInitShape): boolean {
    return !!value.a && !!value.b && !!value.diff;
}

function isDiffInit(message: unknown): message is DiffInitMessage {
    const value = message as (DiffInitShape & { type?: unknown }) | null;
    return !!value && value.type === 'diffInit' && hasDiffInitFields(value);
}

function isDiffError(message: unknown): message is DiffErrorMessage {
    const value = message as { type?: unknown; message?: unknown } | null;
    return !!value && value.type === 'diffError' && typeof value.message === 'string';
}

interface DiffProgressShape {
    type?: unknown;
    stage?: unknown;
    completed?: unknown;
    total?: unknown;
}

function isDiffProgress(message: unknown): message is DiffProgressMessage {
    const value = message as DiffProgressShape | null;
    return !!value && value.type === 'diffProgress'
        && DIFF_PROGRESS_STAGES.includes(value.stage as DiffProgressStage)
        && hasProgressCounts(value);
}

function hasProgressCounts(value: DiffProgressShape): boolean {
    return typeof value.completed === 'number' && typeof value.total === 'number';
}

/** Dispatch a known diff provider message; unknown/malformed messages return false and run no handler. */
export function dispatchDiffMessage(message: unknown, handlers: DiffMessageHandlers): boolean {
    if (isDiffInit(message)) { handlers.diffInit(message); return true; }
    if (isDiffError(message)) { handlers.diffError(message); return true; }
    if (isDiffProgress(message)) { handlers.diffProgress(message); return true; }
    return false;
}
