// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { HexEditorProvider } from './hexEditorProvider';
import { HexEditorSession } from './hexEditorSession';
import { DiffEditorPanel } from './diff/diffEditorPanel';
import { CompareSelectionStore, selectionName, type CompareSelection } from './diff/compareSelection';
import { detectFormatFromParts, repairChecksums } from './core/document';
import { parseIntelHex } from './core/parser/intelHexParser';
import { parseSRec } from './core/parser/srecParser';
import type { ParseResult } from './core/parser/types';

const SUPPORTED_EXTENSIONS = ['hex', 'ihx', 'ihex', 'srec', 'mot', 's19', 's28', 's37'];

export const COMPARE_SELECT_HINT = 'Select a firmware file in the Explorer';
export const COMPARE_TWO_HINT = 'Select exactly two firmware files';

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

    const compareSelection = new CompareSelectionStore();

    const compareDeps: CompareCommandDeps = {
        validate: validateComparable,
        open: (a, b) => DiffEditorPanel.open(context, a, b),
        warn: message => { void vscode.window.showWarningMessage(message); },
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('hexScope.selectAsFirst', (uri?: vscode.Uri) => {
            selectAsFirst(uri, {
                setStash: target => compareSelection.set(target),
                warn: compareDeps.warn,
                info: message => { void vscode.window.showInformationMessage(message); },
            });
        }),
        vscode.commands.registerCommand('hexScope.compareToStaged', (uri?: vscode.Uri) => {
            void runCompare(
                stashedComparePair(compareSelection.get(), uri),
                COMPARE_SELECT_HINT,
                compareDeps,
                () => compareSelection.clear(),
            );
        }),
        vscode.commands.registerCommand('hexScope.compareSelected', (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
            void runCompare(selectedComparePair(uri, selectedUris), COMPARE_TWO_HINT, compareDeps);
        }),
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

    // Profile registry CRUD + select (three-tier profile system)
    context.subscriptions.push(
        vscode.commands.registerCommand('hexScope.selectProfile', () => {
            void HexEditorSession.selectProfileCommand();
        }),
        vscode.commands.registerCommand('hexScope.newProfile', () => {
            void HexEditorSession.newProfileCommand();
        }),
        vscode.commands.registerCommand('hexScope.duplicateProfile', () => {
            void HexEditorSession.duplicateProfileCommand();
        }),
        vscode.commands.registerCommand('hexScope.renameProfile', () => {
            void HexEditorSession.renameProfileCommand();
        }),
        vscode.commands.registerCommand('hexScope.deleteProfile', () => {
            void HexEditorSession.deleteProfileCommand();
        }),
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

export interface CompareCommandDeps {
    validate: (uri: vscode.Uri) => Promise<boolean>;
    open: (a: vscode.Uri, b: vscode.Uri) => Promise<void>;
    warn: (message: string) => void;
}

export interface SelectCompareDeps {
    setStash: (uri: vscode.Uri) => void;
    warn: (message: string) => void;
    info: (message: string) => void;
}

/** Explorer `Compare Two Files`: the clicked file is A/left, the other selected file B/right. */
export function selectedComparePair(
    clicked: vscode.Uri | undefined,
    selected: readonly vscode.Uri[] | undefined,
): [vscode.Uri, vscode.Uri] | undefined {
    if (!clicked || !isSupportedHexFile(clicked)) { return undefined; }
    const companion = soleCompanion(clicked, selected);
    return companion ? [clicked, companion] : undefined;
}

/** The one other supported selected file, or undefined unless exactly one remains. */
function soleCompanion(clicked: vscode.Uri, selected: readonly vscode.Uri[] | undefined): vscode.Uri | undefined {
    const others = uniqueUris(selected ?? [])
        .filter(isSupportedHexFile)
        .filter(uri => uri.toString() !== clicked.toString());
    return others.length === 1 ? others[0] : undefined;
}

/** `Compare with the 1st file`: the stashed file is A/left, the clicked file B/right. */
export function stashedComparePair(
    stash: CompareSelection | null,
    clicked: vscode.Uri | undefined,
): [vscode.Uri, vscode.Uri] | undefined {
    if (!stash || !clicked || !isSupportedHexFile(clicked)) { return undefined; }
    return [stash.uri, clicked];
}

/** Validate both sides, then open the diff panel; `onSuccess` runs only on a successful open. */
export async function runCompare(
    pair: [vscode.Uri, vscode.Uri] | undefined,
    hint: string,
    deps: CompareCommandDeps,
    onSuccess?: () => void,
): Promise<boolean> {
    if (!pair) { deps.warn(hint); return false; }
    if (!(await bothComparable(pair, deps.validate))) { return false; }
    await deps.open(pair[0], pair[1]);
    onSuccess?.();
    return true;
}

async function bothComparable(pair: [vscode.Uri, vscode.Uri], validate: CompareCommandDeps['validate']): Promise<boolean> {
    return (await validate(pair[0])) && (await validate(pair[1]));
}

/** `Set as 1st file to compare`: stash the clicked supported file for the next `Compare with the 1st file`. */
export function selectAsFirst(uri: vscode.Uri | undefined, deps: SelectCompareDeps): boolean {
    if (!uri || !isSupportedHexFile(uri)) { deps.warn(COMPARE_SELECT_HINT); return false; }
    deps.setStash(uri);
    deps.info(`HexScope: ${selectionName(uri)} set as the 1st file. Open the second file and run "Compare with the 1st file".`);
    return true;
}

function uniqueUris(uris: readonly vscode.Uri[]): vscode.Uri[] {
    const seen = new Set<string>();
    const result: vscode.Uri[] = [];
    for (const uri of uris) {
        const key = uri.toString();
        if (seen.has(key)) { continue; }
        seen.add(key);
        result.push(uri);
    }
    return result;
}

async function runQuickRepair(uri?: vscode.Uri): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) { return; }
    await repairTargetChecksums(target);
}

function isSupportedHexFile(uri: vscode.Uri): boolean {
    return SUPPORTED_EXTENSIONS.includes(uri.path.split('.').pop()?.toLowerCase() ?? '');
}

/** Read + parse, or undefined when the file is missing/moved/unreadable. */
async function readParseResult(uri: vscode.Uri): Promise<ParseResult | undefined> {
    try {
        return (await loadHexDocument(uri)).parseResult;
    } catch {
        return undefined;
    }
}

async function validateComparable(uri: vscode.Uri): Promise<boolean> {
    const parseResult = await readParseResult(uri);
    if (!parseResult) {
        await vscode.window.showWarningMessage(
            `HexScope: cannot read ${selectionName(uri)} for comparison.`
        );
        return false;
    }
    if (parseResultIsValid(parseResult)) { return true; }
    await openNormalEditor(uri);
    const repair = await vscode.window.showWarningMessage(
        'HexScope can only compare valid files. Use Quick Repair to fix checksum errors in the normal editor.',
        'Quick Repair'
    );
    if (repair) {
        await vscode.commands.executeCommand('hexScope.quickRepair', uri);
    }
    return false;
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
