import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposableStore';
import { buildDiffMeta, type DiffMeta } from '../core/diff';
import { decodePairKey } from '../core/pairUri';
import { parseIntelHexCompact } from '../core/parser/intelHexParser';
import { parseSRecCompact } from '../core/parser/srecParser';
import type { CompactParseResult } from '../core/parser/compact';
import type { HexScopeFormat } from '../core/document';
import { SearchEngine } from '../core/search';
import type { SearchEndianness, SearchMode, WireParseResult } from '../core/types';
import { toWireSegments } from '../core/transfer';
import { detectFormatFromParts } from '../core/document';
import { ProgressReporter } from './progressReporter';
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
    const checks = result.checksumErrors;
    const malformed = result.malformedLines;
    if (hasBothErrors(checks, malformed)) {
        return `Parse error: ${checks} checksum error(s), ${malformed} malformed line(s).`;
    }
    if (checks > 0) { return `Parse error: ${checks} checksum error(s).`; }
    return malformed > 0 ? `Parse error: ${malformed} malformed line(s).` : null;
}

function hasBothErrors(checks: number, malformed: number): boolean {
    return checks > 0 && malformed > 0;
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

/** Serialize a parse result for zero-copy ArrayBuffer transfer to the webview. */
function serializeParse(state: SideState): WireParseResult {
    return {
        recordCount: state.result.records.length,
        segments: toWireSegments(state.result.segments),
        totalDataBytes: state.result.totalDataBytes,
        checksumErrors: state.result.checksumErrors,
        malformedLines: state.result.malformedLines,
        startAddress: state.result.startAddress,
        format: state.format,
    };
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

        const progressReporter = new ProgressReporter(webviewPanel.webview, () => generation, 'diffProgress');
        const postProgress = progressReporter.post.bind(progressReporter);

        const aLabel = labelFor(aUri, fileName(bUri.fsPath));
        const bLabel = labelFor(bUri, fileName(aUri.fsPath));

        let pendingInit: { a: WireParseResult; b: WireParseResult; meta: DiffMeta } | null = null;

        const initNotReady = (): boolean => webviewReady === false || pendingInit === null || aState === null || bState === null;

        const sendInit = (): void => {
            if (initNotReady()) { return; }
            const init = pendingInit as { a: WireParseResult; b: WireParseResult; meta: DiffMeta };
            const a = aState as SideState;
            const b = bState as SideState;
            pendingInit = null;
            post({
                type: 'diffInit',
                generation,
                a: init.a,
                b: init.b,
                meta: init.meta,
                aLabel,
                bLabel,
                aFormat: a.format,
                bFormat: b.format,
                aError: parseErrorFor(a.result),
                bError: parseErrorFor(b.result),
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
            void runLoad(gen, seq);
        };

        const runLoad = async (gen: number, seq: number): Promise<void> => {
            const controller = new AbortController();
            loadAbort = controller;
            loading = true;
            const { signal } = controller;
            const cancelled = (): boolean => signal.aborted || disposed;
            try {
                await loadSides(signal, cancelled);
            } catch (error) {
                handleLoadError(error, gen, cancelled);
            } finally {
                finishLoading(seq);
            }
        };

        const loadSide = async (side: 'a' | 'b', signal: AbortSignal): Promise<SideState> => {
            if (side === 'a') {
                postProgress('read', 5, 100);
                return readAndParse(aUri, {
                    signal,
                    onProgress: p => postProgress('parse', Math.round(6 + 44 * fraction(p)), 100),
                });
            }
            postProgress('read', 55, 100);
            return readAndParse(bUri, {
                signal,
                onProgress: p => postProgress('parse', Math.round(56 + 39 * fraction(p)), 100),
            });
        };

        const loadSides = async (signal: AbortSignal, cancelled: () => boolean): Promise<void> => {
            const aLoaded = await loadSide('a', signal);
            if (cancelled()) { return; }
            const bLoaded = await loadSide('b', signal);
            if (cancelled()) { return; }
            await finishLoad(aLoaded, bLoaded, cancelled);
        };

        const finishLoad = async (aLoaded: SideState, bLoaded: SideState, cancelled: () => boolean): Promise<void> => {
            postProgress('build', 97, 100);
            const meta = buildDiffMeta(aLoaded.result, bLoaded.result);
            if (cancelled()) { return; }
            postProgress('transfer', 100, 100);
            aState = aLoaded;
            bState = bLoaded;
            pendingInit = { a: serializeParse(aLoaded), b: serializeParse(bLoaded), meta };
            initialized = true;
            sendInit();
        };

        const handleLoadError = (error: unknown, gen: number, cancelled: () => boolean): void => {
            if (cancelled()) { return; }
            const message = error instanceof Error ? error.message : 'Failed to read pair.';
            post({ type: 'loadError', generation: gen, message });
        };

        const finishLoading = (seq: number): void => {
            // Only the newest load may clear the loading flag: an aborted
            // load's finally must not clobber the restart that replaced it.
            if (seq === loadSeq) {
                loading = false;
                loadAbort = null;
            }
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
            handleReadyMessage(type, rawMsg);
        };
        const handleReadyMessage = (type: string | undefined, rawMsg: unknown): void => {
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
            // Search-bar styles come from the component; the diff chrome
            // (.view-tabs/.tb-sep) lives in diff.css. toolbar.css is single-view
            // only, so no duplicate search-box rules can drift apart.
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
