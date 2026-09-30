// ── .hexscope three-tier storage (host adapter) ───────────────────
// Single owner of .hexscope/ I/O. No Memento access here; normalizers
// are passed in per slot. src/core must not import vscode — this file
// sits at the top level exactly because it is a host adapter.
//
// Three-tier layout (single-file profile registry):
//   .hexscope/structs.json          — workspace-wide StructDef[] pool
//   .hexscope/profiles.json         — ProfileRecord[] registry (all profiles in one file)
//   .hexscope/bindings.json         — fileKey → profileId table
//   .hexscope/schemas/              — generated schema copies (refreshed on data writes)
//   .hexscope/scripts/              — script runner (unchanged)

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { normalizeIntegrityCheckSet, type IntegrityCheckSet } from './core/integrity';
import { arrayOrEmpty, plainObject, plainStringRecord, stringOrEmpty } from './core/fromUnknown';
import type { BitFieldAllocation, SegmentLabel, StructPin } from './core/types';
import { bitAllocationOrDefault, endianOrDefault, showHiddenFieldsOrDefault, type HexScopeEndian, type SegmentNameOverrides } from './webviewProtocol';

/** Storage envelope version (`{ version, data }`). A future/unknown value is refused on read.
 *  This is NOT the data-schema version: it must not be bumped without breaking older builds. */
export const DATA_VERSION = 1;

/** Current shape version of the payload carried inside `data` (see `migrateData`).
 *  Bump this when a `.hexscope` data shape changes and add the matching step to
 *  `MIGRATIONS`; existing files then migrate forward on open. */
export const DATA_SCHEMA_VERSION = 1;

/** Ordered forward migrations keyed by from-version: `MIGRATIONS[n]` turns a
 *  version-`n` payload into a version-`n+1` payload. Empty while the shape is
 *  still at its first version; the table (and the constant above) is the one
 *  source of truth shared by all three data files. */
const MIGRATIONS: Readonly<Record<number, (data: Record<string, unknown>) => Record<string, unknown>>> = {};

/** Payload key per data file — the object form is `{ schemaVersion, <key>: payload }`. */
export type DataPayloadKey = 'defs' | 'records' | 'bindings';

/** Stamp the current data-schema version on a payload: `{ schemaVersion, <key>: payload }`. */
export function withDataEnvelope(payloadKey: DataPayloadKey, payload: unknown): Record<string, unknown> {
    return { schemaVersion: DATA_SCHEMA_VERSION, [payloadKey]: payload };
}

/** Outcome of running the migration chain. `newer` = recorded version is ahead
 *  of this build: the caller maps it to the existing corrupt path (empty
 *  default + warn-once, file never overwritten). No downgrade path exists. */
export type MigratedData =
    | { status: 'ok'; value: Record<string, unknown>; changed: boolean }
    | { status: 'newer' };

/** Recorded data-schema version: object form reads `schemaVersion`; a legacy
 *  bare array (or an object missing the field) is the first version. */
function recordedSchemaVersion(raw: unknown): number {
    const v = plainObject(raw)?.schemaVersion;
    return isSchemaVersion(v) ? v : 1;
}

function isSchemaVersion(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Apply the ordered steps in `steps` from `from` up to (not including) `target`,
 *  threading the payload under `payloadKey`. Exported as the test seam for the
 *  ordered-chain contract; `migrateData` calls it with the shared table. */
export function applyMigrationSteps(
    steps: Readonly<Record<number, (data: Record<string, unknown>) => Record<string, unknown>>>,
    from: number,
    target: number,
    payloadKey: DataPayloadKey,
    payload: unknown,
): unknown {
    let value = payload;
    for (let v = from; v < target; v++) {
        const step = steps[v];
        if (step) { value = step({ schemaVersion: v, [payloadKey]: value })[payloadKey]; }
    }
    return value;
}

/** Resolve the payload from a raw `data` value: the legacy bare array is the
 *  payload itself; the versioned object carries it under `payloadKey`. An object
 *  that declares a valid `schemaVersion` but omits the payload key has an absent
 *  payload (`undefined`) — stamp it so the shape normalizer self-heals the empty
 *  default rather than nesting the whole object. Returns null for an
 *  unrecognized object (no carrier, no numeric `schemaVersion`) — not a data
 *  file this runner should restructure. */
function resolvePayload(raw: unknown, payloadKey: DataPayloadKey): { value: unknown } | null {
    const source = plainObject(raw);
    if (source === null) { return { value: raw }; }
    if (payloadKey in source) { return { value: source[payloadKey] }; }
    return isSchemaVersion(source.schemaVersion) ? { value: undefined } : null;
}

/** Migrate a payload forward to `DATA_SCHEMA_VERSION`.
 *  - legacy bare-array `data` is treated as version 1 and wrapped in the object form;
 *  - recorded version newer than the build → `{ status: 'newer' }` (no downgrade);
 *  - already current and byte-identical → `changed: false` (no write). */
export function migrateData(raw: unknown, payloadKey: DataPayloadKey): MigratedData {
    const from = recordedSchemaVersion(raw);
    if (from > DATA_SCHEMA_VERSION) { return { status: 'newer' }; }
    const resolved = resolvePayload(raw, payloadKey);
    if (resolved === null) { return { status: 'ok', value: raw as Record<string, unknown>, changed: false }; }
    const value = applyMigrationSteps(MIGRATIONS, from, DATA_SCHEMA_VERSION, payloadKey, resolved.value);
    // An absent payload (versioned object missing its key) omits the carrier key
    // rather than nesting the whole object; the shape normalizer then self-heals.
    const next = value === undefined
        ? { schemaVersion: DATA_SCHEMA_VERSION }
        : { schemaVersion: DATA_SCHEMA_VERSION, [payloadKey]: value };
    return { status: 'ok', value: next, changed: JSON.stringify(raw) !== JSON.stringify(next) };
}

/** Compose the migration runner with a per-file shape normalizer.
 *  Returns:
 *  - `newer` when the recorded version is ahead of this build (caller → corrupt path);
 *  - otherwise the shape-normalized payload, with `changed` true when either the
 *    version/shape migrated or the shape normalizer reports a diff. */
export function migrateAndNormalize<T>(
    raw: unknown,
    payloadKey: DataPayloadKey,
    shapeNormalize: (payload: unknown) => NormalizedValue<T>,
    empty: () => T,
): NormalizedValue<T> {
    const migrated = migrateData(raw, payloadKey);
    if (migrated.status === 'newer') { return { value: empty(), changed: false, newer: true }; }
    const shaped = shapeNormalize(migrated.value[payloadKey]);
    return { value: shaped.value, changed: migrated.changed || shaped.changed };
}

/** Extract the payload from a raw `data` value (legacy array or object form).
 *  Returns null when the file is newer than this build (do not read stale data). */
export function migratedPayload(raw: unknown, payloadKey: DataPayloadKey): unknown | null {
    const migrated = migrateData(raw, payloadKey);
    return migrated.status === 'newer' ? null : migrated.value[payloadKey];
}

/** Read a data file for a read-modify-write. `newer` marks a payload ahead of
 *  this build: the caller must NOT write (forward-only — never downgrade or
 *  clobber a newer file). `missing`/`corrupt` fall back to the empty payload so
 *  an unrelated corrupt sibling is not treated as a reason to skip a legitimate
 *  write (existing behavior). */
export type PayloadForWrite = { status: 'ok' | 'missing' | 'corrupt' | 'newer'; payload: unknown };

export async function readPayloadForWrite(uri: vscode.Uri, payloadKey: DataPayloadKey): Promise<PayloadForWrite> {
    const read = await readJson(uri);
    if (read.status !== 'ok') { return { status: read.status, payload: undefined }; }
    const migrated = migrateData(read.value, payloadKey);
    if (migrated.status === 'newer') { return { status: 'newer', payload: undefined }; }
    return { status: 'ok', payload: migrated.value[payloadKey] };
}

const DEFAULT_DEBOUNCE_MS = 400;
const SCHEMA_DIR = '.hexscope/schemas';
const PROFILES_FILE = 'profiles.json';
const BINDINGS_FILE = 'bindings.json';
const STRUCT_POOL_FILE = 'structs.json';

/** File names within the single-file registry. */
type ProfileJsonName = 'profiles.json';
export type JsonRead = { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'corrupt' };
/** Normalizer result. `changed` drives the self-heal write-back; `newer` marks a
 *  payload whose data-schema version is ahead of this build — the store maps it
 *  to the corrupt path (empty default + warn-once, file never overwritten). */
export type NormalizedValue<T> = { value: T; changed: boolean; newer?: boolean };

// Bundled schemas seeded into .hexscope/schemas/; writeJson injects a
// $schema sibling pointing here for AI-agent discovery.
const SCHEMA_FILES: ReadonlyArray<{ file: ProfileJsonName | 'structs.json' | 'bindings.json'; schema: string }> = [
    { file: 'profiles.json', schema: 'profiles.schema.json' },
    { file: 'structs.json', schema: 'structs.schema.json' },
    { file: 'bindings.json', schema: 'bindings.schema.json' },
];

// ── Three-tier domain types ──────────────────────────────────────

/** A named annotation bundle (structPins/checks/endian/labels/segmentNames). Not file-owned. */
export interface ProfileRecord {
    id: string;
    name: string;
    structPins: StructPin[];
    activeChecks: IntegrityCheckSet;
    endian: HexScopeEndian;
    /** Global bit-field allocation (LSB-first / MSB-first) for this profile's struct decode. */
    bitAllocation: BitFieldAllocation;
    /** Global "show hidden fields" toggle for the Struct Instances view. Default false. */
    showHiddenFields: boolean;
    segmentNames: SegmentNameOverrides;
    labels: SegmentLabel[];
}

/** One entry per file that has a bound profile. */
export interface Binding {
    fileKey: string;   // workspace-relative posix path
    profileId: string;
}

/** Root path helpers. */
export function hexScopeSchemasDir(root: string): string {
    return path.join(root, SCHEMA_DIR);
}

export function profilesJsonUri(root: string): vscode.Uri {
    return vscode.Uri.file(path.join(root, '.hexscope', PROFILES_FILE));
}

export function bindingsJsonUri(root: string): vscode.Uri {
    return vscode.Uri.file(path.join(root, '.hexscope', BINDINGS_FILE));
}

export function structPoolJsonUri(root: string): vscode.Uri {
    return vscode.Uri.file(path.join(root, '.hexscope', STRUCT_POOL_FILE));
}

export function emptyProfileRecord(id: string, name: string): ProfileRecord {
    return { id, name, structPins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le', bitAllocation: 'msb', showHiddenFields: false, segmentNames: {}, labels: [] };
}

// ── Version envelope ──────────────────────────────────────────────

export function withEnvelope(payload: unknown): unknown {
    return { version: DATA_VERSION, data: payload };
}

/** Unwrap the version envelope. null = unknown version (refused, corrupt path).
    Unversioned payloads (bare object/array) are accepted as current version. */
export function unwrapEnvelope(raw: unknown): unknown | null {
    if (!isEnvelopeCandidate(raw)) { return null; }
    const candidate = raw as { version?: unknown; data?: unknown };
    if (candidate.version === undefined) { return raw; }
    return candidate.version === DATA_VERSION ? candidate.data : null;
}

function isEnvelopeCandidate(raw: unknown): boolean {
    return raw !== null && typeof raw === 'object';
}

// ── I/O primitives (vscode.workspace.fs) ──────────────────────────

/**
 * Read + unwrap a JSON file. `corrupt` covers read failures (non-ENOENT),
 * JSON parse failures, and unknown envelope versions. Never seeds gitignore.
 */
export async function readJson(uri: vscode.Uri): Promise<JsonRead> {
    const bytes = await readFileBytes(uri);
    if (bytes.status !== 'ok') { return { status: bytes.status }; }
    const parsed = parseJson(bytes.bytes);
    if (parsed === undefined) { return { status: 'corrupt' }; }
    return dataToRead(unwrapEnvelope(parsed));
}

async function readFileBytes(uri: vscode.Uri): Promise<{ status: 'ok'; bytes: Uint8Array } | { status: 'missing' | 'corrupt' }> {
    try {
        return { status: 'ok', bytes: await vscode.workspace.fs.readFile(uri) };
    } catch (error) {
        return { status: isEnoent(error) ? 'missing' : 'corrupt' };
    }
}

function parseJson(bytes: Uint8Array): unknown | undefined {
    try {
        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch {
        return undefined;
    }
}

function dataToRead(data: unknown | null): JsonRead {
    return data === null ? { status: 'corrupt' } : { status: 'ok', value: data };
}

export async function writeJson(uri: vscode.Uri, value: unknown): Promise<void> {
    await ensureParentDir(uri);
    const schemaRef = resolveProfileSchemaRef(uri);
    const payload = schemaRef ? withSchemaSibling(value, schemaRef) : value;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(payload, null, 2)));
    await refreshSchemaCopiesAfterWrite(uri);
}

/** Best-effort schema-copy refresh after a .hexscope data write. Recursion
 *  invariant: the copies live in `.hexscope/schemas/`, so
 *  `hexScopeRootFromDataUri` returns null for them — writing a copy never
 *  re-triggers the refresh. */
async function refreshSchemaCopiesAfterWrite(uri: vscode.Uri): Promise<void> {
    const root = hexScopeRootFromDataUri(uri);
    if (root === null) { return; }
    try {
        await seedSchemaCopies(root);
    } catch {
        // Tooling-only copies: a refresh failure never fails the data write.
    }
}

/** Keep an existing `$schema` sibling; otherwise inject the canonical one. */
function withSchemaSibling(value: unknown, ref: string): unknown {
    if (!isObject(value) || !('data' in value)) { return value; }
    const sibling = (value as { $schema?: unknown }).$schema;
    return { ...value, $schema: typeof sibling === 'string' ? sibling : ref };
}

/** Write only when the file does not already exist (keep a committed copy). */
export async function writeIfMissing(uri: vscode.Uri, value: unknown): Promise<void> {
    if ((await readJson(uri)).status !== 'missing') { return; }
    await writeJson(uri, value);
}

async function ensureParentDir(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
}

function isEnoent(error: unknown): boolean {
    if (!isObject(error)) { return false; }
    // VS Code's FileSystemError surfaces missing files as 'EntryNotFound'
    // (node fs writes 'ENOENT' instead); a string match guards the wrapped
    // remote/disk variants where `code` is not populated.
    return isMissingCode(error) || isMissingText(String(error));
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isMissingCode(error: Record<string, unknown>): boolean {
    return error.code === 'ENOENT' || error.code === 'EntryNotFound';
}

function isMissingText(message: string): boolean {
    return message.includes('EntryNotFound') || message.includes('ENOENT');
}

// ── Root / relative path resolution ───────────────────────────────

/** Workspace folder of the document, else its directory (single-file open). */
export function resolveHexScopeRoot(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? folder.uri.fsPath : path.dirname(uri.fsPath);
}

/** Workspace-relative path with posix separators; the lookup key for a profile. */
export function perFileRelativePath(root: string, uri: vscode.Uri): string {
    return path.relative(root, uri.fsPath).split(path.sep).join('/');
}

/** Root of a top-level `.hexscope` data file, else null. Schema copies (and
 *  any nested path) return null, so the post-write refresh cannot recurse. */
function hexScopeRootFromDataUri(uri: vscode.Uri): string | null {
    if (!isTopLevelDataFile(path.basename(uri.fsPath))) { return null; }
    const hsDir = path.dirname(uri.fsPath);
    return path.basename(hsDir) === '.hexscope' ? path.dirname(hsDir) : null;
}

function isTopLevelDataFile(file: string): boolean {
    return file === PROFILES_FILE || file === STRUCT_POOL_FILE || file === BINDINGS_FILE;
}

/** Read a directory; [] when it does not exist (shared by session + migration). */
export async function readDirectorySafe(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
        return await vscode.workspace.fs.readDirectory(uri);
    } catch {
        return [];
    }
}

// ── Single-file profile registry (.hexscope/profiles.json) ─────────
// All profiles live in one array. Reads scan the array; writes are
// read-modify-write on the single file. No-per-profile directories.

/** Every profile record in the registry array (normalized). A newer-version
 *  file resolves to [] (forward-only: never downgraded; the store warns). */
export async function collectProfileRecords(root: string): Promise<ProfileRecord[]> {
    const read = await readJson(profilesJsonUri(root));
    if (read.status !== 'ok') { return []; }
    const payload = migratedPayload(read.value, 'records');
    return payload === null ? [] : normalizeProfilesRegistry(payload).value;
}

/** Registry array for a read-modify-write: `newer` means the file is ahead of
 *  this build and the caller must not write it back (R4 forward-only). */
async function recordsForWrite(root: string): Promise<{ records: ProfileRecord[]; newer: boolean }> {
    const read = await readPayloadForWrite(profilesJsonUri(root), 'records');
    return read.status === 'newer'
        ? { records: [], newer: true }
        : { records: normalizeProfilesRegistry(read.payload).value, newer: false };
}

/** Read one registry profile record; null when missing. */
export async function readProfileRecord(root: string, profileId: string): Promise<ProfileRecord | null> {
    const records = await collectProfileRecords(root);
    return records.find(rec => rec.id === profileId) ?? null;
}

/** Upsert one record into the registry array (read-modify-write). The write
 *  itself refreshes the .hexscope/schemas copies (see writeJson). */
export async function writeProfileRecord(root: string, rec: ProfileRecord): Promise<void> {
    const uri = profilesJsonUri(root);
    const { records, newer } = await recordsForWrite(root);
    if (newer) { return; }   // forward-only: never clobber a newer file
    const idx = records.findIndex(r => r.id === rec.id);
    const next = idx >= 0 ? records.map(r => (r.id === rec.id ? rec : r)) : [...records, rec];
    await writeJson(uri, withEnvelope(withDataEnvelope('records', normalizeProfilesRegistry(next).value)));
}

/** Remove a profile record from the registry array (no-op when absent). */
export async function removeProfileRecord(root: string, profileId: string): Promise<void> {
    const { records, newer } = await recordsForWrite(root);
    if (newer) { return; }   // forward-only: never clobber a newer file
    const next = records.filter(r => r.id !== profileId);
    if (next.length === records.length) { return; }
    await writeJson(profilesJsonUri(root), withEnvelope(withDataEnvelope('records', normalizeProfilesRegistry(next).value)));
}

/** Rename one profile record in the registry array (created when missing). */
export async function renameProfileRecord(root: string, profileId: string, name: string): Promise<void> {
    await writeProfileRecord(root, {
        ...((await readProfileRecord(root, profileId)) ?? emptyProfileRecord(profileId, name)),
        name,
    });
}

/** Next ordinal id for a new profile, scanning the registry array. */
export async function nextProfileOrdinal(root: string): Promise<number> {
    const used = new Set(
        (await collectProfileRecords(root))
            .map(rec => rec.id)
            .filter(id => /^profile_\d+$/.test(id)),
    );
    let id = 1;
    while (used.has(`profile_${id}`)) { id++; }
    return id;
}

/** Collect the registry records merged with any legacy per-dir records, or
 *  `null` when the file is newer than the build (forward-only → no write). */
async function mergedLegacyRecords(root: string): Promise<{ current: ProfileRecord[]; merged: ProfileRecord[] } | null> {
    const read = await readPayloadForWrite(profilesJsonUri(root), 'records');
    if (read.status === 'newer') { return null; }
    const current = normalizeProfilesRegistry(read.payload).value;
    const container = vscode.Uri.file(path.join(root, '.hexscope', 'profiles'));
    const merged: ProfileRecord[] = [...current];
    for (const entry of await readDirectorySafe(container)) {
        const rec = await readLegacyDirRecord(container, entry);
        if (rec) { merged.push(rec); }
    }
    return { current, merged };
}

/** One-time merge of the per-directory registry (.hexscope/profiles/<id>/profile.json)
 *  into the single-file registry array. Idempotent: existing records win on
 *  duplicate id / case-insensitive name; the dir tree is left in place for
 *  rollback (the marker lives in hexScopeMigration). A newer-version file is
 *  never rewritten (forward-only). */
export async function migrateLegacyProfileDirs(root: string): Promise<void> {
    const collected = await mergedLegacyRecords(root);
    if (collected === null) { return; }
    const normalized = normalizeProfilesRegistry(collected.merged);
    if (registryChanged(normalized.value, collected.current)) {
        await writeJson(profilesJsonUri(root), withEnvelope(withDataEnvelope('records', normalized.value)));
    }
}

async function readLegacyDirRecord(container: vscode.Uri, entry: [string, vscode.FileType]): Promise<ProfileRecord | null> {
    const [dirName, type] = entry;
    if (type !== vscode.FileType.Directory) { return null; }
    const read = await readJson(vscode.Uri.file(path.join(container.fsPath, dirName, 'profile.json')));
    if (read.status !== 'ok') { return null; }
    const rec = normalizeProfileRecord(read.value, emptyProfileRecord(dirName, dirName)).value;
    return rec.id !== '' ? rec : { ...rec, id: dirName };
}

function registryChanged(next: ProfileRecord[], current: ProfileRecord[]): boolean {
    return next.length !== current.length || JSON.stringify(next) !== JSON.stringify(current);
}

/** Refresh .hexscope/schemas with the bundled schema copies (content-diff):
 *  each copy is written only when missing or its parsed content differs from
 *  the bundled schema. Returns the schema names actually (re)written. */
export async function seedSchemaCopies(root: string): Promise<string[]> {
    const written: string[] = [];
    for (const { schema } of SCHEMA_FILES) {
        const bundled = bundledSchema(schema);
        if (bundled === undefined) { continue; }
        const uri = vscode.Uri.file(path.join(hexScopeSchemasDir(root), schema));
        if (await schemaCopyDiffers(uri, bundled)) {
            await writeJson(uri, bundled);
            written.push(schema);
        }
    }
    return written;
}

/** Compare the parsed on-disk copy with the bundled value using the same
 *  pretty shape writeJson emits, so whitespace/key-order noise is not a diff. */
async function schemaCopyDiffers(uri: vscode.Uri, bundled: unknown): Promise<boolean> {
    const onDisk = await readJson(uri);
    return onDisk.status !== 'ok'
        || JSON.stringify(onDisk.value, null, 2) !== JSON.stringify(bundled, null, 2);
}

/** Relative $schema path from a storage file to .hexscope/schemas/, or null. */
function resolveProfileSchemaRef(uri: vscode.Uri): string | null {
    const file = path.basename(uri.fsPath);
    const match = SCHEMA_FILES.find(entry => entry.file === file);
    if (!match) { return null; }
    // .hexscope/profiles.json → schemas/profiles.schema.json
    // .hexscope/structs.json → schemas/structs.schema.json
    // .hexscope/bindings.json → schemas/bindings.schema.json
    return schemaRefForParts(uri.fsPath.split(path.sep), match.schema);
}

function schemaRefForParts(parts: string[], schema: string): string | null {
    const hs = parts.indexOf('.hexscope');
    if (hs < 0) { return null; }
    const afterHs = parts.slice(hs + 1);
    if (isTopLevelSchemaPath(afterHs)) { return `schemas/${schema}`; }
    return null;
}

function isTopLevelSchemaPath(afterHs: string[]): boolean {
    return afterHs.length === 1 && isTopLevelDataFile(afterHs[0]);
}

/** Read a bundled schema from the extension's own install dir (out/ or dist/ → ../schemas). */
function bundledSchema(name: string): unknown {
    try {
        return JSON.parse(readFileSync(path.resolve(__dirname, '..', 'schemas', name), 'utf8'));
    } catch {
        return undefined;
    }
}

// ── Profile record normalization ─────────────────────────────────

function normalizeProfileRecord(raw: unknown, fallback: ProfileRecord): NormalizedValue<ProfileRecord> {
    const candidate = plainObject(raw);
    if (!candidate) { return { value: fallback, changed: false }; }
    const value: ProfileRecord = {
        id: typeof candidate.id === 'string' ? candidate.id : fallback.id,
        name: typeof candidate.name === 'string' ? candidate.name : fallback.name,
        labels: arrayOrEmpty(candidate.labels, []) as SegmentLabel[],
        segmentNames: plainStringRecord(candidate.segmentNames),
        structPins: candidateStructPins(candidate),
        activeChecks: checkSetOrDefault(candidate.activeChecks),
        endian: endianOrDefault(candidate.endian),
        bitAllocation: bitAllocationOrDefault(candidate.bitAllocation),
        showHiddenFields: showHiddenFieldsOrDefault(candidate.showHiddenFields),
    };
    return { value, changed: JSON.stringify(raw) !== JSON.stringify(value) };
}

/** Read the structPins field; tolerate the pre-rename `pins` key on existing files. */
function candidateStructPins(candidate: Record<string, unknown>): StructPin[] {
    return arrayOrEmpty(candidate.structPins ?? candidate.pins, []) as StructPin[];
}

/** Normalize the whole registry array: drop malformed records, dedupe by
 *  id, drop case-insensitive duplicate names, preserve order. */
export function normalizeProfilesRegistry(raw: unknown): NormalizedValue<ProfileRecord[]> {
    if (!Array.isArray(raw)) { return { value: [], changed: false }; }
    const records = dedupeProfileRecords(raw.map(entry => normalizeProfileRecord(entry, emptyProfileRecord('', '')).value));
    return { value: records, changed: JSON.stringify(raw) !== JSON.stringify(records) };
}

function dedupeProfileRecords(records: ProfileRecord[]): ProfileRecord[] {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const out: ProfileRecord[] = [];
    for (const rec of records) {
        if (!isAddable(rec, seenIds, seenNames)) { continue; }
        seenIds.add(rec.id);
        seenNames.add(rec.name.toLowerCase());
        out.push(rec);
    }
    return out;
}

function isAddable(rec: ProfileRecord, seenIds: Set<string>, seenNames: Set<string>): boolean {
    return rec.id !== '' && !seenIds.has(rec.id) && !seenNames.has(rec.name.toLowerCase());
}

function checkSetOrDefault(value: unknown): IntegrityCheckSet {
    return normalizeIntegrityCheckSet(value) ?? { schemaVersion: 1, checks: [] };
}

// ── Per-file store slot ───────────────────────────────────────────

export interface JsonStoreOptions<T> {
    uri: vscode.Uri;
    normalizer: (raw: unknown) => NormalizedValue<T>;
    empty: () => T;
    /** Data-schema payload key: when set, `commitWrite` stamps the cache as
     *  `{ schemaVersion, <key>: cache }` inside `data` (see `withDataEnvelope`). */
    payloadKey?: DataPayloadKey;
    debounceMs?: number;
    onSelfWrite?: () => void;
    onReload?: (value: T) => void;
    /** Deferred profile dir: when set the store starts in-memory (reads return
     *  `empty()`, no fs access) and materializes on first write. `null` from
     *  the resolver keeps the write in-memory (no disk) — used for
     *  out-of-workspace files until an explicit save/profile action. */
    lazyDir?: () => Promise<string | null>;
}

/**
 * One cached JSON slot with a per-slot debounced write (default 400 ms).
 * Corrupt/unknown-version files load the empty default, warn once, and are
 * never overwritten; self-heal write-back runs only when parse is OK and the
 * normalized output differs.
 */
export class JsonStore<T> {
    private cache: T | null = null;
    private writeTimer: ReturnType<typeof setTimeout> | undefined;
    private reloadTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingWrite = false;
    private warned = false;
    private disposed = false;
    private resolvedDir: string | null = null;
    private resolvingDir: Promise<string | null> | null = null;

    constructor(private readonly options: JsonStoreOptions<T>) {}

    /** Slot file name; derived from the initial uri basename so the
     *  same slot name survives lazy-dir materialization. */
    private name(): string {
        return path.basename(this.options.uri.fsPath);
    }

    /** Resolve the lazy dir once; null stays deferred (retried on next write
     *  so an explicit save can materialize later). Single-flight per store. */
    private async lazyDir(): Promise<string | null> {
        if (!this.options.lazyDir) { return null; }
        if (this.resolvedDir !== null) { return this.resolvedDir; }
        if (this.resolvingDir === null) {
            this.resolvingDir = this.options.lazyDir().then(dir => {
                this.resolvedDir = dir;
                return dir;
            }).finally(() => {
                this.resolvingDir = null;
            });
        }
        return this.resolvingDir;
    }

    private readUri(): vscode.Uri {
        return this.resolvedDir !== null ? vscode.Uri.file(path.resolve(this.resolvedDir, this.name())) : this.options.uri;
    }

    /** Uri to write; null when deferred and the dir resolver declined (stay in-memory). */
    private async writeUri(): Promise<vscode.Uri | null> {
        if (!this.options.lazyDir) { return this.options.uri; }
        const dir = await this.lazyDir();
        // Resolve to an absolute path: a bare relative resolver result (e.g. a
        // profile id) must never collapse to a filesystem-root Uri (Uri.file
        // interprets an unqualified path as absolute, so path.join('profile_1', …)
        // becomes file:///profile_1/… on POSIX → EACCES mkdir '/profile_1').
        return dir === null ? null : vscode.Uri.file(path.resolve(dir, this.name()));
    }

    async load(force = false): Promise<T> {
        if (this.hasCached(force)) { return this.cache as T; }
        if (this.isDeferred()) {
            // Deferred mode: no directory exists yet, so no fs access.
            this.cache = this.options.empty();
            return this.cache;
        }
        const read = await readJson(this.readUri());
        this.cache = await this.applyRead(read);
        return this.cache;
    }

    private hasCached(force: boolean): boolean {
        return !force && this.cache !== null;
    }

    private isDeferred(): boolean {
        return !!this.options.lazyDir && this.resolvedDir === null;
    }

    private async applyRead(read: JsonRead): Promise<T> {
        return read.status === 'ok' ? this.applyOk(read.value) : this.applyFallback(read.status);
    }

    private async applyOk(raw: unknown): Promise<T> {
        const normalized = this.options.normalizer(raw);
        // A payload newer than this build reuses the corrupt path: empty default
        // + warn-once, never overwritten (forward-only; no downgrade).
        if (normalized.newer) { return this.applyFallback('corrupt'); }
        this.cache = normalized.value;
        if (normalized.changed) { await this.writeNow(); }
        return this.cache;
    }

    private applyFallback(status: 'missing' | 'corrupt'): T {
        if (status === 'corrupt') { this.warnCorrupt(); }
        this.cache = this.options.empty();
        return this.cache;
    }

    get(): T | null {
        return this.cache;
    }

    set(next: T): void {
        this.cache = next;
        this.pendingWrite = true;
        if (this.writeTimer !== undefined) { clearTimeout(this.writeTimer); }
        this.writeTimer = setTimeout(() => {
            this.writeTimer = undefined;
            void this.writeNow();
        }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    }

    /** Write now (envelope), clear the write timer, mark self-write. */
    async flush(): Promise<void> {
        if (this.writeTimer !== undefined) { clearTimeout(this.writeTimer); this.writeTimer = undefined; }
        if (this.pendingWrite) { await this.writeNow(); }
    }

    /** Debounced watcher hook: re-read + re-normalize, then notify onReload. */
    scheduleReload(ms: number = this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS): void {
        if (this.reloadTimer !== undefined) { clearTimeout(this.reloadTimer); }
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined;
            void this.reload();
        }, ms);
    }

    async reload(): Promise<T> {
        const value = await this.load(true);
        this.options.onReload?.(value);
        return value;
    }

    dispose(flushPending = true): void {
        if (this.disposed) { return; }
        this.disposed = true;
        this.clearTimers();
        if (this.shouldFlushNow(flushPending)) {
            void this.writePendingNow();
        }
    }

    private shouldFlushNow(flushPending: boolean): boolean {
        return flushPending && this.pendingWrite && this.cache !== null;
    }

    private clearTimers(): void {
        if (this.writeTimer !== undefined) { clearTimeout(this.writeTimer); this.writeTimer = undefined; }
        if (this.reloadTimer !== undefined) { clearTimeout(this.reloadTimer); this.reloadTimer = undefined; }
    }

    private async writePendingNow(): Promise<void> {
        await this.commitWrite();
    }

    private async writeNow(): Promise<void> {
        if (this.writable()) { await this.commitWrite(); }
    }

    private writable(): boolean {
        return !this.disposed && this.cache !== null;
    }

    /** Shared write tail: envelope + self-write stamp + debounced-dir resolve. */
    private async commitWrite(): Promise<void> {
        if (this.cache === null) { return; }
        this.pendingWrite = false;
        this.options.onSelfWrite?.();
        const uri = await this.writeUri();
        if (uri === null) { return; }
        await writeJson(uri, withEnvelope(this.payload()));
    }

    /** The `data` payload: stamped with the data-schema version when the slot
     *  owns one (`payloadKey`), else the cache verbatim. */
    private payload(): unknown {
        const key = this.options.payloadKey;
        return key ? withDataEnvelope(key, this.cache) : this.cache;
    }

    private warnCorrupt(): void {
        if (this.warned) { return; }
        this.warned = true;
        console.warn(
            `HexScope: ${this.options.uri.fsPath} is corrupt or has an unknown version; ` +
            'loading empty defaults. The file was left untouched.',
        );
    }
}

// ── Profile watcher ───────────────────────────────────────────────

export interface ProfileWatcherOptions {
    root: string;
    onProfileChanged: () => void;
}

/**
 * Watch the three-tier storage (struct pool, profile registry, bindings)
 * so an external restructure is picked up. The session owns the
 * self-write horizon and the debounced per-slot reload.
 */
export function attachProfileWatcher(options: ProfileWatcherOptions): vscode.Disposable {
    const watchers = [
        // profile registry, struct pool + bindings table
        vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(options.root, `.hexscope/${PROFILES_FILE}`)),
        vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(options.root, `.hexscope/${STRUCT_POOL_FILE}`)),
        vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(options.root, `.hexscope/${BINDINGS_FILE}`)),
    ];
    const notify = () => options.onProfileChanged();
    for (const watcher of watchers) {
        watcher.onDidChange(notify);
        watcher.onDidCreate(notify);
        watcher.onDidDelete(notify);
    }
    return { dispose: () => { for (const watcher of watchers) { watcher.dispose(); } } };
}

// ── Binding table helpers ─────────────────────────────────────────

export function normalizeBindings(raw: unknown): NormalizedValue<Binding[]> {
    // Accept the legacy bare array or the versioned object form; a newer-than-build
    // payload resolves to [] and carries `newer` (forward-only — never written back).
    const migrated = migrateData(raw, 'bindings');
    if (migrated.status === 'newer') { return { value: [], changed: false, newer: true }; }
    const payload = migrated.value.bindings;
    if (!Array.isArray(payload)) { return { value: [], changed: false }; }
    const value: Binding[] = payload.map(bindingFromEntry).filter((b): b is Binding => isBinding(b));
    // Rewrite when the payload differs OR the carrier/version is not yet stamped.
    const changed = JSON.stringify(raw) !== JSON.stringify(withDataEnvelope('bindings', value));
    return { value, changed };
}

function bindingFromEntry(entry: unknown): Binding | null {
    const o = plainObject(entry);
    if (!o) { return null; }
    return {
        fileKey: stringOrEmpty(o.fileKey),
        profileId: stringOrEmpty(o.profileId),
    };
}

function isBinding(b: Binding | null): b is Binding {
    return b !== null && b.fileKey.length > 0 && b.profileId.length > 0;
}

