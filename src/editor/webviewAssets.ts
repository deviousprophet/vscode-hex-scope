import * as vscode from 'vscode';

/** Build `<link rel="stylesheet">` tags for extension-relative css files.
    Shared by the single-view and diff sessions (they each pick their own set). */
export function cssLinkTags(webview: vscode.Webview, extensionUri: vscode.Uri, cssFiles: string[]): string {
    return cssFiles.map(rel => {
        const uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, rel));
        return `    <link rel="stylesheet" href="${uri}">`;
    }).join('\n');
}
