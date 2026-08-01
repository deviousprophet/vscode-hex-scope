import * as vscode from 'vscode';

/**
 * Shared plumbing for both readonly custom-editor providers (hex editor + hex diff).
 * The concrete session is held by the subclass and passed as a closure, so
 * fallow can trace `resolveCustomEditor` back to its use.
 */
export abstract class ReadonlyEditorProviderBase implements vscode.CustomReadonlyEditorProvider {
    protected constructor(
        protected readonly resolve: (
            document: vscode.CustomDocument,
            webviewPanel: vscode.WebviewPanel,
            token: vscode.CancellationToken,
        ) => Promise<void>,
    ) {}

    /** Build a provider with a fresh concrete session, then register it. */
    public static registerCustomEditor<T extends ReadonlyEditorProviderBase>(
        viewType: string,
        context: vscode.ExtensionContext,
        makeProvider: (context: vscode.ExtensionContext) => T,
    ): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(viewType, makeProvider(context), {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false,
        });
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
        await this.resolve(document, webviewPanel, token);
    }
}
