import * as crypto from 'crypto';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposableStore';
import type { HexScopeFormat } from '../core/document';
import { computeByteDiff, type DiffModel } from '../core/diff';
import { disambiguatedLabels } from '../core/diffLabels';
import type { MemorySegment } from '../core/parser/types';
import type { WireParseResult } from '../core/types';
import { diffCopyText, diffMessageType, type DiffProviderToWebview, type DiffSide, type DiffProgressStage } from '../diffProtocol';
import { advanceFraction, combinedLoadProgress } from './loadProgress';

/** Each file contributes one unit to `diffProgress`; its read fills a small leading slice, its parse the rest. */
const FILE_TOTAL = 2;
/** Reading is fast and posts no intermediate progress, so it keeps only a small slice; the parse owns the rest. */
const READ_SHARE = 0.05;

interface ParsedDiffFile {
    format: HexScopeFormat;
    wire: WireParseResult;
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

        resources.add(() => {
            disposed = true;
            controller.abort();
        });
        panel.onDidDispose(() => resources.dispose());
        resources.add(panel);

        panel.webview.html = diffHtml(context, panel.webview, baseUri, otherUri);

        resources.add(panel.webview.onDidReceiveMessage(message => {
            const type = diffMessageType(message);
            if (type === 'ready') {
                void loadDiff();
                return;
            }
            const text = diffCopyText(message);
            if (text !== null) {
                void vscode.env.clipboard.writeText(text);
            }
        }));

        const loadDiff = async (): Promise<void> => {
            const gen = ++generation;
            const progress = new DiffProgressReporter(panel);
            const isStale = (): boolean => staleDiff(disposed, gen, generation);
            try {
                const loaded = await loadBothSides(baseUri, otherUri, controller.signal, progress, isStale);
                if (!loaded) { return; }
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

interface LoadedDiff {
    a: DiffSide;
    b: DiffSide;
    diff: DiffModel;
}

/** Read, parse, and diff both sides concurrently; `null` when the load was superseded or the panel is gone. */
async function loadBothSides(
    baseUri: vscode.Uri,
    otherUri: vscode.Uri,
    signal: AbortSignal,
    progress: DiffProgressReporter,
    isStale: () => boolean,
): Promise<LoadedDiff | null> {
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
        fractions[index] = 1;
        report();
        return parsed;
    };
    report();
    const [base, other] = await Promise.all([loadSide(baseUri, 0), loadSide(otherUri, 1)]);
    if (isStale() || !base || !other) { return null; }
    progress.post('diff', 0, 1);
    const diff = computeByteDiff(sideSegments(base.wire), sideSegments(other.wire));
    progress.post('diff', 1, 1);
    return { a: diffSide(baseUri, base), b: diffSide(otherUri, other), diff };
}

async function readDiffSource(uri: vscode.Uri): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(uri);
}

interface WorkerParseOut {
    type?: string;
    fraction?: number;
    format?: HexScopeFormat;
    wire?: WireParseResult;
    message?: string;
}

interface WorkerMessageContext {
    onFraction: (fraction: number) => void;
    settle: (action: () => void) => void;
    accept: (message: WorkerParseOut) => void;
    reject: (error: unknown) => void;
}

type WorkerMessageHandler = (message: WorkerParseOut, ctx: WorkerMessageContext) => void;

const WORKER_MESSAGE_HANDLERS: Record<string, WorkerMessageHandler> = {
    progress: (message, ctx) => ctx.onFraction(message.fraction ?? 0),
    result: (message, ctx) => ctx.accept(message),
    error: (message, ctx) => ctx.settle(() => ctx.reject(new Error(message.message ?? 'Failed to parse file.'))),
};

/** Route one worker message to its handler; unknown types are ignored. */
function handleWorkerMessage(message: WorkerParseOut, ctx: WorkerMessageContext): void {
    WORKER_MESSAGE_HANDLERS[message.type ?? '']?.(message, ctx);
}

/** Parse one file in its own worker thread, relaying the worker's monotonic fraction. */
function parseSideInWorker(
    uri: vscode.Uri,
    bytes: Uint8Array,
    signal: AbortSignal,
    onFraction: (fraction: number) => void,
): Promise<ParsedDiffFile> {
    return new Promise<ParsedDiffFile>((resolve, reject) => {
        const buffer = bytes.buffer as ArrayBuffer;
        const worker = new Worker(path.join(__dirname, 'diffParseWorker.js'), {
            workerData: { kind: 'diffParse', bytes: buffer, extension: extensionOf(uri) },
            transferList: [buffer],
        });
        let settled = false;
        const settle = (action: () => void): void => {
            if (settled) { return; }
            settled = true;
            signal.removeEventListener('abort', onAbort);
            void worker.terminate();
            action();
        };
        const onAbort = (): void => settle(() => reject(new Error('Compare cancelled')));
        signal.addEventListener('abort', onAbort, { once: true });
        const accept = (message: WorkerParseOut): void => {
            let parsed: ParsedDiffFile;
            try {
                parsed = acceptParsedSide(uri, message);
            } catch (error) {
                settle(() => reject(error));
                return;
            }
            settle(() => resolve(parsed));
        };
        worker.on('message', message => handleWorkerMessage(message, { onFraction, settle, accept, reject }));
        worker.on('error', error => settle(() => reject(error)));
    });
}

interface CompleteParse extends WorkerParseOut {
    format: HexScopeFormat;
    wire: WireParseResult;
}

function hasCompleteParse(message: WorkerParseOut): message is CompleteParse {
    return Boolean(message.format && message.wire);
}

function assertNoParseDefects(uri: vscode.Uri, wire: WireParseResult): void {
    if (wire.checksumErrors > 0 || wire.malformedLines > 0) {
        throw new Error(`${fileName(uri)} has ${wire.checksumErrors} checksum error(s) and ${wire.malformedLines} malformed line(s). Use Quick Repair first.`);
    }
}

function acceptParsedSide(uri: vscode.Uri, message: WorkerParseOut): ParsedDiffFile {
    if (!hasCompleteParse(message)) { throw new Error(`Failed to parse ${fileName(uri)}.`); }
    assertNoParseDefects(uri, message.wire);
    return { format: message.format, wire: message.wire };
}

function sideSegments(wire: WireParseResult): MemorySegment[] {
    return wire.segments.map(segment => ({ startAddress: segment.startAddress, data: new Uint8Array(segment.data) }));
}

function diffSide(uri: vscode.Uri, parsed: ParsedDiffFile): DiffSide {
    return {
        name: fileName(uri),
        path: uri.fsPath,
        format: parsed.format,
        parseResult: parsed.wire,
        labels: [],
    };
}

function diffTitle(baseUri: vscode.Uri, otherUri: vscode.Uri): string {
    const [labelA, labelB] = disambiguatedLabels(labelInput(baseUri), labelInput(otherUri));
    return `${labelA} ↔ ${labelB}`;
}

function labelInput(uri: vscode.Uri): { name: string; path: string } {
    return { name: fileName(uri), path: uri.fsPath };
}

function fileName(uri: vscode.Uri): string {
    return uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
}

function extensionOf(uri: vscode.Uri): string {
    return uri.path.split('.').pop()?.toLowerCase() ?? '';
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
