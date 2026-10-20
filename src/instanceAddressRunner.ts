import * as fs from 'node:fs';
import { executeEntry } from './core/scripting/scriptRunner';
import type { ScriptContext, ScriptErrorType } from './core/scripting/types';
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

export interface InstanceAddressRunInput {
    /** Workspace root (or document dir when the file is not in a workspace). */
    root: string;
    entries: readonly InstanceAddressRequestEntry[];
    segments: MemorySegment[];
    edits: Array<[number, number]>;
    trusted: boolean;
    /** Approval bridge; receives the resolved absolute script path for the entry. */
    confirm: (scriptPath: string, type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;
    signal?: AbortSignal;
}

export interface InstanceParamRunInput {
    root: string;
    entries: readonly InstanceParamRequestEntry[];
    segments: MemorySegment[];
    edits: Array<[number, number]>;
    trusted: boolean;
    confirm: (scriptPath: string, type: 'write' | 'exec' | 'fetch', detail: string) => Promise<boolean>;
    signal?: AbortSignal;
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

/** Normalize/validate one authored source before a profile write. */
function normalizeAddressSource(root: string, pin: TypeInstance): TypeInstance {
    const scriptPath = pin.addressSource?.scriptPath.trim() ?? '';
    if (!scriptPath || (pin.pointerSources && pin.pointerSources.length > 0)) {
        if (!pin.addressSource) { return pin; }
        const { addressSource: _source, ...rest } = pin;
        return rest;
    }
    const relative = workspaceRelativeScriptPath(root, scriptPath);
    if (relative === pin.addressSource?.scriptPath) { return pin; }
    return { ...pin, addressSource: { scriptPath: relative } };
}

/** Workspace-relative, non-empty parameter-source paths; empty entries are dropped. */
function normalizeParamSources(root: string, pin: TypeInstance): TypeInstance {
    if (!pin.paramSources) { return pin; }
    let changed = false;
    const cleaned: Record<string, { scriptPath: string }> = {};
    for (const [name, source] of Object.entries(pin.paramSources)) {
        const scriptPath = source?.scriptPath?.trim() ?? '';
        if (!name || !scriptPath) { changed = true; continue; }
        const relative = workspaceRelativeScriptPath(root, scriptPath);
        if (relative !== source.scriptPath) { changed = true; }
        cleaned[name] = { scriptPath: relative };
    }
    if (!changed) { return pin; }
    const { paramSources: _sources, ...rest } = pin;
    return Object.keys(cleaned).length > 0
        ? { ...rest, paramSources: cleaned }
        : rest;
}

/**
 * Resolve every script-sourced instance parameter. One `getSize` run per entry,
 * sequential so a slow/blocked script cannot starve the rest. Partial results
 * are returned: one failure never hides the other parameters.
 */
export async function runInstanceParams(input: InstanceParamRunInput): Promise<InstanceParamResult[]> {
    if (!input.trusted) {
        return input.entries.map(entry => paramFailure(entry, 'Workspace not trusted', 'cancel'));
    }
    if (input.edits.length > MAX_INTEGRITY_EDIT_ENTRIES) {
        return input.entries.map(entry => paramFailure(entry, 'Too many pending edits to run the script.', 'contract'));
    }

    const results: InstanceParamResult[] = [];
    for (let i = 0; i < input.entries.length; i++) {
        const entry = input.entries[i];
        if (i >= MAX_INSTANCE_PARAM_ENTRIES) {
            results.push(paramFailure(entry, `Too many parameters to resolve (limit ${MAX_INSTANCE_PARAM_ENTRIES}).`, 'contract'));
            continue;
        }
        if (input.signal?.aborted) {
            results.push(paramFailure(entry, 'Cancelled', 'cancel'));
            continue;
        }
        results.push(await runOneParam(input, entry));
    }
    return results;
}

async function runOneParam(input: InstanceParamRunInput, entry: InstanceParamRequestEntry): Promise<InstanceParamResult> {
    const scriptPath = resolveIntegrityScriptPath(input.root, entry.scriptPath);
    if (!scriptPath || !isReadableFile(scriptPath)) {
        return paramFailure(entry, `Script not found: ${entry.scriptPath}`, 'runtime');
    }

    const host = new VSCodeScriptHost(input.segments, {
        confirm: (type, detail) => input.confirm(scriptPath, type, detail),
        edits: input.edits,
        workspaceRoot: input.root,
        selectionRange: entry.context.selection,
    });
    const context: ScriptContext = { ...entry.context, documentSize: host.totalSize };

    const output = await executeEntry(scriptPath, 'getSize', host, {
        trusted: true,
        context,
        signal: input.signal,
    });
    if (output.error) {
        return paramFailure(entry, sizeErrorMessage(output.error, output.errorType), output.errorType ?? 'runtime');
    }
    if (typeof output.value !== 'number') {
        return paramFailure(entry, 'Invalid size from script', 'contract');
    }
    if (output.value > MAX_SCRIPT_PARAM_SIZE) {
        return paramFailure(
            entry,
            `Size is too large from script (limit ${MAX_SCRIPT_PARAM_SIZE.toLocaleString('en-US')}).`,
            'contract',
        );
    }
    return { pinId: entry.pinId, param: entry.param, ok: true, value: output.value };
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
    if (!input.trusted) {
        return input.entries.map(entry => failure(entry.pinId, 'Workspace not trusted', 'cancel'));
    }
    if (input.edits.length > MAX_INTEGRITY_EDIT_ENTRIES) {
        return input.entries.map(entry => failure(entry.pinId, 'Too many pending edits to run the script.', 'contract'));
    }

    const results: InstanceAddressResult[] = [];
    for (let i = 0; i < input.entries.length; i++) {
        const entry = input.entries[i];
        if (i >= MAX_INSTANCE_ADDRESS_ENTRIES) {
            results.push(failure(entry.pinId, `Too many instances to resolve (limit ${MAX_INSTANCE_ADDRESS_ENTRIES}).`, 'contract'));
            continue;
        }
        if (input.signal?.aborted) {
            results.push(failure(entry.pinId, 'Cancelled', 'cancel'));
            continue;
        }
        results.push(await runOne(input, entry));
    }
    return results;
}

async function runOne(input: InstanceAddressRunInput, entry: InstanceAddressRequestEntry): Promise<InstanceAddressResult> {
    const scriptPath = resolveIntegrityScriptPath(input.root, entry.scriptPath);
    if (!scriptPath || !isReadableFile(scriptPath)) {
        return failure(entry.pinId, `Script not found: ${entry.scriptPath}`, 'runtime');
    }

    const host = new VSCodeScriptHost(input.segments, {
        confirm: (type, detail) => input.confirm(scriptPath, type, detail),
        edits: input.edits,
        workspaceRoot: input.root,
        selectionRange: entry.context.selection,
    });
    const context: ScriptContext = { ...entry.context, documentSize: host.totalSize };

    const output = await executeEntry(scriptPath, 'getAddress', host, {
        trusted: true,
        context,
        signal: input.signal,
    });
    if (output.error) {
        return failure(entry.pinId, addressErrorMessage(output.error, output.errorType), output.errorType ?? 'runtime');
    }
    if (typeof output.value !== 'number') {
        return failure(entry.pinId, 'Invalid address from script', 'contract');
    }
    return { pinId: entry.pinId, ok: true, addr: output.value };
}

/** Keep a missing-export message actionable; every other contract failure is the row-level invalid-address state. */
function addressErrorMessage(error: string, errorType: ScriptErrorType | undefined): string {
    return errorType === 'contract' && !error.startsWith('Script must export')
        ? 'Invalid address from script'
        : error;
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
