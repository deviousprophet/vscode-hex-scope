import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    EXAMPLE_SCRIPTS_DIR,
    examplePickerItems,
    installExampleScripts,
    installSummary,
    type ExampleInstallResult,
    type ExamplePickerItem,
} from './core/scripting/examples';

export const ADD_EXAMPLE_SCRIPTS_COMMAND = 'hexScope.addExampleScripts';
export const OPEN_SCRIPTS_FOLDER = 'Open scripts folder';
export const OPEN_SCRIPTING_GUIDE = 'Open scripting guide';
export const UNTRUSTED_MESSAGE =
    'HexScope: adding example scripts is unavailable in an untrusted workspace. Trust the folder and try again.';
export const NO_WORKSPACE_MESSAGE = 'HexScope: open a workspace folder before using scripts.';

/** Host-side dependencies, injected so the flow is testable without a window. */
export interface AddExamplesDeps {
    /** `vscode.workspace.isTrusted`; installation refuses an untrusted workspace. */
    trusted: boolean;
    /** Bundled catalog (`<extension>/examples`). */
    catalogRoot: string;
    /** Workspace root that receives `.hexscope/scripts/`; null when none is known. */
    targetRoot: string | null;
    warn: (message: string) => void;
    info: (message: string, actions: readonly string[]) => Promise<string | undefined>;
    /** Reveal the installed scripts directory. */
    openFolder: (dir: string) => Promise<void>;
    /** Open the bundled scripting guide. */
    openGuide: () => Promise<void>;
}

/**
 * Copy the bundled example catalog into a workspace and report what happened.
 * Returns null when nothing was installed (untrusted, no workspace, or a broken
 * catalog) — the user already has a message in that case.
 */
export async function runAddExampleScripts(deps: AddExamplesDeps): Promise<ExampleInstallResult | null> {
    const targetRoot = resolveTargetRoot(deps);
    if (!targetRoot) { return null; }
    return reportInstall(deps, installOrWarn(deps, targetRoot), targetRoot);
}

/** Shared trust + workspace gate: warns and returns null when the flow must stop. */
function resolveTargetRoot(deps: AddExamplesDeps): string | null {
    if (!deps.trusted) { deps.warn(UNTRUSTED_MESSAGE); return null; }
    const targetRoot = deps.targetRoot;
    if (!targetRoot) { deps.warn(NO_WORKSPACE_MESSAGE); return null; }
    return targetRoot;
}

/** Report a completed install and run the chosen result-message action; null when refused. */
async function reportInstall(
    deps: AddExamplesDeps,
    result: ExampleInstallResult | null,
    targetRoot: string,
): Promise<ExampleInstallResult | null> {
    if (!result) { return null; }
    const action = await deps.info(installSummary(result), [OPEN_SCRIPTS_FOLDER, OPEN_SCRIPTING_GUIDE]);
    await handleAction(action, targetRoot, deps);
    return result;
}

/** Selective install: the picker chooses which catalog rows are copied. */
export interface BrowseExamplesDeps extends AddExamplesDeps {
    /** Multi-select over the catalog; resolves the chosen source paths, undefined = cancelled. */
    pick: (items: readonly ExamplePickerItem[]) => Promise<readonly string[] | undefined>;
}

/**
 * Show the catalog picker and copy only the checked rows. Cancelling or an empty
 * selection installs nothing; existing targets are still skipped by the copy.
 */
export async function runBrowseExampleScripts(deps: BrowseExamplesDeps): Promise<ExampleInstallResult | null> {
    const targetRoot = resolveTargetRoot(deps);
    if (!targetRoot) { return null; }
    const selected = await deps.pick(examplePickerItems(targetRoot));
    if (!isSelected(selected)) { return null; }
    return reportInstall(deps, installOrWarn(deps, targetRoot, selected), targetRoot);
}

/** Cancelling or an empty selection installs nothing. */
function isSelected(selected: readonly string[] | undefined): selected is readonly string[] {
    return selected !== undefined && selected.length > 0;
}

function installOrWarn(
    deps: AddExamplesDeps,
    targetRoot: string,
    selectedSources?: readonly string[],
): ExampleInstallResult | null {
    try {
        return installExampleScripts(deps.catalogRoot, targetRoot, selectedSources);
    } catch (err: unknown) {
        deps.warn(`HexScope: could not add the example scripts: ${errorMessage(err)}`);
        return null;
    }
}

async function handleAction(
    action: string | undefined,
    targetRoot: string,
    deps: AddExamplesDeps,
): Promise<void> {
    if (action === OPEN_SCRIPTS_FOLDER) { await deps.openFolder(path.join(targetRoot, EXAMPLE_SCRIPTS_DIR)); }
    else if (action === OPEN_SCRIPTING_GUIDE) { await deps.openGuide(); }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Register `hexScope.addExampleScripts` (Command Palette entry point). */
export function registerAddExampleScripts(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand(ADD_EXAMPLE_SCRIPTS_COMMAND, () =>
        runAddExampleScripts(extensionExampleDeps(context, workspaceRootForCommand())),
    );
}

/** Install into a known root (the Scripts panel posts `addExampleScripts`). */
export async function addExampleScriptsAt(
    root: string,
    context: vscode.ExtensionContext,
): Promise<ExampleInstallResult | null> {
    return runAddExampleScripts(extensionExampleDeps(context, root));
}

/** Window/catalog-backed deps for any example install flow (bulk or selective). */
export function extensionExampleDeps(context: vscode.ExtensionContext, targetRoot: string | null): AddExamplesDeps {
    return {
        trusted: vscode.workspace.isTrusted,
        catalogRoot: context.asAbsolutePath('examples'),
        targetRoot,
        warn: message => { void vscode.window.showWarningMessage(message); },
        info: async (message, actions) => vscode.window.showInformationMessage(message, ...actions),
        openFolder: async dir => { await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir)); },
        openGuide: () => openScriptingGuide(context),
    };
}

/** Bulk deps plus the multi-select QuickPick over the catalog rows. */
export function extensionBrowseDeps(context: vscode.ExtensionContext, targetRoot: string | null): BrowseExamplesDeps {
    return { ...extensionExampleDeps(context, targetRoot), pick: pickExamplesFromQuickPick };
}

async function pickExamplesFromQuickPick(items: readonly ExamplePickerItem[]): Promise<readonly string[] | undefined> {
    const picked = await vscode.window.showQuickPick(
        items.map(item => ({
            label: item.label,
            description: item.target,
            detail: item.installed ? 'Already installed \u2014 the copy will skip it' : undefined,
            picked: !item.installed,
            source: item.source,
        })),
        {
            title: 'Add example scripts',
            placeHolder: 'Select the examples to copy; existing files are never overwritten',
            canPickMany: true,
        },
    );
    return picked?.map(item => item.source);
}

/** Workspace folder first, else the active file's directory (mirrors script scanning). */
export function workspaceRootForCommand(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? parentDirectory(activeFilePath());
}

function activeFilePath(): string | null {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return uri?.scheme === 'file' ? uri.fsPath : null;
}

function parentDirectory(filePath: string | null): string | null {
    return filePath ? path.dirname(filePath) : null;
}

async function openScriptingGuide(context: vscode.ExtensionContext): Promise<void> {
    const guide = context.asAbsolutePath(path.join('docs', 'SCRIPTING.md'));
    try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(guide));
        await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
        void vscode.window.showInformationMessage('HexScope: the scripting guide is not available in this installation.');
    }
}
