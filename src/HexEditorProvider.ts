import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { parseIntelHex } from './parser/IntelHexParser';
import { computeSRecChecksum, parseSRec, SREC_ADDR_SIZES, srecIsData } from './parser/SRecParser';
import type { ParseResult } from './parser/types';
import type { StructDef } from './webview/types';
import {
    normalizeIntegrityCheckSet,
    normalizeIntegrityProfiles,
    type IntegrityCheckSet,
    type IntegrityProfile,
} from './webview/integrity';

const GLOBAL_INTEGRITY_PROFILES_KEY = 'hexScope.integrityProfiles.global.v1';

function hasParseErrors(result: ParseResult): boolean {
    return result.checksumErrors > 0 || result.malformedLines > 0;
}

type StructDefsNormalization = { defs: StructDef[]; changed: boolean };
type StructDefIdentity = { id: string; name: string };

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

export class HexEditorProvider implements vscode.CustomReadonlyEditorProvider {

    public static readonly viewType = 'hexScope.hexEditor';

    private static _activePanel: vscode.WebviewPanel | undefined;
    private readonly _panels = new Set<vscode.WebviewPanel>();

    /** Post a message to the currently active HexScope webview, if any. */
    public static postToActive(msg: unknown): void {
        HexEditorProvider._activePanel?.webview.postMessage(msg);
    }

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) {}

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            HexEditorProvider.viewType,
            new HexEditorProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            }
        );
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        let raw = '';
        let format: 'ihex' | 'srec' = 'ihex';
        let parseResult: ParseResult | null = null;
        let webviewReady = false;

        raw = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(document.uri));

        format = detectFormat(document.uri, raw);
        parseResult = format === 'srec' ? parseSRec(raw) : parseIntelHex(raw);

        if (parseResult.checksumErrors > 0 || parseResult.malformedLines > 0) {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(document.uri), { preview: false });
            webviewPanel.dispose();
            return;
        }

        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this._getHtml(webviewPanel.webview, document.uri);
        this._panels.add(webviewPanel);

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
                void panel.webview.postMessage({ type: 'integrityProfiles', profiles: current, error });
            }
        };

        const sendIntegrityProfileError = async (error: string): Promise<void> => {
            const current = await loadIntegrityProfiles();
            await webviewPanel.webview.postMessage({ type: 'integrityProfiles', profiles: current, error });
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
            
            const msg = {
                type: 'init',
                parseResult: serialized,
                labels:      this._context.workspaceState.get(labelKey, []),
                structs,
                structPins:  this._context.workspaceState.get(structPinKey, []),
                endian: loadEndian(),
                integrityProfiles: { profiles: integrityProfiles, activeChecks: integrityChecks },
            };
            
            webviewPanel.webview.postMessage(msg);
        };

        // ── Live reload on external file changes ──────────────────────────
        // suppress the single watcher event caused by our own writes
        let suppressReload = false;
        let reloadTimer: ReturnType<typeof setTimeout> | undefined;

        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'),
                document.uri.path.split('/').pop()!)
        );

        const onExternalChange = () => {
            if (suppressReload) { suppressReload = false; return; }
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(async () => {
                try {
                    const newRaw = new TextDecoder('utf-8').decode(
                        await vscode.workspace.fs.readFile(document.uri));
                    const newResult = format === 'srec' ? parseSRec(newRaw) : parseIntelHex(newRaw);
                    
                    // Validate the externally-changed file
                    if (hasParseErrors(newResult)) {
                        // Update provider-side state with the new content so repair works on actual file
                        raw = newRaw;
                        parseResult = newResult;
                        
                        // Quick repair only works with checksum errors; malformed lines need manual fixing
                        const canQuickRepair = newResult.malformedLines === 0;
                        webviewPanel.webview.postMessage({
                            type: 'externalChangeError',
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
                    webviewPanel.webview.postMessage({
                        type: 'externalChange',
                        parseResult: serializeParseResult(newResult, format),
                        labels: this._context.workspaceState.get(labelKey, []),
                    });
                    // Update provider-side state only after webview accepts it
                    // (done on 'reloadAccepted' response below)
                } catch { /* file transiently unavailable */ }
            }, 200);
        };

        watcher.onDidChange(onExternalChange);
        watcher.onDidCreate(onExternalChange);

        type WebviewMessage = { type: string; [key: string]: unknown };
        type WebviewMessageHandler = (msg: WebviewMessage) => Promise<void>;

        const currentFileName = () => document.uri.fsPath.split(/[\/\\]/).pop();
        const parseCurrentRaw = () => format === 'srec' ? parseSRec(raw) : parseIntelHex(raw);
        const writeRawAndReparse = async (nextRaw: string): Promise<ParseResult> => {
            suppressReload = true;
            await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(nextRaw));
            raw = nextRaw;
            parseResult = parseCurrentRaw();
            return parseResult;
        };

        const messageHandlers: Record<string, WebviewMessageHandler> = {
            ready: async () => {
                webviewReady = true;
                await postInit();
            },
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
                const edits = msg.edits as Array<[number, number]>;
                const editMap = new Map<number, number>(edits);
                const newHex = format === 'srec'
                    ? serializeSRec(raw, parseResult, editMap)
                    : serializeIntelHex(raw, parseResult, editMap);
                const nextParseResult = await writeRawAndReparse(newHex);
                webviewPanel.webview.postMessage({
                    type: 'savedEdits',
                    parseResult: serializeParseResult(nextParseResult, format),
                });
                vscode.window.showInformationMessage(`HexScope: saved ${edits.length} byte${edits.length === 1 ? '' : 's'} to ${currentFileName()}`);
            },
            reloadAccepted: async () => {},
            repairAndReload: async () => {
                if (!parseResult) { return; }
                const repairedRaw = repairChecksums(raw, parseResult);
                const nextParseResult = await writeRawAndReparse(repairedRaw);
                webviewPanel.webview.postMessage({
                    type: 'repairComplete',
                    parseResult: serializeParseResult(nextParseResult, format),
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

        webviewPanel.webview.onDidReceiveMessage(async rawMsg => {
            const msg = rawMsg as WebviewMessage;
            await messageHandlers[msg.type]?.(msg);
        });

        webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.active) {
                HexEditorProvider._activePanel = webviewPanel;
            }
        });

        webviewPanel.onDidDispose(() => {
            watcher.dispose();
            clearTimeout(reloadTimer);
            this._panels.delete(webviewPanel);
            if (HexEditorProvider._activePanel === webviewPanel) {
                HexEditorProvider._activePanel = undefined;
            }
        });
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
                vscode.Uri.joinPath(this._context.extensionUri, 'src', 'webview', `${name}.css`)
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

interface SegmentLabel {
    id: string;
    name: string;
    startAddress: number;
    length: number;
    color: string;
    hidden?: boolean;
}

function serializeParseResult(result: ParseResult, format: 'ihex' | 'srec'): SerializedParseResult {
    return {
        records: result.records.map(r => ({
            lineNumber: r.lineNumber,
            raw: r.raw,
            byteCount: r.byteCount,
            address: r.address,
            recordType: r.recordType,
            data: Array.from(r.data),
            checksum: r.checksum,
            checksumValid: r.checksumValid,
            resolvedAddress: r.resolvedAddress,
            error: r.error,
        })),
        recordCount: result.records.length,
        segments: result.segments.map(s => ({
            startAddress: s.startAddress,
            data: Array.from(s.data),
        })),
        totalDataBytes: result.totalDataBytes,
        checksumErrors: result.checksumErrors,
        malformedLines: result.malformedLines,
        startAddress: result.startAddress,
        format,
    };
}

// Types safe to transfer over the webview message boundary
interface SerializedRecord {
    lineNumber: number;
    raw: string;
    byteCount: number;
    address: number;
    recordType: number;
    data: number[];
    checksum: number;
    checksumValid: boolean;
    resolvedAddress: number;
    error?: string;
}

interface SerializedSegment {
    startAddress: number;
    data: number[];
}

interface SerializedParseResult {
    records: SerializedRecord[];
    recordCount?: number;
    segments: SerializedSegment[];
    totalDataBytes: number;
    checksumErrors: number;
    malformedLines: number;
    startAddress?: number;
    format: 'ihex' | 'srec';
}

/** Rebuild an Intel HEX file from original parse + a map of addr→newValue overrides. */
function serializeIntelHex(originalRaw: string, parseResult: ParseResult, edits: Map<number, number>): string {
    return serializeEditedRecords(
        originalRaw,
        parseResult,
        edits,
        rec => rec.recordType === 0 /* Data */,
        (rec, data) => buildDataRecord(rec.address, data),
    );
}

type ParsedRecord = ParseResult['records'][number];

function serializeEditedRecords(
    originalRaw: string,
    parseResult: ParseResult,
    edits: Map<number, number>,
    canEditRecord: (rec: ParsedRecord) => boolean,
    rebuildRecord: (rec: ParsedRecord, data: number[]) => string,
): string {
    if (edits.size === 0) { return originalRaw; }

    const eol = originalRaw.includes('\r\n') ? '\r\n' : '\n';
    const lines = parseResult.records.map(rec => {
        if (rec.error || !canEditRecord(rec)) { return rec.raw; }
        const edited = applyRecordEdits(rec, edits);
        return edited ? rebuildRecord(rec, edited) : rec.raw;
    });
    return lines.join(eol);
}

function applyRecordEdits(rec: ParsedRecord, edits: Map<number, number>): number[] | null {
    const data = Array.from(rec.data);
    let changed = false;
    for (let i = 0; i < data.length; i++) {
        const addr = rec.resolvedAddress + i;
        if (edits.has(addr)) {
            data[i] = edits.get(addr)!;
            changed = true;
        }
    }
    return changed ? data : null;
}

function buildDataRecord(addr16: number, data: number[]): string {
    const bc = data.length;
    const ah = (addr16 >> 8) & 0xFF;
    const al = addr16 & 0xFF;
    let sum = bc + ah + al + 0 /* type=Data */;
    for (const b of data) { sum += b; }
    const chk = ((~sum + 1) & 0xFF);
    const body =
        bc.toString(16).toUpperCase().padStart(2, '0') +
        addr16.toString(16).toUpperCase().padStart(4, '0') +
        '00' +
        data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('') +
        chk.toString(16).toUpperCase().padStart(2, '0');
    return ':' + body;
}

/**
 * Pure format-detection logic, exposed for testing.
 * Decides format from file extension and raw content.
 */
export function detectFormatFromParts(ext: string, raw: string): 'ihex' | 'srec' {
    if (['srec', 'mot', 's19', 's28', 's37'].includes(ext)) { return 'srec'; }
    // Content sniff: first non-empty line starts with 'S' followed by a digit
    const firstLine = raw.trimStart().slice(0, 4);
    if (/^S[0-9]/i.test(firstLine)) { return 'srec'; }
    return 'ihex';
}

/** Detect whether raw content is Intel HEX or Motorola SREC. */
function detectFormat(uri: vscode.Uri, raw: string): 'ihex' | 'srec' {
    return detectFormatFromParts(uri.path.split('.').pop()?.toLowerCase() ?? '', raw);
}

/** Rebuild a Motorola SREC file from original parse + a map of addr→newValue overrides. */
export function serializeSRec(originalRaw: string, parseResult: ParseResult, edits: Map<number, number>): string {
    return serializeEditedRecords(
        originalRaw,
        parseResult,
        edits,
        rec => srecIsData(rec.recordType),
        (rec, data) => buildSRecDataRecord(rec.recordType, rec.resolvedAddress, data),
    );
}

export function buildSRecDataRecord(type: number, address: number, data: number[]): string {
    const asz = SREC_ADDR_SIZES[type] ?? 2;
    const byteCount = asz + data.length + 1; // addrBytes + dataBytes + checksumByte
    const chk = computeSRecChecksum(byteCount, address, asz, data);
    const bcHex   = byteCount.toString(16).toUpperCase().padStart(2, '0');
    const addrHex = address.toString(16).toUpperCase().padStart(asz * 2, '0');
    const dataHex = data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    const chkHex  = chk.toString(16).toUpperCase().padStart(2, '0');
    return `S${type}${bcHex}${addrHex}${dataHex}${chkHex}`;
}

/**
 * Rewrite every checksum-invalid (but structurally parseable) record in-place
 * by replacing its last two hex characters with the correctly computed checksum.
 * Lines with a parse error are left untouched because their structure is unknown.
 */
export function repairChecksums(raw: string, parseResult: ParseResult): string {
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.split(/\r?\n/);
    for (const rec of parseResult.records) {
        if (rec.error || rec.checksumValid) { continue; }
        const line = lines[rec.lineNumber - 1];
        if (!line) { continue; }
        // Replace the last two characters (the checksum hex byte)
        const correctChk = computeCorrectChecksum(rec);
        lines[rec.lineNumber - 1] = line.slice(0, -2) +
            correctChk.toString(16).toUpperCase().padStart(2, '0');
    }
    return lines.join(eol);
}

/** Compute the correct checksum for a parsed record (works for both IHEX and SREC). */
function computeCorrectChecksum(rec: import('./parser/types').HexRecord): number {
    // IHEX: two's-complement of (byteCount + addrHi + addrLo + recordType + data)
    // SREC: one's-complement of (byteCount + addrBytes + data)
    // We detect by address byte count: SREC types have fixed addr sizes, IHEX always 2.
    // Both share the same shape — differentiate by checking if raw starts with ':' or 'S'.
    if (rec.raw.startsWith('S')) {
        const aszMap: Record<number, number> = {0:2,1:2,2:3,3:4,5:2,6:3,7:4,8:3,9:2};
        const asz = aszMap[rec.recordType] ?? 2;
        let sum = rec.byteCount;
        for (let i = asz - 1; i >= 0; i--) { sum += (rec.address >>> (i * 8)) & 0xFF; }
        for (const b of rec.data) { sum += b; }
        return (~sum) & 0xFF;
    }
    let sum = rec.byteCount + ((rec.address >> 8) & 0xFF) + (rec.address & 0xFF) + rec.recordType;
    for (const b of rec.data) { sum += b; }
    return (~sum + 1) & 0xFF;
}

function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}
