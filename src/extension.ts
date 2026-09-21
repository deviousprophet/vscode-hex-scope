// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { HexEditorProvider } from './hexEditorProvider';
import { HexEditorSession } from './hexEditorSession';
import { DiffEditorPanel } from './diff/diffEditorPanel';
import {
    actionForChoice,
    BROWSE_ITEM_LABEL,
    comparisonConfirmItems,
    openEditorItems,
    pickerBasename,
} from './diff/diffPicker';
import { detectFormatFromParts, repairChecksums } from './core/document';
import { parseIntelHex } from './core/parser/intelHexParser';
import { parseSRec } from './core/parser/srecParser';
import type { ParseResult } from './core/parser/types';

const SUPPORTED_EXTENSIONS = ['hex', 'ihx', 'ihex', 'srec', 'mot', 's19', 's28', 's37'];

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
        vscode.commands.registerCommand('hexScope.compareWith', (uri?: vscode.Uri) => {
            void compareWith(context, uri);
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

async function runQuickRepair(uri?: vscode.Uri): Promise<void> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) { return; }
    await repairTargetChecksums(target);
}

async function compareWith(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
    const base = commandTarget(uri);
    if (!base || !isSupportedHexFile(base)) { return; }
    const picked = await pickComparisonTarget(base);
    if (!picked) { return; }
    const [first, second] = orderedPair(base, picked);
    await DiffEditorPanel.open(context, first, second);
}

/** Panel side order: side A is the active base file unless the user swapped the pair. */
function orderedPair(base: vscode.Uri, picked: ComparisonTarget): [vscode.Uri, vscode.Uri] {
    return picked.swap ? [picked.uri, base] : [base, picked.uri];
}

interface ComparisonTarget {
    uri: vscode.Uri;
    swap: boolean;
}

export interface ComparisonPickerDeps {
    validate: (uri: vscode.Uri) => Promise<boolean>;
    chooseOther: (base: vscode.Uri) => Promise<vscode.Uri | undefined>;
    confirm: (baseName: string, otherName: string) => Promise<string | undefined>;
}

/** Validate the base file, choose the second file, then confirm the pair (or swap sides). */
export async function resolveComparisonTarget(
    base: vscode.Uri,
    deps: ComparisonPickerDeps,
): Promise<ComparisonTarget | undefined> {
    if (!(await deps.validate(base))) { return undefined; }
    const other = await deps.chooseOther(base);
    if (!other || !(await deps.validate(other))) { return undefined; }
    return confirmedTarget(base, other, deps);
}

async function confirmedTarget(
    base: vscode.Uri,
    other: vscode.Uri,
    deps: ComparisonPickerDeps,
): Promise<ComparisonTarget | undefined> {
    const baseName = pickerBasename(base.fsPath);
    const otherName = pickerBasename(other.fsPath);
    const action = actionForChoice(await deps.confirm(baseName, otherName), baseName, otherName);
    return action === 'cancel' ? undefined : { uri: other, swap: action === 'swap' };
}

async function pickComparisonTarget(base: vscode.Uri): Promise<ComparisonTarget | undefined> {
    return resolveComparisonTarget(base, {
        validate: validateComparable,
        chooseOther: chooseOtherFile,
        confirm: async (baseName, otherName) => vscode.window.showQuickPick(
            comparisonConfirmItems(baseName, otherName),
            { placeHolder: 'Compare files' },
        ),
    });
}

type PickerQuickItem = vscode.QuickPickItem & { uri?: string; browse?: boolean };

async function chooseOtherFile(base: vscode.Uri): Promise<vscode.Uri | undefined> {
    const items: PickerQuickItem[] = [
        ...openEditorItems(supportedOpenPaths(), base.fsPath),
        { label: BROWSE_ITEM_LABEL, browse: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Compare with…',
    });
    if (!picked) { return undefined; }
    if (picked.browse) { return browseForFile(); }
    return picked.uri ? vscode.Uri.file(picked.uri) : undefined;
}

async function browseForFile(): Promise<vscode.Uri | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Compare with',
        filters: { 'Firmware files': SUPPORTED_EXTENSIONS },
    });
    return firstUri(picked);
}

/** Paths of supported files open in text editors or loaded as documents, deduped. */
function supportedOpenPaths(): string[] {
    const paths = new Set<string>();
    for (const path of openTabPaths()) { paths.add(path); }
    for (const path of documentPaths()) { paths.add(path); }
    return [...paths];
}

function openTabPaths(): string[] {
    return vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .map(tab => tab.input)
        .filter((input): input is vscode.TabInputText => input instanceof vscode.TabInputText)
        .map(input => input.uri)
        .filter(isSupportedHexFile)
        .map(uri => uri.fsPath);
}

function documentPaths(): string[] {
    return vscode.workspace.textDocuments
        .filter(document => isSupportedHexFile(document.uri))
        .map(document => document.uri.fsPath);
}

function firstUri(uris: readonly vscode.Uri[] | undefined): vscode.Uri | undefined {
    if (!uris || uris.length === 0) { return undefined; }
    return uris[0];
}

function isSupportedHexFile(uri: vscode.Uri): boolean {
    return SUPPORTED_EXTENSIONS.includes(uri.path.split('.').pop()?.toLowerCase() ?? '');
}

async function validateComparable(uri: vscode.Uri): Promise<boolean> {
    const { parseResult } = await loadHexDocument(uri);
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

