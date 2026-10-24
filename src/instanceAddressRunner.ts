import * as fs from 'node:fs';
import { executeEntry } from './core/scripting/scriptRunner';
import type { ScriptContext, ScriptEntry, ScriptErrorType, ScriptOutput } from './core/scripting/types';
import type { MemorySegment } from './core/parser/types';
import type { TypeInstance } from './core/types';
import type {
    InstanceAddressRequestEntry, InstanceAddressResult, InstanceParamRequestEntry, InstanceParamResult,
} from './webviewProtocol';
import { VSCodeScriptHost } from './scriptHost';
import { MAX_INTEGRITY_EDIT_ENTRIES, resolveIntegrityScriptPath, workspaceRelativeScriptPath } from './integrityScriptRunner';

/** Upper bound on instances resolved in one host request (others get a row-level error). */
export const MAX_INSTANCE_ADDRESS_ENTRIES = 128;

/** Upper bound on script-sourced parameters resolved in one host request. */
export const MAX_INSTANCE_PARAM_ENTRIES = 256;

/**
 * Defensive bound for a script-produced array count. Manual counts keep the
 * editor's no-cap rule; a script cannot force a pathological decode.
 */
export const MAX_SCRIPT_PARAM_SIZE = 1_000_000;

/** Fields shared by both batched instance-resolution requests. */
export interface ScriptRunBase {
    /** Workspace root (or document dir when the file is not in a workspace). */
    root: string;
    segments: MemorySegment[];
    edits: Array<[number, number]>;
    /** Approval bridge; receives the resolved absolute script path for the entry. */
    confirm: (scriptPath: string, type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;
    signal?: AbortSignal;
}

export interface InstanceAddressRunInput extends ScriptRunBase {
    entries: readonly InstanceAddressRequestEntry[];
    trusted: boolean;
}

export interface InstanceParamRunInput extends ScriptRunBase {
    entries: readonly InstanceParamRequestEntry[];
    trusted: boolean;
}

/** Persist script paths relative to the workspace root (posix separators). */
export function withRelativeAddressSources(root: string, pins: TypeInstance[]): TypeInstance[] {
    let changed = false;
    const next = pins.map(pin => {
        const normalized = normalizeInstanceSources(root, pin);
        if (normalized !== pin) { changed = true; }
        return normalized;
    });
    return changed ? next : pins;
}

/** Normalize the address source and every parameter source of one instance. */
function normalizeInstanceSources(root: string, pin: TypeInstance): TypeInstance {
    return normalizeParamSources(root, normalizeAddressSource(root, pin));
}

/** Trimmed authored source path; empty for an absent source. */
function authoredSourcePath(pin: TypeInstance): string {
    return pin.addressSource?.scriptPath.trim() ?? '';
}

/** A pin with pointer metadata owns its address, so a stored source must be dropped. */
function conflictsWithPointerSources(pin: TypeInstance): boolean {
    return (pin.pointerSources?.length ?? 0) > 0;
}

/** Drop the address source without touching anything else (identity preserved otherwise). */
function withoutAddressSource(pin: TypeInstance): TypeInstance {
    const { addressSource: _source, ...rest } = pin;
    return rest;
}

/** Normalize/validate one authored source before a profile write. */
function normalizeAddressSource(root: string, pin: TypeInstance): TypeInstance {
    const scriptPath = authoredSourcePath(pin);
    if (!scriptPath || conflictsWithPointerSources(pin)) {
        return pin.addressSource ? withoutAddressSource(pin) : pin;
    }
    return withNormalizedAddressSource(root, pin, scriptPath);
}

/** Store the source workspace-relative; unchanged paths keep the original pin. */
function withNormalizedAddressSource(root: string, pin: TypeInstance, scriptPath: string): TypeInstance {
    const relative = workspaceRelativeScriptPath(root, scriptPath);
    return relative === pin.addressSource?.scriptPath ? pin : { ...pin, addressSource: { scriptPath: relative } };
}

/** One parameter-source entry under normalization. */
interface ParamSourceCleanup {
    cleaned: Record<string, { scriptPath: string }>;
    changed: boolean;
}

/** Workspace-relative, non-empty parameter-source paths; empty entries are dropped. */
function normalizeParamSources(root: string, pin: TypeInstance): TypeInstance {
    if (!pin.paramSources) { return pin; }
    const cleanup: ParamSourceCleanup = { cleaned: {}, changed: false };
    for (const [name, source] of Object.entries(pin.paramSources)) {
        cleanParamSource(root, name, source, cleanup);
    }
    if (!cleanup.changed) { return pin; }
    return withCleanedParamSources(pin, cleanup.cleaned);
}

function withCleanedParamSources(pin: TypeInstance, cleaned: Record<string, { scriptPath: string }>): TypeInstance {
    const { paramSources: _sources, ...rest } = pin;
    return Object.keys(cleaned).length > 0
        ? { ...rest, paramSources: cleaned }
        : rest;
}

function cleanParamSource(
    root: string,
    name: string,
    source: { scriptPath?: string } | undefined,
    cleanup: ParamSourceCleanup,
): void {
    const raw = paramSourcePath(source);
    if (isDroppedParamSource(name, raw)) { cleanup.changed = true; return; }
    const relative = workspaceRelativeScriptPath(root, raw);
    if (relative !== source?.scriptPath) { cleanup.changed = true; }
    cleanup.cleaned[name] = { scriptPath: relative };
}

/** Empty names and empty paths are dropped instead of persisted. */
function isDroppedParamSource(name: string, raw: string): boolean {
    return !name || !raw;
}

function paramSourcePath(source: { scriptPath?: string } | undefined): string {
    return source?.scriptPath?.trim() ?? '';
}

/** Shared pre-run rejection: untrusted workspace or an oversized edits overlay. */
function gateFailure(gate: { trusted: boolean; edits: Array<[number, number]> }): { error: string; errorType: ScriptErrorType } | null {
    if (!gate.trusted) { return { error: 'Workspace not trusted', errorType: 'cancel' }; }
    if (gate.edits.length > MAX_INTEGRITY_EDIT_ENTRIES) {
        return { error: 'Too many pending edits to run the script.', errorType: 'contract' };
    }
    return null;
}

/** Per-request row bound plus the user-facing message for rows above it. */
interface EntryLimit {
    count: number;
    message: string;
}

const PARAM_LIMIT: EntryLimit = {
    count: MAX_INSTANCE_PARAM_ENTRIES,
    message: `Too many parameters to resolve (limit ${MAX_INSTANCE_PARAM_ENTRIES}).`,
};

const ADDRESS_LIMIT: EntryLimit = {
    count: MAX_INSTANCE_ADDRESS_ENTRIES,
    message: `Too many instances to resolve (limit ${MAX_INSTANCE_ADDRESS_ENTRIES}).`,
};

/** Why one entry is skipped instead of run, or null when it should run. */
function skipReason(
    index: number,
    limit: EntryLimit,
    signal: AbortSignal | undefined,
): { error: string; errorType: ScriptErrorType } | null {
    if (index >= limit.count) { return { error: limit.message, errorType: 'contract' }; }
    if (signal?.aborted) { return { error: 'Cancelled', errorType: 'cancel' }; }
    return null;
}

/**
 * Run every entry sequentially (a slow/blocked script cannot starve the rest),
 * turning bound/abort skips into row-level failures. Partial results are
 * returned: one failure never hides the other rows.
 */
async function resolveEntries<Entry, Result>(
    entries: readonly Entry[],
    limit: EntryLimit,
    skip: (entry: Entry, error: string, errorType: ScriptErrorType) => Result,
    run: (entry: Entry) => Promise<Result>,
    signal?: AbortSignal,
): Promise<Result[]> {
    const results: Result[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const skipped = skipReason(i, limit, signal);
        if (skipped) { results.push(skip(entry, skipped.error, skipped.errorType)); continue; }
        results.push(await run(entry));
    }
    return results;
}

/**
 * Resolve every script-sourced instance parameter. One `getSize` run per entry,
 * sequential so a slow/blocked script cannot starve the rest. Partial results
 * are returned: one failure never hides the other parameters.
 */
export async function runInstanceParams(input: InstanceParamRunInput): Promise<InstanceParamResult[]> {
    const gate = gateFailure(input);
    if (gate) { return input.entries.map(entry => paramFailure(entry, gate.error, gate.errorType)); }
    return resolveEntries(input.entries, PARAM_LIMIT, paramFailure, entry => runOneParam(input, entry), input.signal);
}

async function runOneParam(input: InstanceParamRunInput, entry: InstanceParamRequestEntry): Promise<InstanceParamResult> {
    const scriptPath = resolveIntegrityScriptPath(input.root, entry.scriptPath);
    if (!scriptPath || !isReadableFile(scriptPath)) {
        return paramFailure(entry, `Script not found: ${entry.scriptPath}`, 'runtime');
    }
    return paramOutcome(entry, await runScriptEntry(input, scriptPath, 'getSize', entry.context));
}

/** Row-level result of a `getSize` run over one instance parameter. */
function paramOutcome(entry: InstanceParamRequestEntry, output: ScriptOutput): InstanceParamResult {
    if (output.error) {
        return paramFailure(entry, sizeErrorMessage(output.error, output.errorType), output.errorType ?? 'runtime');
    }
    return paramValue(entry, output.value);
}

function paramValue(entry: InstanceParamRequestEntry, value: unknown): InstanceParamResult {
    if (typeof value !== 'number') { return paramFailure(entry, 'Invalid size from script', 'contract'); }
    if (value > MAX_SCRIPT_PARAM_SIZE) {
        return paramFailure(entry, tooLargeSizeMessage(), 'contract');
    }
    return { pinId: entry.pinId, param: entry.param, ok: true, value };
}

function tooLargeSizeMessage(): string {
    return `Size is too large from script (limit ${MAX_SCRIPT_PARAM_SIZE.toLocaleString('en-US')}).`;
}

/** Keep a missing-export message actionable; every other contract failure is the row-level invalid-size state. */
function sizeErrorMessage(error: string, errorType: ScriptErrorType | undefined): string {
    return errorType === 'contract' && !error.startsWith('Script must export')
        ? 'Invalid size from script'
        : error;
}

function paramFailure(
    entry: Pick<InstanceParamRequestEntry, 'pinId' | 'param'>,
    error: string,
    errorType: ScriptErrorType,
): InstanceParamResult {
    return { pinId: entry.pinId, param: entry.param, ok: false, error, errorType };
}

/**
 * Resolve every dynamic instance's base address. One `getAddress` run per
 * entry, sequential so a slow/blocked script cannot starve the rest. Partial
 * results are returned: one failure never hides the other instances.
 */
export async function runInstanceAddresses(input: InstanceAddressRunInput): Promise<InstanceAddressResult[]> {
    const gate = gateFailure(input);
    if (gate) { return input.entries.map(entry => failure(entry.pinId, gate.error, gate.errorType)); }
    return resolveEntries(
        input.entries,
        ADDRESS_LIMIT,
        (entry, error, errorType) => failure(entry.pinId, error, errorType),
        entry => runOne(input, entry),
        input.signal,
    );
}

async function runOne(input: InstanceAddressRunInput, entry: InstanceAddressRequestEntry): Promise<InstanceAddressResult> {
    const scriptPath = resolveIntegrityScriptPath(input.root, entry.scriptPath);
    if (!scriptPath || !isReadableFile(scriptPath)) {
        return failure(entry.pinId, `Script not found: ${entry.scriptPath}`, 'runtime');
    }
    return addressOutcome(entry, await runScriptEntry(input, scriptPath, 'getAddress', entry.context));
}

/** Row-level result of a `getAddress` run over one instance. */
function addressOutcome(entry: InstanceAddressRequestEntry, output: ScriptOutput): InstanceAddressResult {
    if (output.error) {
        return failure(entry.pinId, addressErrorMessage(output.error, output.errorType), output.errorType ?? 'runtime');
    }
    return typeof output.value === 'number'
        ? { pinId: entry.pinId, ok: true, addr: output.value }
        : failure(entry.pinId, 'Invalid address from script', 'contract');
}

/** Keep a missing-export message actionable; every other contract failure is the row-level invalid-address state. */
function addressErrorMessage(error: string, errorType: ScriptErrorType | undefined): string {
    return errorType === 'contract' && !error.startsWith('Script must export')
        ? 'Invalid address from script'
        : error;
}

/** One read-only entry run over a host seeded with the input's bytes and pending edits. */
async function runScriptEntry(
    input: ScriptRunBase,
    scriptPath: string,
    entry: ScriptEntry,
    context: ScriptContext,
): Promise<ScriptOutput> {
    const host = new VSCodeScriptHost(input.segments, {
        confirm: (type, detail) => input.confirm(scriptPath, type, detail),
        edits: input.edits,
        workspaceRoot: input.root,
        selectionRange: context.selection,
    });
    return executeEntry(scriptPath, entry, host, {
        trusted: true,
        context: { ...context, documentSize: host.totalSize },
        signal: input.signal,
    });
}

function failure(pinId: string, error: string, errorType: ScriptErrorType): InstanceAddressResult {
    return { pinId, ok: false, error, errorType };
}

function isReadableFile(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}
