import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposableStore';
import { computeDiff, type DiffResult } from '../core/diff';
import { decodePairKey } from '../core/pairUri';
import { parseIntelHexCompact } from '../core/parser/intelHexParser';
import { parseSRecCompact } from '../core/parser/srecParser';
import type { CompactParseResult } from '../core/parser/compact';
import type { HexScopeFormat } from '../core/document';
import { SearchEngine } from '../core/search';
import type { SearchEndianness, SearchMode } from '../core/types';
import type { SegmentLabel } from '../core/types';
import { detectFormatFromParts } from '../core/document';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { messageType } from '../webviewProtocol';

function formatForPath(path: string): HexScopeFormat {
    return detectFormatFromParts(path.split('.').pop()?.toLowerCase() ?? '', '');
}

async function readAndParse(uri: vscode.Uri): Promise<{ source: string; format: HexScopeFormat; result: CompactParseResult }> {
    const source = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    const format = formatForPath(uri.fsPath);
    const result = format === 'srec'
        ? await parseSRecCompact(source, {})
        : await parseIntelHexCompact(source, {});
    return { source, format, result };
}

function parseErrors(result: CompactParseResult): boolean {
    return result.checksumErrors > 0 || result.malformedLines > 0;
}

/** Human message for an invalid side, or null when valid. */
function parseErrorFor(result: CompactParseResult): string | null {
    if (result.checksumErrors > 0 && result.malformedLines > 0) {
        return `Parse error: ${result.checksumErrors} checksum error(s), ${result.malformedLines} malformed line(s).`;
    }
    if (result.checksumErrors > 0) { return `Parse error: ${result.checksumErrors} checksum error(s).`; }
    if (result.malformedLines > 0) { return `Parse error: ${result.malformedLines} malformed line(s).`; }
    return null;
}

function fileName(path: string): string {
    return path.split(/[\/\\]/).pop() ?? path;
}

function labelFor(uri: vscode.Uri): string {
    return fileName(uri.fsPath);
}

/** Extract the opaque pair key from a diff tab URI (key lives in the query). */
function pairKeyFromUri(uri: vscode.Uri): string {
    const match = /(?:^|&)k=([^&]+)/.exec(uri.query);
    if (!match) { throw new Error('diff tab URI is missing its pair key'); }
    return match[1];
}

/** Address-range labels stored for a file (read-only display in the diff). */
function readLabels(context: vscode.ExtensionContext, uri: vscode.Uri): SegmentLabel[] {
    return context.workspaceState.get<SegmentLabel[]>(`hexScope.labels.${uri.toString()}`, []);
}

export class HexDiffSession {
    private static _activePanel: vscode.WebviewPanel | undefined;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const resources = new DisposableStore();
        resources.add(token.onCancellationRequested(() => {}));

        const pair = decodePairKey(pairKeyFromUri(document.uri));
        const aUri = vscode.Uri.file(pair.aPath);
        const bUri = vscode.Uri.file(pair.bPath);

        let generation = 0;
        let disposed = false;
        let webviewReady = false;
        let aState: { source: string; format: HexScopeFormat; result: CompactParseResult } | null = null;
        let bState: { source: string; format: HexScopeFormat; result: CompactParseResult } | null = null;
        let swap = false;
        let reloadTimer: ReturnType<typeof setTimeout> | undefined;

        const post = (msg: ProviderToWebviewMessage): void => {
            if (!disposed) { void webviewPanel.webview.postMessage(msg); }
        };

        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this._getHtml(webviewPanel.webview, document.uri);
        webviewPanel.onDidDispose(() => resources.dispose());
        resources.add(() => {
            disposed = true;
            clearTimeout(reloadTimer);
            if (HexDiffSession._activePanel === webviewPanel) {
                HexDiffSession._activePanel = undefined;
            }
        });
        HexDiffSession._activePanel = webviewPanel;

        const recompute = (): void => {
            if (!aState || !bState) { return; }
            const result: DiffResult = computeDiff(aState.result, bState.result);
            post({
                type: 'diffUpdate',
                generation,
                result,
                aError: parseErrorFor(aState.result),
                bError: parseErrorFor(bState.result),
            });
        };

        const reloadSide = async (uri: vscode.Uri, side: 'a' | 'b'): Promise<void> => {
            try {
                const loaded = await readAndParse(uri);
                if (side === 'a') { aState = loaded; } else { bState = loaded; }
                recompute();
            } catch {
                /* file transiently unavailable; keep last state */
            }
        };

        const onExternalChange = (side: 'a' | 'b', uri: vscode.Uri): void => {
            if (disposed) { return; }
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => { void reloadSide(uri, side); }, 200);
        };

        const watch = (uri: vscode.Uri, side: 'a' | 'b'): void => {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(
                    vscode.Uri.joinPath(uri, '..'),
                    uri.path.split('/').pop()!,
                )
            );
            watcher.onDidChange(() => onExternalChange(side, uri));
            watcher.onDidCreate(() => onExternalChange(side, uri));
            resources.add(watcher);
        };
        watch(aUri, 'a');
        watch(bUri, 'b');

        const runSearch = (query: string, mode: SearchMode, endianness: SearchEndianness, onComplete: (matches: number[]) => void): void => {
            const hasAnyState = aState !== null || bState !== null;
            if (!hasAnyState) { onComplete([]); return; }
            const engine = new SearchEngine();
            const done: { a: boolean; b: boolean } = { a: !aState, b: !bState };
            const merged: number[] = [];
            const complete = (): void => {
                if (done.a && done.b) {
                    merged.sort((x, y) => x - y);
                    onComplete(merged);
                }
            };
            const runOne = (segments: Array<{ startAddress: number; data: ArrayLike<number> }>, mark: 'a' | 'b'): void => {
                engine.search(
                    { mode, endianness, raw: query, segments },
                    { onComplete: matches => { merged.push(...matches); done[mark] = true; complete(); } },
                );
            };
            if (aState) { runOne(aState.result.segments, 'a'); }
            if (bState) { runOne(bState.result.segments, 'b'); }
            complete();
        };

        /** Handle one message from the diff webview (dispatched by type). */
        const onReady = (): void => {
            webviewReady = true;
            sendInit();
        };
        const onSwapRequest = (): void => {
            swap = !swap;
            post({ type: 'diffSwap', generation, swapped: swap });
        };
        const onSearchRequest = (rawMsg: unknown): void => {
            const msg = rawMsg as Extract<WebviewToProviderMessage, { type: 'diffSearchRequest' }>;
            if (msg.generation !== generation) { return; }
            runSearch(String(msg.query), msg.mode, msg.endianness, matches => {
                post({ type: 'diffSearch', generation, query: String(msg.query), matches });
            });
        };
        const handleMessage = (rawMsg: unknown): void => {
            const type = messageType(rawMsg);
            if (type === 'diffReady') { onReady(); return; }
            if (!webviewReady) { return; }
            if (type === 'diffSwapRequest') { onSwapRequest(); return; }
            if (type === 'diffSearchRequest') { onSearchRequest(rawMsg); }
        };
        webviewPanel.webview.onDidReceiveMessage(handleMessage, undefined, [resources]);

        await new Promise<void>(r => setImmediate(r));
        generation++;

        try {
            const [aLoaded, bLoaded] = await Promise.all([readAndParse(aUri), readAndParse(bUri)]);
            aState = aLoaded;
            bState = bLoaded;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to read pair.';
            post({ type: 'loadError', generation, message });
            return;
        }

        const aLabel = labelFor(aUri);
        const bLabel = labelFor(bUri);
        const aLabels = readLabels(this._context, aUri);
        const bLabels = readLabels(this._context, bUri);
        const result: DiffResult = computeDiff(aState.result, bState.result);
        const sendInit = (): void => {
            if (!webviewReady || !aState || !bState) { return; }
            post({
                type: 'diffInit',
                generation,
                result,
                aLabel,
                bLabel,
                aFormat: aState.format,
                bFormat: bState.format,
                aError: parseErrorFor(aState.result),
                bError: parseErrorFor(bState.result),
                aLabels,
                bLabels,
            });
        };
        sendInit();
    }

    private _getHtml(webview: vscode.Webview, _uri: vscode.Uri): string {
        const nonce = getNonce();
        const cssLinks = ['base', 'diff'].map(name => {
            const uri = webview.asWebviewUri(
                vscode.Uri.joinPath(this._context.extensionUri, 'src', 'webview', 'styles', `${name}.css`)
            );
            return `    <link rel="stylesheet" href="${uri}">`;
        }).join('\n');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${cssLinks}
<title>HexScope Diff</title>
</head>
<body>
<div id="app">Hex Diff View</div>
<div id="status"></div>
<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'hexDiffViewer.js'))}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
