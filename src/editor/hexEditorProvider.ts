import * as vscode from 'vscode';
import { HexEditorSession, migrateStructDefinitions } from './hexEditorSession';
import { ReadonlyEditorProviderBase } from './readonlyEditorProvider';

export { migrateStructDefinitions };

export class HexEditorProvider extends ReadonlyEditorProviderBase {
    public static readonly viewType = 'hexScope.hexEditor';

    /** Post a message to the currently active HexScope webview, if any. */
    public static postToActive(msg: unknown): void {
        HexEditorSession.postToActive(msg);
    }

    private constructor(context: vscode.ExtensionContext) {
        const session = new HexEditorSession(context);
        super((d, w, t) => session.resolveCustomEditor(d, w, t));
    }

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return ReadonlyEditorProviderBase.registerCustomEditor(HexEditorProvider.viewType, context, c => new HexEditorProvider(c));
    }
}
