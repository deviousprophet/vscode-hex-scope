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

export type ScriptErrorType = 'compile' | 'runtime' | 'timeout' | 'cancel';

export interface ScriptOutput {
    results: Array<{ label: string; value: string }>;
    log: string[];
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
}
