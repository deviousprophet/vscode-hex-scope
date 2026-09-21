import { parentPort, workerData } from 'node:worker_threads';
import { detectFormatFromParts, type HexScopeFormat } from '../core/document';
import { parseIntelHexCompact } from '../core/parser/intelHexParser';
import { parseSRecCompact } from '../core/parser/srecParser';
import { serializeParseResult } from '../core/wire';
import type { ParseProgress } from '../core/parser/types';

/** The parser's `parse` (scan) stage fills `[0, BUILD_FLOOR]`; `build` fills the rest. */
export const BUILD_FLOOR = 0.9;

interface DiffParseJob {
    kind: 'diffParse';
    bytes: ArrayBuffer;
    extension: string;
}

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

function readJob(jobData: Partial<DiffParseJob> | undefined): DiffParseJob {
    if (!(jobData?.bytes instanceof ArrayBuffer) || typeof jobData.extension !== 'string') {
        throw new Error('diffParseWorker received an invalid parse job');
    }
    return { kind: 'diffParse', bytes: jobData.bytes, extension: jobData.extension };
}

async function parseJob(port: NonNullable<typeof parentPort>, job: DiffParseJob): Promise<void> {
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

// Import-safe: the module is also imported by its test for the pure helpers. Only a job carrying the
// `diffParse` sentinel runs the worker body, so any other thread that loads this module is a no-op.
const port = parentPort;
const jobData = workerData as Partial<DiffParseJob> | undefined;

async function main(): Promise<void> {
    if (port && jobData?.kind === 'diffParse') {
        await parseJob(port, readJob(jobData));
    }
}

void main().catch((error: unknown) => {
    port?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
});
