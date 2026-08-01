import * as vscode from 'vscode';
import { HexDiffSession } from './hexDiffSession';
import { encodePairKey } from '../core/pairUri';

export class HexDiffProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'hexScope.hexDiff';

    private readonly _session: HexDiffSession;

    constructor(context: vscode.ExtensionContext) {
        this._session = new HexDiffSession(context);
    }

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            HexDiffProvider.viewType,
            new HexDiffProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            }
        );
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken,
    ): Promise<void> {
        await this._session.resolveCustomEditor(document, webviewPanel, token);
    }
}

/**
 * Build the pair-keyed virtual document URI used to open a diff tab.
 * `vscode.openWith` dedupes tabs by this URI, so the same canonical pair
 * reuses one tab (D14).
 */
export function diffViewUri(aPath: string, bPath: string): vscode.Uri {
    return vscode.Uri.from({
        scheme: 'hexdiff',
        path: '/' + encodePairKey(aPath, bPath),
    });
}
