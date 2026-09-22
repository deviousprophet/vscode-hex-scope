/**
 * Gate for the open document's file watcher.
 *
 * A watcher event is only a real external change when the file was already loaded, the bytes
 * actually differ from the loaded source, and the write is not one of ours (self-writes are
 * ignored inside a short horizon because the FS watcher emits several events per write).
 */

export interface ExternalChangeGate {
    markSelfWrite(now?: number): void;
    /** True while the last host write is still inside the self-write horizon. */
    isSelfWrite(now?: number): boolean;
    /** True when the event describes a real external change to handle. */
    shouldHandle(nextRaw: string, isLoaded: boolean, currentRaw: string, now?: number): boolean;
}

export function createExternalChangeGate(horizonMs: number): ExternalChangeGate {
    let lastSelfWriteAt = 0;
    const isSelfWrite = (now: number = Date.now()): boolean => now - lastSelfWriteAt < horizonMs;
    return {
        markSelfWrite: (now: number = Date.now()) => { lastSelfWriteAt = now; },
        isSelfWrite,
        shouldHandle: (nextRaw, isLoaded, currentRaw, now) =>
            isLoaded && !isSelfWrite(now) && nextRaw !== currentRaw,
    };
}
