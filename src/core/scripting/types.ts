export interface ScriptHost {
    readBytes(address: number, length: number): Uint8Array;
    writeBytes(address: number, data: Uint8Array): boolean;
    totalSize: number;
    confirm(type: 'write' | 'exec' | 'fetch', detail: string): Promise<boolean>;
    output(text: string): void;
    setResult(label: string, value: string): void;
    /** Collect results and log accumulated during execution. */
    collectOutput(): { results: Array<{ label: string; value: string }>; log: string[] };
    /** If true, the host data is stale and writes should be rejected. */
    stale?: boolean;
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

export interface ScriptOutput {
    results: Array<{ label: string; value: string }>;
    log: string[];
    error?: string;
}

export interface HexScopeAPI {
    hex: {
        read(address: number, length: number): Uint8Array;
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
    fetch(url: string, options?: RequestInit): Promise<FetchResult | null>;
    output(text: string): void;
    setResult(label: string, value: string): void;
}
