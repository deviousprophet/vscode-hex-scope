import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DisposableStore } from '../core/disposableStore';
import { detectFormatFromParts, type HexScopeFormat } from '../core/document';
import { computeByteDiff } from '../core/diff';
import { disambiguatedLabels } from '../core/diffLabels';
import { parseIntelHexCompact } from '../core/parser/intelHexParser';
import { parseSRecCompact } from '../core/parser/srecParser';
import type { CompactParseResult } from '../core/parser/compact';
import { serializeParseResult } from '../core/wire';
import { diffCopyText, diffMessageType, type DiffProviderToWebview, type DiffSide } from '../diffProtocol';

interface ParsedDiffFile {
    format: HexScopeFormat;
    result: CompactParseResult;
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

        panel.webview.html = diffHtml(context, panel.webview);

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
            try {
                const [base, other] = await Promise.all([
                    parseDiffFile(baseUri, controller.signal),
                    parseDiffFile(otherUri, controller.signal),
                ]);
                if (staleDiff(disposed, gen, generation)) { return; }
                const diff = computeByteDiff(base.result.segments, other.result.segments);
                await DiffEditorPanel.post(panel, {
                    type: 'diffInit',
                    generation: gen,
                    a: diffSide(baseUri, base),
                    b: diffSide(otherUri, other),
                    diff,
                });
            } catch (error) {
                if (!disposed) {
                    await DiffEditorPanel.post(panel, { type: 'diffError', generation: gen, message: diffErrorMessage(error) });
                }
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

async function parseDiffFile(uri: vscode.Uri, signal: AbortSignal): Promise<ParsedDiffFile> {
    const raw = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    const format = detectFormatFromParts(extensionOf(uri), raw);
    const options = { signal };
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

function diffHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'diffViewer.js')
    );
    const cssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'diffViewer.css')
    );
    const baseUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'styles', 'base.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="${baseUri}">
    <link rel="stylesheet" href="${cssUri}">
    <title>HexScope Diff</title>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}
