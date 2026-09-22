import { parentPort, workerData } from 'node:worker_threads';
import { detectFormatFromParts, type HexScopeFormat } from '../core/document';
import { parseIntelHexCompact } from '../core/parser/intelHexParser';
import { parseSRecCompact } from '../core/parser/srecParser';
import { serializeCompactParseResult, compactTransferList, type SerializedCompactParseResult } from '../core/parser/compact';
import { serializeParseResult } from '../core/wire';
import type { ParseProgress } from '../core/parser/types';
import type { WireParseResult } from '../core/types';

/** The parser's `parse` (scan) stage fills `[0, BUILD_FLOOR]`; `build` fills the rest. */
export const BUILD_FLOOR = 0.9;

export interface DiffParseJob {
    kind: 'diffParse';
    bytes: ArrayBuffer;
    extension: string;
}

export interface HexParseJob {
    kind: 'hexParse';
    source: string;
    extension: string;
}

export type ParseJob = DiffParseJob | HexParseJob;

export type WorkerOut =
    | { type: 'progress'; fraction: number }
    | { type: 'progress'; stage: 'parse' | 'build'; completed: number; total: number }
    | { type: 'result'; format: HexScopeFormat; wire: WireParseResult }
    | { type: 'result'; format: HexScopeFormat; compact: SerializedCompactParseResult }
    | { type: 'error'; message: string };

export interface LoadFraction {
    /** Monotonic per-file fraction in `[0, 1]`. */
    fraction: number;
    /** Last posted integer percent; `-1` before the first post. */
    percent: number;
}

export const INITIAL_LOAD_FRACTION: LoadFraction = { fraction: 0, percent: -1 };

/** Map a compact-parser stage onto one per-file fraction for the diff loading bar. */
export function stageFraction(stage: ParseProgress['stage'], completed: number, total: number): number {
    const ratio = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
    return stage === 'build' ? BUILD_FLOOR + (1 - BUILD_FLOOR) * ratio : BUILD_FLOOR * ratio;
}

/**
 * Advance the monotonic load fraction, returning the next state only when the integer percent
 * strictly advances. A per-event post is a firehose the single host main thread must drain, which
 * serializes the two workers; at most 101 posts per file.
 */
export function nextLoadFraction(previous: LoadFraction, stage: ParseProgress['stage'], completed: number, total: number): LoadFraction | null {
    const fraction = Math.max(previous.fraction, stageFraction(stage, completed, total));
    const percent = Math.floor(fraction * 100);
    return percent > previous.percent ? { fraction, percent } : null;
}

interface StageProgress {
    stage: 'parse' | 'build';
    completed: number;
    total: number;
    /** Last posted integer percent for this stage; `-1` before the first post. */
    percent: number;
}

const INITIAL_STAGE_PROGRESS: StageProgress = { stage: 'parse', completed: 0, total: 0, percent: -1 };

/** Thin a stage-tagged parser event to one post per integer percent per stage. */
function nextStageProgress(previous: StageProgress, stage: 'parse' | 'build', completed: number, total: number): StageProgress | null {
    const percent = total > 0 ? Math.floor((completed / total) * 100) : 0;
    if (stage === previous.stage && percent <= previous.percent) { return null; }
    return { stage, completed, total, percent };
}

interface RawJobData {
    kind?: unknown;
    bytes?: unknown;
    source?: unknown;
    extension?: unknown;
}

function isKnownJob(jobData: RawJobData | undefined): jobData is RawJobData {
    if (!jobData) { return false; }
    return jobData.kind === 'diffParse' || jobData.kind === 'hexParse';
}

function invalidJob(): Error {
    return new Error('parseWorker received an invalid parse job');
}

function readDiffJob(jobData: RawJobData): DiffParseJob {
    if (jobData.bytes instanceof ArrayBuffer && typeof jobData.extension === 'string') {
        return { kind: 'diffParse', bytes: jobData.bytes, extension: jobData.extension };
    }
    throw invalidJob();
}

function readHexJob(jobData: RawJobData): HexParseJob {
    if (typeof jobData.source === 'string' && typeof jobData.extension === 'string') {
        return { kind: 'hexParse', source: jobData.source, extension: jobData.extension };
    }
    throw invalidJob();
}

function readJob(jobData: RawJobData): ParseJob {
    if (jobData.kind === 'diffParse') { return readDiffJob(jobData); }
    if (jobData.kind === 'hexParse') { return readHexJob(jobData); }
    throw invalidJob();
}

type Port = NonNullable<typeof parentPort>;

async function runDiffParse(port: Port, job: DiffParseJob): Promise<void> {
    const raw = new TextDecoder('utf-8').decode(new Uint8Array(job.bytes));
    const format: HexScopeFormat = detectFormatFromParts(job.extension, raw);
    let load = INITIAL_LOAD_FRACTION;
    const onProgress = (event: ParseProgress): void => {
        const next = nextLoadFraction(load, event.stage, event.completed, event.total);
        if (!next) { return; }
        load = next;
        port.postMessage({ type: 'progress', fraction: next.fraction });
    };
    const result = format === 'srec'
        ? await parseSRecCompact(raw, { onProgress })
        : await parseIntelHexCompact(raw, { onProgress });
    const wire = serializeParseResult(result, format);
    port.postMessage(
        { type: 'result', format, wire },
        wire.segments.map(segment => segment.data),
    );
}

async function runHexParse(port: Port, job: HexParseJob): Promise<void> {
    const format: HexScopeFormat = detectFormatFromParts(job.extension, job.source);
    let stage = INITIAL_STAGE_PROGRESS;
    const onProgress = (event: ParseProgress): void => {
        const next = nextStageProgress(stage, event.stage, event.completed, event.total);
        if (!next) { return; }
        stage = next;
        port.postMessage({ type: 'progress', stage: next.stage, completed: next.completed, total: next.total });
    };
    const result = format === 'srec'
        ? await parseSRecCompact(job.source, { onProgress })
        : await parseIntelHexCompact(job.source, { onProgress });
    const compact = serializeCompactParseResult(result);
    port.postMessage({ type: 'result', format, compact }, compactTransferList(compact));
}

// Import-safe: the module is also imported by its test for the pure helpers. Only a job carrying a
// known `kind` sentinel runs the worker body, so any other thread that loads this module is a no-op.
const port = parentPort;
const jobData = workerData as RawJobData | undefined;

async function main(): Promise<void> {
    if (!port || !isKnownJob(jobData)) { return; }
    const job = readJob(jobData);
    await (job.kind === 'diffParse' ? runDiffParse(port, job) : runHexParse(port, job));
}

void main().catch((error: unknown) => {
    port?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
});
