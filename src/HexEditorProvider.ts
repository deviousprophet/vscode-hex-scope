import * as vscode from 'vscode';
import { parseIntelHex, ParseResult } from './parser/IntelHexParser';

export class HexEditorProvider implements vscode.CustomReadonlyEditorProvider {

    public static readonly viewType = 'hexScope.hexEditor';

    private static _activePanel: vscode.WebviewPanel | undefined;

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
        return { uri, dispose: () => { /* nothing to dispose */ } };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };

        const raw = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(document.uri));
        const parseResult = parseIntelHex(raw);

        webviewPanel.webview.html = this._getHtml(webviewPanel.webview, document.uri, parseResult);

        // Load segment labels from workspace state
        const labelKey = `hexScope.labels.${document.uri.toString()}`;
        const storedLabels: SegmentLabel[] = this._context.workspaceState.get(labelKey, []);

        // Post initial data to webview
        webviewPanel.webview.postMessage({
            type: 'init',
            parseResult: serializeParseResult(parseResult),
            labels: storedLabels,
            rawSource: raw,
        });

        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async msg => {
            switch (msg.type) {
                case 'copyText':
                    await vscode.env.clipboard.writeText(msg.text);
                    vscode.window.showInformationMessage(`Copied: ${msg.label ?? ''}`);
                    break;
                case 'saveLabels': {
                    await this._context.workspaceState.update(labelKey, msg.labels);
                    break;
                }
                case 'updateLabelVisibility': {
                    const current: SegmentLabel[] = this._context.workspaceState.get(labelKey, []);
                    const next = current.map(l =>
                        l.id === msg.id ? { ...l, hidden: msg.hidden as boolean } : l
                    );
                    await this._context.workspaceState.update(labelKey, next);
                    break;
                }
                case 'reorderLabel': {
                    const current: SegmentLabel[] = this._context.workspaceState.get(labelKey, []);
                    const idx = current.findIndex(l => l.id === msg.id);
                    if (idx < 0) { break; }
                    const next = [...current];
                    const dir  = (msg.dir as number);
                    const swap = idx + dir;
                    if (swap < 0 || swap >= next.length) { break; }
                    [next[idx], next[swap]] = [next[swap], next[idx]];
                    await this._context.workspaceState.update(labelKey, next);
                    // Labels already updated client-side; just persist
                    break;
                }
                case 'saveEdits': {
                    // msg.edits: Array<[addr: number, value: number]>
                    const edits = msg.edits as Array<[number, number]>;
                    // Rebuild flatBytes from original parse + edits
                    const editMap = new Map<number, number>(edits);
                    const newHex = serializeIntelHex(raw, parseResult, editMap);
                    await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(newHex));
                    webviewPanel.webview.postMessage({ type: 'savedEdits' });
                    vscode.window.showInformationMessage(`HexScope: saved ${edits.length} byte${edits.length === 1 ? '' : 's'} to ${document.uri.fsPath.split(/[\/]/).pop()}`);
                    break;
                }
            }
        });

        webviewPanel.onDidChangeViewState(e => {
            if (e.webviewPanel.active) {
                HexEditorProvider._activePanel = webviewPanel;
            }
        });

        webviewPanel.onDidDispose(() => {
            if (HexEditorProvider._activePanel === webviewPanel) {
                HexEditorProvider._activePanel = undefined;
            }
        });
    }

    private _getHtml(webview: vscode.Webview, _uri: vscode.Uri, _parseResult: ParseResult): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.js')
        );

        const cssFiles = [
            'base', 'toolbar', 'layout', 'sidebar',
            'record-view', 'memory-view', 'raw-view', 'context-menu',
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
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

export interface SegmentLabel {
    id: string;
    name: string;
    startAddress: number;
    length: number;
    color: string;
    hidden?: boolean;
}

function serializeParseResult(result: ParseResult): SerializedParseResult {
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
        segments: result.segments.map(s => ({
            startAddress: s.startAddress,
            data: Array.from(s.data),
        })),
        totalDataBytes: result.totalDataBytes,
        checksumErrors: result.checksumErrors,
        malformedLines: result.malformedLines,
        startAddress: result.startAddress,
    };
}

// Types safe to transfer over the webview message boundary
export interface SerializedRecord {
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

export interface SerializedSegment {
    startAddress: number;
    data: number[];
}

export interface SerializedParseResult {
    records: SerializedRecord[];
    segments: SerializedSegment[];
    totalDataBytes: number;
    checksumErrors: number;
    malformedLines: number;
    startAddress?: number;
}

/** Rebuild an Intel HEX file from original parse + a map of addr→newValue overrides. */
function serializeIntelHex(originalRaw: string, parseResult: ParseResult, edits: Map<number, number>): string {
    if (edits.size === 0) { return originalRaw; }

    const lines: string[] = [];
    for (const rec of parseResult.records) {
        if (rec.error || rec.recordType !== 0 /* Data */) {
            lines.push(rec.raw);
            continue;
        }
        // Apply any edits that fall inside this record
        const data = Array.from(rec.data);
        let changed = false;
        for (let i = 0; i < data.length; i++) {
            const addr = rec.resolvedAddress + i;
            if (edits.has(addr)) {
                data[i] = edits.get(addr)!;
                changed = true;
            }
        }
        if (!changed) { lines.push(rec.raw); continue; }
        // Rebuild the record line with updated data + recomputed checksum
        lines.push(buildDataRecord(rec.address, data));
    }
    return lines.join('\n');
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

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
