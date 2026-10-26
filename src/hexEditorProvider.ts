import * as vscode from 'vscode';
import { HexEditorSession } from './hexEditorSession';
import { migrateTypeDefinitions } from './core/overlay/overlayMigration';

export { migrateTypeDefinitions };

export class HexEditorProvider implements vscode.CustomReadonlyEditorProvider {

    public static readonly viewType = 'hexScope.hexEditor';

    private readonly _session: HexEditorSession;

    /** Post a message to the currently active HexScope webview; false when no panel is active. */
    public static postToActive(msg: unknown): boolean {
        return HexEditorSession.postToActive(msg);
    }

    constructor(
        private readonly _context: vscode.ExtensionContext,
    ) {
        this._session = new HexEditorSession(_context);
    }

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
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        await this._session.resolveCustomEditor(document, webviewPanel, token);
    }
}
