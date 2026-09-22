import type { DiffKind, DiffModel } from '../../core/diff';
import type { DiffProviderToWebview, DiffProgressStage, DiffSide } from '../../diffProtocol';

export type DiffInitMessage = Extract<DiffProviderToWebview, { type: 'diffInit' }>;
export type DiffErrorMessage = Extract<DiffProviderToWebview, { type: 'diffError' }>;
export type DiffProgressMessage = Extract<DiffProviderToWebview, { type: 'diffProgress' }>;
export type DiffExternalChangeMessage = Extract<DiffProviderToWebview, { type: 'diffExternalChange' }>;
export type DiffExternalChangeErrorMessage = Extract<DiffProviderToWebview, { type: 'diffExternalChangeError' }>;

export interface DiffMessageHandlers {
    diffInit: (message: DiffInitMessage) => void;
    diffError: (message: DiffErrorMessage) => void;
    diffProgress: (message: DiffProgressMessage) => void;
    diffExternalChange: (message: DiffExternalChangeMessage) => void;
    diffExternalChangeError: (message: DiffExternalChangeErrorMessage) => void;
}

const DIFF_PROGRESS_STAGES: readonly DiffProgressStage[] = ['read', 'parse', 'diff'];
const DIFF_FORMATS: readonly DiffSide['format'][] = ['ihex', 'srec'];
const DIFF_KINDS: readonly DiffKind[] = ['changed', 'added', 'removed'];

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function isWireSegment(value: unknown): boolean {
    const segment = value as { startAddress?: unknown; data?: unknown } | null;
    return !!segment && typeof segment.startAddress === 'number' && !!segment.data;
}

interface DiffSideShape {
    name?: unknown;
    path?: unknown;
    format?: unknown;
    parseResult?: unknown;
    labels?: unknown;
}

function hasSideHeader(side: DiffSideShape | null): boolean {
    if (!side) { return false; }
    return isString(side.name)
        && isString(side.path)
        && DIFF_FORMATS.includes(side.format as DiffSide['format']);
}

/** Structural `DiffSide` check so a malformed init is rejected before hydration can throw. */
function isDiffSide(value: unknown): value is DiffSide {
    const side = value as DiffSideShape | null;
    if (!hasSideHeader(side)) { return false; }
    if (!Array.isArray(side!.labels)) { return false; }
    return isWireParseResult(side!.parseResult);
}

function isWireParseResult(value: unknown): boolean {
    const result = value as { recordCount?: unknown; segments?: unknown } | null;
    return !!result
        && typeof result.recordCount === 'number'
        && Array.isArray(result.segments)
        && result.segments.every(isWireSegment);
}

function isDiffRun(value: unknown): boolean {
    const run = value as { start?: unknown; end?: unknown; kind?: unknown } | null;
    return !!run
        && typeof run.start === 'number'
        && typeof run.end === 'number'
        && DIFF_KINDS.includes(run.kind as DiffKind);
}

/** Shallow `DiffModel` check: the webview maps runs directly, so every run must be well-formed. */
function isDiffModel(value: unknown): value is DiffModel {
    const model = value as { runs?: unknown } | null;
    return !!model && Array.isArray(model.runs) && model.runs.every(isDiffRun);
}

interface DiffInitShape {
    type?: unknown;
    a?: unknown;
    b?: unknown;
    diff?: unknown;
}

function hasDiffInitSides(value: DiffInitShape): boolean {
    return isDiffSide(value.a) && isDiffSide(value.b) && isDiffModel(value.diff);
}

function isDiffInit(message: unknown): message is DiffInitMessage {
    const value = message as DiffInitShape | null;
    if (!value || value.type !== 'diffInit') { return false; }
    return hasDiffInitSides(value);
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

/** A reload carries the same side/model shape as an init, so it reuses `hasDiffInitSides`. */
function isDiffExternalChange(message: unknown): message is DiffExternalChangeMessage {
    const value = message as DiffInitShape | null;
    if (!value || value.type !== 'diffExternalChange') { return false; }
    return hasDiffInitSides(value);
}

interface DiffExternalChangeErrorShape {
    type?: unknown;
    side?: unknown;
    checksumErrors?: unknown;
    malformedLines?: unknown;
    canQuickRepair?: unknown;
}

function isDiffExternalChangeError(message: unknown): message is DiffExternalChangeErrorMessage {
    const value = message as DiffExternalChangeErrorShape | null;
    if (!isExternalChangeErrorShape(value)) { return false; }
    return typeof value.checksumErrors === 'number'
        && typeof value.malformedLines === 'number'
        && typeof value.canQuickRepair === 'boolean';
}

function isExternalChangeErrorShape(value: DiffExternalChangeErrorShape | null): value is DiffExternalChangeErrorShape {
    if (!value || value.type !== 'diffExternalChangeError') { return false; }
    return value.side === 'a' || value.side === 'b';
}

/** Dispatch a known diff provider message; unknown/malformed messages return false and run no handler. */
export function dispatchDiffMessage(message: unknown, handlers: DiffMessageHandlers): boolean {
    if (isDiffInit(message)) { handlers.diffInit(message); return true; }
    if (isDiffError(message)) { handlers.diffError(message); return true; }
    if (isDiffProgress(message)) { handlers.diffProgress(message); return true; }
    return dispatchExternalChange(message, handlers);
}

function dispatchExternalChange(message: unknown, handlers: DiffMessageHandlers): boolean {
    if (isDiffExternalChange(message)) { handlers.diffExternalChange(message); return true; }
    if (isDiffExternalChangeError(message)) { handlers.diffExternalChangeError(message); return true; }
    return false;
}
