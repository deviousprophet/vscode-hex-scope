// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { HexEditorProvider, detectFormatFromParts, repairChecksums } from './HexEditorProvider';
import { parseIntelHex } from './parser/IntelHexParser';
import { parseSRec } from './parser/SRecParser';
import type { ParseResult } from './parser/types';

async function loadHexDocument(uri: vscode.Uri): Promise<{ raw: string; format: 'ihex' | 'srec'; parseResult: ParseResult }> {
    const raw = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    const ext = uri.path.split('.').pop()?.toLowerCase() ?? '';
    const format = detectFormatFromParts(ext, raw);
    const parseResult = format === 'srec' ? parseSRec(raw) : parseIntelHex(raw);
    return { raw, format, parseResult };
}

async function openNormalEditor(uri: vscode.Uri): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
}

function commandTarget(uri?: vscode.Uri): vscode.Uri | undefined {
    return uri ?? vscode.window.activeTextEditor?.document.uri;
}

function parseResultIsValid(parseResult: ParseResult): boolean {
    return parseResult.checksumErrors === 0 && parseResult.malformedLines === 0;
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        HexEditorProvider.register(context)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hexScope.addSegmentLabel', () => {
            vscode.commands.executeCommand('hexScope.addSegmentLabelInternal');
        })
    );

    context.subscriptions.push(
            vscode.commands.registerCommand('hexScope.openInHexScope', (uri?: vscode.Uri) => {
            void (async () => {
                const target = commandTarget(uri);
                if (!target) { return; }
                const { parseResult } = await loadHexDocument(target);
                if (parseResultIsValid(parseResult)) {
                    await vscode.commands.executeCommand('vscode.openWith', target, HexEditorProvider.viewType);
                    return;
                }
                await openNormalEditor(target);
                const repair = await vscode.window.showWarningMessage(
                    'HexScope only opens valid files. Use Quick Repair to fix checksum errors in the normal editor.',
                    'Quick Repair'
                );
                if (repair) {
                    await vscode.commands.executeCommand('hexScope.quickRepair', target);
                }
            })();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hexScope.quickRepair', (uri?: vscode.Uri) => {
            void (async () => {
                const target = uri ?? vscode.window.activeTextEditor?.document.uri;
                if (!target) { return; }
                const { raw, parseResult } = await loadHexDocument(target);
                if (parseResult.checksumErrors === 0) {
                    vscode.window.showInformationMessage('HexScope: no checksum repairs were needed.');
                    return;
                }
                const repairedRaw = repairChecksums(raw, parseResult);
                if (repairedRaw === raw) {
                    vscode.window.showInformationMessage('HexScope: no checksum repairs were applied.');
                    return;
                }
                await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(repairedRaw));
                vscode.window.showInformationMessage(`HexScope: repaired ${parseResult.checksumErrors} checksum${parseResult.checksumErrors === 1 ? '' : 's'} in ${target.fsPath.split(/[\\/]/).pop()}`);
            })();
        })
    );

    // Copy commands — delegate to the active webview
    const copyCommands: Array<[string, string]> = [
        ['hexScope.copyAsHexString', 'hex'],
        ['hexScope.copyAsCArray',    'c'],
        ['hexScope.copyAsAscii',     'ascii'],
        ['hexScope.copyRawRecord',   'record'],
    ];
    for (const [cmd, format] of copyCommands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(cmd, () => {
                HexEditorProvider.postToActive({ type: 'copyCommand', format });
            })
        );
    }
}

export function deactivate() {}

