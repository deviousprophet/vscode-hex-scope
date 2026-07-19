import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DisposableStore } from './core/disposableStore';
import { parseIntelHexCompact, parseIntelHexLine } from './core/parser/intelHexParser';
import { parseSRecCompact, parseSRecRecordLine } from './core/parser/srecParser';
import type { ParseResult } from './core/parser/types';
import type { CompactParseResult } from './core/parser/compact';
import type { SegmentLabel, SerializedRecord, StructDef, WireParseResult } from './core/types';
import { detectFormatFromParts, repairChecksums, serializeIntelHexAsync, serializeSRecAsync, type HexScopeFormat } from './core/document';
import {
    normalizeIntegrityCheckSet,
    normalizeIntegrityProfiles,
    type IntegrityCheckSet,
    type IntegrityProfile,
} from './core/integrity';
import {
    messageType,
    RECORD_PAGE_SIZE,
    type ProviderToWebviewMessage,
    type WebviewToProviderMessage,
} from './webviewProtocol';

const GLOBAL_INTEGRITY_PROFILES_KEY = 'hexScope.integrityProfiles.global.v1';

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

function postToPanel(panel: vscode.WebviewPanel, msg: ProviderToWebviewMessage): void {
    void postToWebview(panel.webview, msg);
}

async function postToWebview(webview: vscode.Webview, msg: ProviderToWebviewMessage): Promise<boolean> {
    return webview.postMessage(msg);
}

type StructDefsNormalization = { defs: StructDef[]; changed: boolean };
type StructDefIdentity = { id: string; name: string };
type IncomingProviderMessage = WebviewToProviderMessage;
type RecordPageRequest = Extract<WebviewToProviderMessage, { type: 'requestRecordPage' }>;

class LoadProgressReporter {
    private lastAt = 0;
    private lastStage = '';

    constructor(
        private readonly webview: vscode.Webview,
        private readonly canPost: () => boolean,
        private readonly generation: () => number,
    ) {}

    public post(stage: 'read' | 'parse' | 'build' | 'transfer', completed: number, total?: number): void {
        if (!this.canPost()) { return; }
        const now = Date.now();
        if (this.isThrottled(stage, completed, total, now)) { return; }
        this.lastAt = now;
        this.lastStage = stage;
        void postToWebview(this.webview, {
            type: 'loadProgress', generation: this.generation(), stage, completed, total,
        });
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

function stringProperty(value: unknown, key: 'id' | 'name'): string | null {
    const prop = (value as { id?: unknown; name?: unknown })?.[key];
    return typeof prop === 'string' ? prop : null;
}

function structDefIdentity(value: unknown): StructDefIdentity | null {
    const id = stringProperty(value, 'id');
    if (!id) { return null; }
    const name = stringProperty(value, 'name');
    return name ? { id, name } : null;
}

function rememberStructDefIdentity(identity: StructDefIdentity, seenIds: Set<string>, seenNames: Set<string>): void {
    seenIds.add(identity.id);
    seenNames.add(identity.name);
}

function hasSeenStructDefIdentity(identity: StructDefIdentity, seenIds: Set<string>, seenNames: Set<string>): boolean {
    return seenIds.has(identity.id) || seenNames.has(identity.name);
}

function appendUniqueStructDef(item: unknown, out: StructDef[], seenIds: Set<string>, seenNames: Set<string>): boolean {
    const identity = structDefIdentity(item);
    if (!identity || hasSeenStructDefIdentity(identity, seenIds, seenNames)) { return false; }
    rememberStructDefIdentity(identity, seenIds, seenNames);
    out.push(item as StructDef);
    return true;
}

function normalizeStructDefsValue(value: unknown): StructDefsNormalization {
    if (!Array.isArray(value)) { return { defs: [], changed: false }; }
    const out: StructDef[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    let changed = false;

    for (const item of value) {
        changed = !appendUniqueStructDef(item, out, seenIds, seenNames) || changed;
    }
    return { defs: out, changed };
}

function createStructDefIdentitySets(defs: StructDef[]): { usedIds: Set<string>; usedNames: Set<string> } {
    return {
        usedIds: new Set(defs.map(s => structDefIdentity(s)?.id).filter((id): id is string => typeof id === 'string')),
        usedNames: new Set(defs.map(s => structDefIdentity(s)?.name).filter((name): name is string => typeof name === 'string')),
    };
}

function mergeLegacyStructDefs(globalArr: StructDef[], legacyArr: StructDef[]): { defs: StructDef[]; changed: boolean } {
    if (legacyArr.length === 0) { return { defs: globalArr, changed: false }; }
    const { usedIds, usedNames } = createStructDefIdentitySets(globalArr);
    const migrated = legacyArr.filter(s => {
        const identity = structDefIdentity(s);
        if (!identity || hasSeenStructDefIdentity(identity, usedIds, usedNames)) { return false; }
        rememberStructDefIdentity(identity, usedIds, usedNames);
        return true;
    });
    return migrated.length > 0 ? { defs: [...globalArr, ...migrated], changed: true } : { defs: globalArr, changed: false };
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
        let pendingExternalReload: { raw: string; parseResult: CompactParseResult; generation: number } | null = null;
        let reloadTimer: ReturnType<typeof setTimeout> | undefined;
        const resources = new DisposableStore();
        resources.add(token.onCancellationRequested(() => activeLoad?.abort()));

        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this._getHtml(webviewPanel.webview, document.uri);
        this._panels.add(webviewPanel);

        let dispatchIncoming = async (rawMsg: unknown): Promise<void> => {
            if (messageType(rawMsg) === 'ready') {
                webviewReady = true;
                await postToWebview(webviewPanel.webview, {
                    type: 'loadProgress', generation, stage: 'read', completed: 0,
                });
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
            () => webviewReady && !disposed,
            () => generation,
        );
        const postProgress = progressReporter.post.bind(progressReporter);

        postProgress('read', 0);

        generation++;
        const initial = await loadInitialDocument(
            document,
            webviewPanel,
            token,
            activeLoad,
            generation,
            () => disposed,
            progress => postProgress(progress.stage, progress.completed, progress.total),
        );
        if (!initial) {
            resources.dispose();
            return;
        }
        ({ source: raw, format, result: parseResult } = initial);
        currentGeneration = generation;

        const labelKey = `hexScope.labels.${document.uri.toString()}`;

        const structKey = `hexScope.structs.${document.uri.toString()}`;
        const globalStructKey = 'hexScope.structs.global.v2';
        const previousGlobalStructKey = 'hexScope.structs.global.v1';
        const structPinKey = `hexScope.structPins.${document.uri.toString()}`;
        const integrityChecksKey = `hexScope.integrityChecks.${document.uri.toString()}.v1`;
        const endianKey = `hexScope.endian.${document.uri.toString()}.v1`;

        const normalizeStructDefs = normalizeStructDefsValue;

        const syncGlobalStructs = async (rawGlobal: unknown, normalizedGlobal: unknown, defs: StructDef[], changed: boolean): Promise<void> => {
            if (rawGlobal === undefined || !Array.isArray(normalizedGlobal) || changed) {
                await this._context.globalState.update(globalStructKey, defs);
            }
        };

        const clearPreviousGlobalStructs = async (previousGlobalStructs: unknown): Promise<void> => {
            if (previousGlobalStructs !== undefined) {
                await this._context.globalState.update(previousGlobalStructKey, undefined);
            }
        };

        const persistMergedLegacyStructs = async (globalArr: StructDef[], legacyArr: StructDef[]): Promise<StructDef[]> => {
            const merged = mergeLegacyStructDefs(globalArr, legacyArr);
            if (merged.changed) {
                await this._context.globalState.update(globalStructKey, merged.defs);
            }
            return merged.defs;
        };

        const loadStructs = async () => {
            const currentGlobalStructs = this._context.globalState.get<unknown>(globalStructKey);
            const previousGlobalStructs = this._context.globalState.get<unknown>(previousGlobalStructKey);
            const globalStructs = currentGlobalStructs ?? migrateStructDefinitions(previousGlobalStructs ?? []);
            const legacyStructs = migrateStructDefinitions(this._context.workspaceState.get<unknown>(structKey, []));
            let { defs: globalArr, changed: globalChanged } = normalizeStructDefs(globalStructs);
            const { defs: legacyArr } = normalizeStructDefs(legacyStructs);

            await syncGlobalStructs(currentGlobalStructs, globalStructs, globalArr, globalChanged);
            await clearPreviousGlobalStructs(previousGlobalStructs);
            globalArr = await persistMergedLegacyStructs(globalArr, legacyArr);

            await this._context.workspaceState.update(structKey, undefined);

            return globalArr;
        };

        const loadIntegrityProfiles = async (): Promise<IntegrityProfile[]> => {
            const rawProfiles = this._context.globalState.get<unknown>(GLOBAL_INTEGRITY_PROFILES_KEY, []);
            const normalized = normalizeIntegrityProfiles(rawProfiles);
            if (JSON.stringify(rawProfiles) !== JSON.stringify(normalized)) {
                await this._context.globalState.update(GLOBAL_INTEGRITY_PROFILES_KEY, normalized);
            }
            return normalized;
        };

        const loadIntegrityChecks = async (): Promise<IntegrityCheckSet> => {
            const rawChecks = this._context.workspaceState.get<unknown>(integrityChecksKey);
            const normalized = normalizeIntegrityCheckSet(rawChecks) ?? {
                schemaVersion: 1,
                checks: [],
            };
            if (rawChecks !== undefined && JSON.stringify(rawChecks) !== JSON.stringify(normalized)) {
                await this._context.workspaceState.update(integrityChecksKey, normalized);
            }
            return normalized;
        };

        const loadEndian = (): 'le' | 'be' => {
            return this._context.workspaceState.get<unknown>(endianKey) === 'be' ? 'be' : 'le';
        };

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
            await this._context.globalState.update(GLOBAL_INTEGRITY_PROFILES_KEY, next);
            await broadcastIntegrityProfiles();
        };

        const postInit = async () => {
            if (!webviewReady || !parseResult) { return; }
            const serialized = serializeParseResult(parseResult, format);
            const structs = await loadStructs();
            const integrityProfiles = await loadIntegrityProfiles();
            const integrityChecks = await loadIntegrityChecks();
            
            const msg: ProviderToWebviewMessage = {
                type: 'init',
                generation: currentGeneration,
                parseResult: serialized,
                labels:      this._context.workspaceState.get(labelKey, []),
                structs,
                structPins:  this._context.workspaceState.get(structPinKey, []),
                endian: loadEndian(),
                integrityProfiles: { profiles: integrityProfiles, activeChecks: integrityChecks },
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
        // suppress the single watcher event caused by our own writes
        let suppressReload = false;
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'),
                document.uri.path.split('/').pop()!)
        );
        resources.add(watcher);

        const onExternalChange = () => {
            if (suppressReload) { suppressReload = false; return; }
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
                            labels: this._context.workspaceState.get(labelKey, []),
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
                        labels: this._context.workspaceState.get(labelKey, []),
                    });
                } catch { /* file transiently unavailable */ }
            }, 200);
        };

        watcher.onDidChange(onExternalChange);
        watcher.onDidCreate(onExternalChange);

        type WebviewMessageHandler = (msg: any) => Promise<void>;

        const currentFileName = () => document.uri.fsPath.split(/[\/\\]/).pop();
        const writeRawAndReparse = async (nextRaw: string): Promise<{ result: CompactParseResult; generation: number }> => {
            suppressReload = true;
            await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(nextRaw));
            raw = nextRaw;
            const loaded = await parseCompactSource(raw);
            parseResult = loaded.result;
            currentGeneration = loaded.generation;
            return loaded;
        };

        const messageHandlers: Partial<Record<WebviewToProviderMessage['type'], WebviewMessageHandler>> = {
            ready: async () => {
                webviewReady = true;
                await postInit();
            },
            requestRecordPage: msg => postRecordPage(
                msg, parseResult, raw, format, currentGeneration, webviewPanel.webview,
            ),
            copyText: async msg => {
                await vscode.env.clipboard.writeText(msg.text as string);
                vscode.window.showInformationMessage(`Copied: ${msg.label ?? ''}`);
            },
            saveLabels: async msg => {
                await this._context.workspaceState.update(labelKey, msg.labels);
            },
            saveStructs: async msg => {
                const { defs } = normalizeStructDefs(msg.structs);
                await this._context.globalState.update(globalStructKey, defs);
            },
            saveStructPins: async msg => {
                await this._context.workspaceState.update(structPinKey, msg.pins);
            },
            saveIntegrityChecks: async msg => {
                const state = normalizeIntegrityCheckSet(msg.state);
                if (state) { await this._context.workspaceState.update(integrityChecksKey, state); }
            },
            saveEndian: async msg => {
                if (msg.endian === 'le' || msg.endian === 'be') {
                    await this._context.workspaceState.update(endianKey, msg.endian);
                }
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
                const current: SegmentLabel[] = this._context.workspaceState.get(labelKey, []);
                const next = current.map(l =>
                    l.id === msg.id ? { ...l, hidden: msg.hidden as boolean } : l
                );
                await this._context.workspaceState.update(labelKey, next);
            },
            reorderLabel: async msg => {
                const current: SegmentLabel[] = this._context.workspaceState.get(labelKey, []);
                const idx = current.findIndex(l => l.id === msg.id);
                if (idx < 0) { return; }
                const next = [...current];
                const dir  = (msg.dir as number);
                const swap = idx + dir;
                if (swap < 0 || swap >= next.length) { return; }
                [next[idx], next[swap]] = [next[swap], next[idx]];
                await this._context.workspaceState.update(labelKey, next);
            },
            saveEdits: async msg => {
                if (!parseResult) { return; }
                const edits = msg.edits;
                const editMap = new Map<number, number>(edits);
                const materialized = materializeParseResult(parseResult, raw, format);
                const newHex = format === 'srec'
                    ? await serializeSRecAsync(raw, materialized, editMap)
                    : await serializeIntelHexAsync(raw, materialized, editMap);
                const loaded = await writeRawAndReparse(newHex);
                void postToWebview(webviewPanel.webview, {
                    type: 'savedEdits',
                    generation: loaded.generation,
                    parseResult: serializeParseResult(loaded.result, format),
                });
                vscode.window.showInformationMessage(`HexScope: saved ${edits.length} byte${edits.length === 1 ? '' : 's'} to ${currentFileName()}`);
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
        await postInit();

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
            'base', 'toolbar', 'layout', 'sidebar',
            'record-view', 'memory-view', 'context-menu', 'struct', 'integrity',
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
${cssLinks}
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

export function migrateStructDefinitions(value: unknown): unknown {
    if (!Array.isArray(value)) { return value; }
    return value.map(item => {
        if (item === null || typeof item !== 'object') { return item; }
        const def = item as { fields?: unknown };
        if (!Array.isArray(def.fields)) { return item; }
        return {
            ...def,
            fields: def.fields.map(field => {
                if (field === null || typeof field !== 'object') { return field; }
                const clean = { ...field } as Record<string, unknown>;
                delete clean.endian;
                return clean;
            }),
        };
    });
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
