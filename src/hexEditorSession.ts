import * as crypto from 'crypto';
import * as fs from 'node:fs';
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
    normalizeIntegrityProfiles,
    type IntegrityCheckSet,
    type IntegrityProfile,
} from './core/integrity';
import {
    messageType,
    RECORD_PAGE_SIZE,
    type HexScopeEndian,
    type ProviderToWebviewMessage,
    type SegmentNameOverrides,
    type WebviewToProviderMessage,
} from './webviewProtocol';

import { scanScripts, execute } from './core/scripting/scriptRunner';
import { VSCodeScriptHost } from './scriptHost';
import {
    JsonStore,
    integrityFileUri,
    perFileDataUri,
    perFileLocalUri,
    perFileRelativePath,
    resolveHexScopeRoot,
    structsFileUri,
    type NormalizedValue,
} from './hexScopeStorage';
import { migrateLegacyData } from './hexScopeMigration';
import { migrateStructDefinitions, normalizeStructDefsValue } from './core/structMigration';

export { migrateStructDefinitions };

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

function postToPanel(panel: vscode.WebviewPanel, msg: ProviderToWebviewMessage): void {
    void postToWebview(panel.webview, msg);
}

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

// ── .hexscope/ file normalizers ─────────────────────────────────────
// One blob per file shape; same normalization functions as the Memento
// era, now fed from (and self-healing back to) the on-disk JSON.

interface PerFileData {
    labels: SegmentLabel[];
    segmentNames: SegmentNameOverrides;
}

interface PerFileLocal {
    pins: StructPin[];
    activeChecks: IntegrityCheckSet;
    endian: HexScopeEndian;
}

function emptyPerFileData(): PerFileData {
    return { labels: [], segmentNames: {} };
}

function emptyPerFileLocal(): PerFileLocal {
    return { pins: [], activeChecks: { schemaVersion: 1, checks: [] }, endian: 'le' };
}

function jsonChanged(next: unknown, previous: unknown): boolean {
    return JSON.stringify(next) !== JSON.stringify(previous);
}

function normalizeStructsFile(raw: unknown): NormalizedValue<StructDef[]> {
    const migrated = migrateStructDefinitions(raw);
    const { defs, changed } = normalizeStructDefsValue(migrated);
    return { value: defs, changed: changed || jsonChanged(migrated, raw) };
}

function normalizeIntegrityFile(raw: unknown): NormalizedValue<IntegrityProfile[]> {
    const value = normalizeIntegrityProfiles(raw);
    return { value, changed: jsonChanged(value, raw) };
}

function normalizePerFileDataFile(raw: unknown): NormalizedValue<PerFileData> {
    const obj = perFileObject<PerFileData>(raw);
    const value = {
        labels: Array.isArray(obj?.labels) ? obj.labels : [],
        segmentNames: segmentNamesOrEmpty(obj?.segmentNames),
    };
    return { value, changed: jsonChanged(value, raw) };
}

function normalizePerFileLocalFile(raw: unknown): NormalizedValue<PerFileLocal> {
    const obj = perFileObject<PerFileLocal>(raw);
    const value = localFileNormalized(obj);
    return { value, changed: jsonChanged(value, raw) };
}

function localFileNormalized(obj: Partial<PerFileLocal> | null): PerFileLocal {
    return {
        pins: pinsOrEmpty(obj?.pins),
        activeChecks: activeChecksOrDefault(obj),
        endian: endianOrDefault(obj?.endian),
    };
}

function pinsOrEmpty(value: StructPin[] | undefined): StructPin[] {
    return Array.isArray(value) ? value : [];
}

function endianOrDefault(value: HexScopeEndian | undefined): HexScopeEndian {
    return value === 'be' ? 'be' : 'le';
}

function activeChecksOrDefault(obj: Partial<PerFileLocal> | null): IntegrityCheckSet {
    const raw = obj !== null && typeof obj.activeChecks === 'object' ? obj.activeChecks : undefined;
    return normalizeIntegrityCheckSet(raw) ?? { schemaVersion: 1, checks: [] };
}

function perFileObject<T>(raw: unknown): Partial<T> | null {
    return raw !== null && typeof raw === 'object' ? raw as Partial<T> : null;
}

function segmentNamesOrEmpty(value: unknown): SegmentNameOverrides {
    return value !== null && typeof value === 'object' ? value as SegmentNameOverrides : {};
}

/** Move a label by one position; returns null when the move is invalid. */
function reorderedLabels(labels: SegmentLabel[], id: string, dir: number): SegmentLabel[] | null {
    const idx = labels.findIndex(l => l.id === id);
    if (idx < 0) { return null; }
    const swap = idx + dir;
    if (swap < 0 || swap >= labels.length) { return null; }
    const next = [...labels];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    return next;
}

export class HexEditorSession {

    private static _activePanel: vscode.WebviewPanel | undefined;
    private readonly _panels = new Set<vscode.WebviewPanel>();

    /** Post a message to the currently active HexScope webview, if any. */
    public static postToActive(msg: unknown): void {
        HexEditorSession._activePanel?.webview.postMessage(msg);
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

        const root = resolveHexScopeRoot(document.uri);
        const relPath = perFileRelativePath(root, document.uri);

        const normalizeStructDefs = normalizeStructDefsValue;

        // ── Live reload on external file changes ──────────────────────────
        // Self-writes are ignored within a short horizon so our own save/repair
        // never surfaces as an "external change" — even when the FS watcher
        // emits several events per write (flag was the old one-shot version).
        const SELF_WRITE_HORIZON_MS = 1000;
        let lastSelfWriteAt = 0;
        const markSelfWrite = () => { lastSelfWriteAt = Date.now(); };

        const structsStore = new JsonStore<StructDef[]>(structsFileUri(root), root, normalizeStructsFile, () => [], markSelfWrite);
        const integrityStore = new JsonStore<IntegrityProfile[]>(integrityFileUri(root), root, normalizeIntegrityFile, () => [], markSelfWrite);
        const dataStore = new JsonStore<PerFileData>(perFileDataUri(root, relPath), root, normalizePerFileDataFile, emptyPerFileData, markSelfWrite);
        const localStore = new JsonStore<PerFileLocal>(perFileLocalUri(root, relPath), root, normalizePerFileLocalFile, emptyPerFileLocal, markSelfWrite);

        // Serialize read-modify-write per-file ops from concurrent handlers.
        let perFileOpChain: Promise<void> = Promise.resolve();
        const enqueuePerFileOp = (op: () => Promise<void>): void => {
            perFileOpChain = perFileOpChain.then(op).catch(() => undefined);
        };

        const loadStructs = async (): Promise<StructDef[]> => structsStore.load();
        const loadIntegrityProfiles = async (): Promise<IntegrityProfile[]> => integrityStore.load();

        const broadcastIntegrityProfiles = async (error = ''): Promise<void> => {
            const current = await loadIntegrityProfiles();
            for (const panel of this._panels) {
                postToPanel(panel, { type: 'integrityProfiles', profiles: current, error });
            }
        };

        const sendIntegrityProfileError = async (error: string): Promise<void> => {
            const current = await loadIntegrityProfiles();
            await postToWebview(webviewPanel.webview, { type: 'integrityProfiles', profiles: current, error });
        };

        const saveIntegrityProfiles = async (next: IntegrityProfile[]): Promise<void> => {
            integrityStore.set(next);
            await broadcastIntegrityProfiles();
        };

        const postPerFileDataChange = async (): Promise<void> => {
            const data = await dataStore.load();
            const local = await localStore.load();
            postToPanel(webviewPanel, {
                type: 'perFileDataChange',
                labels: data.labels,
                segmentNames: data.segmentNames,
                pins: local.pins,
                endian: local.endian,
                activeChecks: local.activeChecks,
            });
        };

        // One-time legacy migration, shared by every postInit path.
        let migrationPromise: Promise<void> | null = null;
        const runMigration = (): Promise<void> => {
            migrationPromise ??= migrateLegacyData(this._context, root)
                .then(() => { markSelfWrite(); })
                .catch(() => { /* a migration failure must not block panel init */ });
            return migrationPromise;
        };

        const postInit = async () => {
            await runMigration();
            if (!webviewReady || !parseResult) { return; }
            postProgress('transfer', 0);
            const serialized = serializeParseResult(parseResult, format);
            postProgress('transfer', 1, 1);
            const structs = await loadStructs();
            const data = await dataStore.load();
            const local = await localStore.load();
            const integrityProfiles = await loadIntegrityProfiles();

            const msg: ProviderToWebviewMessage = {
                type: 'init',
                generation: currentGeneration,
                parseResult: serialized,
                labels:      data.labels,
                segmentNames: data.segmentNames,
                structs,
                structPins:  local.pins,
                endian: local.endian,
                integrityProfiles: { profiles: integrityProfiles, activeChecks: local.activeChecks },
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
                        void postToWebview(webviewPanel.webview, {
                            type: 'externalChangeError',
                            generation: loaded.generation,
                            parseResult: serializeParseResult(newResult, format),
                            labels: cachedPerFileData().labels,
                            segmentNames: cachedPerFileData().segmentNames,
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
                    void postToWebview(webviewPanel.webview, {
                        type: 'externalChange',
                        generation: loaded.generation,
                        parseResult: serializeParseResult(newResult, format),
                        labels: cachedPerFileData().labels,
                        segmentNames: cachedPerFileData().segmentNames,
                    });
                } catch { /* file transiently unavailable */ }
            }, 200);
        };

        watcher.onDidChange(onExternalChange);
        watcher.onDidCreate(onExternalChange);

        // ── Live reload on external .hexscope/ changes ────────────────────
        // Four independent debounced watchers, one per file slot. Genuine
        // external edits (e.g. a teammate's `git pull`) re-read + re-normalize
        // and push refreshed state to the webview. Self-writes within the
        // horizon are ignored exactly like the hex-file watcher above.
        const cachedPerFileData = (): PerFileData => dataStore.get() ?? emptyPerFileData();

        const watchJsonStore = <T,>(store: JsonStore<T>, glob: string, onReload: () => Promise<void> | void): void => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const schedule = () => {
                if (Date.now() - lastSelfWriteAt < SELF_WRITE_HORIZON_MS) { return; }
                clearTimeout(timer);
                timer = setTimeout(async () => {
                    try {
                        await store.load(true);
                        await onReload();
                    } catch { /* file transiently unavailable */ }
                }, 200);
            };
            const storeWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, glob));
            storeWatcher.onDidChange(uri => { if (uri.toString() === store.uri.toString()) { schedule(); } });
            storeWatcher.onDidCreate(uri => { if (uri.toString() === store.uri.toString()) { schedule(); } });
            resources.add(storeWatcher);
            resources.add(() => { if (timer) { clearTimeout(timer); } });
        };

        watchJsonStore(structsStore, '.hexscope/structs.json', async () => {
            postToPanel(webviewPanel, { type: 'structsExternalChange', structs: await structsStore.load() });
        });
        watchJsonStore(integrityStore, '.hexscope/integrity.json', () => broadcastIntegrityProfiles());
        watchJsonStore(dataStore, '.hexscope/data/**', postPerFileDataChange);
        watchJsonStore(localStore, '.hexscope/local/**', postPerFileDataChange);

        resources.add(() => {
            void structsStore.flush();
            void integrityStore.flush();
            void dataStore.flush();
            void localStore.flush();
        });

        type WebviewMessageHandler = (msg: any) => Promise<void>;

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
                enqueuePerFileOp(async () => {
                    const current = dataStore.get() ?? await dataStore.load();
                    dataStore.set({
                        labels: msg.labels,
                        segmentNames: msg.segmentNames ?? current.segmentNames,
                    });
                });
            },
            saveStructs: async msg => {
                const { defs } = normalizeStructDefs(msg.structs);
                structsStore.set(defs);
            },
            saveStructPins: async msg => {
                enqueuePerFileOp(async () => {
                    const current = localStore.get() ?? await localStore.load();
                    localStore.set({ ...current, pins: msg.pins });
                });
            },
            saveIntegrityChecks: async msg => {
                const state = normalizeIntegrityCheckSet(msg.state);
                if (!state) { return; }
                enqueuePerFileOp(async () => {
                    const current = localStore.get() ?? await localStore.load();
                    localStore.set({ ...current, activeChecks: state });
                });
            },
            saveEndian: async msg => {
                if (msg.endian !== 'le' && msg.endian !== 'be') { return; }
                enqueuePerFileOp(async () => {
                    const current = localStore.get() ?? await localStore.load();
                    localStore.set({ ...current, endian: msg.endian });
                });
            },
            createIntegrityProfile: async msg => {
                const profile = normalizeIntegrityProfiles([msg.profile])[0];
                if (!profile) { await sendIntegrityProfileError('Profile is invalid.'); return; }
                const current = await loadIntegrityProfiles();
                if (current.some(item => item.id === profile.id || sameProfileName(item.name, profile.name))) {
                    await sendIntegrityProfileError(`A profile named “${profile.name}” already exists.`);
                    return;
                }
                await saveIntegrityProfiles([...current, profile]);
            },
            updateIntegrityProfile: async msg => {
                const profile = normalizeIntegrityProfiles([msg.profile])[0];
                if (!profile) { await sendIntegrityProfileError('Profile is invalid.'); return; }
                const current = await loadIntegrityProfiles();
                if (!current.some(item => item.id === profile.id)) {
                    await sendIntegrityProfileError('Profile no longer exists.');
                    return;
                }
                if (current.some(item => item.id !== profile.id && sameProfileName(item.name, profile.name))) {
                    await sendIntegrityProfileError(`A profile named “${profile.name}” already exists.`);
                    return;
                }
                await saveIntegrityProfiles(current.map(item => item.id === profile.id ? profile : item));
            },
            renameIntegrityProfile: async msg => {
                const current = await loadIntegrityProfiles();
                const renamed = renameIntegrityProfiles(current, msg.id, msg.name);
                if (!renamed.ok) { await sendIntegrityProfileError(renamed.error); return; }
                await saveIntegrityProfiles(renamed.value);
            },
            deleteIntegrityProfile: async msg => {
                const id = typeof msg.id === 'string' ? msg.id : '';
                const current = await loadIntegrityProfiles();
                if (!current.some(item => item.id === id)) {
                    await sendIntegrityProfileError('Profile no longer exists.');
                    return;
                }
                await saveIntegrityProfiles(current.filter(item => item.id !== id));
            },
            updateLabelVisibility: async msg => {
                enqueuePerFileOp(async () => {
                    const current = dataStore.get() ?? await dataStore.load();
                    dataStore.set({
                        ...current,
                        labels: current.labels.map(l =>
                            l.id === msg.id ? { ...l, hidden: msg.hidden as boolean } : l
                        ),
                    });
                });
            },
            reorderLabel: async msg => {
                enqueuePerFileOp(async () => {
                    const current = dataStore.get() ?? await dataStore.load();
                    const next = reorderedLabels(current.labels, msg.id, msg.dir as number);
                    if (next) { dataStore.set({ ...current, labels: next }); }
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
                const scriptRoot = resolveHexScopeRoot(document.uri);
                const trusted = vscode.workspace.isTrusted;
                const scripts = scanScripts(scriptRoot, trusted);
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
            }
        }));
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

function sameProfileName(left: string, right: string): boolean {
    return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function renameIntegrityProfiles(
    profiles: IntegrityProfile[],
    rawId: unknown,
    rawName: unknown,
): { ok: true; value: IntegrityProfile[] } | { ok: false; error: string } {
    const id = messageString(rawId);
    const name = messageString(rawName).trim();
    if (!validProfileRename(id, name)) { return { ok: false, error: 'Profile name is invalid.' }; }
    if (!profiles.some(item => item.id === id)) { return { ok: false, error: 'Profile no longer exists.' }; }
    if (profiles.some(item => item.id !== id && sameProfileName(item.name, name))) {
        return { ok: false, error: `A profile named “${name}” already exists.` };
    }
    return { ok: true, value: profiles.map(item => item.id === id ? { ...item, name } : item) };
}

function validProfileRename(id: string, name: string): boolean {
    return id.length > 0 && name.length > 0;
}

function messageString(value: unknown): string {
    return typeof value === 'string' ? value : '';
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
