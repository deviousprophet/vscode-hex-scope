export interface ScriptHost {
    readBytes(address: number, length: number): Uint8Array;
    writeBytes(address: number, data: Uint8Array): boolean;
    totalSize: number;
    confirm(type: 'write' | 'exec' | 'fetch', detail: string): Promise<boolean>;
    output(text: string): void;
    setResult(label: string, value: string): void;
    assert(condition: boolean, label: string): void;
    /** Collect results and log accumulated during execution. */
    collectOutput(): { results: Array<{ label: string; value: string }>; log: string[] };
    /** If true, the host data is stale and writes should be rejected. */
    stale?: boolean;
    /** Current editor selection range, if any. Set at script-run time. */
    selectionRange?: { start: number; end: number };
    /** Workspace root path used as pinned cwd for exec(). Falls back to process.cwd(). */
    workspaceRoot?: string;
}

export interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
}

export interface FetchResult {
    ok: boolean;
    status: number;
    body: string;
}

export interface FetchOptions extends RequestInit {
    /** Max response body size in bytes (default 1 MiB). */
    maxSize?: number;
    /** Allow requests to loopback/link-local addresses (default false). */
    allowLoopback?: boolean;
}

export type ScriptErrorType = 'compile' | 'runtime' | 'timeout' | 'cancel' | 'contract';

/** Declared script purpose, parsed from a `@script <role>` header tag. */
export type ScriptRole = 'integrity' | 'address' | 'size';

/** Entry points the runner can invoke. `run` is the legacy script entry. */
export type ScriptEntry = 'run' | 'verifyIntegrity' | 'getIntegrityValue' | 'getAddress' | 'getSize';

/** Structured-clone-safe value returned by a contract entry. */
export type ScriptValue = number | boolean | number[];

/** Context supplied to contract entries; empty for a legacy `run` script. */
export interface ScriptContext {
    instance?: { id: string; name: string; typeId: string; typeName: string };
    param?: string;
    paramValues?: Record<string, number>;
    documentSize?: number;
    selection?: { start: number; end: number };
    storedStart?: number;
    storedEnd?: number;
}

export interface ScriptOutput {
    results: Array<{ label: string; value: string }>;
    log: string[];
    /** Return value of a contract entry; absent for `run` and on failure. */
    value?: ScriptValue;
    error?: string;
    errorType?: ScriptErrorType;
}

export interface HexScopeAPI {
    hex: {
        read(address: number, length: number): Uint8Array;
        readSelected(): Uint8Array;
        write(address: number, data: Uint8Array): Promise<boolean>;
        size: number;
    };
    crc: {
        crc8(data: Uint8Array | number[]): number;
        crc16(data: Uint8Array | number[]): number;
        crc32(data: Uint8Array | number[]): number;
    };
    hash: {
        sha1(data: Uint8Array): Promise<Uint8Array>;
        sha256(data: Uint8Array): Promise<Uint8Array>;
        sha512(data: Uint8Array): Promise<Uint8Array>;
    };
    exec(command: string, args?: string[]): Promise<ExecResult | null>;
    fetch(url: string, options?: FetchOptions): Promise<FetchResult | null>;
    output(text: string): void;
    setResult(label: string, value: string): void;
    assert(condition: boolean, label: string): void;
    /** Role-run context; an empty object for legacy `run` scripts. */
    context: ScriptContext;
}
