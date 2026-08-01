import * as vscode from 'vscode';
import { HexDiffSession } from './hexDiffSession';
import { ReadonlyEditorProviderBase } from './readonlyEditorProvider';
import { encodePairKey } from '../core/pairUri';

export class HexDiffProvider extends ReadonlyEditorProviderBase {
    public static readonly viewType = 'hexScope.hexDiff';

    private constructor(context: vscode.ExtensionContext) {
        const session = new HexDiffSession(context);
        super((d, w, t) => session.resolveCustomEditor(d, w, t));
    }

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return ReadonlyEditorProviderBase.registerCustomEditor(HexDiffProvider.viewType, context, c => new HexDiffProvider(c));
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
