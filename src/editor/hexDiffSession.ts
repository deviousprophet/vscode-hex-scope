import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposableStore';
import { buildDiffMeta, type DiffMeta } from '../core/diff';
import { decodePairKey } from '../core/pairUri';
import { parseIntelHexCompact } from '../core/parser/intelHexParser';
import { parseSRecCompact } from '../core/parser/srecParser';
import type { CompactParseResult } from '../core/parser/compact';
import type { HexScopeFormat } from '../core/document';
import { SearchEngine } from '../core/search';
import type { SearchEndianness, SearchMode } from '../core/types';
import type { SegmentLabel, WireParseResult } from '../core/types';
import { detectFormatFromParts } from '../core/document';
import type { ProviderToWebviewMessage, WebviewToProviderMessage } from '../webviewProtocol';
import { messageType } from '../webviewProtocol';

function formatForPath(path: string): HexScopeFormat {
    return detectFormatFromParts(path.split('.').pop()?.toLowerCase() ?? '', '');
}

type SideState = { source: string; format: HexScopeFormat; result: CompactParseResult };

type ParseProgress = { stage: 'parse' | 'build'; completed: number; total: number };

async function readAndParse(
    uri: vscode.Uri,
    options: { signal?: AbortSignal; onProgress?: (progress: ParseProgress) => void } = {},
): Promise<SideState> {
    const source = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    const format = formatForPath(uri.fsPath);
    const result = format === 'srec'
        ? await parseSRecCompact(source, options)
        : await parseIntelHexCompact(source, options);
    return { source, format, result };
}

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

/** Editor-tab-style label: the base filename, or `<dir>/<name>` when the two files share a name. */
function labelFor(uri: vscode.Uri, otherName: string): string {
    const name = fileName(uri.fsPath);
    if (name !== otherName) { return name; }
    const parts = uri.fsPath.split(/[\/\\]/).filter(Boolean);
    const dir = parts[parts.length - 2];
    return dir ? `${dir}/${name}` : name;
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

/** Serialize a parse result for zero-copy ArrayBuffer transfer to the webview. */
function serializeParse(state: SideState): WireParseResult {
    return {
        recordCount: state.result.records.length,
        segments: state.result.segments.map(s => ({
            startAddress: s.startAddress,
            data: s.data.buffer.slice(s.data.byteOffset, s.data.byteOffset + s.data.byteLength) as ArrayBuffer,
        })),
        totalDataBytes: state.result.totalDataBytes,
        checksumErrors: state.result.checksumErrors,
        malformedLines: state.result.malformedLines,
        startAddress: state.result.startAddress,
        format: state.format,
    };
}

/** Throttled staged-load progress poster for the diff view (mirrors the single view's reporter). */
class DiffProgressReporter {
    private lastAt = 0;
    private lastStage = '';
    private pending: ProviderToWebviewMessage | null = null;
    private flushed = false;

    constructor(
        private readonly webview: vscode.Webview,
        private readonly generation: () => number,
    ) {}

    public post(stage: 'read' | 'parse' | 'build' | 'transfer', completed: number, total: number): void {
        const now = Date.now();
        if (stage === this.lastStage && completed !== total && now - this.lastAt < 100) { return; }
        this.lastAt = now;
        this.lastStage = stage;
        this.pending = { type: 'diffProgress', generation: this.generation(), stage, completed, total };
        if (this.flushed) {
            void this.webview.postMessage(this.pending);
        }
    }

    public flush(): void {
        if (this.pending) {
            void this.webview.postMessage(this.pending);
            this.pending = null;
        }
        this.flushed = true;
    }
}

export class HexDiffSession {

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
        let initialized = false;
        let aState: SideState | null = null;
        let bState: SideState | null = null;
        let swap = false;
        let reloadTimer: ReturnType<typeof setTimeout> | undefined;
        let loadAbort: AbortController | null = null;
        let loadSeq = 0;
        let loading = false;
        let searchSeq = 0;

        const post = (msg: ProviderToWebviewMessage): void => {
            if (!disposed) { void webviewPanel.webview.postMessage(msg); }
        };

        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this._getHtml(webviewPanel.webview, document.uri);
        webviewPanel.onDidDispose(() => resources.dispose());
        resources.add(() => {
            disposed = true;
            clearTimeout(reloadTimer);
            loadAbort?.abort();
            loadAbort = null;
        });

        const progressReporter = new DiffProgressReporter(webviewPanel.webview, () => generation);
        const postProgress = progressReporter.post.bind(progressReporter);

        const aLabel = labelFor(aUri, fileName(bUri.fsPath));
        const bLabel = labelFor(bUri, fileName(aUri.fsPath));

        let pendingInit: { a: WireParseResult; b: WireParseResult; meta: DiffMeta } | null = null;

        const sendInit = (): void => {
            if (!webviewReady || !pendingInit || !aState || !bState) { return; }
            const init = pendingInit;
            pendingInit = null;
            post({
                type: 'diffInit',
                generation,
                a: init.a,
                b: init.b,
                meta: init.meta,
                aLabel,
                bLabel,
                aFormat: aState.format,
                bFormat: bState.format,
                aError: parseErrorFor(aState.result),
                bError: parseErrorFor(bState.result),
                aLabels: readLabels(this._context, aUri),
                bLabels: readLabels(this._context, bUri),
            });
        };

        const postUpdate = (meta: DiffMeta): void => {
            if (!aState || !bState) { return; }
            post({
                type: 'diffUpdate',
                generation,
                a: serializeParse(aState),
                b: serializeParse(bState),
                meta,
                aError: parseErrorFor(aState.result),
                bError: parseErrorFor(bState.result),
            });
        };

        const recompute = (): void => {
            if (!aState || !bState || !initialized) { return; }
            postProgress('build', 90, 100);
            const meta = buildDiffMeta(aState.result, bState.result);
            postProgress('transfer', 100, 100);
            postUpdate(meta);
        };

        /** Sequential staged load: read A -> parse A -> read B -> parse B -> build -> transfer. */
        const startLoad = (gen: number): void => {
            const seq = ++loadSeq;
            void (async (): Promise<void> => {
                const controller = new AbortController();
                loadAbort = controller;
                loading = true;
                const { signal } = controller;
                const cancelled = (): boolean => signal.aborted || disposed;
                try {
                    postProgress('read', 5, 100);
                    const aLoaded = await readAndParse(aUri, {
                        signal,
                        onProgress: p => postProgress('parse', Math.round(6 + 44 * fraction(p)), 100),
                    });
                    if (cancelled()) { return; }
                    postProgress('read', 55, 100);
                    const bLoaded = await readAndParse(bUri, {
                        signal,
                        onProgress: p => postProgress('parse', Math.round(56 + 39 * fraction(p)), 100),
                    });
                    if (cancelled()) { return; }
                    postProgress('build', 97, 100);
                    const meta = buildDiffMeta(aLoaded.result, bLoaded.result);
                    if (cancelled()) { return; }
                    postProgress('transfer', 100, 100);
                    aState = aLoaded;
                    bState = bLoaded;
                    pendingInit = { a: serializeParse(aLoaded), b: serializeParse(bLoaded), meta };
                    initialized = true;
                    sendInit();
                } catch (error) {
                    if (cancelled() || disposed) { return; }
                    const message = error instanceof Error ? error.message : 'Failed to read pair.';
                    post({ type: 'loadError', generation: gen, message });
                } finally {
                    // Only the newest load may clear the loading flag: an aborted
                    // load's finally must not clobber the restart that replaced it.
                    if (seq === loadSeq) {
                        loading = false;
                        loadAbort = null;
                    }
                }
            })();
        };

        const reloadSide = async (uri: vscode.Uri, side: 'a' | 'b'): Promise<void> => {
            try {
                postProgress('read', 5, 100);
                const loaded = await readAndParse(uri, {
                    onProgress: p => postProgress('parse', Math.round(6 + 84 * fraction(p)), 100),
                });
                if (side === 'a') { aState = loaded; } else { bState = loaded; }
                recompute();
            } catch {
                /* file transiently unavailable; keep last state */
            }
        };

        const onExternalChange = (uri: vscode.Uri): void => {
            if (disposed) { return; }
            if (loading) {
                // Abort + restart (generation bump) so a mid-load edit is never lost.
                loadAbort?.abort();
                clearTimeout(reloadTimer);
                void startLoad(++generation);
                return;
            }
            const side = uri.fsPath === aUri.fsPath ? 'a' : 'b';
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => { void reloadSide(uri, side); }, 200);
        };

        const watch = (uri: vscode.Uri): void => {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(
                    vscode.Uri.joinPath(uri, '..'),
                    uri.path.split('/').pop()!,
                )
            );
            watcher.onDidChange(onExternalChange);
            watcher.onDidCreate(onExternalChange);
            resources.add(watcher);
        };
        watch(aUri);
        watch(bUri);

        const runSearch = (rawMsg: unknown): void => {
            const msg = rawMsg as Extract<WebviewToProviderMessage, { type: 'diffSearchRequest' }>;
            if (msg.generation !== generation) { return; }
            const seq = ++searchSeq;
            const query = String(msg.query).trim();
            const mode = msg.mode;
            const endianness = msg.endianness;
            const aMatches: number[] = [];
            const bMatches: number[] = [];
            const done = { a: !aState, b: !bState };
            const sideMatches = (mark: 'a' | 'b'): number[] => (mark === 'a' ? aMatches : bMatches);
            const union = (): number[] => {
                const merged = aMatches.concat(bMatches);
                merged.sort((x, y) => x - y);
                const out: number[] = [];
                for (const m of merged) {
                    if (out[out.length - 1] !== m) { out.push(m); }
                }
                return out;
            };
            const postUnion = (finished: boolean): void => {
                if (seq !== searchSeq || disposed) { return; }
                post({ type: 'diffSearch', generation, query: String(msg.query), matches: union(), done: finished });
            };
            const runOne = (state: SideState | null, mark: 'a' | 'b'): void => {
                if (!state) {
                    done[mark] = true;
                    postUnion(done.a && done.b);
                    return;
                }
                new SearchEngine().search(
                    { mode, endianness, raw: query, segments: state.result.segments },
                    {
                        onProgressUpdate: matches => {
                            const list = sideMatches(mark);
                            list.length = 0;
                            list.push(...matches);
                            postUnion(false);
                        },
                        onComplete: matches => {
                            const list = sideMatches(mark);
                            list.length = 0;
                            list.push(...matches);
                            done[mark] = true;
                            postUnion(done.a && done.b);
                        },
                    },
                );
            };
            runOne(aState, 'a');
            runOne(bState, 'b');
        };

        const onReady = (): void => {
            webviewReady = true;
            progressReporter.flush();
            sendInit();
        };
        const handleMessage = (rawMsg: unknown): void => {
            const type = messageType(rawMsg);
            if (type === 'diffReady') { onReady(); return; }
            if (!webviewReady) { return; }
            if (type === 'diffSwapRequest') {
                swap = !swap;
                post({ type: 'diffSwap', generation, swapped: swap });
                return;
            }
            if (type === 'diffSearchRequest') { runSearch(rawMsg); }
        };
        webviewPanel.webview.onDidReceiveMessage(handleMessage, undefined, [resources]);

        await new Promise<void>(r => setImmediate(r));
        generation++;
        startLoad(generation);
    }

    private _getHtml(webview: vscode.Webview, _uri: vscode.Uri): string {
        const nonce = getNonce();
        const cssFiles = [
            'src/webview/styles/base.css',
            'src/webview/styles/toolbar.css',
            'src/webview/ui-components/search-bar/searchBarComponent.css',
            'src/webview/ui-components/hex-view/hexViewComponent.css',
            'src/webview/styles/diff.css',
        ];
        const cssLinks = cssFiles.map(rel => {
            const uri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, rel));
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
<div id="app">
    <div class="loading-shell" aria-live="polite">
        <div class="loading-card">
            <div class="loading-eyebrow">HexScope</div>
            <div class="loading-title">Loading files</div>
            <div id="load-text" class="loading-text">Reading and parsing both files…</div>
            <div class="loading-bar" role="presentation"><div id="load-fill" class="loading-bar-fill"></div></div>
        </div>
    </div>
</div>
<div id="status"></div>
<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'hexDiffViewer.js'))}"></script>
</body>
</html>`;
    }
}

function fraction(progress: ParseProgress): number {
    return progress.total > 0 ? progress.completed / progress.total : 1;
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
