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

/** Absolute form of an authored (workspace-relative or absolute) script path. */
function authoredAbsolutePath(root: string, scriptPath: string): string {
    const trimmed = scriptPath.trim();
    return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(root, trimmed);
}

function isOutsideRoot(relative: string): boolean {
    return relative.startsWith('..') || path.isAbsolute(relative);
}

/**
 * Resolve a persisted (workspace-relative) script path. Returns null when the
 * path is empty or escapes the workspace root.
 */
export function resolveIntegrityScriptPath(root: string, scriptPath: string): string | null {
    if (!scriptPath.trim()) { return null; }
    const absolute = authoredAbsolutePath(root, scriptPath);
    return isOutsideRoot(path.relative(root, absolute)) ? null : absolute;
}

/** Persist script paths relative to the workspace root (posix separators). */
export function workspaceRelativeScriptPath(root: string, scriptPath: string): string {
    const trimmed = scriptPath.trim();
    if (!trimmed) { return ''; }
    const relative = path.relative(root, authoredAbsolutePath(root, trimmed));
    return (isOutsideRoot(relative) ? trimmed : relative).split(path.sep).join('/');
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

interface ValueEntryRun {
    missing: boolean;
    error?: string;
    errorType?: ScriptErrorType;
    valueBytes?: number[];
}

interface VerifyEntryRun {
    missing: boolean;
    error?: string;
    errorType?: ScriptErrorType;
    valid?: boolean;
}

/**
 * Run one script check: `getIntegrityValue` first, then `verifyIntegrity`.
 * A missing export is not an error (one failing entry must not erase the other);
 * `verifyIntegrity` is authoritative when it produces a boolean.
 */
export async function runIntegrityScript(input: IntegrityScriptRunInput): Promise<IntegrityScriptRunOutcome> {
    const rejection = integrityInputRejection(input);
    if (rejection) { return rejection; }
    const scriptPath = resolveIntegrityScriptPath(input.root, input.scriptPath);
    if (!scriptPath || !isReadableFile(scriptPath)) {
        return failure(`Script not found: ${input.scriptPath}`, 'runtime');
    }
    const host = createIntegrityHost(input);
    const value = await runValueEntry(input, host, scriptPath);
    const verify = await runVerifyEntry(input, host, scriptPath, value.valueBytes);
    return buildIntegrityOutcome(input, scriptPath, value, verify);
}

function integrityInputRejection(input: IntegrityScriptRunInput): IntegrityScriptRunOutcome | null {
    if (input.edits.length > MAX_INTEGRITY_EDIT_ENTRIES) {
        return failure('Too many pending edits to run the script.', 'contract');
    }
    return input.trusted ? null : failure('Workspace not trusted', 'cancel');
}

function createIntegrityHost(input: IntegrityScriptRunInput): VSCodeScriptHost {
    return new VSCodeScriptHost(input.segments, {
        confirm: input.confirm,
        edits: input.edits,
        workspaceRoot: input.root,
        selectionRange: { start: input.startAddress, end: input.endAddress },
    });
}

async function runValueEntry(
    input: IntegrityScriptRunInput,
    host: VSCodeScriptHost,
    scriptPath: string,
): Promise<ValueEntryRun> {
    const output = await executeEntry(scriptPath, 'getIntegrityValue', host, {
        trusted: input.trusted,
        context: baseContext(input, host),
    });
    const missing = missingExport(output);
    const error = missing ? undefined : output.error;
    const valueBytes = !error && Array.isArray(output.value) ? output.value : undefined;
    return { missing, error, errorType: output.errorType, valueBytes };
}

async function runVerifyEntry(
    input: IntegrityScriptRunInput,
    host: VSCodeScriptHost,
    scriptPath: string,
    valueBytes: readonly number[] | undefined,
): Promise<VerifyEntryRun> {
    const output = await executeEntry(scriptPath, 'verifyIntegrity', host, {
        trusted: input.trusted,
        context: verifyContext(input, host, valueBytes),
    });
    const missing = missingExport(output);
    const valid = !missing && typeof output.value === 'boolean' ? output.value : undefined;
    return { missing, error: output.error, errorType: output.errorType, valid };
}

function buildIntegrityOutcome(
    input: IntegrityScriptRunInput,
    scriptPath: string,
    value: ValueEntryRun,
    verify: VerifyEntryRun,
): IntegrityScriptRunOutcome {
    const missing = bothEntriesMissing(value, verify);
    if (missing) { return missing; }
    const verifyFailure = verifyEntryFailure(verify);
    if (verifyFailure) { return verifyFailure; }
    const valueFailure = valueEntryFailure(value, verify);
    if (valueFailure) { return valueFailure; }
    return integritySuccess(input, scriptPath, value, verify);
}

function bothEntriesMissing(value: ValueEntryRun, verify: VerifyEntryRun): IntegrityScriptRunOutcome | null {
    return value.missing && verify.missing
        ? failure("Script must export 'verifyIntegrity' or 'getIntegrityValue'.", 'contract')
        : null;
}

function verifyEntryFailure(verify: VerifyEntryRun): IntegrityScriptRunOutcome | null {
    if (verify.missing) { return null; }
    const error = verifyErrorFailure(verify);
    if (error) { return error; }
    return verify.valid === undefined
        ? failure('verifyIntegrity returned an invalid value.', 'contract')
        : null;
}

function verifyErrorFailure(verify: VerifyEntryRun): IntegrityScriptRunOutcome | null {
    if (!verify.error) { return null; }
    return failure(`verifyIntegrity: ${verify.error}`, verify.errorType ?? 'runtime');
}

function valueEntryFailure(value: ValueEntryRun, verify: VerifyEntryRun): IntegrityScriptRunOutcome | null {
    if (!value.error || !verify.missing) { return null; }
    return failure(`getIntegrityValue: ${value.error}`, value.errorType ?? 'runtime');
}

function integritySuccess(
    input: IntegrityScriptRunInput,
    scriptPath: string,
    value: ValueEntryRun,
    verify: VerifyEntryRun,
): IntegrityScriptRunOutcome {
    return {
        ok: true,
        value: {
            ...optionalOutcomeFields(verify, value),
            byteCount: valueByteCount(input, value),
            scriptName: path.basename(scriptPath),
            warnings: valueWarnings(value),
        },
    };
}

type OptionalOutcomeFields = Pick<IntegrityScriptValueOutcome, 'valid' | 'valueBytes'>;

function optionalOutcomeFields(verify: VerifyEntryRun, value: ValueEntryRun): OptionalOutcomeFields {
    const fields: OptionalOutcomeFields = {};
    if (verify.valid !== undefined) { fields.valid = verify.valid; }
    if (value.valueBytes !== undefined) { fields.valueBytes = value.valueBytes; }
    return fields;
}

function valueByteCount(input: IntegrityScriptRunInput, value: ValueEntryRun): number {
    return value.valueBytes?.length ?? (input.endAddress - input.startAddress + 1);
}

function valueWarnings(value: ValueEntryRun): string[] {
    return value.error ? [`getIntegrityValue: ${value.error}`] : [];
}
