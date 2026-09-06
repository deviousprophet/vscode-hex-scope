import * as crypto from 'crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DisposableStore } from './core/disposableStore';
import { parseIntelHexCompact, parseIntelHexLine } from './core/parser/intelHexParser';
import { parseSRecCompact, parseSRecRecordLine } from './core/parser/srecParser';
import type { ParseResult, MemorySegment } from './core/parser/types';
import type { CompactParseResult } from './core/parser/compact';
import type { SegmentLabel, SerializedRecord, StructDef, StructPin, WireParseResult } from './core/types';
import { buildSplicePlan, detectFormatFromParts, repairChecksums, type HexScopeFormat, type SplicePatch, type SplicePlan } from './core/document';
import {
    normalizeIntegrityCheckSet,
} from './core/integrity';
import { migrateStructDefinitions } from './core/structMigration';
import { normalizeStructDefsValue } from './core/structNormalization';
import {
    messageType,
    RECORD_PAGE_SIZE,
    type ProviderToWebviewMessage,
    type WebviewToProviderMessage,
} from './webviewProtocol';
import {
    attachProfileWatcher,
    bindingsJsonUri,
    collectProfileRecords,
    emptyProfileRecord,
    nextProfileOrdinal,
    normalizeBindings,
    normalizeProfilesRegistry,
    perFileRelativePath,
    profilesJsonUri,
    readJson,
    readProfileRecord,
    removeProfileRecord,
    resolveHexScopeRoot,
    structPoolJsonUri,
    withEnvelope,
    writeJson,
    writeProfileRecord,
    type Binding,
    type ProfileRecord,
    JsonStore,
} from './hexScopeStorage';
import { migrateLegacyData } from './hexScopeMigration';

import { scanScripts, execute } from './core/scripting/scriptRunner';
import { VSCodeScriptHost } from './scriptHost';

function hasParseErrors(result: Pick<ParseResult, 'checksumErrors' | 'malformedLines'>): boolean {
    return result.checksumErrors > 0 || result.malformedLines > 0;
}

function serializeRecord(record: ParseResult['records'][number]): SerializedRecord {
    return {
        lineNumber: record.lineNumber,
        raw: record.raw,
        byteCount: record.byteCount,
        address: record.address,
        recordType: record.recordType,
        data: Array.from(record.data),
        checksum: record.checksum,
        checksumValid: record.checksumValid,
        resolvedAddress: record.resolvedAddress,
        error: record.error,
    };
}

function materializeParseResult(result: CompactParseResult, source: string, format: HexScopeFormat): ParseResult {
    const parseLine = format === 'srec' ? parseSRecRecordLine : parseIntelHexLine;
    const records = Array.from({ length: result.records.length }, (_, index) => result.records.materialize(index, source, parseLine));
    return {
        records,
        segments: result.segments,
        totalDataBytes: result.totalDataBytes,
        checksumErrors: result.checksumErrors,
        malformedLines: result.malformedLines,
        startAddress: result.startAddress,
    };
}

/** Apply a save's edits to the in-memory segment bytes (no reparse). */
function foldEditsIntoSegments(segments: MemorySegment[], editMap: Map<number, number>): void {
    for (const [addr, value] of editMap) { patchSegmentsAt(segments, addr, value); }
}

function patchSegmentsAt(segments: MemorySegment[], addr: number, value: number): void {
    for (const seg of segments) {
        const off = addr - seg.startAddress;
        if (off >= 0 && off < seg.data.length) { seg.data[off] = value; return; }
    }
}

/** Write only the edited byte ranges into the file (positional save). */
async function writeSplices(uri: vscode.Uri, patches: SplicePatch[]): Promise<void> {
    const fh = await fs.promises.open(uri.fsPath, 'r+');
    try {
        for (const patch of patches) {
            const buf = Buffer.from(patch.bytes.buffer, patch.bytes.byteOffset, patch.bytes.byteLength);
            await fh.write(buf, 0, buf.length, patch.offset);
        }
    } finally {
        await fh.close();
    }
}

/** Positional write when the plan allows it; whole-file write otherwise (fallback safe). */
async function writePlanToFile(uri: vscode.Uri, plan: SplicePlan): Promise<void> {
    if (plan.patches) {
        try {
            await writeSplices(uri, plan.patches);
            return;
        } catch { /* positional write failed → whole-file fallback below */ }
    }
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(plan.newRaw));
}

/** Debounce for profile-registry restructure scans (external rename/create). */
const PROFILE_CHANGE_DEBOUNCE_MS = 400;

async function postToWebview(webview: vscode.Webview, msg: ProviderToWebviewMessage): Promise<boolean> {
    return webview.postMessage(msg);
}

type IncomingProviderMessage = WebviewToProviderMessage;
type RecordPageRequest = Extract<WebviewToProviderMessage, { type: 'requestRecordPage' }>;

class LoadProgressReporter {
    private lastAt = 0;
    private lastStage = '';
    private pending: ProviderToWebviewMessage | null = null;
    private flushed = false;

    constructor(
        private readonly webview: vscode.Webview,
        private readonly generation: () => number,
    ) {}

    public post(stage: 'read' | 'parse' | 'build' | 'transfer', completed: number, total?: number): void {
        const now = Date.now();
        if (this.isThrottled(stage, completed, total, now)) { return; }
        this.lastAt = now;
        this.lastStage = stage;
        this.pending = { type: 'loadProgress', generation: this.generation(), stage, completed, total };
        if (this.flushed) {
            void postToWebview(this.webview, this.pending);
        }
    }

    public flush(): void {
        if (this.pending) {
            void postToWebview(this.webview, this.pending);
            this.pending = null;
        }
        this.flushed = true;
    }

    private isThrottled(stage: string, completed: number, total: number | undefined, now: number): boolean {
        return stage === this.lastStage && completed !== total && now - this.lastAt < 100;
    }
}

function parseCompactByFormat(source: string, format: HexScopeFormat, options: Parameters<typeof parseIntelHexCompact>[1]): Promise<CompactParseResult> {
    return format === 'srec' ? parseSRecCompact(source, options) : parseIntelHexCompact(source, options);
}

function parseErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Failed to read file.';
}

async function readDocumentSource(
    document: vscode.CustomDocument,
    webview: vscode.Webview,
    generation: number,
    isDisposed: () => boolean,
): Promise<string | null> {
    try {
        return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(document.uri));
    } catch (error) {
        if (!isDisposed()) {
            await postToWebview(webview, { type: 'loadError', generation, message: parseErrorMessage(error) });
        }
        return null;
    }
}

function validRecordPageBounds(start: number, count: number): boolean {
    if (!Number.isInteger(start)) { return false; }
    if (start < 0) { return false; }
    if (start % RECORD_PAGE_SIZE !== 0) { return false; }
    return validRecordPageCount(count);
}

function validRecordPageCount(count: number): boolean {
    return Number.isInteger(count) && count >= 1;
}

async function parseCompactSafely(
    source: string,
    format: HexScopeFormat,
    options: Parameters<typeof parseIntelHexCompact>[1],
    isCancelled: () => boolean,
): Promise<CompactParseResult | null> {
    try {
        return await parseCompactByFormat(source, format, options);
    } catch (error) {
        if (isCancelled()) { return null; }
        throw error;
    }
}

async function redirectInvalidDocument(
    result: CompactParseResult,
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
): Promise<boolean> {
    if (!hasParseErrors(result)) { return false; }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(document.uri), { preview: false });
    panel.dispose();
    return true;
}

async function loadInitialDocument(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
    controller: AbortController,
    generation: number,
    isDisposed: () => boolean,
    onProgress: (progress: { stage: 'parse' | 'build'; completed: number; total: number }) => void,
): Promise<{ source: string; format: HexScopeFormat; result: CompactParseResult } | null> {
    const source = await readDocumentSource(document, panel.webview, generation, isDisposed);
    if (source === null) { return null; }
    if (initialLoadCancelled(isDisposed, token)) { return null; }
    const format = detectFormat(document.uri, source);
    const result = await parseCompactSafely(source, format, { signal: controller.signal, onProgress }, () => controller.signal.aborted || isDisposed());
    if (!result) { return null; }
    return finishInitialDocument(source, format, result, document, panel);
}

function initialLoadCancelled(isDisposed: () => boolean, token: vscode.CancellationToken): boolean {
    return isDisposed() || token.isCancellationRequested;
}

async function finishInitialDocument(
    source: string,
    format: HexScopeFormat,
    result: CompactParseResult,
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
): Promise<{ source: string; format: HexScopeFormat; result: CompactParseResult } | null> {
    if (await redirectInvalidDocument(result, document, panel)) { return null; }
    return { source, format, result };
}

function materializeRecordPage(
    result: CompactParseResult,
    source: string,
    format: HexScopeFormat,
    start: number,
    count: number,
): SerializedRecord[] {
    const parseLine = format === 'srec' ? parseSRecRecordLine : parseIntelHexLine;
    const end = Math.min(result.records.length, start + count);
    const records: SerializedRecord[] = [];
    for (let index = start; index < end; index++) {
        records.push(serializeRecord(result.records.materialize(index, source, parseLine)));
    }
    return records;
}

async function postRecordPage(
    msg: RecordPageRequest,
    result: CompactParseResult | null,
    source: string,
    format: HexScopeFormat,
    currentGeneration: number,
    webview: vscode.Webview,
): Promise<void> {
    if (!result || msg.generation !== currentGeneration) { return; }
    const start = Number(msg.start);
    const count = Math.min(RECORD_PAGE_SIZE, Number(msg.count));
    if (!validRecordPageBounds(start, count)) { return; }
    await postToWebview(webview, {
        type: 'recordPage',
        generation: currentGeneration,
        start,
        records: materializeRecordPage(result, source, format, start, count),
    });
}

export class HexEditorSession {

    private static _activePanel: vscode.WebviewPanel | undefined;
    private static _activeRoot: string | null = null;
    private static _activeRelPath: string | null = null;
    private readonly _panels = new Set<vscode.WebviewPanel>();

    /** Post a message to the currently active HexScope webview, if any. */
    public static postToActive(msg: unknown): void {
        HexEditorSession._activePanel?.webview.postMessage(msg);
    }

    private static activeRoot(): string | null {
        return HexEditorSession._activeRoot;
    }

    /** Refresh the active panel's dropdown from the registry (post CRUD mutations). */
    private static async refreshActiveProfileState(): Promise<void> {
        const root = HexEditorSession._activeRoot;
        const relPath = HexEditorSession._activeRelPath;
        if (!root || !relPath) { return; }
        const all = await listProfiles(root);
        const bound = await boundProfileId(root, relPath);
        const count = bound ? (await bindingsUsing(root, bound)).length : 0;
        HexEditorSession.postToActive({ type: 'profilesState', profiles: all, current: bound, boundFileCount: count });
    }

    /** Focus the active panel's profile dropdown (Command Palette selectProfile). */
    public static async selectProfileCommand(): Promise<void> {
        HexEditorSession.postToActive({ type: 'activateProfilePicker' });
    }

    /** Create a blank profile from a prompt. */
    public static async newProfileCommand(): Promise<void> {
        const root = HexEditorSession.activeRoot();
        if (!root) { return; }
        const name = await vscode.window.showInputBox({
            title: 'New Profile',
            prompt: 'Name for the new annotation profile',
            placeHolder: 'Profile name',
        });
        if (!name || !name.trim()) { return; }
        await createProfileFromName(root, name.trim());
        await HexEditorSession.refreshActiveProfileState();
    }

    /** Deep-copy an existing profile into a new one. */
    public static async duplicateProfileCommand(): Promise<void> {
        const ctx = await HexEditorSession.pickProfileForAction({
            title: 'Duplicate Profile',
            placeHolder: 'Pick the profile to copy',
            emptyMessage: 'HexScope: no profiles to duplicate.',
        });
        if (!ctx) { return; }
        const { root, pick } = ctx;
        const src = await readProfileRecord(root, pick.id);
        if (!src) { return; }
        const newName = await vscode.window.showInputBox({
            title: 'Duplicate Profile',
            prompt: 'Name for the copy',
            value: `${src.name} Copy`,
        });
        const trimmed = trimOrNull(newName);
        if (!trimmed) { return; }
        const id = await createProfileFromName(root, trimmed);
        await writeProfileCopy(root, src, id, trimmed);
        await HexEditorSession.refreshActiveProfileState();
    }

    /** Rename a registry profile. */
    public static async renameProfileCommand(): Promise<void> {
        const ctx = await HexEditorSession.pickProfileForAction({
            title: 'Rename Profile',
            placeHolder: 'Pick the profile to rename',
            emptyMessage: '',
        });
        if (!ctx) { return; }
        const { root, pick } = ctx;
        const rec = await readProfileRecord(root, pick.id);
        const newName = await vscode.window.showInputBox({
            title: 'Rename Profile',
            prompt: 'New name',
            value: renameDefaultValue(rec, pick.label),
        });
        const trimmed = trimOrNull(newName);
        if (!trimmed) { return; }
        await writeProfileName(root, pick.id, rec, pick.label, trimmed);
        await HexEditorSession.refreshActiveProfileState();
    }

    /** Delete a registry profile (bindings to it are cleared; files revert to "No Profile"). */
    public static async deleteProfileCommand(): Promise<void> {
        const ctx = await HexEditorSession.pickProfileForAction({
            title: 'Delete Profile',
            placeHolder: 'Pick the profile to delete',
            emptyMessage: 'HexScope: no profiles to delete.',
        });
        if (!ctx) { return; }
        const { root, pick } = ctx;
        const bound = await bindingsUsing(root, pick.id);
        if (!(await confirmDeleteBoundProfile(pick, bound.length))) { return; }
        await deleteRegistryProfile(root, pick.id);
        await HexEditorSession.refreshActiveProfileState();
    }

    /** Pick an action profile from the registry; null when cancelled or empty. */
    private static async pickProfileForAction(
        options: { title: string; placeHolder: string; emptyMessage: string },
    ): Promise<{ root: string; pick: { id: string; label: string } } | null> {
        const root = HexEditorSession.activeRoot();
        if (!root) { return null; }
        const current = await listProfiles(root);
        if (current.length === 0) { return notifyEmptyProfileList(options.emptyMessage); }
        const pick = await vscode.window.showQuickPick(
            current.map(p => ({ label: p.name, id: p.id })),
            { title: options.title, placeHolder: options.placeHolder },
        );
        return pick ? { root, pick } : null;
    }

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) {}

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        let raw = '';
        let format: HexScopeFormat = 'ihex';
        let parseResult: CompactParseResult | null = null;
        let webviewReady = false;
        let generation = 0;
        let currentGeneration = 0;
        let disposed = false;
        let activeLoad: AbortController | null = new AbortController();
        let currentAbort: AbortController | null = null;
        let pendingExternalReload: { raw: string; parseResult: CompactParseResult; generation: number } | null = null;
        let reloadTimer: ReturnType<typeof setTimeout> | undefined;
        const resources = new DisposableStore();
        resources.add(token.onCancellationRequested(() => activeLoad?.abort()));

        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this._getHtml(webviewPanel.webview, document.uri);
        this._panels.add(webviewPanel);

        let flushProgress: (() => void) | null = null;

        let dispatchIncoming = async (rawMsg: unknown): Promise<void> => {
            if (messageType(rawMsg) === 'ready') {
                flushProgress?.();
                webviewReady = true;
            }
        };
        const incomingDisposable = webviewPanel.webview.onDidReceiveMessage(rawMsg => dispatchIncoming(rawMsg));
        resources.add(incomingDisposable);
        resources.add(() => {
            disposed = true;
            activeLoad?.abort();
            activeLoad = null;
            raw = '';
            parseResult = null;
            pendingExternalReload = null;
            clearTimeout(reloadTimer);
            clearTimeout(profileReloadTimer);
            for (const store of [registryStore, structPoolStore]) { store?.dispose(); }
            this._panels.delete(webviewPanel);
            if (HexEditorSession._activePanel === webviewPanel) {
                HexEditorSession._activePanel = undefined;
            }
        });
        webviewPanel.onDidDispose(() => resources.dispose());

        const progressReporter = new LoadProgressReporter(
            webviewPanel.webview,
            () => generation,
        );
        flushProgress = () => progressReporter.flush();
        const postProgress = progressReporter.post.bind(progressReporter);

        postProgress('read', 0);

        await new Promise<void>(r => setImmediate(r));

        generation++;
        const loadPromise = loadInitialDocument(
            document,
            webviewPanel,
            token,
            activeLoad,
            generation,
            () => disposed,
            progress => postProgress(progress.stage, progress.completed, progress.total),
        ).then(initial => {
            if (!initial) { resources.dispose(); return; }
            ({ source: raw, format, result: parseResult } = initial);
            currentGeneration = generation;
            void postInit();
        }).catch(() => resources.dispose());

        // ── Three-tier .hexscope storage ─────────────────────────────
        // Root matches the scripts convention: workspace folder, else the
        // document's directory. relPath (workspace-relative posix) is the
        // binding key into bindings.json.
        const root = resolveHexScopeRoot(document.uri);
        const relPath = perFileRelativePath(root, document.uri);

        let registryStore: JsonStore<ProfileRecord[]> | null = null;
        let structPoolStore: JsonStore<StructDef[]> | null = null;
        let profileId: string | null = null;
        /** In-memory bound record for an unbound file's staged edits
         *  (out-of-workspace non-explicit writes stay in-memory; explicit
         *  Save materializes + persists them via forceMaterializeOnSave). */
        let boundProfileCache: ProfileRecord | null = null;
        let profileReady: Promise<void> | null = null;
        let profileReloadTimer: ReturnType<typeof setTimeout> | undefined;
        let perFileOp: Promise<unknown> = Promise.resolve();
        /** Set when a struct-deletion decline reverts the webview; the
         *  immediately-following saveStructPins (webview posts it right after
         *  saveStructs) then no-ops so the decline is a true no-write. */
        let structDeletionDeclined = false;

        // ── Deferred profile materialization ──────────────────────────
        // Nothing is written on open: .hexscope/profiles.json is only written
        // on a registry mutation (create/rename/dup/delete via the store) or
        // an explicit profile action. An unbound file's first mutation
        // creates a new profile + binding. Out-of-workspace files stay
        // in-memory (boundProfileCache); explicit actions (newProfile /
        // selectProfile / saveProfile) write directly.
        const hasWorkspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri) !== undefined;
        let forceMaterializeOnSave = false;
        let profileDirCreated: string | null = null;
        let creatingProfile: Promise<string | null> | null = null;

        /** Materialize a profile + binding on first write. Returns the profile id. */
        const materializePending = (): Promise<string | null> => {
            if (profileDirCreated !== null) { return Promise.resolve(profileDirCreated); }
            if (creatingProfile === null) {
                creatingProfile = (async () => {
                    try {
                        // Non-explicit out-of-workspace writes stay in-memory so
                        // no .hexscope/ sibling is seeded. Only the explicit
                        // saveProfile path sets forceMaterializeOnSave.
                        if (!hasWorkspaceFolder && !forceMaterializeOnSave) { return null; }
                        const id = await createBoundProfile(root, relPath);
                        profileDirCreated = id;
                        profileId = id;
                        await registryStore?.load(true);
                        return id;
                    } finally {
                        creatingProfile = null;
                    }
                })();
            }
            return creatingProfile;
        };

        /** Serialize profile-slot read-modify-write ops so concurrent messages cannot lose updates. */
        const enqueuePerFileOp = <T>(op: () => Promise<T>): Promise<T> => {
            const next = perFileOp.then(op, op);
            perFileOp = next.catch(() => undefined);
            return next;
        };

        const migrationDone = migrateLegacyData(root, document.uri, this._context);
        ensureBindingLifecycle(root);

        /** Create root-level stores once (registry array + struct pool). Idempotent. */
        const ensureRootStores = (): void => {
            const normalizeStructs = (raw: unknown): { value: StructDef[]; changed: boolean } => {
                const defs = normalizeStructDefsValue(migrateStructDefinitions(raw)).defs;
                return { value: defs, changed: JSON.stringify(raw) !== JSON.stringify(defs) };
            };
            if (!registryStore) {
                // single-file profile registry (.hexscope/profiles.json)
                registryStore = new JsonStore<ProfileRecord[]>({
                    uri: profilesJsonUri(root),
                    normalizer: normalizeProfilesRegistry,
                    empty: () => [],
                    onSelfWrite: markSelfWrite,
                    onReload: () => { void broadcastPerFileData(); void broadcastProfilesState(); },
                });
            }
            if (!structPoolStore) {
                // workspace-wide struct pool (.hexscope/structs.json)
                structPoolStore = new JsonStore<StructDef[]>({
                    uri: structPoolJsonUri(root),
                    normalizer: normalizeStructs,
                    empty: () => [...(workspaceStructPoolCache.get(root) ?? [])],
                    onSelfWrite: markSelfWrite,
                    onReload: () => void broadcastStructs(),
                });
            }
        };

        const openProfileStores = (): Promise<void> => {
            if (!profileReady) {
                profileReady = (async () => {
                    await migrationDone;
                    if (disposed) { return; }
                    ensureRootStores();
                    await registryStore!.load();
                    // Watch the three-tier storage for every session (bound or
                    // not) so external registry edits refresh the open dropdown.
                    // Out-of-workspace (no .hexscope/ yet) stays inert — the
                    // RelativePattern simply never matches until files exist.
                    resources.add(attachProfileWatcher({ root, onProfileChanged }));
                    const bound = await boundProfileId(root, relPath);
                    if (bound) {
                        profileId = bound;
                    }
                })().catch(error => {
                    profileReady = null;
                    throw error;
                });
            }
            return profileReady;
        };

        const openStores = async (): Promise<{
            registry: JsonStore<ProfileRecord[]>;
            structs: JsonStore<StructDef[]>;
        }> => {
            await openProfileStores();
            return { registry: registryStore!, structs: structPoolStore! };
        };

        /** The bound record (or the in-memory staged record when unbound). */
        const readBoundProfile = async (): Promise<ProfileRecord> => {
            if (profileId !== null) { return boundRecordFromStoreOrDisk(); }
            return boundProfileCache ?? emptyProfileRecord('', '');
        };

        /** Bound record: registry cache first, disk fallback, empty default. */
        const boundRecordFromStoreOrDisk = async (): Promise<ProfileRecord> => {
            const cached = boundRecord(registryStore?.get() ?? [], profileId!);
            if (cached) { return cached; }
            return (await readProfileRecord(root, profileId!)) ?? emptyProfileRecord(profileId!, profileId!);
        };

        /** Cached bound record for broadcasts; null when nothing to show yet. */
        const currentBoundRecord = (): ProfileRecord | null => {
            if (profileId !== null) {
                return registryStore?.get()?.find(r => r.id === profileId) ?? null;
            }
            return boundProfileCache;
        };

        /** Ensure a profile is bound for writes; materializes or returns false
         *  (the caller keeps the patch in-memory — out-of-workspace non-explicit). */
        const ensureProfileBound = async (): Promise<boolean> => {
            await openProfileStores();
            if (profileId !== null) { return true; }
            const id = await materializePending();
            if (id === null) { return false; }
            profileId = id;
            return true;
        };

        /**
         * Route a per-file mutation into the bound profile:
         * - Unbound workspace file → materialize (create + bind) first.
         * - Unbound out-of-workspace non-explicit → patch the in-memory cache
         *   (flushed by explicit Save).
         * - Bound → patch the record inside the registry array via the store
         *   (debounced write to profiles.json).
         */
        const withBoundProfile = async (patch: (rec: ProfileRecord) => ProfileRecord): Promise<void> => {
            if (!(await ensureProfileBound())) {
                boundProfileCache = patch(boundProfileCache ?? emptyProfileRecord('', ''));
                return;
            }
            await stageRegistryPatch(patch);
        };

        /** Patch the bound record inside the registry array via the store (debounced write). */
        const stageRegistryPatch = async (patch: (rec: ProfileRecord) => ProfileRecord): Promise<void> => {
            // Force a fresh read from disk so an externally-deleted profiles.json
            // (or externally-removed profile record) is reflected before we write.
            // Without this, a stale in-memory cache could resurrect deleted data.
            await registryStore!.load(true);
            const records = registryStore!.get() ?? [];
            if (!records.some(r => r.id === profileId)) {
                // Profile no longer in registry (deleted externally) — abort
                // mutation to avoid resurrecting from in-memory state.
                profileId = null;
                boundProfileCache = null;
                return;
            }
            const base = boundRecord(records, profileId!) ?? emptyProfileRecord(profileId!, profileId!);
            registryStore!.set(normalizeProfilesRegistry(upsertRecord(records, patch({ ...base, id: profileId! }))).value);
        };

        /** Silent auto-apply: genuine external edits to the bound profile re-broadcast to the webview. */
        const broadcastPerFileData = (): void => {
            const p = currentBoundRecord();
            if (!p) { return; }
            void postToWebview(webviewPanel.webview, {
                type: 'perFileDataChange',
                labels: p.labels,
                segmentNames: p.segmentNames,
                pins: p.structPins,
                endian: p.endian,
                activeChecks: p.activeChecks,
            });
        };

        const broadcastStructs = (): void => {
            const structs = structPoolStore?.get();
            if (!structs) { return; }
            void postToWebview(webviewPanel.webview, { type: 'structsExternalChange', structs });
        };

        const broadcastProfilesState = async (): Promise<void> => {
            const all = await listProfiles(root);
            const bound = await boundProfileId(root, relPath);
            const count = bound ? (await bindingsUsing(root, bound)).length : 0;
            void postToWebview(webviewPanel.webview, {
                type: 'profilesState',
                profiles: all,
                current: bound,
                boundFileCount: count,
            });
        };

        const loadCurrentIndex = async (): Promise<ProfileRecord> => {
            await openProfileStores();
            return readBoundProfile();
        };

        /** External change to the registry: re-key the bound state, then debounced reload. */
        const onProfileChanged = (): void => {
            if (Date.now() - lastSelfWriteAt < SELF_WRITE_HORIZON_MS) { return; }
            clearTimeout(profileReloadTimer);
            profileReloadTimer = setTimeout(() => {
                void refreshProfileStores();
            }, PROFILE_CHANGE_DEBOUNCE_MS);
        };

        const refreshProfileStores = async (): Promise<void> => {
            if (disposed) { return; }
            // Re-resolve the bound profile + pool.
            const bound = await boundProfileId(root, relPath);
            if (bound !== profileId) {
                profileId = bound;
                if (bound === null) { boundProfileCache = null; }
            }
            scheduleProfileReload();
        };

        const scheduleProfileReload = (): void => {
            registryStore?.scheduleReload(0);
            structPoolStore?.scheduleReload(0);
            void broadcastProfilesState();
        };

        const postInit = async () => {
            if (!webviewReady || !parseResult) { return; }
            postProgress('transfer', 0);
            const serialized = serializeParseResult(parseResult, format);
            postProgress('transfer', 1, 1);
            const { registry, structs } = await openStores();
            const structDefs = await loadWorkspaceStructs(root, structs);
            const profileData = await readBoundProfile();

            const allProfiles = await listProfiles(root);
            const bound = profileId;
            const boundCount = bound ? (await bindingsUsing(root, bound)).length : 0;

            const msg: ProviderToWebviewMessage = {
                type: 'init',
                generation: currentGeneration,
                parseResult: serialized,
                labels: profileData.labels,
                segmentNames: profileData.segmentNames,
                structs: structDefs,
                structPins: profileData.structPins,
                endian: profileData.endian,
                activeChecks: profileData.activeChecks,
                profile: { profiles: allProfiles, current: bound, boundFileCount: boundCount },
            };

            void postToWebview(webviewPanel.webview, msg);
        };

        const parseCompactSource = async (source: string): Promise<{ result: CompactParseResult; generation: number }> => {
            activeLoad?.abort();
            const controller = new AbortController();
            activeLoad = controller;
            const nextGeneration = ++generation;
            const options = {
                signal: controller.signal,
                onProgress: (progress: { stage: 'parse' | 'build'; completed: number; total: number }) => {
                    const previous = generation;
                    generation = nextGeneration;
                    postProgress(progress.stage, progress.completed, progress.total);
                    generation = previous;
                },
            };
            const result = format === 'srec'
                ? await parseSRecCompact(source, options)
                : await parseIntelHexCompact(source, options);
            return { result, generation: nextGeneration };
        };

        // ── Live reload on external file changes ──────────────────────────
        // Self-writes are ignored within a short horizon so our own save/repair
        // never surfaces as an "external change" — even when the FS watcher
        // emits several events per write (flag was the old one-shot version).
        const SELF_WRITE_HORIZON_MS = 1000;
        let lastSelfWriteAt = 0;
        const markSelfWrite = () => { lastSelfWriteAt = Date.now(); };
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'),
                document.uri.path.split('/').pop()!)
        );
        resources.add(watcher);

        const onExternalChange = () => {
            if (Date.now() - lastSelfWriteAt < SELF_WRITE_HORIZON_MS) { return; }
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(async () => {
                try {
                    const newRaw = new TextDecoder('utf-8').decode(
                        await vscode.workspace.fs.readFile(document.uri));
                    const loaded = await parseCompactSource(newRaw);
                    const newResult = loaded.result;
                    
                    // Validate the externally-changed file
                    if (hasParseErrors(newResult)) {
                        pendingExternalReload = null;
                        // Update provider-side state with the new content so repair works on actual file
                        raw = newRaw;
                        parseResult = newResult;
                        currentGeneration = loaded.generation;
                        
                        // Quick repair only works with checksum errors; malformed lines need manual fixing
                        const canQuickRepair = newResult.malformedLines === 0;
                        const brokenIndex = await loadCurrentIndex();
                        void postToWebview(webviewPanel.webview, {
                            type: 'externalChangeError',
                            generation: loaded.generation,
                            parseResult: serializeParseResult(newResult, format),
                            labels: brokenIndex.labels,
                            segmentNames: brokenIndex.segmentNames,
                            checksumErrors: newResult.checksumErrors,
                            malformedLines: newResult.malformedLines,
                            errorCount: newResult.checksumErrors + newResult.malformedLines,
                            canQuickRepair,
                        });
                        return;
                    }
                    
                    // Send as 'externalChange' so the webview can guard against
                    // overwriting unsaved edits
                    pendingExternalReload = { raw: newRaw, parseResult: newResult, generation: loaded.generation };
                    const freshIndex = await loadCurrentIndex();
                    void postToWebview(webviewPanel.webview, {
                        type: 'externalChange',
                        generation: loaded.generation,
                        parseResult: serializeParseResult(newResult, format),
                        labels: freshIndex.labels,
                        segmentNames: freshIndex.segmentNames,
                    });
                } catch { /* file transiently unavailable */ }
            }, 200);
        };

        watcher.onDidChange(onExternalChange);
        watcher.onDidCreate(onExternalChange);

        type WebviewMessageHandler = (msg: any) => Promise<void>;

        /** Apply a dropdown selection: write binding (or unbind) and re-key the bound record. */
        const applyProfileSelection = async (target: string | null): Promise<void> => {
            if (target === null) {
                await unbindFile(root, relPath);
                profileId = null;
                boundProfileCache = null;
            } else {
                const bound = await boundProfileId(root, relPath);
                if (bound !== target) {
                    const current = currentBoundRecord();
                    // Flush current edits into the old profile before switching —
                    // only when actually bound (an unbound file's pending edits
                    // are in-memory-only; flushing would materialize a new
                    // auto-named profile instead of the picked target).
                    if (shouldFlushBeforeSwitch(current, bound, profileId)) {
                        await registryStore?.flush();
                    }
                    await bindFile(root, relPath, target);
                    profileId = target;
                }
            }
            await registryStore?.load(true);
        };

        const currentFileName = () => document.uri.fsPath.split(/[\/\\]/).pop();
        const writeRawAndReparse = async (nextRaw: string): Promise<{ result: CompactParseResult; generation: number }> => {
            await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(nextRaw));
            markSelfWrite();
            raw = nextRaw;
            const loaded = await parseCompactSource(raw);
            parseResult = loaded.result;
            currentGeneration = loaded.generation;
            return loaded;
        };

        const messageHandlers: Partial<Record<WebviewToProviderMessage['type'], WebviewMessageHandler>> = {
            ready: async () => {
                flushProgress?.();
                webviewReady = true;
                await postInit();
            },
            requestRecordPage: msg => postRecordPage(
                msg, parseResult, raw, format, currentGeneration, webviewPanel.webview,
            ),
            copyText: async msg => {
                await vscode.env.clipboard.writeText(msg.text as string);
                // Copy confirmation lives in the webview toast; no host notice.
            },
            saveLabels: async msg => {
                await enqueuePerFileOp(async () => {
                    await withBoundProfile(current => ({
                        ...current,
                        labels: msg.labels,
                        ...(msg.segmentNames ? { segmentNames: msg.segmentNames } : {}),
                    }));
                });
            },
            saveStructs: async msg => {
                await enqueuePerFileOp(async () => {
                    const { structs } = await openStores();
                    const previous = structs.get() ?? [];
                    const incoming = normalizeStructDefsValue(migrateStructDefinitions(msg.structs)).defs;
                    const result = await applyStructDeletion(
                        root,
                        structs,
                        incoming,
                        usage => confirmStructDeletion(usage),
                    );
                    if (result === 'declined') {
                        structDeletionDeclined = true;
                        await revertDeclinedStructDeletion(root, webviewPanel.webview, previous, profileId);
                    }
                });
            },
            saveStructPins: async msg => {
                await enqueuePerFileOp(async () => {
                    if (structDeletionDeclined) {
                        // A struct-deletion decline reverted the webview already;
                        // this strips nothing. Clear the latch and bail.
                        structDeletionDeclined = false;
                        return;
                    }
                    await withBoundProfile(current => ({ ...current, structPins: msg.pins }));
                });
            },
            saveIntegrityChecks: async msg => {
                const state = normalizeIntegrityCheckSet(msg.state);
                if (!state) { return; }
                await enqueuePerFileOp(async () => {
                    await withBoundProfile(current => ({ ...current, activeChecks: state }));
                });
            },
            saveEndian: async msg => {
                if (msg.endian !== 'le' && msg.endian !== 'be') { return; }
                await enqueuePerFileOp(async () => {
                    await withBoundProfile(current => ({ ...current, endian: msg.endian }));
                });
            },
            selectProfile: async msg => {
                // Immediate apply: write binding, refresh overlays + display.
                const target = typeof msg.profileId === 'string' ? msg.profileId : null;
                await enqueuePerFileOp(() => applyProfileSelection(target));
                broadcastPerFileData();
                void broadcastProfilesState();
            },
            newProfile: async msg => {
                const name = await askProfileName(typeof msg.name === 'string' ? msg.name.trim() : '');
                if (!name) { return; }
                await enqueuePerFileOp(async () => {
                    const pid = await createProfileFromName(root, name);
                    await bindFile(root, relPath, pid);
                    profileId = pid;
                    boundProfileCache = null;
                    await registryStore?.load(true);
                });
                broadcastPerFileData();
                void broadcastProfilesState();
            },
            saveProfile: async () => {
                // Explicit flush: materialize an unbound file (out-of-workspace
                // included), persist any staged in-memory edits, flush pending
                // registry/pool writes, then refresh the webview.
                await enqueuePerFileOp(async () => {
                    forceMaterializeOnSave = true;
                    try {
                        if (!profileId) { await materializePending(); }
                        if (profileId && boundProfileCache) {
                            await writeProfileRecord(root, { ...boundProfileCache, id: profileId });
                            boundProfileCache = null;
                            await registryStore?.load(true);
                        }
                        await registryStore?.flush();
                        await structPoolStore?.flush();
                        broadcastPerFileData();
                        void broadcastProfilesState();
                    } finally {
                        forceMaterializeOnSave = false;
                    }
                });
            },
            duplicateProfile: async msg => {
                // Save as…: copy the bound profile (+ staged cache when unbound)
                // under a new name and bind the current file to the copy.
                await enqueuePerFileOp(async () => {
                    const rec = await readBoundProfile();
                    const name = await askProfileName('', `${rec.name || 'Profile'} Copy`);
                    if (!name) { return; }
                    const pid = await createProfileFromName(root, name);
                    await writeProfileCopy(root, rec, pid, name);
                    await bindFile(root, relPath, pid);
                    profileId = pid;
                    boundProfileCache = null;
                    await registryStore?.load(true);
                });
                broadcastPerFileData();
                void broadcastProfilesState();
            },
            renameProfile: async () => {
                await enqueuePerFileOp(async () => {
                    if (!profileId) { return; }
                    const rec = await readBoundProfile();
                    const name = await askProfileName('', rec.name ?? '');
                    if (!name) { return; }
                    await writeProfileName(root, profileId, rec, rec.name, name);
                    // Resync the cache: a direct registry write leaves the
                    // debounced store stale, so the next edit-flush would
                    // revert the rename.
                    await registryStore?.load(true);
                    void broadcastProfilesState();
                });
            },
            deleteProfile: async () => {
                await enqueuePerFileOp(async () => {
                    if (!profileId) { return; }
                    const rec = await readBoundProfile();
                    const pick = { id: profileId, label: rec.name || profileId };
                    const bound = await bindingsUsing(root, profileId);
                    if (!(await confirmDeleteBoundProfile(pick, bound.length))) { return; }
                    // Drain any pending debounced registry writes BEFORE the
                    // direct removal, so a stale-cache timer cannot fire after
                    // the delete and write the profile back into profiles.json.
                    await registryStore?.flush();
                    await deleteRegistryProfile(root, profileId);
                    profileId = null;
                    boundProfileCache = null;
                    await registryStore?.load(true);
                });
                broadcastPerFileData();
                void broadcastProfilesState();
            },
            updateLabelVisibility: async msg => {
                await enqueuePerFileOp(async () => {
                    await withBoundProfile(current => ({
                        ...current,
                        labels: current.labels.map(l =>
                            l.id === msg.id ? { ...l, hidden: msg.hidden as boolean } : l
                        ),
                    }));
                });
            },
            reorderLabel: async msg => {
                await enqueuePerFileOp(async () => {
                    await withBoundProfile(current => {
                        const idx = current.labels.findIndex(l => l.id === msg.id);
                        if (idx < 0) { return current; }
                        const next = [...current.labels];
                        const dir = (msg.dir as number);
                        const swap = idx + dir;
                        if (swap < 0 || swap >= next.length) { return current; }
                        [next[idx], next[swap]] = [next[swap], next[idx]];
                        return { ...current, labels: next };
                    });
                });
            },
            saveEdits: async msg => {
                if (!parseResult) { return; }
                const editMap = new Map<number, number>(msg.edits);
                // Fast save: splice only the edited record lines, then write
                // positionally (just those byte ranges) when the plan is
                // ASCII/same-length safe; otherwise fall back to a whole write.
                // No materialize (every record) and no full reparse.
                const plan = buildSplicePlan(raw, editMap, format);
                await writePlanToFile(document.uri, plan);
                markSelfWrite();
                raw = plan.newRaw;
                foldEditsIntoSegments(parseResult.segments, editMap);
                currentGeneration = ++generation;
                void postToWebview(webviewPanel.webview, {
                    type: 'savedEdits',
                    generation: currentGeneration,
                });
                vscode.window.showInformationMessage(`HexScope: saved ${msg.edits.length} byte${msg.edits.length === 1 ? '' : 's'} to ${currentFileName()}`);
            },
            reloadAccepted: async () => {
                if (!pendingExternalReload) { return; }
                raw = pendingExternalReload.raw;
                parseResult = pendingExternalReload.parseResult;
                currentGeneration = pendingExternalReload.generation;
                pendingExternalReload = null;
            },
            repairAndReload: async () => {
                if (!parseResult) { return; }
                const repairedRaw = repairChecksums(raw, materializeParseResult(parseResult, raw, format));
                const loaded = await writeRawAndReparse(repairedRaw);
                void postToWebview(webviewPanel.webview, {
                    type: 'repairComplete',
                    generation: loaded.generation,
                    parseResult: serializeParseResult(loaded.result, format),
                });
                vscode.window.showInformationMessage(`HexScope: repaired checksums and reloaded ${currentFileName()}`);
            },
            requestScriptList: async () => {
                const folder = vscode.workspace.getWorkspaceFolder(document.uri);
                const root = folder ? folder.uri.fsPath : path.dirname(document.uri.fsPath);
                const trusted = vscode.workspace.isTrusted;
                const scripts = scanScripts(root, trusted);
                void postToWebview(webviewPanel.webview, { type: 'scriptInfo', trusted, scripts });
            },
            runScript: async msg => {
                if (!parseResult) { return; }
                if (disposed) { return; }
                currentAbort = new AbortController();
                const scriptPath = msg.scriptPath;
                const signal = currentAbort.signal;
                const post = (text: string) => void postToWebview(webviewPanel.webview, { type: 'scriptOutput', scriptPath, text });
                const host = new VSCodeScriptHost(parseResult.segments, {
                    output: post,
                    confirm: async (type, detail) => {
                        const btn = await vscode.window.showWarningMessage(
                            `Script "${scriptPath}" wants to ${type}: ${detail}`, { modal: true }, 'Allow');
                        return btn === 'Allow';
                    },
                    selectionRange: msg.selectionRange,
                });
                const trusted = vscode.workspace.isTrusted;
                const output = await execute(scriptPath, host, undefined, signal, trusted);
                // ponytail: guard with `if (currentAbort?.signal === signal)` if runs can overlap
                currentAbort = null;
                void postToWebview(webviewPanel.webview, {
                    type: 'scriptResult', scriptPath, result: output,
                    error: output.error ?? '', errorType: output.errorType,
                    pendingWriteCount: host.pendingWrites.length,
                    pendingWrites: host.pendingWrites.map(w => [w.address, w.value] as [number, number]),
                });
            },
            cancelScript: async msg => {
                currentAbort?.abort();
                currentAbort = null;
            },
            closePanel: async () => {
                webviewPanel.dispose();
            },
            viewInNormalEditor: async () => {
                const doc = await vscode.workspace.openTextDocument(document.uri);
                await vscode.window.showTextDocument(doc, { preview: false });
            },
        };

        dispatchIncoming = async rawMsg => {
            const msg = rawMsg as IncomingProviderMessage;
            const type = messageType(msg) as WebviewToProviderMessage['type'] | undefined;
            if (type) { await messageHandlers[type]?.(msg); }
        };

        resources.add(webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.active) {
                HexEditorSession._activePanel = webviewPanel;
                HexEditorSession._activeRoot = root;
                HexEditorSession._activeRelPath = relPath;
            }
        }));
        // Initial activation: mark this panel active when it is the visible one.
        if (webviewPanel.active) {
            HexEditorSession._activePanel = webviewPanel;
            HexEditorSession._activeRoot = root;
            HexEditorSession._activeRelPath = relPath;
        }
    }

    private _getHtml(webview: vscode.Webview, _uri: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.js')
        );

        const cssFiles = [
            'base', 'statsBar', 'layout',
        ];
        const cssLinks = cssFiles.map(name => {
            const uri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._context.extensionUri, 'src', 'webview', 'styles', `${name}.css`)
            );
            return `    <link rel="stylesheet" href="${uri}">`;
        }).join('\n');

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style nonce="${nonce}">
body{margin:0;padding:0;height:100vh;background:var(--vscode-editor-background,#1e1e1e)}
#app{display:flex;flex-direction:column;height:100%;overflow:hidden}
.loading-shell{display:grid;place-items:center;height:100%;padding:24px;background:radial-gradient(circle at top,rgba(156,220,254,.12),transparent 42%),linear-gradient(180deg,rgba(255,255,255,.02),transparent 28%)}
.loading-card{width:min(460px,100%);padding:24px 26px;border:1px solid var(--vscode-panel-border,rgba(128,128,128,.35));border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01));box-shadow:0 18px 50px rgba(0,0,0,.24)}
.loading-eyebrow{margin-bottom:8px;color:var(--vscode-textLink-foreground,#3794ff);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.loading-title{margin-bottom:6px;font-size:22px;font-weight:700;color:var(--vscode-editor-foreground,#ccc)}
.loading-text{margin-bottom:18px;color:var(--vscode-descriptionForeground,#8b8b8b);line-height:1.45}
.loading-bar{position:relative;overflow:hidden;height:8px;border-radius:999px;background:rgba(255,255,255,.06)}
.loading-bar-fill{width:35%;height:100%;border-radius:inherit;background:linear-gradient(90deg,rgba(156,220,254,.35),rgba(156,220,254,.95));animation:loading-slide 1.15s ease-in-out infinite}
@keyframes loading-slide{0%{transform:translateX(-120%)}100%{transform:translateX(300%)}}
    </style>
${cssLinks}
    <link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.css'))}">
    <title>HexScope</title>
</head>
<body>
    <div id="app">
        <div class="loading-shell" aria-live="polite">
            <div class="loading-card">
                <div class="loading-eyebrow">HexScope</div>
                <div class="loading-title">Opening file</div>
                <div class="loading-text">Parsing records and building the memory view.</div>
                <div class="loading-bar" role="presentation"><div class="loading-bar-fill"></div></div>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function shouldFlushBeforeSwitch(current: ProfileRecord | null | undefined, bound: string | null, profileId: string | null): boolean {
    return !!current && profileId === bound && bound !== null;
}

/** Registry-array record for a profile id; null when absent. */
function boundRecord(records: ProfileRecord[], profileId: string): ProfileRecord | null {
    return records.find(r => r.id === profileId) ?? null;
}

/** Insert or replace one record in the registry array (order preserved). */
function upsertRecord(records: ProfileRecord[], next: ProfileRecord): ProfileRecord[] {
    const idx = records.findIndex(r => r.id === next.id);
    return idx >= 0 ? records.map(r => (r.id === next.id ? next : r)) : [...records, next];
}

// ── Three-tier registry/binding helpers ───────────────────────────

/** Per-root in-memory workspace struct pool cache (one root's defs must not
 *  leak as another root's empty default). Fallback only: reads still hit the
 *  JsonStore; this mirrors the last-loaded pool for deferred/empty sessions.
 *  Exported as a test seam for two-roots-independent-fallback coverage. */
export const workspaceStructPoolCache = new Map<string, StructDef[]>();

/** Roots that attached the binding rename/delete lifecycle. Kept for the
 *  whole extension-host lifetime (not per panel), so the workspace-level
 *  rename/delete handlers survive every panel closing and reopening. */
const bindingLifecycles = new Map<string, vscode.Disposable>();
function ensureBindingLifecycle(root: string): void {
    if (!bindingLifecycles.has(root)) {
        bindingLifecycles.set(root, attachBindingFileLifecycle(root));
    }
}

/** Create a new registry profile + bind the given file to it. Returns profile id. */
export async function createBoundProfile(root: string, relPath: string): Promise<string> {
    const id = await createProfileFromName(root, profileNameFromRel(relPath));
    await bindFile(root, relPath, id);
    return id;
}

function profileNameFromRel(relPath: string): string {
    return path.basename(relPath, path.extname(relPath)) || 'Firmware';
}

/** Create a blank registry profile with the given name. Returns the new id. */
async function createProfileFromName(root: string, name: string): Promise<string> {
    const ordinal = await nextProfileOrdinal(root);
    const id = `profile_${ordinal}`;
    await writeProfileRecord(root, emptyProfileRecord(id, name));
    return id;
}

function trimOrNull(value: string | undefined): string | null {
    return value && value.trim() ? value.trim() : null;
}

function renameDefaultValue(rec: ProfileRecord | null, label: string): string {
    return rec?.name ?? label;
}

async function notifyEmptyProfileList(message: string): Promise<null> {
    if (message) { await vscode.window.showInformationMessage(message); }
    return null;
}

/** Write the duplicated profile record (id + name swapped, rest copied). */
async function writeProfileCopy(root: string, source: ProfileRecord, id: string, name: string): Promise<void> {
    await writeProfileRecord(root, { ...source, id, name });
}

/** Write a renamed profile record (label is the id fallback for the name). */
async function writeProfileName(root: string, profileId: string, rec: ProfileRecord | null, label: string, name: string): Promise<void> {
    await writeProfileRecord(root, { ...(rec ?? emptyProfileRecord(profileId, label)), name });
}

/** Confirm deleting a profile that is bound to files; true when safe or confirmed. */
async function confirmDeleteBoundProfile(pick: { id: string; label: string }, boundCount: number): Promise<boolean> {
    if (boundCount === 0) { return true; }
    const confirm = await vscode.window.showWarningMessage(
        `Profile “${pick.label}” is bound to ${boundCount} file${boundCount === 1 ? '' : 's'}. Delete it anyway?`,
        { modal: true },
        'Delete',
    );
    return confirm === 'Delete';
}

/** Resolve the bound profile id for a file, or null. Prunes dead bindings on read. */
export async function boundProfileId(root: string, relPath: string): Promise<string | null> {
    const read = await readJson(bindingsJsonUri(root));
    if (read.status !== 'ok') { return null; }
    const bindings = normalizeBindings(read.value).value;
    const match = bindings.find(b => b.fileKey === relPath);
    return match ? match.profileId : null;
}

/** Append/replace the binding for a file (prunes dead entries on write). */
export async function bindFile(root: string, fileKey: string, profileId: string): Promise<void> {
    const bindingsUri = bindingsJsonUri(root);
    const read = await readJson(bindingsUri);
    const bindings = read.status === 'ok' ? normalizeBindings(read.value).value : [];
    const without = bindings.filter(b => b.fileKey !== fileKey);
    const next = [...without, { fileKey, profileId }];
    const pruned = await pruneBindings(root, next);
    await writeJson(bindingsUri, withEnvelope(pruned));
}

/** Remove the binding for a file (silent). */
export async function unbindFile(root: string, fileKey: string): Promise<void> {
    const bindingsUri = bindingsJsonUri(root);
    const read = await readJson(bindingsUri);
    if (read.status !== 'ok') { return; }
    const bindings = normalizeBindings(read.value).value;
    if (!bindings.some(b => b.fileKey === fileKey)) { return; }
    const pruned = await pruneBindings(root, bindings.filter(b => b.fileKey !== fileKey));
    await writeJson(bindingsUri, withEnvelope(pruned));
}

/** Drop binding entries whose fileKey no longer resolves on disk (CLI mv/rm). */
export async function pruneBindings(root: string, bindings: ReadonlyArray<{ fileKey: string; profileId: string }>): Promise<Array<{ fileKey: string; profileId: string }>> {
    const out: Array<{ fileKey: string; profileId: string }> = [];
    for (const b of bindings) {
        const uri = vscode.Uri.file(path.join(root, b.fileKey));
        try {
            await vscode.workspace.fs.stat(uri);
            out.push(b);
        } catch {
            /* file no longer exists → drop */
        }
    }
    return out;
}

/** Resolve a new profile name: payload name, else a host input box (webviews block window.prompt). */
async function askProfileName(prompted: string, initial = ''): Promise<string | null> {
    if (prompted) { return prompted; }
    const input = await vscode.window.showInputBox({
        prompt: 'New profile name',
        placeHolder: 'e.g. Bootloader v3',
        value: initial,
        validateInput: value => value && value.trim() ? undefined : 'Profile name is required.',
    });
    if (input === undefined) { return null; }
    const name = input.trim();
    return name ? name : null;
}

/** List registry profiles as { id, name }. */
async function listProfiles(root: string): Promise<Array<{ id: string; name: string }>> {
    const records = await collectProfileRecords(root);
    return records.map(rec => ({ id: rec.id, name: rec.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Count bindings pointing at a profile. */
export async function bindingsUsing(root: string, profileId: string): Promise<Array<{ fileKey: string }>> {
    const read = await readJson(bindingsJsonUri(root));
    if (read.status !== 'ok') { return []; }
    return normalizeBindings(read.value).value.filter(b => b.profileId === profileId).map(b => ({ fileKey: b.fileKey }));
}

/** Delete a registry profile + its bindings (bound files revert to "No Profile"). */
async function deleteRegistryProfile(root: string, profileId: string): Promise<void> {
    await removeProfileRecord(root, profileId);
    const bindingsUri = bindingsJsonUri(root);
    const read = await readJson(bindingsUri);
    if (read.status === 'ok') {
        const bindings = normalizeBindings(read.value).value.filter(b => b.profileId !== profileId);
        await writeJson(bindingsUri, withEnvelope(bindings));
    }
}

/** Load workspace struct pool (from store cache or disk); empty default when absent.
 *  The per-root fallback cache is written here (keyed by root, never shared
 *  across roots). Exported as a test seam for per-root-fallback coverage. */
export async function loadWorkspaceStructs(
    root: string,
    structs: JsonStore<StructDef[]>,
): Promise<StructDef[]> {
    const defs = await structs.load();
    workspaceStructPoolCache.set(root, defs);
    return defs;
}

/** Confirm dialog for deleting struct types that other profiles pin to.
 *  Naming pin count + affected profile count (modal, explicit "Delete"). */
async function confirmStructDeletion(usage: { pins: number; profileIds: string[] }): Promise<boolean> {
    const typeNoun = usage.pins === 1 ? 'type' : 'types';
    const profileNoun = usage.profileIds.length === 1 ? 'profile' : 'profiles';
    const confirm = await vscode.window.showWarningMessage(
        `${usage.pins} pin${usage.pins === 1 ? '' : 's'} in ${usage.profileIds.length} ${profileNoun} reference the struct ${typeNoun} being deleted. Delete anyway?`,
        { modal: true },
        'Delete',
    );
    return confirm === 'Delete';
}

/** Scan every registry profile for pins whose structId is in deletedIds.
 *  Returns the total pin count + the affected profile ids. Pins of the
 *  current bound profile are still on disk at this point (the webview posts
 *  saveStructs before saveStructPins, both serialized via enqueuePerFileOp),
 *  so they count — matching "1+ pins reference it anywhere". */
export async function collectStructDeletionUsage(
    root: string,
    deletedIds: string[],
): Promise<{ pins: number; profileIds: string[] }> {
    if (deletedIds.length === 0) { return { pins: 0, profileIds: [] }; }
    const target = new Set(deletedIds);
    let pins = 0;
    const profileIds: string[] = [];
    for (const rec of await collectProfileRecords(root)) {
        const count = rec.structPins.filter(pin => target.has(pin.structId)).length;
        if (count > 0) {
            pins += count;
            profileIds.push(rec.id);
        }
    }
    return { pins, profileIds };
}

/** Rewrite every affected registry profile with its pins filtered to drop
 *  any pin referencing the deleted struct ids (the bound profile included —
 *  idempotent with the webview's later saveStructPins). */
export async function stripDeletedStructPins(root: string, deletedIds: string[]): Promise<void> {
    const target = new Set(deletedIds);
    const records = await collectProfileRecords(root);
    const next = records.map(rec => {
const stripped = rec.structPins.filter(pin => !target.has(pin.structId));
return stripped.length === rec.structPins.length ? rec : { ...rec, structPins: stripped };
    });
    if (next.some((rec, i) => rec !== records[i])) {
        await writeJson(profilesJsonUri(root), withEnvelope(normalizeProfilesRegistry(next).value));
    }
}

/** Guard struct-pool writes against deleting types that pins reference.
 *  - No deletion → plain edit writes straight through ('applied').
 *  - Deletion with no referencing pins → pool writes through ('applied').
 *  - Deletion with referencing pins → confirm(usage); declined = no writes,
 *    confirmed = strip pins from every affected profile + write the pool.
 *  Returns 'applied' only when the pool was written (or needed no confirm);
 *  'declined' leaves disk untouched (the caller reverts the webview). */
export async function applyStructDeletion(
    root: string,
    poolStore: JsonStore<StructDef[]>,
    incomingStructs: StructDef[],
    confirm: (usage: { pins: number; profileIds: string[] }) => Promise<boolean>,
): Promise<'applied' | 'declined'> {
    const deletedIds = deletedStructIds(poolStore.get() ?? [], incomingStructs);
    if (deletedIds.length === 0) {
        poolStore.set(incomingStructs);
        return 'applied';
    }
    return applyStructDeletionWithUsage(root, poolStore, incomingStructs, deletedIds, confirm);
}

async function applyStructDeletionWithUsage(
    root: string,
    poolStore: JsonStore<StructDef[]>,
    incomingStructs: StructDef[],
    deletedIds: string[],
    confirm: (usage: { pins: number; profileIds: string[] }) => Promise<boolean>,
): Promise<'applied' | 'declined'> {
    const usage = await collectStructDeletionUsage(root, deletedIds);
    if (usage.pins === 0) {
        poolStore.set(incomingStructs);
        return 'applied';
    }
    if (!(await confirm(usage))) { return 'declined'; }
    await stripDeletedStructPins(root, deletedIds);
    poolStore.set(incomingStructs);
    return 'applied';
}

/** Struct ids present in `previous` but absent from the incoming pool. */
function deletedStructIds(previous: StructDef[], incoming: StructDef[]): string[] {
    const incomingIds = new Set(incoming.map(def => def.id));
    return previous.filter(def => !incomingIds.has(def.id)).map(def => def.id);
}

/** Revert the webview after a declined struct deletion (no disk writes). */
async function revertDeclinedStructDeletion(
    root: string,
    webview: vscode.Webview,
    previous: StructDef[],
    boundProfileId: string | null,
): Promise<void> {
    void postToWebview(webview, { type: 'structsExternalChange', structs: previous });
    if (!boundProfileId) { return; }
    const rec = await readProfileRecord(root, boundProfileId);
    if (!rec) { return; }
    void postToWebview(webview, {
        type: 'perFileDataChange',
        labels: rec.labels,
        segmentNames: rec.segmentNames,
        pins: rec.structPins,
        endian: rec.endian,
        activeChecks: rec.activeChecks,
    });
}

/** Rewrite bindings on workspace rename (silent); remove on delete. */
function attachBindingFileLifecycle(root: string): vscode.Disposable {
    const rename = vscode.workspace.onDidRenameFiles(async event => {
        const bindings = await readBindingsTable(root);
        if (!bindings) { return; }
        let changed = false;
        const next = bindings.map(b => {
            const match = event.files.find(f => perFileRelativePath(root, f.oldUri) === b.fileKey);
            if (match) { changed = true; return { ...b, fileKey: perFileRelativePath(root, match.newUri) }; }
            return b;
        });
        if (changed) { await writeJson(bindingsJsonUri(root), withEnvelope(await pruneBindings(root, next))); }
    });
    const del = vscode.workspace.onDidDeleteFiles(async event => {
        const bindings = await readBindingsTable(root);
        if (!bindings) { return; }
        const deleted = new Set(event.files.map(f => perFileRelativePath(root, f)));
        const next = bindings.filter(b => !deleted.has(b.fileKey));
        if (next.length !== bindings.length) {
            await writeJson(bindingsJsonUri(root), withEnvelope(await pruneBindings(root, next)));
        }
    });
    return new vscode.Disposable(() => { rename.dispose(); del.dispose(); });
}

/** Read + normalize the bindings table; null when missing/corrupt. */
async function readBindingsTable(root: string): Promise<Binding[] | null> {
    const read = await readJson(bindingsJsonUri(root));
    if (read.status !== 'ok') { return null; }
    return normalizeBindings(read.value).value;
}

function serializeParseResult(result: CompactParseResult, format: HexScopeFormat): WireParseResult {
    return {
        recordCount: result.records.length,
        segments: result.segments.map(s => ({
            startAddress: s.startAddress,
            data: s.data.buffer.slice(s.data.byteOffset, s.data.byteOffset + s.data.byteLength) as ArrayBuffer,
        })),
        totalDataBytes: result.totalDataBytes,
        checksumErrors: result.checksumErrors,
        malformedLines: result.malformedLines,
        startAddress: result.startAddress,
        format,
    };
}

/** Detect whether raw content is Intel HEX or Motorola SREC. */
function detectFormat(uri: vscode.Uri, raw: string): HexScopeFormat {
    return detectFormatFromParts(uri.path.split('.').pop()?.toLowerCase() ?? '', raw);
}

function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}
