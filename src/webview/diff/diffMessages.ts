import type { DiffProviderToWebview } from '../../diffProtocol';

export type DiffInitMessage = Extract<DiffProviderToWebview, { type: 'diffInit' }>;
export type DiffErrorMessage = Extract<DiffProviderToWebview, { type: 'diffError' }>;

export interface DiffMessageHandlers {
    diffInit: (message: DiffInitMessage) => void;
    diffError: (message: DiffErrorMessage) => void;
}

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

/** Dispatch a known diff provider message; unknown/malformed messages return false and run no handler. */
export function dispatchDiffMessage(message: unknown, handlers: DiffMessageHandlers): boolean {
    if (isDiffInit(message)) { handlers.diffInit(message); return true; }
    if (isDiffError(message)) { handlers.diffError(message); return true; }
    return false;
}
