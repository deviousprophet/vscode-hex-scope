/**
 * Type definitions for Hex Scope scripts.
 *
 * Reference this file from a script in the same `scripts/` tree:
 *
 *     /// <reference path="./types/hexscope.d.ts" />
 *
 * The declarations are ambient (no imports, no exports), so `HexScopeAPI` is
 * available to every script that references this file. This file describes
 * types only: the runtime object is supplied by the extension.
 *
 * Copy of the public surface of `src/core/scripting/types.ts`. Keep the two in
 * sync when the script API changes.
 *
 * Members are declared in documentation order (document access first, then
 * reporting, then checksums, hashes, and external calls), so the declaration
 * order intentionally differs from the internal file. This file must stay
 * ambient and standalone - it is copied into user workspaces on its own and
 * cannot import from the extension - so keep the two in sync by shape, not by
 * line order.
 */

/** CommonJS shim available to `.js` scripts in the sandbox. */
declare const module: { exports: Record<string, unknown> };

/** Result of `api.exec()`. */
interface ExecResult {
    /** Standard output captured from the process. */
    stdout: string;
    /** Standard error captured from the process. */
    stderr: string;
    /** Process exit code. */
    code: number;
}

/** Result of `api.fetch()`. */
interface FetchResult {
    /** `true` for a 2xx response. */
    ok: boolean;
    /** HTTP status code, `0` when the request was blocked or failed. */
    status: number;
    /** Response body as text. */
    body: string;
}

/**
 * Options for `api.fetch()`. Mirrors the `RequestInit` fields the sandbox
 * forwards, plus the Hex Scope limits.
 */
interface FetchOptions {
    /** HTTP method (default `GET`). */
    method?: string;
    /** Request headers as plain name/value pairs. */
    headers?: Record<string, string>;
    /** Request body for non-GET requests. */
    body?: string;
    /** Maximum response body size in bytes (default 1 MiB). */
    maxSize?: number;
    /** Allow requests to loopback and link-local hosts (default `false`). */
    allowLoopback?: boolean;
}

/**
 * Context for a role run (`@script integrity`, `@script address`,
 * `@script size`). Empty for a plain `run` script.
 */
interface ScriptContext {
    /** Identity of the Type Overlay instance being resolved. */
    instance?: { id: string; name: string; typeId: string; typeName: string };
    /** Parameter this `getSize` run resolves. */
    param?: string;
    /** Already-resolved sibling parameters plus authored values and type defaults. */
    paramValues?: Record<string, number>;
    /** Current hex selection, inclusive (`end` is the last selected address). */
    selection?: { start: number; end: number };
    /** Total mapped bytes in the current document. */
    documentSize?: number;
    /** First address of the stored value, when the integrity check has one. */
    storedStart?: number;
    /** Last address of the stored value, when its length is known. */
    storedEnd?: number;
}

/**
 * Declared script role, parsed from a `@script <role>` header tag in the first
 * 2 KB of the script file.
 */
type ScriptRole = 'integrity' | 'address' | 'size';

/**
 * Value a role entry returns. The runner normalizes it at the boundary:
 * - `getAddress` → unsigned 32-bit integer
 * - `getSize` → positive integer
 * - `verifyIntegrity` → boolean
 * - `getIntegrityValue` → bytes (`Uint8Array` or `number[]`)
 */
type ScriptValue = number | boolean | Uint8Array | number[];

/**
 * Role contract. A role script declares a `@script <role>` tag in its header
 * and exports the matching function. `run` is optional for role-only scripts.
 *
 * | Role tag           | Export                | Returns                          |
 * |--------------------|-----------------------|----------------------------------|
 * | `@script integrity`| `verifyIntegrity`     | `boolean` (sync or Promise)      |
 * | `@script integrity`| `getIntegrityValue`   | bytes replacing the stored field |
 * | `@script address`  | `getAddress`          | unsigned 32-bit integer          |
 * | `@script size`     | `getSize`             | positive integer                 |
 *
 * A missing or mistyped export is reported as a contract error and never
 * reaches the editor.
 */
interface HexScopeAPI {
    /** Read and write the currently open document. */
    hex: {
        /**
         * Bytes from the document at a firmware address. Stops at the first
         * unmapped byte, so the result may be shorter than `length`.
         */
        read(address: number, length: number): Uint8Array;
        /** Bytes in the current editor selection (empty when nothing is selected). */
        readSelected(): Uint8Array;
        /**
         * Stage bytes for writing. The first call opens one inline approval
         * prompt; approved bytes are saved once when the run finishes cleanly.
         * Resolves `false` when the call was denied or the data went stale.
         */
        write(address: number, data: Uint8Array): Promise<boolean>;
        /** Total number of mapped bytes in the document. */
        readonly size: number;
    };
    /** Append one line to the script's output log. */
    output(text: string): void;
    /** Add a key/value row to the script's result block. */
    setResult(label: string, value: string): void;
    /** Record a pass/fail row without stopping the script. */
    assert(condition: boolean, label: string): void;
    /** Role-run context; an empty object for `run` scripts. */
    context: ScriptContext;
    /** Checksums. */
    crc: {
        /** CRC-8 (poly 0x07, init 0x00). */
        crc8(data: Uint8Array | number[]): number;
        /** CRC-16/Modbus (poly 0xA001, init 0xFFFF). */
        crc16(data: Uint8Array | number[]): number;
        /** CRC-32/ISO-HDLC (unsigned). */
        crc32(data: Uint8Array | number[]): number;
    };
    /**
     * Run an external command (no shell expansion). Asks for approval inline;
     * resolves `null` when the call was denied.
     */
    exec(command: string, args?: string[]): Promise<ExecResult | null>;
    /** Cryptographic hashes. */
    hash: {
        sha1(data: Uint8Array): Promise<Uint8Array>;
        sha256(data: Uint8Array): Promise<Uint8Array>;
        sha512(data: Uint8Array): Promise<Uint8Array>;
    };
    /**
     * HTTP/HTTPS request. Asks for approval inline; resolves `null` when the
     * call was denied.
     */
    fetch(url: string, options?: FetchOptions): Promise<FetchResult | null>;
}
