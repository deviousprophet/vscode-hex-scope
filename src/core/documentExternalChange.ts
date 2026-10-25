import { bytesEqual } from './bytesEqual';

/**
 * Gate for the open document's file watcher.
 *
 * A watcher event is only a real external change when the file was already loaded, the bytes
 * actually differ from the loaded source, and the write is not one of ours (self-writes are
 * ignored inside a short horizon because the FS watcher emits several events per write).
 */

/** The loaded source of the open document: HEX/SREC text or raw `.bin` bytes. */
export type DocumentSource = string | Uint8Array;

export interface ExternalChangeGate<T = string> {
    markSelfWrite(now?: number): void;
    /** True while the last host write is still inside the self-write horizon. */
    isSelfWrite(now?: number): boolean;
    /** True when the event describes a real external change to handle. */
    shouldHandle(nextRaw: T, isLoaded: boolean, currentRaw: T, now?: number): boolean;
}

/** The session comparator: strings by value, raw images byte-for-byte. */
export function sameDocumentSource(a: DocumentSource, b: DocumentSource): boolean {
    if (typeof a === 'string' || typeof b === 'string') { return a === b; }
    return bytesEqual(a, b);
}

export function createExternalChangeGate<T = string>(
    horizonMs: number,
    equal: (a: T, b: T) => boolean = Object.is,
): ExternalChangeGate<T> {
    let lastSelfWriteAt = 0;
    const isSelfWrite = (now: number = Date.now()): boolean => now - lastSelfWriteAt < horizonMs;
    return {
        markSelfWrite: (now: number = Date.now()) => { lastSelfWriteAt = now; },
        isSelfWrite,
        shouldHandle: (nextRaw, isLoaded, currentRaw, now) =>
            isLoaded && !isSelfWrite(now) && !equal(nextRaw, currentRaw),
    };
}
