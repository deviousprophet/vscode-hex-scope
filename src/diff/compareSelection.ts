import * as vscode from 'vscode';

export interface CompareSelection {
    uri: vscode.Uri;
    name: string;
}

const COMPARE_SELECTION_CONTEXT = 'hexScope.hasCompareSelection';

export function selectionName(uri: vscode.Uri): string {
    return uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
}

/** Session-only stash of the left/first compare candidate. */
export class CompareSelectionStore {
    private selection: CompareSelection | null = null;

    get(): CompareSelection | null {
        return this.selection;
    }

    set(uri: vscode.Uri): void {
        const name = selectionName(uri);
        this.selection = { uri, name };
        void vscode.commands.executeCommand('setContext', COMPARE_SELECTION_CONTEXT, true);
    }

    clear(): void {
        this.selection = null;
        void vscode.commands.executeCommand('setContext', COMPARE_SELECTION_CONTEXT, false);
    }
}
