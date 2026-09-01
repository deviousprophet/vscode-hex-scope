// ── One-time legacy Memento migration (per workspace root) ─────────
// Reads the old globalState/workspaceState keys, normalizes with the
// existing helpers, seeds the currently-open document's profile slots
// (writeIfMissing — committed profile files are preserved), then
// hard-deletes every touched key. Idempotent; no user prompt.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { normalizeIntegrityProfiles } from './core/integrity';
import { mergeLegacyStructDefs, migrateStructDefinitions, normalizeStructDefsValue } from './core/structMigration';
import type { StructDef } from './core/types';
import {
    createProfileDir,
    emptyIndexData,
    findProfile,
    normalizeIndexFile,
    perFileRelativePath,
    profileJsonUri,
    resolveHexScopeRoot,
    seedSchemaCopies,
    withEnvelope,
    writeIfMissing,
} from './hexScopeStorage';

const STRUCTS_V2_KEY = 'hexScope.structs.global.v2';
const STRUCTS_V1_KEY = 'hexScope.structs.global.v1';
const INTEGRITY_PROFILES_KEY = 'hexScope.integrityProfiles.global.v1';
const PER_FILE_STRUCTS_PREFIX = 'hexScope.structs.';
const PER_FILE_LABELS_PREFIX = 'hexScope.labels.';
const PER_FILE_SEGMENT_NAMES_PREFIX = 'hexScope.segmentNames.';
const PER_FILE_PINS_PREFIX = 'hexScope.structPins.';
const PER_FILE_CHECKS_PREFIX = 'hexScope.integrityChecks.';
const PER_FILE_ENDIAN_PREFIX = 'hexScope.endian.';

export interface MementoLike {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
    keys(): readonly string[];
}

export interface MigrationContext {
    globalState: MementoLike;
    workspaceState: MementoLike;
}

const migratedRoots = new Set<string>();
const sweptRoots = new Set<string>();

export async function migrateLegacyData(root: string, uri: vscode.Uri, context: MigrationContext): Promise<void> {
    if (migratedRoots.has(root)) { return; }
    const uriStr = uri.toString();
    const relPath = perFileRelativePath(root, uri);

    const legacy = readLegacyKeys(uriStr, context);

    try {
        await seedProfileFromLegacy(root, uri, relPath, context, legacy);
    } catch (error) {
        // Best-effort transfer: a seeding failure must not block opening or
        // the defensive key deletion below.
        console.error(`HexScope: legacy data migration failed for ${root}:`, error);
    } finally {
        await deleteLegacyKeys(uriStr, context);
        await sweepLegacyPerFileKeys(root, context);
        migratedRoots.add(root);
    }
}

function readLegacyKeys(uriStr: string, context: MigrationContext): LegacyValues {
    return {
        globalStructV2: context.globalState.get<unknown>(STRUCTS_V2_KEY),
        globalStructV1: context.globalState.get<unknown>(STRUCTS_V1_KEY),
        perFileStructs: context.workspaceState.get<unknown>(PER_FILE_STRUCTS_PREFIX + uriStr),
        globalProfiles: context.globalState.get<unknown>(INTEGRITY_PROFILES_KEY),
        labels: context.workspaceState.get<unknown>(PER_FILE_LABELS_PREFIX + uriStr),
        segmentNames: context.workspaceState.get<unknown>(PER_FILE_SEGMENT_NAMES_PREFIX + uriStr),
        pins: context.workspaceState.get<unknown>(PER_FILE_PINS_PREFIX + uriStr),
        checks: context.workspaceState.get<unknown>(`${PER_FILE_CHECKS_PREFIX}${uriStr}.v1`),
        endian: context.workspaceState.get<unknown>(`${PER_FILE_ENDIAN_PREFIX}${uriStr}.v1`),
    };
}

interface LegacyValues {
    globalStructV2: unknown;
    globalStructV1: unknown;
    perFileStructs: unknown;
    globalProfiles: unknown;
    labels: unknown;
    segmentNames: unknown;
    pins: unknown;
    checks: unknown;
    endian: unknown;
}

async function seedProfileFromLegacy(
    root: string,
    uri: vscode.Uri,
    relPath: string,
    context: MigrationContext,
    legacy: LegacyValues,
): Promise<void> {
    if (!hasLegacyData(legacy)) { return; }
    // Seed the currently-open document's profile slots (writeIfMissing keeps
    // an existing committed copy — including teammate edits).
    let dir = await findProfile(root, relPath);
    if (!dir) { dir = await createProfileDir(root); }
    await seedSchemaCopies(root);

    const seed = normalizeIndexFile(
        { labels: legacy.labels, segmentNames: legacy.segmentNames, pins: legacy.pins, activeChecks: legacy.checks, endian: legacy.endian },
        emptyIndexData(relPath),
    ).value;
    const structs = legacyStructDefs(legacy.globalStructV2, legacy.globalStructV1, legacy.perFileStructs);
    const integrityProfiles = normalizeIntegrityProfiles(legacy.globalProfiles);

    await writeIfMissing(profileJsonUri(dir, 'index.json'), withEnvelope(seed));
    await writeIfMissing(profileJsonUri(dir, 'structs.json'), withEnvelope(structs));
    await writeIfMissing(profileJsonUri(dir, 'integrity.json'), withEnvelope(integrityProfiles));
}

async function deleteLegacyKeys(uriStr: string, context: MigrationContext): Promise<void> {
    // Hard-delete every touched key (incl. all legacy variants) from both
    // stores. Defensive deletion always runs.
    const keys = [
        STRUCTS_V2_KEY,
        STRUCTS_V1_KEY,
        PER_FILE_STRUCTS_PREFIX + uriStr,
        INTEGRITY_PROFILES_KEY,
        PER_FILE_LABELS_PREFIX + uriStr,
        PER_FILE_SEGMENT_NAMES_PREFIX + uriStr,
        PER_FILE_PINS_PREFIX + uriStr,
        `${PER_FILE_CHECKS_PREFIX}${uriStr}.v1`,
        `${PER_FILE_ENDIAN_PREFIX}${uriStr}.v1`,
    ];
    for (const key of keys) {
        await context.globalState.update(key, undefined);
        await context.workspaceState.update(key, undefined);
    }
}

/**
 * Root sweep: delete per-file Memento keys for EVERY document under this
 * root, not just the open uri — so a first-panel-open migration leaves no
 * legacy per-file keys behind for sibling docs. Runs once per root.
 */
async function sweepLegacyPerFileKeys(root: string, context: MigrationContext): Promise<void> {
    if (sweptRoots.has(root)) { return; }
    sweptRoots.add(root);
    for (const key of context.workspaceState.keys()) {
        if (legacyKeyBelongsToRoot(perFileUriFromKey(key), root)) {
            await context.workspaceState.update(key, undefined);
        }
    }
}

/** Does this legacy per-file key's document belong to the given hexScope root? */
function legacyKeyBelongsToRoot(parsedUri: vscode.Uri | null, root: string): boolean {
    if (parsedUri === null) { return false; }
    if (resolveHexScopeRoot(parsedUri) === root) { return true; }
    // Strict under-root containment: dirname fallback for single-file-open
    // roots and docs nested under the root tree.
    return parsedUri.fsPath.startsWith(root + path.sep);
}

/** Parse the embedded workspace uri out of a per-file key; null for non-per-file keys. */
function perFileUriFromKey(key: string): vscode.Uri | null {
    // Checks/endian keys carry a trailing `.v1` (match deleteLegacyKeys/readLegacyKeys);
    // all other per-file keys embed the uri verbatim.
    const match = /^hexScope\.(?:integrityChecks|endian)\.(.+)\.v1$/.exec(key)
        ?? /^hexScope\.(?:structs|labels|segmentNames|structPins|integrityChecks|endian)\.(.+)$/.exec(key);
    if (!match) { return null; }
    try { return vscode.Uri.parse(match[1]); } catch { return null; }
}

function hasLegacyData(values: LegacyValues): boolean {
    return Object.values(values).some(value => value !== undefined);
}

function legacyStructDefs(v2: unknown, v1: unknown, perFile: unknown): StructDef[] {
    const globalSource = v2 === undefined ? migrateStructDefinitions(v1 ?? []) : v2;
    const { defs: globalArr } = normalizeStructDefsValue(globalSource);
    const { defs: legacyArr } = normalizeStructDefsValue(migrateStructDefinitions(perFile ?? []));
    return mergeLegacyStructDefs(globalArr, legacyArr).defs;
}