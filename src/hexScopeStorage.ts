// ── .hexscope firmware-profile storage (host adapter) ─────────────
// Single owner of .hexscope/ I/O. No Memento access here; normalizers
// are passed in per slot. src/core must not import vscode — this file
// sits at the top level exactly because it is a host adapter.

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { normalizeIntegrityCheckSet, type IntegrityCheckSet } from './core/integrity';
import type { SegmentLabel, StructPin } from './core/types';
import { endianOrDefault, type HexScopeEndian, type SegmentNameOverrides } from './webviewProtocol';

/** Current schema version of every profile file. A future/unknown version is refused on read. */
export const DATA_VERSION = 1;

const DEFAULT_DEBOUNCE_MS = 400;
const PROFILE_CONTAINER = '.hexscope/firmware_profiles';
const SCHEMA_DIR = '.hexscope/schemas';

export type ProfileJsonName = 'index.json' | 'structs.json' | 'integrity.json';
export type JsonRead = { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'corrupt' };
export type NormalizedValue<T> = { value: T; changed: boolean };

// The three bundled JSON Schemas; a workspace copy is seeded into .hexscope/schemas/
// and each profile file carries the matching $schema sibling for AI-agent discovery.
const SCHEMA_FILES: ReadonlyArray<{ file: ProfileJsonName; schema: string }> = [
    { file: 'index.json', schema: 'index.schema.json' },
    { file: 'structs.json', schema: 'structs.schema.json' },
    { file: 'integrity.json', schema: 'integrity.schema.json' },
];

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
    const schemaRef = profileSchemaRef(uri);
    const payload = schemaRef ? withSchemaSibling(value, schemaRef) : value;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(payload, null, 2)));
}

/** Keep an existing `$schema` sibling; otherwise inject the canonical one. */
function withSchemaSibling(value: unknown, ref: string): unknown {
    if (!isObject(value) || !('data' in value)) { return value; }
    const sibling = (value as { $schema?: unknown }).$schema;
    return { ...value, $schema: typeof sibling === 'string' ? sibling : ref };
}

/** Write only when the file does not already exist. Used by migration seeding. */
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

export function hexScopeProfilesDir(root: string): string {
    return path.join(root, PROFILE_CONTAINER);
}

export function hexScopeSchemasDir(root: string): string {
    return path.join(root, SCHEMA_DIR);
}

/** Relative posix path from a profile file to its .hexscope/schemas copy, or null outside a profile dir. */
function profileSchemaRef(uri: vscode.Uri): string | null {
    const parts = uri.fsPath.split(path.sep);
    const file = SCHEMA_FILES.find(entry => entry.file === parts[parts.length - 1]);
    return isProfileFile(parts) && file ? `../../schemas/${file.schema}` : null;
}

function isProfileFile(parts: string[]): boolean {
    const hs = parts.indexOf('.hexscope');
    return hs >= 0 && parts[hs + 1] === 'firmware_profiles' && parts[hs + 2] !== undefined;
}

function profileDir(root: string, id: string): string {
    return path.join(hexScopeProfilesDir(root), id);
}

export function profileJsonUri(dir: string, name: ProfileJsonName): vscode.Uri {
    return vscode.Uri.file(path.join(dir, name));
}

// ── Profile lookup / creation ─────────────────────────────────────

/** Scan profiles dir; relPath in index.json is the source of truth (dir name is cosmetic). */
export async function findProfile(root: string, relPath: string): Promise<string | null> {
    for (const [name, type] of await listProfiles(root)) {
        if (type !== vscode.FileType.Directory) { continue; }
        if (await profileHasRelPath(root, name, relPath)) { return profileDir(root, name); }
    }
    return null;
}

async function listProfiles(root: string): Promise<[string, vscode.FileType][]> {
    const container = vscode.Uri.file(hexScopeProfilesDir(root));
    try {
        return await vscode.workspace.fs.readDirectory(container);
    } catch {
        return [];
    }
}

async function profileHasRelPath(root: string, name: string, relPath: string): Promise<boolean> {
    const index = await readJson(profileJsonUri(profileDir(root, name), 'index.json'));
    if (index.status !== 'ok') { return false; }
    return indexDataRelPath(index.value) === relPath;
}

function indexDataRelPath(value: unknown): string | null {
    if (value === null || typeof value !== 'object') { return null; }
    const relPath = (value as { relPath?: unknown }).relPath;
    return typeof relPath === 'string' ? relPath : null;
}

/** Create just the (ordinal-named) profile directory; no index write. Migration uses this. */
export async function createProfileDir(root: string): Promise<string> {
    const container = vscode.Uri.file(hexScopeProfilesDir(root));
    await vscode.workspace.fs.createDirectory(container);
    const entries = await vscode.workspace.fs.readDirectory(container);
    const used = new Set(entries.filter(([, type]) => type === vscode.FileType.Directory).map(([name]) => name));
    let id = 1;
    while (used.has(`profiles_${id}`)) { id++; }
    const dir = profileDir(root, `profiles_${id}`);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    return dir;
}

/** Create a profile dir and seed index.json with the relPath + empty defaults. */
export async function createProfile(root: string, relPath: string): Promise<string> {
    const dir = await createProfileDir(root);
    await seedSchemaCopies(root);
    await writeJson(profileJsonUri(dir, 'index.json'), withEnvelope(emptyIndexData(relPath)));
    return dir;
}

/** Seed .hexscope/schemas with the bundled schema copies (writeIfMissing; watcher ignores this dir). */
export async function seedSchemaCopies(root: string): Promise<void> {
    const dir = vscode.Uri.file(hexScopeSchemasDir(root));
    for (const { schema } of SCHEMA_FILES) {
        const content = bundledSchema(schema);
        if (content === undefined) { continue; }
        await writeIfMissing(vscode.Uri.file(path.join(dir.fsPath, schema)), content);
    }
}

/** Read a bundled schema from the extension's own install dir (out/ or dist/ → ../schemas). */
function bundledSchema(name: string): unknown {
    try {
        return JSON.parse(readFileSync(path.resolve(__dirname, '..', 'schemas', name), 'utf8'));
    } catch {
        return undefined;
    }
}

// ── Index file shape ──────────────────────────────────────────────

export interface IndexFileData {
    relPath: string;
    labels: SegmentLabel[];
    segmentNames: SegmentNameOverrides;
    pins: StructPin[];
    activeChecks: IntegrityCheckSet;
    endian: HexScopeEndian;
}

export function emptyIndexData(relPath: string): IndexFileData {
    return { relPath, labels: [], segmentNames: {}, pins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le' };
}

export function normalizeIndexFile(raw: unknown, fallback: IndexFileData): NormalizedValue<IndexFileData> {
    const candidate = plainObject(raw);
    if (!candidate) { return { value: fallback, changed: false }; }
    const value: IndexFileData = {
        relPath: relPathOr(candidate, fallback),
        labels: arrayOrEmpty(candidate.labels, []) as SegmentLabel[],
        segmentNames: plainStringRecord(candidate.segmentNames),
        pins: arrayOrEmpty(candidate.pins, []) as StructPin[],
        activeChecks: checkSetOrDefault(candidate.activeChecks),
        endian: endianOrDefault(candidate.endian),
    };
    return { value, changed: JSON.stringify(raw) !== JSON.stringify(value) };
}

function relPathOr(candidate: Record<string, unknown>, fallback: IndexFileData): string {
    return typeof candidate.relPath === 'string' ? candidate.relPath : fallback.relPath;
}

function arrayOrEmpty(value: unknown, empty: unknown[]): unknown[] {
    return Array.isArray(value) ? value : empty;
}

function checkSetOrDefault(value: unknown): IntegrityCheckSet {
    return normalizeIntegrityCheckSet(value) ?? { schemaVersion: 1, checks: [] };
}

function plainObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function plainStringRecord(value: unknown): Record<string, string> {
    const raw = plainObject(value);
    if (!raw) { return {}; }
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(raw)) { if (typeof entry === 'string') { out[key] = entry; } }
    return out;
}

// ── Per-file store slot ───────────────────────────────────────────

export interface JsonStoreOptions<T> {
    uri: vscode.Uri;
    normalizer: (raw: unknown) => NormalizedValue<T>;
    empty: () => T;
    debounceMs?: number;
    onSelfWrite?: () => void;
    onReload?: (value: T) => void;
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

    constructor(private readonly options: JsonStoreOptions<T>) {}

    async load(force = false): Promise<T> {
        if (!force && this.cache !== null) { return this.cache; }
        const read = await readJson(this.options.uri);
        this.cache = read.status === 'ok' ? await this.applyOk(read.value) : this.applyFallback(read.status);
        return this.cache;
    }

    private async applyOk(raw: unknown): Promise<T> {
        const normalized = this.options.normalizer(raw);
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
        if (this.cache === null) { return; }
        this.pendingWrite = false;
        this.options.onSelfWrite?.();
        await writeJson(this.options.uri, withEnvelope(this.cache));
    }

    private async writeNow(): Promise<void> {
        if (this.disposed || this.cache === null) { return; }
        this.pendingWrite = false;
        this.options.onSelfWrite?.();
        await writeJson(this.options.uri, withEnvelope(this.cache));
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
 * Watch profile files (index/structs/integrity.json under any profile dir)
 * plus the appearance of profile dirs themselves, so an external
 * firmware_profiles restructure is picked up. The session owns the
 * self-write horizon and the debounced per-slot reload.
 */
export function attachProfileWatcher(options: ProfileWatcherOptions): vscode.Disposable {
    const watchers = [
        vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(options.root, `${PROFILE_CONTAINER}/*/*.json`)),
        vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(options.root, `${PROFILE_CONTAINER}/*`)),
    ];
    const notify = () => options.onProfileChanged();
    for (const watcher of watchers) {
        watcher.onDidChange(notify);
        watcher.onDidCreate(notify);
        watcher.onDidDelete(notify);
    }
    return { dispose: () => { for (const watcher of watchers) { watcher.dispose(); } } };
}