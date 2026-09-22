import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposableStore';
import { detectFormatFromParts, repairChecksums } from '../core/document';
import { parseIntelHex } from '../core/parser/intelHexParser';
import { parseSRec } from '../core/parser/srecParser';
import { disambiguatedLabels } from '../core/diffLabels';
import type { WireParseResult } from '../core/types';
import { diffCopyText, diffMessageType, type DiffProviderToWebview, type DiffSide, type DiffProgressStage } from '../diffProtocol';
import { advanceFraction, combinedLoadProgress } from './loadProgress';
import { buildDiffState, reloadIsStale, reloadState, sideDefects, type DiffReloadState, type DiffSideKey, type ParsedDiffSide } from './diffReload';
import { fileExtension, fileName } from '../core/pathName';
import { runParseJob, type WorkerResultOut } from '../parse/parseWorkerClient';

/** Each file contributes one unit to `diffProgress`; its read fills a small leading slice, its parse the rest. */
const FILE_TOTAL = 2;
/** Reading is fast and posts no intermediate progress, so it keeps only a small slice; the parse owns the rest. */
const READ_SHARE = 0.05;
/** Debounce external-change events (FS watchers emit several per write). */
const RELOAD_DEBOUNCE_MS = 200;
/** Ignore watcher events right after our own repair write, so it never reads as an external change. */
const SELF_WRITE_HORIZON_MS = 1000;

type ParsedDiffFile = ParsedDiffSide;

interface DiffSideRef {
    name: string;
    path: string;
}

/** Dedupes progress posts per stage; the parsers' batches are already rate-limited. */
class DiffProgressReporter {
    private readonly lastByStage = new Map<DiffProgressStage, number>();

    constructor(private readonly panel: vscode.WebviewPanel) {}

    public post(stage: DiffProgressStage, completed: number, total: number): void {
        if (this.lastByStage.get(stage) === completed) { return; }
        this.lastByStage.set(stage, completed);
        void this.panel.webview.postMessage({ type: 'diffProgress', stage, completed, total } satisfies DiffProviderToWebview);
    }
}

export class DiffEditorPanel {

    public static readonly viewType = 'hexScope.hexDiff';

    public static async open(
        context: vscode.ExtensionContext,
        baseUri: vscode.Uri,
        otherUri: vscode.Uri,
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            DiffEditorPanel.viewType,
            diffTitle(baseUri, otherUri),
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri],
            },
        );

        const resources = new DisposableStore();
        const controller = new AbortController();
        let disposed = false;
        let generation = 0;
        let current: DiffReloadState | null = null;
        /** Per-side reload counter: a newer read of the *other* side must not stale this one out. */
        const reloadGeneration: Record<DiffSideKey, number> = { a: 0, b: 0 };
        let lastErrorUri: vscode.Uri | null = null;
        let lastSelfWriteAt = 0;
        let reloadTimer: ReturnType<typeof setTimeout> | undefined;
        const pendingSides = new Set<DiffSideKey>();

        const markSelfWrite = (): void => { lastSelfWriteAt = Date.now(); };
        const uriFor = (side: DiffSideKey): vscode.Uri => (side === 'a' ? baseUri : otherUri);
        const refFor = (uri: vscode.Uri): DiffSideRef => ({ name: fileName(uri), path: uri.fsPath });

        resources.add(() => {
            disposed = true;
            controller.abort();
        });
        panel.onDidDispose(() => resources.dispose());
        resources.add(panel);

        panel.webview.html = diffHtml(context, panel.webview, baseUri, otherUri);

        /** Re-read + re-parse one side and refresh the webview; the other side is reused. */
        const reloadSide = async (side: DiffSideKey): Promise<void> => {
            if (disposed || !current) { return; }
            await reloadFromDisk(side, uriFor(side), ++reloadGeneration[side]);
        };

        const reloadFromDisk = async (
            side: DiffSideKey,
            uri: vscode.Uri,
            gen: number,
        ): Promise<void> => {
            try {
                const parsed = await readAndParseSide(uri, controller.signal);
                if (reloadIsStale(disposed, gen, reloadGeneration[side], current)) { return; }
                await applyParsedSide(side, uri, parsed, gen);
            } catch { /* file transiently unavailable; keep the last loaded bytes */ }
        };

        const applyParsedSide = async (
            side: DiffSideKey,
            uri: vscode.Uri,
            parsed: ParsedDiffFile,
            gen: number,
        ): Promise<void> => {
            const state = current;
            if (!state) { return; }
            const defects = sideDefects(parsed.wire);
            if (defects) {
                lastErrorUri = uri;
                await DiffEditorPanel.post(panel, { type: 'diffExternalChangeError', generation: gen, side, ...defects });
                return;
            }
            lastErrorUri = null;
            const next = reloadState(state, side, refFor(uri), parsed);
            current = next;
            await DiffEditorPanel.post(panel, { type: 'diffExternalChange', generation: gen, ...next });
        };

        const scheduleReload = (side: DiffSideKey): void => {
            if (Date.now() - lastSelfWriteAt < SELF_WRITE_HORIZON_MS) { return; }
            pendingSides.add(side);
            if (reloadTimer) { clearTimeout(reloadTimer); }
            reloadTimer = setTimeout(() => { void flushReloads(); }, RELOAD_DEBOUNCE_MS);
        };

        const flushReloads = async (): Promise<void> => {
            reloadTimer = undefined;
            const sides = [...pendingSides];
            pendingSides.clear();
            for (const side of sides) { await reloadSide(side); }
        };

        /** Repair the broken side's checksums, then reload it (self-write echo suppressed). */
        const repairAndReload = async (): Promise<void> => {
            const uri = lastErrorUri;
            if (!uri || disposed) { return; }
            try {
                await repairChecksumsOnDisk(uri, markSelfWrite);
                await reloadSide(sideOf(uri, baseUri));
            } catch { /* unreadable; leave the error banner up */ }
        };

        const viewInNormalEditor = async (): Promise<void> => {
            if (!lastErrorUri) { return; }
            const doc = await vscode.workspace.openTextDocument(lastErrorUri);
            await vscode.window.showTextDocument(doc, { preview: false });
        };

        const handleWebviewMessage = (message: unknown): void => {
            const type = diffMessageType(message);
            if (type === 'ready') { void loadDiff(); return; }
            if (type === 'repairAndReload') { void repairAndReload(); return; }
            if (type === 'viewInNormalEditor') { void viewInNormalEditor(); return; }
            writeClipboardText(message);
        };

        resources.add(panel.webview.onDidReceiveMessage(handleWebviewMessage));

        const watchTargets: Array<[DiffSideKey, vscode.Uri]> = [['a', baseUri], ['b', otherUri]];
        for (const [side, uri] of watchTargets) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), uri.path.split('/').pop()!)
            );
            watcher.onDidChange(() => scheduleReload(side));
            watcher.onDidCreate(() => scheduleReload(side));
            resources.add(watcher);
        }

        const loadDiff = async (): Promise<void> => {
            const gen = ++generation;
            const progress = new DiffProgressReporter(panel);
            const isStale = (): boolean => staleDiff(disposed, gen, generation);
            try {
                const loaded = await loadBothSides(baseUri, otherUri, controller.signal, progress, isStale);
                if (!loaded) { return; }
                current = loaded;
                await DiffEditorPanel.post(panel, { type: 'diffInit', generation: gen, ...loaded });
            } catch (error) {
                if (isStale()) { return; }
                controller.abort();
                await DiffEditorPanel.post(panel, { type: 'diffError', generation: gen, message: diffErrorMessage(error) });
            }
        };
    }

    private static async post(panel: vscode.WebviewPanel, message: DiffProviderToWebview): Promise<void> {
        await panel.webview.postMessage(message);
    }
}

function staleDiff(disposed: boolean, gen: number, current: number): boolean {
    return disposed || gen !== current;
}

/** Read + parse one side (no progress reporting; used by the reload path). */
async function readAndParseSide(uri: vscode.Uri, signal: AbortSignal): Promise<ParsedDiffFile> {
    const bytes = await readDiffSource(uri);
    return parseSideInWorker(uri, bytes, signal, () => {});
}

/** Repair the file's checksums in place (no-op when it has none) and report the self-write. */
async function repairChecksumsOnDisk(uri: vscode.Uri, markSelfWrite: () => void): Promise<void> {
    const raw = new TextDecoder('utf-8').decode(await readDiffSource(uri));
    const format = detectFormatFromParts(fileExtension(uri), raw);
    const parseResult = format === 'srec' ? parseSRec(raw) : parseIntelHex(raw);
    const repaired = repairChecksums(raw, parseResult);
    if (repaired === raw) { return; }
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(repaired));
    markSelfWrite();
}

function sideOf(uri: vscode.Uri, baseUri: vscode.Uri): DiffSideKey {
    return uri === baseUri ? 'a' : 'b';
}

function writeClipboardText(message: unknown): void {
    const text = diffCopyText(message);
    if (text !== null) { void vscode.env.clipboard.writeText(text); }
}

/** Read, parse, and diff both sides concurrently; `null` when the load was superseded or the panel is gone. */
async function loadBothSides(
    baseUri: vscode.Uri,
    otherUri: vscode.Uri,
    signal: AbortSignal,
    progress: DiffProgressReporter,
    isStale: () => boolean,
): Promise<DiffReloadState | null> {
    const fractions = [0, 0];
    const report = (): void => {
        if (isStale()) { return; }
        const reading = fractions.some(fraction => fraction <= READ_SHARE);
        progress.post(reading ? 'read' : 'parse', combinedLoadProgress(fractions), FILE_TOTAL);
    };
    const loadSide = async (uri: vscode.Uri, index: number): Promise<ParsedDiffFile | null> => {
        const bytes = await readDiffSource(uri);
        fractions[index] = READ_SHARE;
        report();
        if (isStale()) { return null; }
        let running = 0;
        const parsed = await parseSideInWorker(uri, bytes, signal, fraction => {
            running = advanceFraction(running, fraction);
            fractions[index] = READ_SHARE + (1 - READ_SHARE) * running;
            report();
        });
        assertNoParseDefects(uri, parsed.wire);
        fractions[index] = 1;
        report();
        return parsed;
    };
    report();
    const [base, other] = await Promise.all([loadSide(baseUri, 0), loadSide(otherUri, 1)]);
    if (isStale() || !base || !other) { return null; }
    progress.post('diff', 0, 1);
    const loaded = buildDiffState(refOf(baseUri), base, refOf(otherUri), other);
    progress.post('diff', 1, 1);
    return loaded;
}

async function readDiffSource(uri: vscode.Uri): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(uri);
}

/** Parse one file in its own worker thread, relaying the worker's monotonic fraction. */
function parseSideInWorker(
    uri: vscode.Uri,
    bytes: Uint8Array,
    signal: AbortSignal,
    onFraction: (fraction: number) => void,
): Promise<ParsedDiffFile> {
    const buffer = bytes.buffer as ArrayBuffer;
    return runParseJob({
        job: { kind: 'diffParse', bytes: buffer, extension: fileExtension(uri) },
        signal,
        transferList: [buffer],
        abortMessage: 'Compare cancelled',
        onProgress: message => { if ('fraction' in message) { onFraction(message.fraction); } },
        onResult: message => acceptParsedSide(uri, message),
    });
}

function assertNoParseDefects(uri: vscode.Uri, wire: WireParseResult): void {
    if (wire.checksumErrors > 0 || wire.malformedLines > 0) {
        throw new Error(`${fileName(uri)} has ${wire.checksumErrors} checksum error(s) and ${wire.malformedLines} malformed line(s). Use Quick Repair first.`);
    }
}

function acceptParsedSide(uri: vscode.Uri, message: WorkerResultOut): ParsedDiffFile {
    if (!('wire' in message)) { throw new Error(`Failed to parse ${fileName(uri)}.`); }
    return { format: message.format, wire: message.wire };
}

function refOf(uri: vscode.Uri): DiffSideRef {
    return { name: fileName(uri), path: uri.fsPath };
}

function diffTitle(baseUri: vscode.Uri, otherUri: vscode.Uri): string {
    const [labelA, labelB] = disambiguatedLabels(labelInput(baseUri), labelInput(otherUri));
    return `${labelA} ↔ ${labelB}`;
}

function labelInput(uri: vscode.Uri): { name: string; path: string } {
    return { name: fileName(uri), path: uri.fsPath };
}

function diffErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Failed to compare files.';
}

function diffHtml(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
    baseFileUri: vscode.Uri,
    otherFileUri: vscode.Uri,
): string {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'diffViewer.js')
    );
    const cssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'diffViewer.css')
    );
    const baseCssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'styles', 'base.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${baseCssUri}">
    <link rel="stylesheet" href="${cssUri}">
    <title>HexScope Diff</title>
</head>
<body>
    <div id="app">
        <div class="loading-shell" id="diff-loading" aria-live="polite">
            <div class="loading-card">
                <div class="loading-eyebrow">HexScope</div>
                <div class="loading-title">Comparing files</div>
                <div class="loading-text">Reading ${escapeHtml(fileName(baseFileUri))} and ${escapeHtml(fileName(otherFileUri))}…</div>
                <div class="loading-bar" role="presentation"><div class="loading-bar-fill" id="diff-loading-fill"></div></div>
            </div>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}
