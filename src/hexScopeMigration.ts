// ── One-time legacy migration (per workspace root) ────────────────
// Converts the pre-P1 per-file `firmware_profiles/<n>/` layout into the
// three-tier shape:
//   (a) merge every firmware_profiles/<n>/structs.json into the workspace
//       struct pool (.hexscope/structs.json), deduped via structMigration
//   (b) each index.json + integrity.json pair → one registry profile
//       (.hexscope/profiles/<id>.json) + one binding (fileKey → profileId)
// Runs once per root (Memento tariff). The legacy tree is left in place so
// a reverted release still finds committed legacy data; idempotent.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { normalizeIntegrityProfiles } from './core/integrity';
import { migrateStructDefinitions } from './core/structMigration';
import { normalizeStructDefsValue } from './core/structNormalization';
import type { StructDef } from './core/types';
import {
    bindingsJsonUri,
    createProfileRegistryEntry,
    emptyProfileRecord,
    hexScopeProfilesRegistryDir,
    normalizeBindings,
    normalizeProfileRecord,
    perFileRelativePath,
    profileRegistryJsonUri,
    readJson,
    resolveHexScopeRoot,
    resolveProfileDir,
    structPoolJsonUri,
    withEnvelope,
    writeJson,
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

/** Once per root: migrate any legacy firmware_profiles trees that still exist. */
async function ensureMigrationComplete(root: string, relPath: string, uri: vscode.Uri, context: MigrationContext): Promise<void> {
    const legacyTree = path.join(root, '.hexscope', 'firmware_profiles');
    const hasLegacy = await dirExists(legacyTree);
    if (!hasLegacy) {
        // Memento-era data (pre-tree): seed the open document's profile.
        await seedOpenDocFromMemento(root, relPath, uri, context);
        await markMigrated(root, context);
        return;
    }
    await migrateLegacyTree(root, uri, context);
    await markMigrated(root, context);
}

async function markMigrated(root: string, context: MigrationContext): Promise<void> {
    await context.globalState.update(MIGRATION_MARKER, root);
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
    let entries: [string, vscode.FileType][] = [];
    try { entries = await vscode.workspace.fs.readDirectory(legacyContainer); } catch { return; }

    for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory) { continue; }
        const dir = path.join(legacyContainer.fsPath, name);

        const indexRaw = await readJson(vscode.Uri.file(path.join(dir, 'index.json')));
        if (indexRaw.status !== 'ok') { continue; }
        const index = normalizeIndexPayload(indexRaw.value);
        if (!index) { continue; }

        // (a) merge structs.json into workspace pool
        const structsRaw = await readJson(vscode.Uri.file(path.join(dir, 'structs.json')));
        const legacyStructs = structsRaw.status === 'ok'
            ? normalizeStructDefsValue(migrateStructDefinitions(structsRaw.value)).defs
            : [];
        await mergeIntoPool(root, legacyStructs);

        // (b) integrity.json template registry → activeChecks seeds.
        const integrityRaw = await readJson(vscode.Uri.file(path.join(dir, 'integrity.json')));
        const legacyProfiles = integrityRaw.status === 'ok' ? normalizeIntegrityProfiles(integrityRaw.value) : [];

        // Build one registry profile from the legacy index data (and preserve
        // the legacy integrity template registry by folding its first profile's
        // checks into activeChecks when the index had none).
        const profileId = await ensureProfileLegacy(root, index, legacyProfiles, name);

        // Binding: fileKey → profileId.
        await bindFile(root, index.relPath, profileId);

        // Remaining integrity templates become unbound registry profiles so no
        // preset checks are lost (the dropdown can re-select them).
        const extras = index.activeChecks.checks.length > 0 ? legacyProfiles : legacyProfiles.slice(1);
        if (extras.length > 0) {
            await migrateIntegrityTemplates(root, undefined, extras);
        }
    }
}

/** Create/merge one registry profile for a legacy index dir. Returns profileId. */
async function ensureProfileLegacy(
    root: string,
    index: ProfileIndexData,
    legacyProfiles: IntegrityProfileVal[],
    sourceDirName: string,
): Promise<string> {
    const profileId = `profile_${await nextOrdinal(root)}`;
    const name = profileNameFromIndex(index, sourceDirName);
    let dir = await resolveProfileDir(root, profileId);
    let created = false;
    if (!dir) {
        dir = await createProfileRegistryEntry(root, profileId, name);
        created = true;
    }
    const existing = await readProfileRecord(root, profileId);
    const activeChecks = index.activeChecks.checks.length > 0 ? index.activeChecks : legacyActiveChecks(legacyProfiles);
    const merged: unknown = {
        ...emptyProfileRecord(profileId, name),
        activeChecks: created || !existing?.activeChecks?.checks?.length ? activeChecks : existing.activeChecks,
        labels: created || !existing?.labels?.length ? index.labels : existing.labels,
        segmentNames: created || !existing?.segmentNames ? index.segmentNames : existing.segmentNames,
        pins: created || !existing?.pins?.length ? index.pins : existing.pins,
        endian: created || !existing?.endian ? index.endian : existing.endian,
    };
    await writeJson(profileRegistryJsonUri(dir), withEnvelope(merged));
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

async function nextOrdinal(root: string): Promise<number> {
    const container = vscode.Uri.file(hexScopeProfilesRegistryDir(root));
    let entries: [string, vscode.FileType][] = [];
    try { entries = await vscode.workspace.fs.readDirectory(container); } catch { /* none */ }
    const used = new Set(entries.filter(([, t]) => t === vscode.FileType.Directory).map(([n]) => n));
    let id = 1;
    while (used.has(`profile_${id}`)) { id++; }
    return id;
}

function profileNameFromIndex(index: ProfileIndexData, sourceDirName: string): string {
    return index.relPath ? path.basename(index.relPath, path.extname(index.relPath)) : sourceDirName;
}

function profileNameFromRel(relPath: string): string {
    return path.basename(relPath, path.extname(relPath)) || 'Firmware';
}

async function readProfileRecord(root: string, profileId: string): Promise<ProfileRecordVal | null> {
    const dir = await resolveProfileDir(root, profileId);
    if (!dir) { return null; }
    const read = await readJson(profileRegistryJsonUri(dir));
    if (read.status !== 'ok') { return null; }
    return normalizeProfileRecord(read.value, emptyProfileRecord(profileId, '')).value;
}

async function readBindings(root: string): Promise<BindingVal[]> {
    const read = await readJson(bindingsJsonUri(root));
    if (read.status !== 'ok') { return []; }
    return normalizeBindings(read.value).value;
}

/** Merge legacy struct defs into the pool, deduped by id/name. */
async function mergeIntoPool(root: string, legacy: StructDef[]): Promise<void> {
    const poolUri = structPoolJsonUri(root);
    const existing = await readStructPool(root);
    const merged = dedupeStructPool(existing, legacy);
    if (merged.length !== existing.length) {
        await writeJson(poolUri, withEnvelope(merged));
    }
}

function dedupeStructPool(existing: StructDef[], incoming: StructDef[]): StructDef[] {
    const seenIds = new Set(existing.map(s => s.id));
    const seenNames = new Set(existing.map(s => s.name.toLowerCase()));
    const merged = [...existing];
    for (const s of incoming) {
        if (seenIds.has(s.id)) { continue; }
        if (seenNames.has(s.name.toLowerCase())) { continue; }
        seenIds.add(s.id);
        seenNames.add(s.name.toLowerCase());
        merged.push(s);
    }
    return merged;
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

    const profileId = `profile_${await nextOrdinal(root)}`;
    const name = profileNameFromRel(relPath);
    const dir = await createProfileRegistryEntry(root, profileId, name);

    const seed: unknown = {
        ...emptyProfileRecord(profileId, name),
        labels: arrayOrEmpty(legacy.labels),
        segmentNames: plainStringRecord(legacy.segmentNames),
        pins: arrayOrEmpty(legacy.pins),
        activeChecks: normalizeChecks(legacy.checks),
        endian: legacy.endian === 'be' ? 'be' : 'le',
    };
    await writeJson(profileRegistryJsonUri(dir), withEnvelope(seed));

    // Bind the open doc.
    await bindFile(root, relPath, profileId);
}

/** Merge Memento era struct sources (global v2/v1 + per-file) deduped. */
function legacyStructDefs(v2: unknown, v1: unknown, perFile: unknown): StructDef[] {
    const globalSource = v2 === undefined ? migrateStructDefinitions(v1 ?? []) : v2;
    const { defs: globalArr } = normalizeStructDefsValue(globalSource);
    const { defs: legacyArr } = normalizeStructDefsValue(migrateStructDefinitions(perFile ?? []));
    const byId = new Map<string, StructDef>();
    const seenNames = new Set<string>();
    const push = (s: StructDef) => {
        if (byId.has(s.id) || seenNames.has(s.name.toLowerCase())) { return; }
        byId.set(s.id, s);
        seenNames.add(s.name.toLowerCase());
    };
    for (const s of [...globalArr, ...legacyArr]) { push(s); }
    return Array.from(byId.values());
}

/** Create registry profiles from uncapped IntegrityProfile templates (data preservation). */
async function migrateIntegrityTemplates(root: string, raw: unknown, extra: IntegrityProfileVal[]): Promise<void> {
    const templates = [...normalizeIntegrityProfilesSafe(raw), ...extra];
    for (const t of templates) {
        const existing = await listProfileNames(root);
        if (existing.has(t.name.toLowerCase())) { continue; }
        const id = `profile_${await nextOrdinal(root)}`;
        await createProfileRegistryEntry(root, id, t.name);
        const dir = await resolveProfileDir(root, id);
        if (dir) {
            await writeJson(profileRegistryJsonUri(dir), withEnvelope({
                ...emptyProfileRecord(id, t.name),
                activeChecks: { schemaVersion: 1, checks: t.checks as unknown[] },
            }));
        }
    }
}

async function listProfileNames(root: string): Promise<Set<string>> {
    const container = vscode.Uri.file(hexScopeProfilesRegistryDir(root));
    let entries: [string, vscode.FileType][] = [];
    try { entries = await vscode.workspace.fs.readDirectory(container); } catch { /* none */ }
    const names = new Set<string>();
    for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory) { continue; }
        const dir = await resolveProfileDir(root, name);
        if (!dir) { continue; }
        const read = await readJson(profileRegistryJsonUri(dir));
        if (read.status !== 'ok') { continue; }
        const rec = normalizeProfileRecord(read.value, emptyProfileRecord(name, name)).value;
        names.add(rec.name.toLowerCase());
    }
    return names;
}

function normalizeIntegrityProfilesSafe(raw: unknown): IntegrityProfileVal[] {
    if (!Array.isArray(raw)) { return []; }
    const out: IntegrityProfileVal[] = [];
    for (const item of raw) {
        if (item === null || typeof item !== 'object') { continue; }
        const o = item as Record<string, unknown>;
        if (typeof o.id !== 'string' || typeof o.name !== 'string') { continue; }
        out.push({ id: o.id, name: o.name, checks: Array.isArray(o.checks) ? o.checks : [] });
    }
    return out;
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

function arrayOrEmpty(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function plainStringRecord(value: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) { if (typeof v === 'string') { out[k] = v; } }
    }
    return out;
}

function normalizeChecks(value: unknown): IntegrityCheckVal {
    if (value === null || typeof value !== 'object') { return { schemaVersion: 1, checks: [] }; }
    const o = value as Record<string, unknown>;
    return { schemaVersion: o.schemaVersion === 1 ? 1 : 1, checks: Array.isArray(o.checks) ? o.checks : [] };
}

function normalizeIndexPayload(raw: unknown): ProfileIndexData | null {
    if (raw === null || typeof raw !== 'object') { return null; }
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o)) { return null; }
    return {
        relPath: typeof o.relPath === 'string' ? o.relPath : '',
        labels: Array.isArray(o.labels) ? o.labels : [],
        segmentNames: plainStringRecord(o.segmentNames),
        pins: Array.isArray(o.pins) ? o.pins : [],
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

interface ProfileRecordVal {
    id: string;
    name: string;
    pins: unknown[];
    activeChecks: IntegrityCheckVal;
    endian: 'le' | 'be';
    segmentNames: Record<string, string>;
    labels: unknown[];
}

interface BindingVal {
    fileKey: string;
    profileId: string;
}
