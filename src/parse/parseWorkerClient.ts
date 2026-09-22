import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ParseJob, WorkerOut } from './parseWorker';

/** Worker → host progress: a monotonic diff fraction or a stage-tagged hex `parse`/`build` step. */
export type WorkerProgressOut = Extract<WorkerOut, { type: 'progress' }>;
/** Worker → host terminal message: the diff `wire` result or the hex serialized compact result. */
export type WorkerResultOut = Extract<WorkerOut, { type: 'result' }>;

export interface ParseWorkerRun<T> {
    job: ParseJob;
    signal: AbortSignal;
    transferList?: readonly ArrayBuffer[];
    onProgress?: (message: WorkerProgressOut) => void;
    onResult: (message: WorkerResultOut) => T;
    abortMessage?: string;
}

type Settle = (action: () => void) => void;

const WORKER_OUT_TYPES = ['progress', 'result', 'error'];

/** The one cancellation error, built lazily so its stack points at the abort. */
function abortError(run: ParseWorkerRun<unknown>): Error {
    return new Error(run.abortMessage ?? 'Parse cancelled');
}

/**
 * Spawn one parse worker for `run.job`, relay progress, and settle exactly once on the first of
 * result / error / abort. The worker is terminated on settle; an already-aborted signal rejects
 * before a worker is spawned.
 */
export function runParseJob<T>(run: ParseWorkerRun<T>): Promise<T> {
    if (run.signal.aborted) { return Promise.reject(abortError(run)); }
    return new Promise<T>((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'parseWorker.js'), {
            workerData: run.job,
            transferList: [...(run.transferList ?? [])],
        });
        let settled = false;
        const settle: Settle = action => {
            if (settled) { return; }
            settled = true;
            run.signal.removeEventListener('abort', onAbort);
            void worker.terminate();
            action();
        };
        const onAbort = (): void => settle(() => reject(abortError(run)));
        run.signal.addEventListener('abort', onAbort, { once: true });
        worker.on('message', (raw: unknown) => dispatchWorkerOut(raw, run, settle, reject, resolve));
        worker.on('error', error => settle(() => reject(error)));
    });
}

function isWorkerOut(raw: unknown): raw is WorkerOut {
    if (!raw || typeof raw !== 'object') { return false; }
    const type = (raw as { type?: unknown }).type as string;
    return WORKER_OUT_TYPES.includes(type);
}

function notifyProgress(onProgress: ParseWorkerRun<unknown>['onProgress'], message: WorkerProgressOut): void {
    if (onProgress) { onProgress(message); }
}

/** Route one worker message to its handling; unknown types are ignored. */
function dispatchWorkerOut<T>(
    raw: unknown,
    run: ParseWorkerRun<T>,
    settle: Settle,
    reject: (error: unknown) => void,
    resolve: (value: T) => void,
): void {
    if (!isWorkerOut(raw)) { return; }
    if (raw.type === 'progress') { notifyProgress(run.onProgress, raw); return; }
    if (raw.type === 'error') { settle(() => reject(new Error(raw.message))); return; }
    settleResult(raw, run, settle, reject, resolve);
}

/** Project the worker's result; a projection throw rejects instead of resolving. */
function settleResult<T>(
    message: WorkerResultOut,
    run: ParseWorkerRun<T>,
    settle: Settle,
    reject: (error: unknown) => void,
    resolve: (value: T) => void,
): void {
    try {
        const value = run.onResult(message);
        settle(() => resolve(value));
    } catch (error) {
        settle(() => reject(error));
    }
}
