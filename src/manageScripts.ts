// ── Script creation + workspace manager ───────────────────────────
// Host-side flows behind `HexScope: Manage Scripts`, the Scripts panel's
// New split button, and the empty provider pickers (Overlay / Integrity).
//
// File writes are trust-gated and exclusive: a new script is written with
// `wx`, so an existing file is reported and never overwritten. The manager
// scans the same root `requestScriptList` scans (workspace folder, else the
// open document's directory) and opens scripts instead of running them —
// running needs a parsed document, which the manager deliberately does not.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EXAMPLE_SCRIPTS_DIR } from './core/scripting/examples';
import { SCRIPT_TEMPLATES, scriptTemplate, type ScriptTemplate, type ScriptTemplateId } from './core/scripting/templates';
import { scanScripts } from './core/scripting/scriptRunner';
import type { ScriptInfo } from './core/scripting/types';
import { scriptGrantStoreFor } from './scriptPermissions';
import type { ScriptCapabilityGrant, ScriptGrantScope, ScriptGrantView } from './webviewProtocol';
import {
    extensionBrowseDeps,
    extensionExampleDeps,
    NO_WORKSPACE_MESSAGE,
    runAddExampleScripts,
    runBrowseExampleScripts,
    workspaceRootForCommand,
} from './addExampleScripts';

export const MANAGE_SCRIPTS_COMMAND = 'hexScope.manageScripts';
export const CREATE_SCRIPT_COMMAND = 'hexScope.createScript';
export const SCRIPTS_DIR_DISPLAY = EXAMPLE_SCRIPTS_DIR;
export const UNTRUSTED_CREATE_MESSAGE =
    'HexScope: creating scripts is unavailable in an untrusted workspace. Trust the folder and try again.';
export const DUPLICATE_NAME_HINT = 'Choose a different name.';
export const JS_VERSION_MISSING_TARGET = 'HexScope: the TypeScript script no longer exists; the JavaScript version was not created.';

/** Name rules in order; the first matching rule supplies the refusal message. */
const FILE_NAME_RULES: ReadonlyArray<{ reject: (name: string) => boolean; message: string }> = [
    { reject: name => name.length === 0, message: 'Enter a file name.' },
    { reject: name => name === '.' || name === '..', message: 'Enter a valid file name.' },
    { reject: name => /[\\/]/.test(name), message: 'Use a plain file name without folders.' },
    { reject: name => !/\.(js|ts)$/i.test(name), message: 'Use a .js or .ts file name.' },
];

/** Reject a new-script name that cannot be written as a plain file in the scripts folder. */
export function validateScriptFileName(value: string): string | null {
    const name = value.trim();
    return FILE_NAME_RULES.find(rule => rule.reject(name))?.message ?? null;
}

/** Host-side dependencies for creating one script from a template. */
export interface ScriptCreateDeps {
    /** `vscode.workspace.isTrusted`; creation refuses an untrusted workspace. */
    trusted: boolean;
    /** Workspace root, or the open document's directory; null when none is known. */
    root: string | null;
    warn: (message: string) => void;
    info: (message: string) => void;
    /** Ask for the new file name (prefilled with the template's suggestion). */
    promptName: (template: ScriptTemplate) => Promise<string | undefined>;
    /** Ask which template to use when the caller did not name one. */
    pickTemplate: (templates: readonly ScriptTemplate[]) => Promise<ScriptTemplateId | undefined>;
    /** Open the created script in the editor. */
    openFile: (filePath: string) => Promise<void>;
}

/**
 * Create one script: template (named or picked), file name, exclusive write,
 * then open. Returns the written path, or null when the user cancelled or the
 * flow refused (untrusted, no root, duplicate, write error).
 */
export async function requestCreateScript(
    deps: ScriptCreateDeps,
    templateId?: ScriptTemplateId,
): Promise<string | null> {
    const template = scriptTemplate(templateId) ?? scriptTemplate(await deps.pickTemplate(SCRIPT_TEMPLATES));
    if (!template) { return null; }
    return createScriptFromTemplate(deps, template);
}

/** Write one template (no picker). Refuses duplicates; never overwrites. */
export async function createScriptFromTemplate(
    deps: ScriptCreateDeps,
    template: ScriptTemplate,
): Promise<string | null> {
    if (!deps.trusted) { deps.warn(UNTRUSTED_CREATE_MESSAGE); return null; }
    const root = deps.root;
    if (!root) { deps.warn(NO_WORKSPACE_MESSAGE); return null; }

    const name = (await deps.promptName(template))?.trim();
    if (name === undefined) { return null; }
    return writeNamedScript(deps, root, template.body, name);
}

/** Validate the name, write exclusively, then open + report the new file. */
async function writeNamedScript(
    deps: ScriptCreateDeps,
    root: string,
    body: string,
    name: string,
): Promise<string | null> {
    const invalid = validateScriptFileName(name);
    if (invalid) { deps.warn(`HexScope: ${invalid}`); return null; }

    const filePath = path.join(root, EXAMPLE_SCRIPTS_DIR, name);
    const written = writeNewScript(filePath, body);
    if (written !== 'created') { deps.warn(writeRefusal(name, written)); return null; }

    await deps.openFile(filePath);
    deps.info(`HexScope: created ${name} in ${SCRIPTS_DIR_DISPLAY}.`);
    return filePath;
}

/** Warning text for a refused write: the duplicate message, else the raw OS error. */
function writeRefusal(name: string, written: string): string {
    return written === 'exists' ? duplicateMessage(name) : `HexScope: could not create ${name}: ${written}`;
}

export function duplicateMessage(name: string): string {
    return `HexScope: ${name} already exists in ${SCRIPTS_DIR_DISPLAY}. ${DUPLICATE_NAME_HINT}`;
}

/** Exclusive write (`wx`), so an existing file is never read, replaced, or deleted. */
function writeNewScript(filePath: string, body: string): 'created' | 'exists' | string {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, body, { flag: 'wx' });
        return 'created';
    } catch (err: unknown) {
        return writeErrorReason(err);
    }
}

/** `exists` for EEXIST (the duplicate refusal), else the raw error message. */
function writeErrorReason(err: unknown): string {
    if ((err as NodeJS.ErrnoException | null)?.code === 'EEXIST') { return 'exists'; }
    return err instanceof Error ? err.message : String(err);
}

// ── TypeScript → JavaScript version (JS-first decision) ───────────
// The extension does not bundle esbuild: `.ts` is an advanced local-dev path.
// "Create JavaScript version" copies the source to a `.js` sibling (header
// comment, never overwriting, never rewriting the source) so users have a
// runnable starting point for a manual conversion.

/** Host-side dependencies for creating one `.js` version of a `.ts` script. */
export interface JsVersionDeps {
    /** `vscode.workspace.isTrusted`; creation refuses an untrusted workspace. */
    trusted: boolean;
    warn: (message: string) => void;
    info: (message: string) => void;
    /** Open the created `.js` file in the editor. */
    openFile: (filePath: string) => Promise<void>;
}

/** `.js` sibling path for a `.ts` script; null when the input is not a `.ts` file. */
export function jsVersionPath(scriptPath: string): string | null {
    return /\.ts$/i.test(scriptPath) ? scriptPath.replace(/\.ts$/i, '.js') : null;
}

/** New `.js` body: a manual-conversion header plus the untouched source. */
export function jsVersionBody(sourceName: string, source: string): string {
    return `// Created from ${sourceName} by HexScope. The TypeScript conversion is manual -\n`
        + '// review types and imports, then run this .js file (see docs/SCRIPTING.md).\n'
        + source;
}

/**
 * Copy a `.ts` script to its `.js` sibling (exclusive write; the source is
 * never modified). Returns the written path, or null when the flow refused
 * (untrusted, missing source, existing target, read/write error).
 */
export async function createJsVersion(scriptPath: string, deps: JsVersionDeps): Promise<string | null> {
    if (!deps.trusted) { deps.warn(UNTRUSTED_CREATE_MESSAGE); return null; }
    const target = jsVersionPath(scriptPath);
    if (!target) { return null; }
    const source = readScriptSource(scriptPath, deps);
    if (source === null) { return null; }
    return writeJsVersion(target, scriptPath, source, deps);
}

/** Exclusive `.js` write + open + report; null (with a warning) when the target exists. */
async function writeJsVersion(target: string, sourcePath: string, source: string, deps: JsVersionDeps): Promise<string | null> {
    const written = writeNewScript(target, jsVersionBody(path.basename(sourcePath), source));
    if (written !== 'created') {
        deps.warn(jsVersionRefusal(path.basename(target), written));
        return null;
    }
    await deps.openFile(target);
    deps.info(`HexScope: created ${path.basename(target)} from ${path.basename(sourcePath)}. Review it before running - the conversion is manual.`);
    return target;
}

/** Source read with a warn-once refusal (missing file, permissions, encoding). */
function readScriptSource(scriptPath: string, deps: JsVersionDeps): string | null {
    try {
        return fs.readFileSync(scriptPath, 'utf-8');
    } catch {
        deps.warn(JS_VERSION_MISSING_TARGET);
        return null;
    }
}

/** Warning for a refused `.js` version: the existing target, else the raw OS error. */
function jsVersionRefusal(targetName: string, written: string): string {
    return written === 'exists'
        ? `HexScope: ${targetName} already exists - the JavaScript version was not created.`
        : `HexScope: could not create ${targetName}: ${written}`;
}

/** Reveal the scripts folder, creating it in a trusted workspace so the reveal lands. */
export interface ScriptsFolderDeps {
    root: string | null;
    trusted: boolean;
    warn: (message: string) => void;
    reveal: (dir: string) => Promise<void>;
}

export async function openScriptsFolder(deps: ScriptsFolderDeps): Promise<void> {
    if (!deps.root) { deps.warn(NO_WORKSPACE_MESSAGE); return; }
    const dir = path.join(deps.root, EXAMPLE_SCRIPTS_DIR);
    ensureScriptsDir(dir, deps.trusted);
    try { await deps.reveal(dir); } catch { /* reveal is best-effort */ }
}

/** Create the folder in a trusted workspace so the reveal lands; untrusted reveals as-is. */
function ensureScriptsDir(dir: string, trusted: boolean): void {
    if (!trusted) { return; }
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* reveal is best-effort */ }
}

// ── Manage Scripts QuickPick ──────────────────────────────────────

/** One row of the manager QuickPick; `separator` rows are group labels. */
export interface ManagerItem {
    /** Stable dispatch id; empty for separators. */
    id: string;
    label: string;
    description?: string;
    detail?: string;
    separator?: boolean;
    /** Template created when the item is picked. */
    template?: ScriptTemplateId;
    /** Absolute script path opened when the item is picked. */
    scriptPath?: string;
}

/** Actions first, then Providers (alphabetical), then creation and workspace actions. */
export function buildManagerItems(scripts: readonly ScriptInfo[]): ManagerItem[] {
    const { actions, providers } = partitionScripts(scripts);
    const items: ManagerItem[] = [];
    appendScriptGroup(items, 'Actions', actions);
    appendScriptGroup(items, 'Providers', providers);
    appendGroupSeparator(items);
    items.push(...templateItems(), ...workspaceActionItems());
    appendRevealItem(items, scripts.length);
    return items;
}

/** Action/provider split mirroring the panel's card classification. */
function partitionScripts(scripts: readonly ScriptInfo[]): { actions: ScriptInfo[]; providers: ScriptInfo[] } {
    const actions: ScriptInfo[] = [];
    const providers: ScriptInfo[] = [];
    for (const script of scripts) { (isProviderScript(script) ? providers : actions).push(script); }
    return { actions, providers };
}

/** Separator between the script rows and the fixed creation/workspace rows. */
function appendGroupSeparator(items: ManagerItem[]): void {
    if (items.length === 0) { return; }
    items.push({ id: '', label: '', separator: true });
}

/** The four creation templates, in catalog order. */
function templateItems(): ManagerItem[] {
    return SCRIPT_TEMPLATES.map(template => ({
        id: `new-${template.id}`, label: template.name, description: template.description, template: template.id,
    }));
}

/** Fixed creation + workspace rows below the template list. */
function workspaceActionItems(): ManagerItem[] {
    return [
        { id: 'browse-examples', label: 'Browse examples\u2026', description: 'Copy selected bundled examples' },
        { id: 'add-all-examples', label: 'Add all examples', description: 'Copy the whole bundled catalog' },
        { id: 'manage-permissions', label: 'Manage permissions\u2026', description: 'Review and revoke stored script grants' },
        { id: 'open-scripts-folder', label: 'Open scripts folder', description: SCRIPTS_DIR_DISPLAY },
    ];
}

/** Reveal row only exists when there is a script to reveal (never a dead end). */
function appendRevealItem(items: ManagerItem[], scriptCount: number): void {
    if (scriptCount === 0) { return; }
    items.push({ id: 'reveal-script', label: 'Reveal a script in Explorer\u2026', description: 'Show a script file in the Explorer view' });
}

function appendScriptGroup(items: ManagerItem[], label: string, scripts: readonly ScriptInfo[]): void {
    if (scripts.length === 0) { return; }
    items.push({ id: '', label, separator: true });
    for (const script of [...scripts].sort((a, b) => a.name.localeCompare(b.name))) {
        items.push({
            id: `script:${script.filePath}`,
            label: script.name,
            description: 'Open',
            detail: script.filePath,
            scriptPath: script.filePath,
        });
    }
}

/** Role provider without a run entry — mirrors the panel's card classification. */
function isProviderScript(script: Pick<ScriptInfo, 'roles' | 'hasRun'>): boolean {
    if ((script.roles?.length ?? 0) === 0) { return false; }
    return script.hasRun !== true;
}

/** Host-side dependencies of one manager run (each row's action is injected). */
export interface ManageScriptsDeps {
    scanScripts: () => ScriptInfo[];
    pick: (items: readonly ManagerItem[]) => Promise<ManagerItem | undefined>;
    create: (template: ScriptTemplate) => Promise<string | null>;
    addAllExamples: () => Promise<unknown>;
    browseExamples: () => Promise<unknown>;
    managePermissions: () => Promise<void>;
    openFolder: (dir: string) => Promise<void>;
    openFile: (filePath: string) => Promise<void>;
    /** Reveal one script file in the Explorer view. */
    revealScript: (filePath: string) => Promise<void>;
    /** Scripts directory for the Open scripts folder row. */
    scriptsDir: string;
}

/** Show the manager once and run the picked row's action. */
export async function runManageScripts(deps: ManageScriptsDeps): Promise<void> {
    const item = await deps.pick(buildManagerItems(deps.scanScripts()));
    if (item) { await dispatchManagerItem(item, deps); }
}

async function dispatchManagerItem(item: ManagerItem, deps: ManageScriptsDeps): Promise<void> {
    if (item.template) {
        const template = scriptTemplate(item.template);
        if (template) { await deps.create(template); }
        return;
    }
    if (item.scriptPath) { await deps.openFile(item.scriptPath); return; }
    await dispatchManagerCommand(item.id, deps);
}

/** Dispatch a fixed row by id; unknown ids (and separators) are no-ops. */
async function dispatchManagerCommand(id: string, deps: ManageScriptsDeps): Promise<void> {
    const commands: Record<string, () => Promise<unknown>> = {
        'add-all-examples': () => deps.addAllExamples(),
        'browse-examples': () => deps.browseExamples(),
        'manage-permissions': () => deps.managePermissions(),
        'open-scripts-folder': () => deps.openFolder(deps.scriptsDir),
        'reveal-script': () => runRevealScript(deps),
    };
    await commands[id]?.();
}

/** Second pick over the same script rows; the chosen file is revealed in the Explorer view. */
async function runRevealScript(deps: ManageScriptsDeps): Promise<void> {
    const scriptItems = buildManagerItems(deps.scanScripts()).filter(item => item.scriptPath);
    const picked = await deps.pick(scriptItems);
    if (picked?.scriptPath) { await deps.revealScript(picked.scriptPath); }
}

// ── Permission center (host-side, no open document required) ──────

export interface PermissionItem {
    label: string;
    description: string;
    detail: string;
    grant: ScriptGrantView;
}

export interface ManagePermissionsDeps {
    listGrants: () => ScriptGrantView[];
    pick: (items: readonly PermissionItem[]) => Promise<PermissionItem | undefined>;
    revoke: (grant: ScriptGrantView) => void;
    info: (message: string) => void;
}

/** Pick one stored grant and revoke it; a hint when nothing is stored. */
export async function runManagePermissions(deps: ManagePermissionsDeps): Promise<void> {
    const grants = deps.listGrants();
    if (grants.length === 0) {
        deps.info('HexScope: no stored script permissions.');
        return;
    }
    const item = await deps.pick(grants.map(permissionItem));
    if (!item) { return; }
    deps.revoke(item.grant);
    deps.info(`HexScope: revoked ${item.label}.`);
}

function permissionItem(grant: ScriptGrantView): PermissionItem {
    const script = grant.scope === 'session' ? 'All scripts' : path.basename(grant.scriptPath);
    return {
        label: `${script} \u00b7 ${capabilityLabel(grant.capability)}`,
        description: scopeLabel(grant.scope),
        detail: grant.scope === 'session'
            ? 'Every script \u2014 until VS Code restarts'
            : grant.scriptPath,
        grant,
    };
}

function capabilityLabel(capability: ScriptCapabilityGrant): string {
    return capability === '*' ? 'all non-exec' : capability;
}

function scopeLabel(scope: ScriptGrantScope): string {
    if (scope === 'workspace') { return 'Workspace'; }
    if (scope === 'session') { return 'This session'; }
    return 'This script';
}

// ── Window-backed adapters + command registration ─────────────────

/** Create deps for the extension command and the webview message handler. */
export function hostCreateDeps(root: string | null): ScriptCreateDeps {
    return {
        trusted: vscode.workspace.isTrusted,
        root,
        warn: message => { void vscode.window.showWarningMessage(message); },
        info: message => { void vscode.window.showInformationMessage(message); },
        promptName: async template => vscode.window.showInputBox({
            title: template.name,
            prompt: `New file in ${SCRIPTS_DIR_DISPLAY}`,
            value: template.fileName,
            validateInput: value => validateScriptFileName(value) ?? undefined,
        }),
        pickTemplate: pickTemplateFromQuickPick,
        openFile: openScriptFile,
    };
}

/** Window-backed deps for the panel's "Create JavaScript version" action. */
export function hostJsVersionDeps(): JsVersionDeps {
    return {
        trusted: vscode.workspace.isTrusted,
        warn: message => { void vscode.window.showWarningMessage(message); },
        info: message => { void vscode.window.showInformationMessage(message); },
        openFile: openScriptFile,
    };
}

async function pickTemplateFromQuickPick(templates: readonly ScriptTemplate[]): Promise<ScriptTemplateId | undefined> {
    const picked = await vscode.window.showQuickPick(
        templates.map(template => ({
            label: template.name,
            description: template.fileName,
            detail: template.description,
            template,
        })),
        { title: 'New script', placeHolder: 'Choose a template' },
    );
    return picked?.template.id;
}

async function openScriptFile(filePath: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
}

async function pickManagerItem(items: readonly ManagerItem[]): Promise<ManagerItem | undefined> {
    const picked = await vscode.window.showQuickPick(
        items.map(managerQuickPickItem),
        { title: 'Manage Scripts', placeHolder: 'Open a script or run a script action' },
    );
    return picked?.managerItem;
}

type ManagerQuickPickItem = vscode.QuickPickItem & { managerItem: ManagerItem };

function managerQuickPickItem(item: ManagerItem): ManagerQuickPickItem {
    const quickPick: ManagerQuickPickItem = { label: item.label, managerItem: item };
    if (item.separator) { quickPick.kind = vscode.QuickPickItemKind.Separator; }
    if (item.description !== undefined) { quickPick.description = item.description; }
    if (item.detail !== undefined) { quickPick.detail = item.detail; }
    return quickPick;
}

async function pickPermissionItem(items: readonly PermissionItem[]): Promise<PermissionItem | undefined> {
    const picked = await vscode.window.showQuickPick(
        items.map(item => ({ label: item.label, description: item.description, detail: item.detail, permission: item })),
        { title: 'Script permissions', placeHolder: 'Pick a stored permission to revoke' },
    );
    return picked?.permission;
}

/** Register `hexScope.manageScripts` (works with no hex document open). */
export function registerManageScripts(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand(MANAGE_SCRIPTS_COMMAND, () => {
        const root = workspaceRootForCommand();
        if (!root) { void vscode.window.showWarningMessage(NO_WORKSPACE_MESSAGE); return; }
        return runManageScripts(extensionManagerDeps(context, root));
    });
}

/** Register `hexScope.createScript` (optional template id argument). */
export function registerCreateScript(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand(CREATE_SCRIPT_COMMAND, (templateId?: ScriptTemplateId) =>
        requestCreateScript(hostCreateDeps(workspaceRootForCommand()), templateId),
    );
}

function extensionManagerDeps(context: vscode.ExtensionContext, root: string): ManageScriptsDeps {
    const createDeps = hostCreateDeps(root);
    return {
        scanScripts: () => scanScripts(root, vscode.workspace.isTrusted),
        pick: pickManagerItem,
        create: template => createScriptFromTemplate(createDeps, template),
        addAllExamples: () => runAddExampleScripts(extensionExampleDeps(context, root)),
        browseExamples: () => runBrowseExampleScripts(extensionBrowseDeps(context, root)),
        managePermissions: () => runManagePermissions(extensionPermissionDeps(context, root)),
        openFolder: revealFolder,
        openFile: openScriptFile,
        revealScript: async filePath => { await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(filePath)); },
        scriptsDir: path.join(root, EXAMPLE_SCRIPTS_DIR),
    };
}

/** Window-backed permission center over the root's host-lifetime grant store. */
function extensionPermissionDeps(context: vscode.ExtensionContext, root: string): ManagePermissionsDeps {
    const store = () => scriptGrantStoreFor(root, context.workspaceState);
    return {
        listGrants: () => store().listGrants(),
        pick: pickPermissionItem,
        revoke: grant => { store().revokeGrant(grant.scope, grant.scriptPath, grant.capability); },
        info: message => { void vscode.window.showInformationMessage(message); },
    };
}

async function revealFolder(dir: string): Promise<void> {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
}
