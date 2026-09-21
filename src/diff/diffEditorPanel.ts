import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposableStore';
import { detectFormatFromParts, type HexScopeFormat } from '../core/document';
import { computeByteDiff, type DiffModel } from '../core/diff';
import { disambiguatedLabels } from '../core/diffLabels';
import { parseIntelHexCompact } from '../core/parser/intelHexParser';
import { parseSRecCompact } from '../core/parser/srecParser';
import type { CompactParserOptions, CompactParseResult } from '../core/parser/compact';
import { serializeParseResult } from '../core/wire';
import { diffCopyText, diffMessageType, type DiffProviderToWebview, type DiffSide, type DiffProgressStage } from '../diffProtocol';
import { combinedLoadProgress } from './loadProgress';

/** Each file contributes one unit to `diffProgress`; its read fills the first half, its parse the second. */
const FILE_TOTAL = 2;
const READ_SHARE = 0.5;

interface ParsedDiffFile {
    format: HexScopeFormat;
    result: CompactParseResult;
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
        const raw = await readDiffSource(uri);
        fractions[index] = READ_SHARE;
        report();
        if (isStale()) { return null; }
        const parsed = await parseDiffSource(uri, raw, signal, fraction => {
            fractions[index] = READ_SHARE + (1 - READ_SHARE) * fraction;
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
    const diff = computeByteDiff(base.result.segments, other.result.segments);
    progress.post('diff', 1, 1);
    return { a: diffSide(baseUri, base), b: diffSide(otherUri, other), diff };
}

async function readDiffSource(uri: vscode.Uri): Promise<string> {
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
}

async function parseDiffSource(
    uri: vscode.Uri,
    raw: string,
    signal: AbortSignal,
    onProgress: (fraction: number) => void,
): Promise<ParsedDiffFile> {
    const format = detectFormatFromParts(extensionOf(uri), raw);
    const options: CompactParserOptions = {
        signal,
        onProgress: event => onProgress(event.completed / Math.max(1, event.total)),
    };
    const result = format === 'srec' ? await parseSRecCompact(raw, options) : await parseIntelHexCompact(raw, options);
    if (result.checksumErrors > 0 || result.malformedLines > 0) {
        throw new Error(`${fileName(uri)} has ${result.checksumErrors} checksum error(s) and ${result.malformedLines} malformed line(s). Use Quick Repair first.`);
    }
    return { format, result };
}

function diffSide(uri: vscode.Uri, parsed: ParsedDiffFile): DiffSide {
    return {
        name: fileName(uri),
        path: uri.fsPath,
        format: parsed.format,
        parseResult: serializeParseResult(parsed.result, parsed.format),
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
                <div class="loading-bar" role="presentation"><div class="loading-bar-fill det" id="diff-loading-fill"></div></div>
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
