// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { HexEditorProvider } from './hexEditorProvider';
import { HexDiffProvider, diffViewUri } from './hexDiffProvider';
import { detectFormatFromParts, repairChecksums } from './core/document';
import { parseIntelHex } from './core/parser/intelHexParser';
import { parseSRec } from './core/parser/srecParser';
import type { ParseResult } from './core/parser/types';

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

// ── Diff staging (D7: ephemeral, session only) ─────────────────────
let stagedFirstPath: string | null = null;

const STAGED_DECORATION = 'hexScope.stagedFirst';

function openDiff(aPath: string, bPath: string): void {
    void vscode.commands.executeCommand('vscode.openWith', diffViewUri(aPath, bPath), HexDiffProvider.viewType);
}

/** Validate pair (D8/D9): distinct URIs, both parse valid; then open. */
async function validateAndOpenPair(a: vscode.Uri, b: vscode.Uri): Promise<void> {
    if (a.fsPath === b.fsPath) {
        vscode.window.showWarningMessage('HexScope: cannot diff a file with itself.');
        return;
    }
    try {
        const [{ parseResult: pa }, { parseResult: pb }] = await Promise.all([loadHexDocument(a), loadHexDocument(b)]);
        if (!parseResultIsValid(pa)) {
            vscode.window.showWarningMessage(`HexScope: ${a.fsPath.split(/[\\/]/).pop()} has parse errors; cannot diff.`);
            return;
        }
        if (!parseResultIsValid(pb)) {
            vscode.window.showWarningMessage(`HexScope: ${b.fsPath.split(/[\\/]/).pop()} has parse errors; cannot diff.`);
            return;
        }
    } catch {
        vscode.window.showWarningMessage('HexScope: failed to read one of the selected files.');
        return;
    }
    openDiff(a.fsPath, b.fsPath);
}

function diffDecorationProvider(): vscode.FileDecorationProvider {
    return {
        provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
            if (stagedFirstPath !== null && uri.fsPath === stagedFirstPath) {
                return { badge: 'A', color: new vscode.ThemeColor('charts.blue'), tooltip: 'HexScope diff: first file (A)' };
            }
            return undefined;
        },
    };
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        HexEditorProvider.register(context)
    );

    context.subscriptions.push(
        HexDiffProvider.register(context)
    );

    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(diffDecorationProvider())
    );

    // Compare selected (2 URIs) — first selected is A (D17)
    context.subscriptions.push(
        vscode.commands.registerCommand('hexScope.compareSelected', async (first?: vscode.Uri, second?: vscode.Uri) => {
            const uris = (first && second) ? [first, second] : (vscode.window.activeTextEditor?.selection
                ? [] : []);
            if (uris.length < 2) {
                const picked = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { 'Hex files': ['hex', 'ihx', 'ihex', 'srec', 'mot', 's19', 's28', 's37'] } });
                if (!picked || picked.length < 2) { return; }
                uris.push(...picked.slice(0, 2));
            }
            if (uris.length < 2) { return; }
            await validateAndOpenPair(uris[0], uris[1]);
        })
    );

    // Stage current file as A (D7/D18)
    context.subscriptions.push(
        vscode.commands.registerCommand('hexScope.selectAsFirst', (uri?: vscode.Uri) => {
            const target = commandTarget(uri);
            if (!target) { return; }
            stagedFirstPath = target.fsPath;
            void vscode.commands.executeCommand('setContext', 'hexScope.hasStagedFirst', true);
            vscode.window.showInformationMessage(`HexScope: staged ${target.fsPath.split(/[\\/]/).pop()} as first file (A).`);
        })
    );

    // Compare current file vs staged A (D7)
    context.subscriptions.push(
        vscode.commands.registerCommand('hexScope.compareToStaged', (uri?: vscode.Uri) => {
            const target = commandTarget(uri);
            if (!target || stagedFirstPath === null) { return; }
            void validateAndOpenPair(vscode.Uri.file(stagedFirstPath), target);
        })
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
        vscode.commands.registerCommand('hexScope.quickRepair', uri => {
            void runQuickRepair(uri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hexScope.runScript', () => {
            HexEditorProvider.postToActive({ type: 'activateScriptsTab' });
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

async function runQuickRepair(uri?: vscode.Uri): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) { return; }
    await repairTargetChecksums(target);
}

async function repairTargetChecksums(target: vscode.Uri): Promise<void> {
    const { raw, parseResult } = await loadHexDocument(target);
    if (showNoChecksumErrors(parseResult.checksumErrors)) { return; }
    const repairedRaw = repairChecksums(raw, parseResult);
    if (showNoChecksumRepair(raw, repairedRaw)) { return; }
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(repairedRaw));
    vscode.window.showInformationMessage(repairCompleteMessage(parseResult.checksumErrors, target));
}

function showNoChecksumErrors(checksumErrors: number): boolean {
    if (checksumErrors !== 0) { return false; }
    vscode.window.showInformationMessage('HexScope: no checksum repairs were needed.');
    return true;
}

function showNoChecksumRepair(raw: string, repairedRaw: string): boolean {
    if (repairedRaw !== raw) { return false; }
    vscode.window.showInformationMessage('HexScope: no checksum repairs were applied.');
    return true;
}

function repairCompleteMessage(checksumErrors: number, target: vscode.Uri): string {
    return `HexScope: repaired ${checksumErrors} checksum${checksumErrors === 1 ? '' : 's'} in ${target.fsPath.split(/[\\/]/).pop()}`;
}

export function deactivate() {}

