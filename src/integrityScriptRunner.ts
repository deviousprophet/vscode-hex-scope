import * as fs from 'node:fs';
import * as path from 'node:path';
import { executeEntry } from './core/scripting/scriptRunner';
import type { ScriptContext, ScriptEntry, ScriptErrorType, ScriptHost, ScriptOutput } from './core/scripting/types';
import type { IntegrityCheckSet } from './core/integrity';
import type { MemorySegment } from './core/parser/types';
import { VSCodeScriptHost } from './scriptHost';

/** Pending edits above this count (~1 MiB of address/byte pairs) are refused. */
export const MAX_INTEGRITY_EDIT_ENTRIES = 65_536;

export interface IntegrityScriptRunInput {
    /** Workspace root (or document dir when the file is not in a workspace). */
    root: string;
    /** Workspace-relative path; an absolute path is accepted but clamped to the root. */
    scriptPath: string;
    segments: MemorySegment[];
    edits: Array<[number, number]>;
    trusted: boolean;
    startAddress: number;
    endAddress: number;
    storedAddress?: number;
    /** Known stored-field length from a previous value result (drives context.storedEnd). */
    storedLength?: number;
    confirm: ScriptHost['confirm'];
}

export interface IntegrityScriptValueOutcome {
    valid?: boolean;
    valueBytes?: number[];
    byteCount: number;
    scriptName: string;
    warnings: string[];
}

export type IntegrityScriptRunOutcome =
    | { ok: true; value: IntegrityScriptValueOutcome }
    | { ok: false; error: string; errorType: ScriptErrorType };

/**
 * Resolve a persisted (workspace-relative) script path. Returns null when the
 * path is empty or escapes the workspace root.
 */
export function resolveIntegrityScriptPath(root: string, scriptPath: string): string | null {
    const trimmed = scriptPath.trim();
    if (!trimmed) { return null; }
    const absolute = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(root, trimmed);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { return null; }
    return absolute;
}

/** Persist script paths relative to the workspace root (posix separators). */
export function workspaceRelativeScriptPath(root: string, scriptPath: string): string {
    const trimmed = scriptPath.trim();
    if (!trimmed) { return ''; }
    const absolute = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(root, trimmed);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return trimmed.split(path.sep).join('/');
    }
    return relative.split(path.sep).join('/');
}

/** Normalize every script check's path before persistence. */
export function withRelativeScriptPaths(root: string, set: IntegrityCheckSet): IntegrityCheckSet {
    return {
        schemaVersion: set.schemaVersion,
        checks: set.checks.map(check => (check.kind === 'script'
            ? { ...check, scriptPath: workspaceRelativeScriptPath(root, check.scriptPath) }
            : check)),
    };
}

function missingExport(output: ScriptOutput): boolean {
    return output.errorType === 'contract' && !!output.error && output.error.startsWith('Script must export');
}

function failure(error: string, errorType: ScriptErrorType): IntegrityScriptRunOutcome {
    return { ok: false, error, errorType };
}

function isReadableFile(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function baseContext(input: IntegrityScriptRunInput, host: VSCodeScriptHost): ScriptContext {
    const context: ScriptContext = {
        selection: { start: input.startAddress, end: input.endAddress },
        documentSize: host.totalSize,
    };
    if (input.storedAddress !== undefined) {
        context.storedStart = input.storedAddress;
        if (input.storedLength !== undefined) {
            context.storedEnd = input.storedAddress + input.storedLength - 1;
        }
    }
    return context;
}

function verifyContext(
    input: IntegrityScriptRunInput,
    host: VSCodeScriptHost,
    valueBytes: readonly number[] | undefined,
): ScriptContext {
    const context = baseContext(input, host);
    if (input.storedAddress !== undefined && valueBytes && valueBytes.length > 0) {
        context.storedStart = input.storedAddress;
        context.storedEnd = input.storedAddress + valueBytes.length - 1;
    }
    return context;
}

/**
 * Run one script check: `getIntegrityValue` first, then `verifyIntegrity`.
 * A missing export is not an error (one failing entry must not erase the other);
 * `verifyIntegrity` is authoritative when it produces a boolean.
 */
export async function runIntegrityScript(input: IntegrityScriptRunInput): Promise<IntegrityScriptRunOutcome> {
    if (input.edits.length > MAX_INTEGRITY_EDIT_ENTRIES) {
        return failure('Too many pending edits to run the script.', 'contract');
    }
    if (!input.trusted) {
        return failure('Workspace not trusted', 'cancel');
    }
    const scriptPath = resolveIntegrityScriptPath(input.root, input.scriptPath);
    if (!scriptPath || !isReadableFile(scriptPath)) {
        return failure(`Script not found: ${input.scriptPath}`, 'runtime');
    }

    const host = new VSCodeScriptHost(input.segments, {
        confirm: input.confirm,
        edits: input.edits,
        workspaceRoot: input.root,
        selectionRange: { start: input.startAddress, end: input.endAddress },
    });

    const valueOutput = await executeEntry(scriptPath, 'getIntegrityValue', host, {
        trusted: input.trusted,
        context: baseContext(input, host),
    });
    const valueMissing = missingExport(valueOutput);
    const valueError = !valueMissing ? valueOutput.error : undefined;
    const valueBytes = !valueError && Array.isArray(valueOutput.value) ? valueOutput.value : undefined;

    const verifyOutput = await executeEntry(scriptPath, 'verifyIntegrity', host, {
        trusted: input.trusted,
        context: verifyContext(input, host, valueBytes),
    });
    const verifyMissing = missingExport(verifyOutput);

    if (valueMissing && verifyMissing) {
        return failure("Script must export 'verifyIntegrity' or 'getIntegrityValue'.", 'contract');
    }
    if (!verifyMissing && verifyOutput.error) {
        return failure(`verifyIntegrity: ${verifyOutput.error}`, verifyOutput.errorType ?? 'runtime');
    }
    const valid = !verifyMissing && typeof verifyOutput.value === 'boolean' ? verifyOutput.value : undefined;
    if (!verifyMissing && valid === undefined) {
        return failure('verifyIntegrity returned an invalid value.', 'contract');
    }
    if (valueError && verifyMissing) {
        return failure(`getIntegrityValue: ${valueError}`, valueOutput.errorType ?? 'runtime');
    }

    const warnings = valueError ? [`getIntegrityValue: ${valueError}`] : [];
    const byteCount = valueBytes?.length ?? (input.endAddress - input.startAddress + 1);
    return {
        ok: true,
        value: {
            ...(valid === undefined ? {} : { valid }),
            ...(valueBytes === undefined ? {} : { valueBytes }),
            byteCount,
            scriptName: path.basename(scriptPath),
            warnings,
        },
    };
}
