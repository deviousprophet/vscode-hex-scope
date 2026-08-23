import * as path from 'node:path';
import * as vscode from 'vscode';
import { normalizeIntegrityCheckSet, normalizeIntegrityProfiles, type IntegrityCheckSet, type IntegrityProfile } from './core/integrity';
import { mergeLegacyStructDefs, migrateStructDefinitions, normalizeStructDefsValue } from './core/structMigration';
import type { SegmentLabel, StructDef, StructPin } from './core/types';
import {
    integrityFileUri,
    perFileDataUri,
    perFileLocalUri,
    perFileRelativePath,
    readJson,
    structsFileUri,
    writeJson,
} from './hexScopeStorage';

/**
 * One-time migration from VS Code Memento (`globalState`/`workspaceState`)
 * into `.hexscope/` JSON files. Runs at first panel open for a workspace root.
 *
 * Per spec:
 *  - normalizes with the same functions used at runtime,
 *  - writes only when the target file does not already exist (team copy wins),
 *  - hard-deletes every Memento key it touched, including legacy variants.
 *
 * All old keys are deleted even when the corresponding file already exists, so
 * re-opening the workspace never re-migrates but still cleans up leftovers.
 */

interface LegacyPerFileData {
    uri: vscode.Uri;
    labels: SegmentLabel[] | undefined;
    segmentNames: Record<string, string> | undefined;
    pins: StructPin[] | undefined;
    integrityChecks: IntegrityCheckSet | undefined;
    endian: 'le' | 'be' | undefined;
    legacyStructs: StructDef[] | undefined;
}

type LegacyKeyKind = 'labels' | 'segmentNames' | 'pins' | 'checks' | 'endian' | 'structs';

const PER_FILE_KEY_KINDS: Record<string, LegacyKeyKind> = {
    'hexScope.labels.': 'labels',
    'hexScope.segmentNames.': 'segmentNames',
    'hexScope.structPins.': 'pins',
    'hexScope.integrityChecks.': 'checks',
    'hexScope.endian.': 'endian',
    'hexScope.structs.': 'structs',
};

export async function migrateLegacyData(
    context: vscode.ExtensionContext,
    root: string,
): Promise<void> {
    const perFile = collectLegacyPerFileData(context, root);
    await migrateGlobalStructs(context, root);
    await migrateGlobalIntegrity(context, root);
    for (const entry of perFile) {
        await migratePerFileData(context, root, entry);
    }
}

function collectLegacyPerFileData(context: vscode.ExtensionContext, root: string): LegacyPerFileData[] {
    const byUri = new Map<string, LegacyPerFileData>();
    const apply: Record<LegacyKeyKind, (entry: LegacyPerFileData, value: unknown) => void> = {
        labels: (entry, value) => { entry.labels = asSegmentLabels(value); },
        segmentNames: (entry, value) => { entry.segmentNames = asRecord(value); },
        pins: (entry, value) => { entry.pins = asStructPins(value); },
        checks: (entry, value) => { entry.integrityChecks = normalizeLegacyChecks(value); },
        endian: (entry, value) => { entry.endian = value === 'be' ? 'be' : 'le'; },
        structs: (entry, value) => { entry.legacyStructs = normalizeLegacyStructList(value); },
    };
    for (const key of context.workspaceState.keys()) {
        const parsed = legacyPerFileKey(key, root);
        if (!parsed) { continue; }
        const uriText = parsed.uri.toString();
        const entry = byUri.get(uriText) ?? newLegacyPerFileEntry(parsed.uri);
        apply[parsed.kind](entry, context.workspaceState.get<unknown>(key));
        byUri.set(uriText, entry);
    }
    return [...byUri.values()];
}

function newLegacyPerFileEntry(uri: vscode.Uri): LegacyPerFileData {
    return {
        uri,
        labels: undefined,
        segmentNames: undefined,
        pins: undefined,
        integrityChecks: undefined,
        endian: undefined,
        legacyStructs: undefined,
    };
}

function legacyPerFileKey(
    key: string,
    root: string,
): { uri: vscode.Uri; kind: LegacyKeyKind } | null {
    const hit = Object.entries(PER_FILE_KEY_KINDS).find(([prefix]) => key.startsWith(prefix));
    if (!hit) { return null; }
    const [prefix, kind] = hit;
    const uri = uriFromKey(key.slice(prefix.length));
    if (uri === null) { return null; }
    return uriIsUnderRoot(uri, root) ? { uri, kind } : null;
}

function uriFromKey(raw: string): vscode.Uri | null {
    // integrityChecks/endian keys carry a trailing ".v1" after the uri.
    const uriText = raw.endsWith('.v1') ? raw.slice(0, -'.v1'.length) : raw;
    try {
        const uri = vscode.Uri.parse(uriText);
        return uri.scheme === 'file' ? uri : null;
    } catch {
        return null;
    }
}

function uriIsUnderRoot(uri: vscode.Uri, root: string): boolean {
    const fsPath = uri.fsPath;
    const rel = path.relative(root, fsPath);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function migrateGlobalStructs(context: vscode.ExtensionContext, root: string): Promise<void> {
    const currentGlobal = context.globalState.get<unknown>('hexScope.structs.global.v2');
    const previousGlobal = context.globalState.get<unknown>('hexScope.structs.global.v1');
    const perFileStructKeys = context.workspaceState.keys()
        .filter(k => legacyPerFileKey(k, root)?.kind === 'structs');
    await migrateGlobalStructsFile(context, root, currentGlobal, previousGlobal, perFileStructKeys);
    await deleteKey(context, 'hexScope.structs.global.v2');
    await deleteKey(context, 'hexScope.structs.global.v1');
    for (const key of perFileStructKeys) { await context.workspaceState.update(key, undefined); }
}

async function migrateGlobalStructsFile(
    context: vscode.ExtensionContext,
    root: string,
    currentGlobal: unknown,
    previousGlobal: unknown,
    perFileStructKeys: string[],
): Promise<void> {
    if (!hasAnyGlobalStructLegacy(currentGlobal, previousGlobal, perFileStructKeys)) { return; }
    if ((await readJson(structsFileUri(root))).status !== 'missing') { return; }
    await writeMergedStructsFile(context, root, currentGlobal, previousGlobal, perFileStructKeys);
}

function hasAnyGlobalStructLegacy(currentGlobal: unknown, previousGlobal: unknown, perFileStructKeys: string[]): boolean {
    return currentGlobal !== undefined || previousGlobal !== undefined || perFileStructKeys.length > 0;
}

async function writeMergedStructsFile(
    context: vscode.ExtensionContext,
    root: string,
    currentGlobal: unknown,
    previousGlobal: unknown,
    perFileStructKeys: string[],
): Promise<void> {
    const baseRaw = currentGlobal ?? migrateStructDefinitions(previousGlobal ?? []);
    const { defs: baseDefs } = normalizeStructDefsValue(baseRaw);
    const legacy = perFileStructKeys.flatMap(key => normalizeLegacyStructList(context.workspaceState.get<unknown>(key)));
    const merged = mergeLegacyStructDefs(baseDefs, legacy);
    await writeJson(structsFileUri(root), merged.defs, root);
}

async function deleteKey(context: vscode.ExtensionContext, key: string): Promise<void> {
    if (context.globalState.keys().includes(key)) { await context.globalState.update(key, undefined); }
    if (context.workspaceState.keys().includes(key)) { await context.workspaceState.update(key, undefined); }
}

async function migrateGlobalIntegrity(context: vscode.ExtensionContext, root: string): Promise<void> {
    const key = 'hexScope.integrityProfiles.global.v1';
    const raw = context.globalState.get<unknown>(key);
    const target = integrityFileUri(root);
    if (raw !== undefined && (await readJson(target)).status === 'missing') {
        await writeJson(target, normalizeIntegrityProfiles(raw), root);
    }
    await context.globalState.update(key, undefined);
}

async function migratePerFileData(
    context: vscode.ExtensionContext,
    root: string,
    entry: LegacyPerFileData,
): Promise<void> {
    await migrateDataFile(root, entry);
    await migrateLocalFile(root, entry);
    await deletePerFileKeys(context, entry.uri);
}

async function migrateDataFile(root: string, entry: LegacyPerFileData): Promise<void> {
    if (!hasDataLegacyData(entry)) { return; }
    await writeIfMissing(perFileDataUri(root, perFileRelativePath(root, entry.uri)), dataFilePayload(entry), root);
}

function hasDataLegacyData(entry: LegacyPerFileData): boolean {
    return hasLabels(entry.labels) || hasSegmentNames(entry.segmentNames);
}

function dataFilePayload(entry: LegacyPerFileData): { labels: SegmentLabel[]; segmentNames: Record<string, string> } {
    return { labels: entry.labels ?? [], segmentNames: entry.segmentNames ?? {} };
}

async function migrateLocalFile(root: string, entry: LegacyPerFileData): Promise<void> {
    if (!hasLocalLegacyData(entry)) { return; }
    await writeIfMissing(perFileLocalUri(root, perFileRelativePath(root, entry.uri)), localFilePayload(entry), root);
}

function hasLocalLegacyData(entry: LegacyPerFileData): boolean {
    return hasPins(entry.pins) || hasChecks(entry.integrityChecks) || entry.endian !== undefined;
}

function localFilePayload(entry: LegacyPerFileData): { pins: StructPin[]; activeChecks: IntegrityCheckSet; endian: 'le' | 'be' } {
    return {
        pins: entry.pins ?? [],
        activeChecks: entry.integrityChecks ?? { schemaVersion: 1, checks: [] },
        endian: entry.endian ?? 'le',
    };
}

/** Write only when the target file does not exist (a teammate's copy wins). */
async function writeIfMissing(uri: vscode.Uri, value: unknown, root: string): Promise<void> {
    if ((await readJson(uri)).status !== 'missing') { return; }
    await writeJson(uri, value, root);
}

async function deletePerFileKeys(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
    for (const key of context.workspaceState.keys()) {
        if (keyIsForUri(key, uri)) { await context.workspaceState.update(key, undefined); }
    }
}

function keyIsForUri(key: string, uri: vscode.Uri): boolean {
    return Object.keys(PER_FILE_KEY_KINDS).some(prefix => {
        if (!key.startsWith(prefix)) { return false; }
        return uriFromKey(key.slice(prefix.length))?.toString() === uri.toString();
    });
}

function normalizeLegacyStructList(value: unknown): StructDef[] {
    return normalizeStructDefsValue(migrateStructDefinitions(value)).defs;
}

function normalizeLegacyChecks(value: unknown): IntegrityCheckSet | undefined {
    return normalizeIntegrityCheckSet(value) ?? undefined;
}

function asSegmentLabels(value: unknown): SegmentLabel[] | undefined {
    return Array.isArray(value) ? value as SegmentLabel[] : undefined;
}

function asStructPins(value: unknown): StructPin[] | undefined {
    return Array.isArray(value) ? value as StructPin[] : undefined;
}

function asRecord(value: unknown): Record<string, string> | undefined {
    return value !== null && typeof value === 'object' ? value as Record<string, string> : undefined;
}

function hasLabels(value: SegmentLabel[] | undefined): boolean {
    return !!value && value.length > 0;
}

function hasSegmentNames(value: Record<string, string> | undefined): boolean {
    return !!value && Object.keys(value).length > 0;
}

function hasPins(value: StructPin[] | undefined): boolean {
    return !!value && value.length > 0;
}

function hasChecks(value: IntegrityCheckSet | undefined): boolean {
    return !!value && value.checks.length > 0;
}