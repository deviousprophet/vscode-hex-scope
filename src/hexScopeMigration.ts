// ── One-time legacy migration (per workspace root) ────────────────
// Converts the pre-P1 per-file `firmware_profiles/<n>/` layout into the
// three-tier shape:
//   (a) merge every firmware_profiles/<n>/structs.json into the workspace
//       struct pool (.hexscope/structs.json), deduped via structMigration
//   (b) each index.json + integrity.json pair → one registry profile in
//       .hexscope/profiles.json + one binding (fileKey → profileId)
// Also merges the per-directory profile registry (`.hexscope/profiles/<id>/`)
// into the single-file `profiles.json` array.
// Runs once per root (Memento tariff). The legacy trees are left in place so
// a reverted release still finds committed legacy data; idempotent.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { normalizeIntegrityProfiles } from './core/integrity';
import { arrayField, arrayOrEmpty, plainObject, plainStringRecord, stringField } from './core/fromUnknown';
import { migrateStructDefinitions, mergeLegacyStructDefs } from './core/structMigration';
import { normalizeStructDefsValue } from './core/structNormalization';
import type { StructDef } from './core/types';
import {
    bindingsJsonUri,
    collectProfileRecords,
    emptyProfileRecord,
    migrateLegacyProfileDirs,
    nextProfileOrdinal,
    normalizeBindings,
    perFileRelativePath,
    readDirectorySafe,
    readJson,
    resolveHexScopeRoot,
    structPoolJsonUri,
    withEnvelope,
    writeJson,
    writeProfileRecord,
    type ProfileRecord,
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
const MIGRATION_MARKER = 'hexScope.migration.v3';
const PROFILES_ARRAY_MARKER = 'hexScope.profilesArray.v1';

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

export async function migrateLegacyData(root: string, uri: vscode.Uri, context: MigrationContext): Promise<void> {
    if (migratedRoots.has(root)) { return; }
    const relPath = perFileRelativePath(root, uri);

    try {
        await ensureMigrationComplete(root, relPath, uri, context);
    } catch (error) {
        console.error(`HexScope: profile migration failed for ${root}:`, error);
    } finally {
        await sweepLegacyPerFileKeys(root, context);
        await deleteLegacyGlobalKeys(context);
        migratedRoots.add(root);
    }
}

/** Once per root: merge a per-directory registry into profiles.json, then
 *  migrate any legacy firmware_profiles trees that still exist. */
async function ensureMigrationComplete(root: string, relPath: string, uri: vscode.Uri, context: MigrationContext): Promise<void> {
    // Current-release per-dir registry → single-file array (before the
    // firmware_profiles tree below pushes more records into the array).
    await migrateProfilesDirToArray(root, context);

    const legacyTree = path.join(root, '.hexscope', 'firmware_profiles');
    const hasLegacy = await dirExists(legacyTree);
    if (!hasLegacy) {
        // Memento-era data (pre-tree): seed the open document's profile.
        await seedOpenDocFromMemento(root, relPath, uri, context);
        await markMigrated(root, context);
        return;
    }
    // The legacy tree is left in place after conversion (revert safety), so
    // completion is tracked per converted dir via a `.converted` marker file —
    // never by the mere existence of bindings.json, which a pre-existing
    // binding from an unrelated file could otherwise use to permanently
    // suppress conversion of a remaining legacy tree (silent data loss).
    await migrateLegacyTree(root, uri, context);
    await markMigrated(root, context);
}

async function markMigrated(root: string, context: MigrationContext): Promise<void> {
    await context.globalState.update(MIGRATION_MARKER, root);
}

/** One-time merge of `.hexscope/profiles/<id>/profile.json` dirs into the
 *  single-file registry array. The marker is Memento (restart safe); the dir
 *  tree is left in place for rollback. No-op when the old tree is absent. */
async function migrateProfilesDirToArray(root: string, context: MigrationContext): Promise<void> {
    const marker = PROFILES_ARRAY_MARKER;
    if (context.globalState.get<string>(marker) === root) { return; }
    if (await dirExists(path.join(root, '.hexscope', 'profiles'))) {
        await migrateLegacyProfileDirs(root);
    }
    await context.globalState.update(marker, root);
}

async function dirExists(p: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(p));
        return true;
    } catch {
        return false;
    }
}

/** Convert every legacy firmware_profiles/<n> dir into a registry profile + binding. */
async function migrateLegacyTree(root: string, uri: vscode.Uri, context: MigrationContext): Promise<void> {
    // Also consume any remaining Memento-era data (global structs, global
    // integrity templates, per-file structs) so nothing is lost.
    const uriStr = uri.toString();
    const mementoLegacy = readLegacyKeys(uriStr, context);
    const mementoStructs = legacyStructDefs(mementoLegacy.globalStructV2, mementoLegacy.globalStructV1, mementoLegacy.perFileStructs);
    if (mementoStructs.length > 0) { await mergeIntoPool(root, mementoStructs); }
    await migrateIntegrityTemplates(root, mementoLegacy.globalProfiles, []);

    const legacyContainer = vscode.Uri.file(path.join(root, '.hexscope', 'firmware_profiles'));
    const entries = await readDirectorySafe(legacyContainer);
    for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory) { continue; }
        await migrateLegacyEntry(root, name, path.join(legacyContainer.fsPath, name));
    }
}

/** Convert one legacy firmware_profiles/<n> dir: pool + profile + binding.
 *  Idempotent per dir via a `.converted` marker (left in place with the tree
 *  for revert safety). */
async function migrateLegacyEntry(root: string, name: string, dir: string): Promise<void> {
    const markerUri = vscode.Uri.file(path.join(dir, '.converted'));
    if (await fileExists(markerUri)) { return; }

    const index = await legacyIndexFor(dir);
    if (!index) { return; }

    // (a) merge structs.json into workspace pool
    await mergeIntoPool(root, await readLegacyStructs(dir));

    // (b) integrity.json template registry → activeChecks seeds.
    const legacyProfiles = await readLegacyIntegrityProfiles(dir);

    // Build one registry profile from the legacy index data (and preserve
    // the legacy integrity template registry by folding its first profile's
    // checks into activeChecks when the index had none).
    const profileId = await ensureProfileLegacy(root, index, legacyProfiles, name);

    // Binding: fileKey → profileId.
    await bindFile(root, index.relPath, profileId);

    // Remaining integrity templates become unbound registry profiles so no
    // preset checks are lost (the dropdown can re-select them).
    const extras = extraTemplates(index, legacyProfiles);
    if (extras.length > 0) {
        await migrateIntegrityTemplates(root, undefined, extras);
    }

    // Mark this dir converted (before index jiggles could reorder); the tree
    // itself stays on disk for revert safety.
    await markConverted(markerUri);
}

/** Write a `.converted` marker; marker-write failures never block migration. */
async function markConverted(markerUri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.writeFile(markerUri, new Uint8Array());
    } catch { /* best effort */ }
}

/** Read + normalize a legacy index.json; null when missing/corrupt/shape-invalid. */
async function legacyIndexFor(dir: string): Promise<ProfileIndexData | null> {
    const indexRaw = await readJson(vscode.Uri.file(path.join(dir, 'index.json')));
    if (indexRaw.status !== 'ok') { return null; }
    return normalizeIndexPayload(indexRaw.value);
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function readLegacyStructs(dir: string): Promise<StructDef[]> {
    const raw = await readJson(vscode.Uri.file(path.join(dir, 'structs.json')));
    return raw.status === 'ok' ? normalizeStructDefsValue(migrateStructDefinitions(raw.value)).defs : [];
}

async function readLegacyIntegrityProfiles(dir: string): Promise<IntegrityProfileVal[]> {
    const raw = await readJson(vscode.Uri.file(path.join(dir, 'integrity.json')));
    return raw.status === 'ok' ? normalizeIntegrityProfiles(raw.value) : [];
}

function extraTemplates(index: ProfileIndexData, legacyProfiles: IntegrityProfileVal[]): IntegrityProfileVal[] {
    return index.activeChecks.checks.length > 0 ? legacyProfiles : legacyProfiles.slice(1);
}

/** Create one registry profile for a legacy index dir. Returns profileId. */
async function ensureProfileLegacy(
    root: string,
    index: ProfileIndexData,
    legacyProfiles: IntegrityProfileVal[],
    sourceDirName: string,
): Promise<string> {
    const profileId = `profile_${await nextProfileOrdinal(root)}`;
    const name = profileNameFromIndex(index, sourceDirName);
    await writeProfileRecord(root, {
        ...emptyProfileRecord(profileId, name),
        activeChecks: (index.activeChecks.checks.length > 0 ? index.activeChecks : legacyActiveChecks(legacyProfiles)) as ProfileRecord['activeChecks'],
        labels: index.labels as ProfileRecord['labels'],
        segmentNames: index.segmentNames,
        structPins: index.pins as ProfileRecord['structPins'],
        endian: index.endian,
    });
    return profileId;
}

/** Opportunistic activeChecks from a legacy integrity profile template. */
function legacyActiveChecks(profiles: IntegrityProfileVal[]): IntegrityCheckVal {
    if (profiles.length === 0) { return { schemaVersion: 1, checks: [] }; }
    // The first template's checks seed the profile's activeChecks.
    return { schemaVersion: 1, checks: profiles[0].checks as unknown[] };
}

/** Rewrite bindings entry for a fileKey; prune dead entries on the way. */
async function bindFile(root: string, fileKey: string, profileId: string): Promise<void> {
    if (!fileKey) { return; }
    const bindingsUri = bindingsJsonUri(root);
    const current = await readBindings(root);
    const without = current.filter(b => b.fileKey !== fileKey);
    const next = [...without, { fileKey, profileId }];
    await writeJson(bindingsUri, withEnvelope(normalizeBindings(next).value));
}

function profileNameFromIndex(index: ProfileIndexData, sourceDirName: string): string {
    return index.relPath ? path.basename(index.relPath, path.extname(index.relPath)) : sourceDirName;
}

function profileNameFromRel(relPath: string): string {
    return path.basename(relPath, path.extname(relPath)) || 'Firmware';
}

async function readBindings(root: string): Promise<BindingVal[]> {
    const read = await readJson(bindingsJsonUri(root));
    if (read.status !== 'ok') { return []; }
    return normalizeBindings(read.value).value;
}

/** Merge legacy struct defs into the pool, deduped via structMigration. */
async function mergeIntoPool(root: string, legacy: StructDef[]): Promise<void> {
    const poolUri = structPoolJsonUri(root);
    const existing = await readStructPool(root);
    const merged = mergeLegacyStructDefs(existing, legacy);
    if (merged.changed) {
        await writeJson(poolUri, withEnvelope(merged.defs));
    }
}

async function readStructPool(root: string): Promise<StructDef[]> {
    const read = await readJson(structPoolJsonUri(root));
    if (read.status !== 'ok') { return []; }
    return normalizeStructDefsValue(migrateStructDefinitions(read.value)).defs;
}

// ── Legacy Memento seeding (open doc) ─────────────────────────────

async function seedOpenDocFromMemento(root: string, relPath: string, uri: vscode.Uri, context: MigrationContext): Promise<void> {
    const uriStr = uri.toString();
    const legacy = readLegacyKeys(uriStr, context);
    if (!hasLegacyData(legacy)) { return; }

    // Memento global/per-file structs → workspace pool (deduped).
    const legacyStructs = legacyStructDefs(legacy.globalStructV2, legacy.globalStructV1, legacy.perFileStructs);
    await mergeIntoPool(root, legacyStructs);

    // Legacy global integrity templates → registry profiles (unbound, so the
    // dropdown can re-select them; the open doc gets its own profile below).
    await migrateIntegrityTemplates(root, legacy.globalProfiles, []);

    const profileId = `profile_${await nextProfileOrdinal(root)}`;
    const name = profileNameFromRel(relPath);

    const seed: ProfileRecord = {
        ...emptyProfileRecord(profileId, name),
        labels: arrayOrEmpty(legacy.labels) as ProfileRecord['labels'],
        segmentNames: plainStringRecord(legacy.segmentNames),
        structPins: arrayOrEmpty(legacy.pins) as ProfileRecord['structPins'],
        activeChecks: normalizeChecks(legacy.checks) as ProfileRecord['activeChecks'],
        endian: legacy.endian === 'be' ? 'be' : 'le',
    };
    await writeProfileRecord(root, seed);

    // Bind the open doc.
    await bindFile(root, relPath, profileId);
}

/** Merge Memento era struct sources (global v2/v1 + per-file) deduped. */
function legacyStructDefs(v2: unknown, v1: unknown, perFile: unknown): StructDef[] {
    const globalArr = v2 === undefined ? legacySourceDefs(v1) : normalizeStructDefsValue(v2).defs;
    const legacyArr = legacySourceDefs(perFile);
    return dedupeStructDefs([...globalArr, ...legacyArr]);
}

function legacySourceDefs(source: unknown): StructDef[] {
    return normalizeStructDefsValue(migrateStructDefinitions(source ?? [])).defs;
}

function dedupeStructDefs(defs: StructDef[]): StructDef[] {
    const byId = new Map<string, StructDef>();
    const seenNames = new Set<string>();
    for (const s of defs) {
        if (byId.has(s.id) || seenNames.has(s.name.toLowerCase())) { continue; }
        byId.set(s.id, s);
        seenNames.add(s.name.toLowerCase());
    }
    return Array.from(byId.values());
}

/** Create registry profiles from uncapped IntegrityProfile templates (data preservation). */
async function migrateIntegrityTemplates(root: string, raw: unknown, extra: IntegrityProfileVal[]): Promise<void> {
    const templates = [...normalizeIntegrityProfilesSafe(raw), ...extra];
    for (const t of templates) {
        const existing = await listProfileNames(root);
        if (existing.has(t.name.toLowerCase())) { continue; }
        const id = `profile_${await nextProfileOrdinal(root)}`;
        await writeProfileRecord(root, {
            ...emptyProfileRecord(id, t.name),
            activeChecks: { schemaVersion: 1, checks: t.checks as unknown[] } as ProfileRecord['activeChecks'],
        });
    }
}

async function listProfileNames(root: string): Promise<Set<string>> {
    const records = await collectProfileRecords(root);
    return new Set(records.map(rec => rec.name.toLowerCase()));
}

function normalizeIntegrityProfilesSafe(raw: unknown): IntegrityProfileVal[] {
    if (!Array.isArray(raw)) { return []; }
    return raw.filter(isIntegrityProfileObject).map(toIntegrityProfileValue);
}

function isIntegrityProfileObject(item: unknown): item is Record<string, unknown> {
    if (item === null || typeof item !== 'object') { return false; }
    const o = item as Record<string, unknown>;
    return typeof o.id === 'string' && typeof o.name === 'string';
}

function toIntegrityProfileValue(o: Record<string, unknown>): IntegrityProfileVal {
    return { id: o.id as string, name: o.name as string, checks: Array.isArray(o.checks) ? o.checks : [] };
}

function readLegacyKeys(uriStr: string, context: MigrationContext): LegacyValues {
    return {
        globalStructV2: context.globalState.get<unknown>(STRUCTS_V2_KEY),
        globalStructV1: context.globalState.get<unknown>(STRUCTS_V1_KEY),
        globalProfiles: context.globalState.get<unknown>(INTEGRITY_PROFILES_KEY),
        perFileStructs: context.workspaceState.get<unknown>(PER_FILE_STRUCTS_PREFIX + uriStr),
        labels: context.workspaceState.get<unknown>(PER_FILE_LABELS_PREFIX + uriStr),
        segmentNames: context.workspaceState.get<unknown>(PER_FILE_SEGMENT_NAMES_PREFIX + uriStr),
        pins: context.workspaceState.get<unknown>(PER_FILE_PINS_PREFIX + uriStr),
        checks: context.workspaceState.get<unknown>(`${PER_FILE_CHECKS_PREFIX}${uriStr}.v1`),
        endian: context.workspaceState.get<unknown>(`${PER_FILE_ENDIAN_PREFIX}${uriStr}.v1`),
    };
}

async function deleteLegacyGlobalKeys(context: MigrationContext): Promise<void> {
    for (const key of [STRUCTS_V2_KEY, STRUCTS_V1_KEY, INTEGRITY_PROFILES_KEY]) {
        await context.globalState.update(key, undefined);
    }
    for (const key of context.workspaceState.keys()) {
        if (isLegacyPerFileKey(key)) { await context.workspaceState.update(key, undefined); }
    }
}

function isLegacyPerFileKey(key: string): boolean {
    return /^hexScope\.(?:structs|labels|segmentNames|structPins|integrityChecks|endian)\./.test(key);
}

async function sweepLegacyPerFileKeys(root: string, context: MigrationContext): Promise<void> {
    for (const key of context.workspaceState.keys()) {
        if (legacyKeyBelongsToRoot(perFileUriFromKey(key), root)) {
            await context.workspaceState.update(key, undefined);
        }
    }
}

function legacyKeyBelongsToRoot(parsedUri: vscode.Uri | null, root: string): boolean {
    if (parsedUri === null) { return false; }
    if (resolveHexScopeRoot(parsedUri) === root) { return true; }
    return parsedUri.fsPath.startsWith(root + path.sep);
}

function perFileUriFromKey(key: string): vscode.Uri | null {
    const match = /^hexScope\.(?:integrityChecks|endian)\.(.+)\.v1$/.exec(key)
        ?? /^hexScope\.(?:structs|labels|segmentNames|structPins|integrityChecks|endian)\.(.+)$/.exec(key);
    if (!match) { return null; }
    try { return vscode.Uri.parse(match[1]); } catch { return null; }
}

function hasLegacyData(values: LegacyValues): boolean {
    return Object.values(values).some(value => value !== undefined);
}

function normalizeChecks(value: unknown): IntegrityCheckVal {
    const o = checksObject(value);
    if (!o) { return { schemaVersion: 1, checks: [] }; }
    return { schemaVersion: 1, checks: Array.isArray(o.checks) ? o.checks : [] };
}

function checksObject(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object') { return null; }
    return value as Record<string, unknown>;
}

function normalizeIndexPayload(raw: unknown): ProfileIndexData | null {
    const o = plainObject(raw);
    if (!o) { return null; }
    return {
        relPath: stringField(o, 'relPath'),
        labels: arrayField(o, 'labels'),
        segmentNames: plainStringRecord(o.segmentNames),
        pins: arrayField(o, 'pins'),
        activeChecks: normalizeChecks(o.activeChecks),
        endian: o.endian === 'be' ? 'be' : 'le',
    };
}

interface LegacyValues {
    globalStructV2: unknown;
    globalStructV1: unknown;
    globalProfiles: unknown;
    perFileStructs: unknown;
    labels: unknown;
    segmentNames: unknown;
    pins: unknown;
    checks: unknown;
    endian: unknown;
}

interface ProfileIndexData {
    relPath: string;
    labels: unknown[];
    segmentNames: Record<string, string>;
    pins: unknown[];
    activeChecks: IntegrityCheckVal;
    endian: 'le' | 'be';
}

interface IntegrityCheckVal {
    schemaVersion: number;
    checks: unknown[];
}

interface IntegrityProfileVal {
    id: string;
    name: string;
    checks: unknown[];
}

interface BindingVal {
    fileKey: string;
    profileId: string;
}
