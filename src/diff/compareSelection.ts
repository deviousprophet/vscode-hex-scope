import * as vscode from 'vscode';

export interface CompareSelection {
    uri: vscode.Uri;
    name: string;
}

const COMPARE_SELECTION_CONTEXT = 'hexScope.hasCompareSelection';
const CLEAR_COMPARE_SELECTION_COMMAND = 'hexScope.clearCompareSelection';

export function selectionName(uri: vscode.Uri): string {
    return uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
}

/** Session-only stash of the left/first compare candidate, surfaced in the status bar. */
export class CompareSelectionStore implements vscode.Disposable {
    private selection: CompareSelection | null = null;
    private readonly item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        this.item.command = CLEAR_COMPARE_SELECTION_COMMAND;
    }

    get(): CompareSelection | null {
        return this.selection;
    }

    set(uri: vscode.Uri): void {
        const name = selectionName(uri);
        this.selection = { uri, name };
        this.item.text = `$(diff) HexScope: ${name}`;
        this.item.tooltip = `${uri.fsPath}\nClick to clear`;
        this.item.show();
        void vscode.commands.executeCommand('setContext', COMPARE_SELECTION_CONTEXT, true);
    }

    clear(): void {
        this.selection = null;
        this.item.hide();
        void vscode.commands.executeCommand('setContext', COMPARE_SELECTION_CONTEXT, false);
    }

    dispose(): void {
        this.item.dispose();
    }
}
