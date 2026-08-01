import * as vscode from 'vscode';
import { DisposableStore } from './core/disposableStore';
import { computeDiff, type DiffResult } from './core/diff';
import { decodePairKey } from './core/pairUri';
import { parseIntelHexCompact } from './core/parser/intelHexParser';
import { parseSRecCompact } from './core/parser/srecParser';
import type { CompactParseResult } from './core/parser/compact';
import type { HexScopeFormat } from './core/document';
import { SearchEngine } from './core/search';
import { detectFormatFromParts } from './core/document';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from './webviewProtocol';
import { messageType } from './webviewProtocol';

// ── Staging state (D7: ephemeral, module-level, session only) ──────
let stagedFirstPath: string | null = null;

export function setStagedFirstPath(path: string | null): void {
    stagedFirstPath = path;
}

export function getStagedFirstPath(): string | null {
    return stagedFirstPath;
}

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

function fileName(path: string): string {
    return path.split(/[\/\\]/).pop() ?? path;
}

function labelFor(uri: vscode.Uri, side: 'A' | 'B'): string {
    return `${fileName(uri.fsPath)} [${side}]`;
}

export class HexDiffSession {
    private static _activePanel: vscode.WebviewPanel | undefined;

    public static postToActive(msg: unknown): void {
        HexDiffSession._activePanel?.webview.postMessage(msg);
    }

    constructor(private readonly _context: vscode.ExtensionContext) {}

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const resources = new DisposableStore();
        resources.add(token.onCancellationRequested(() => {}));

        const pair = decodePairKey(document.uri.path.split('/').pop() ?? document.uri.path);
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
            });
        };

        const reloadSide = async (uri: vscode.Uri, side: 'a' | 'b'): Promise<void> => {
            try {
                const loaded = await readAndParse(uri);
                if (side === 'a') { aState = loaded; } else { bState = loaded; }
                recompute();
            } catch {
                /* file transiently unavailable; keep last state (D15) */
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

        const runSearch = (query: string, onComplete: (matches: number[]) => void): void => {
            if (!aState && !bState) { onComplete([]); return; }
            const engine = new SearchEngine();
            const done: { a: boolean; b: boolean } = { a: !aState, b: !bState };
            const merged: number[] = [];
            const settle = (): void => {
                if (done.a && done.b) {
                    merged.sort((x, y) => x - y);
                    onComplete(merged);
                }
            };
            const runOne = (segments: Array<{ startAddress: number; data: ArrayLike<number> }>, mark: 'a' | 'b'): void => {
                engine.search(
                    { mode: 'bytes', raw: query, segments },
                    { onComplete: matches => { merged.push(...matches); done[mark] = true; settle(); } },
                );
            };
            if (aState) { runOne(aState.result.segments, 'a'); }
            if (bState) { runOne(bState.result.segments, 'b'); }
            settle();
        };

        webviewPanel.webview.onDidReceiveMessage((rawMsg: unknown) => {
            const type = messageType(rawMsg);
            if (type === 'diffReady') {
                webviewReady = true;
                sendInit();
                return;
            }
            if (!webviewReady) { return; }
            if (type === 'diffSwapRequest') {
                swap = !swap;
                post({ type: 'diffSwap', generation, swapped: swap });
                return;
            }
            if (type === 'diffSearchRequest') {
                const msg = rawMsg as Extract<WebviewToProviderMessage, { type: 'diffSearchRequest' }>;
                if (msg.generation !== generation) { return; }
                runSearch(String(msg.query), matches => {
                    post({ type: 'diffSearch', generation, query: String(msg.query), matches });
                });
            }
        }, undefined, [resources]);

        await new Promise<void>(r => setImmediate(r));
        generation++;

        try {
            const [aLoaded, bLoaded] = await Promise.all([readAndParse(aUri), readAndParse(bUri)]);
            aState = aLoaded;
            bState = bLoaded;
        } catch (error) {
            if (!disposed) {
                post({ type: 'loadError', generation, message: error instanceof Error ? error.message : 'Failed to read pair.' });
            }
            return;
        }

        const aLabel = labelFor(aUri, 'A');
        const bLabel = labelFor(bUri, 'B');
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
            });
        };
        sendInit();
    }

    private _getHtml(webview: vscode.Webview, _uri: vscode.Uri): string {
        const nonce = 'diff';
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
</head>
<body>
<div id="app">Hex Diff View</div>
<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'hexDiffViewer.js'))}"></script>
</body>
</html>`;
    }
}
