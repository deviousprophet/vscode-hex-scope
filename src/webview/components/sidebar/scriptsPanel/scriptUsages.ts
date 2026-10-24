/** Script usage derivation — pure, DOM-free.
 *
 * The host (`hexViewer`) derives "used by" links from the bound profile:
 * script-backed integrity checks and script-sourced instance addresses /
 * parameters. Usages are transient view data: never persisted, never written
 * back into scripts or profiles. A configured path that no scan resolves keeps
 * its authored (workspace-relative) form, so the destination can still report
 * "script not found"; only resolved paths match a Scripts card. */

import type { ScriptInfo } from '../../../../core/scripting/types';
import type { TypeInstance } from '../../../../core/types';

/** What feeds on a script: an integrity check, an instance address, or an instance size parameter. */
export type ScriptUsageKind = 'integrity' | 'address' | 'size';

/** One derived used-by link (host-built from the bound profile; transient). */
export interface ScriptUsageRef {
    /** Card identity (scanned `filePath`) when the configured path resolves; else the configured path. */
    scriptPath: string;
    kind: ScriptUsageKind;
    /** Destination label: integrity check title, instance name (`instance · param` for size). */
    label: string;
    /** Integrity check runtime id (click → Integrity panel `selectCheck`). */
    checkId?: number;
    /** Instance id (click → Overlay panel `selectInstance`). */
    pinId?: string;
}

/** One configured script-backed integrity check (runtime id owned by the Integrity panel). */
export interface ScriptCheckRef {
    checkId: number;
    /** Authored (workspace-relative) script path. */
    scriptPath: string;
    /** Card title: custom check name, else the script file name. */
    label: string;
}

/** Instance shape the derivation reads. */
export type ScriptUsagePin = Pick<TypeInstance, 'id' | 'name' | 'addressSource' | 'paramSources' | 'paramValues'>;

/** Scanned-script shape used to resolve configured paths to card identities. */
export type ScriptUsageScript = Pick<ScriptInfo, 'filePath' | 'relativePath'>;

/** Authored script-source shape (address or parameter); both carry a workspace-relative path. */
type ScriptUsageSource = { scriptPath?: string };

export interface ScriptUsageInput {
    checks: readonly ScriptCheckRef[];
    pins: readonly ScriptUsagePin[];
    scripts: readonly ScriptUsageScript[];
}

/** Derive every used-by link: integrity checks first, then instances in stored order. */
export function deriveScriptUsages(input: ScriptUsageInput): ScriptUsageRef[] {
    const resolve = cardPathResolver(input.scripts);
    const usages: ScriptUsageRef[] = [];
    for (const check of input.checks) {
        appendCheckUsage(usages, check, resolve);
    }
    for (const pin of input.pins) {
        appendPinUsages(usages, pin, resolve);
    }
    return usages;
}

function appendCheckUsage(
    usages: ScriptUsageRef[],
    check: ScriptCheckRef,
    resolve: (configured: string) => string | null,
): void {
    const configured = check.scriptPath.trim();
    if (!configured) { return; }
    usages.push({
        scriptPath: resolve(configured) ?? configured,
        kind: 'integrity',
        label: check.label,
        checkId: check.checkId,
    });
}

function appendPinUsages(
    usages: ScriptUsageRef[],
    pin: ScriptUsagePin,
    resolve: (configured: string) => string | null,
): void {
    appendAddressUsage(usages, pin, resolve);
    appendParamUsages(usages, pin, resolve);
}

/** Instance address source → one `address` usage (absent/blank sources derive nothing). */
function appendAddressUsage(
    usages: ScriptUsageRef[],
    pin: ScriptUsagePin,
    resolve: (configured: string) => string | null,
): void {
    const configured = sourcePath(pin.addressSource);
    if (!configured) { return; }
    usages.push({ scriptPath: resolve(configured) ?? configured, kind: 'address', label: pin.name, pinId: pin.id });
}

/** Every script-sourced parameter → one `size` usage each (stored order). */
function appendParamUsages(
    usages: ScriptUsageRef[],
    pin: ScriptUsagePin,
    resolve: (configured: string) => string | null,
): void {
    for (const [param, source] of Object.entries(pin.paramSources ?? {})) {
        appendParamUsage(usages, pin, param, source, resolve);
    }
}

/** One parameter source → one `size` usage; a manual `paramValues` entry wins over it. */
function appendParamUsage(
    usages: ScriptUsageRef[],
    pin: ScriptUsagePin,
    param: string,
    source: ScriptUsageSource | undefined,
    resolve: (configured: string) => string | null,
): void {
    const configured = sourcePath(source);
    if (!configured || isManualParam(pin, param)) { return; }
    usages.push({
        scriptPath: resolve(configured) ?? configured,
        kind: 'size',
        label: `${pin.name} \u00b7 ${param}`,
        pinId: pin.id,
    });
}

/** Trimmed authored path of a source, or '' when absent/blank. */
function sourcePath(source: ScriptUsageSource | undefined): string {
    return source?.scriptPath?.trim() ?? '';
}

/** A manual `paramValues` entry wins over the script source (mirrors the resolver's skip). */
function isManualParam(pin: ScriptUsagePin, param: string): boolean {
    return Object.prototype.hasOwnProperty.call(pin.paramValues ?? {}, param);
}

/** Map a configured (workspace-relative or absolute) script path to the scanned card identity. */
function cardPathResolver(scripts: readonly ScriptUsageScript[]): (configured: string) => string | null {
    const index = new Map<string, string>();
    for (const script of scripts) {
        addScriptKeys(index, script);
    }
    return configured => lookupCardPath(index, configured);
}

function addScriptKeys(index: Map<string, string>, script: ScriptUsageScript): void {
    if (!script.filePath) { return; }
    addIndexKey(index, script.relativePath, script.filePath);
    addIndexKey(index, script.filePath, script.filePath);
}

function addIndexKey(index: Map<string, string>, key: string | undefined, filePath: string): void {
    const normalized = normalizeScriptPath(key ?? '');
    if (normalized && !index.has(normalized)) { index.set(normalized, filePath); }
}

/** Exact match first, then a case-insensitive fallback (Windows-authored drive/segment casing). */
function lookupCardPath(index: Map<string, string>, configured: string): string | null {
    const normalized = normalizeScriptPath(configured);
    if (!normalized) { return null; }
    const exact = index.get(normalized);
    if (exact) { return exact; }
    return caseInsensitiveLookup(index, normalized.toLowerCase());
}

function caseInsensitiveLookup(index: Map<string, string>, lowered: string): string | null {
    for (const [key, filePath] of index) {
        if (key.toLowerCase() === lowered) { return filePath; }
    }
    return null;
}

/** Trim + forward slashes, so Windows-authored paths compare with scan-relative keys. */
function normalizeScriptPath(pathValue: string): string {
    return pathValue.trim().replace(/\\/g, '/');
}
