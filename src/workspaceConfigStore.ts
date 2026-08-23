// ── Workspace config host adapter ─────────────────────────────────
// VS Code filesystem access for the team-shared `.hexscope/config.json`.
// Pure model logic stays in `src/core/workspaceConfigModel.ts`; this file
// owns the extension-host FS seam (placement rule: FS effects live in the
// smallest host adapter, not in `src/core/`).

import * as vscode from 'vscode';
import {
    normalizeWorkspaceConfig,
    type WorkspaceConfig,
} from './core/workspaceConfigModel';

export const HEXSCOPE_DIR = '.hexscope';
export const WORKSPACE_CONFIG_FILENAME = 'config.json';

/** Root of the workspace folder containing the document; null outside any folder. */
export function workspaceRootOf(documentUri: vscode.Uri): vscode.Uri | null {
    const folder = vscode.workspace.getWorkspaceFolder(documentUri);
    return folder ? folder.uri : null;
}

/** `.hexscope/config.json` URI for the document's workspace; null outside a workspace. */
export function workspaceConfigUri(documentUri: vscode.Uri): vscode.Uri | null {
    const root = workspaceRootOf(documentUri);
    return root ? vscode.Uri.joinPath(root, HEXSCOPE_DIR, WORKSPACE_CONFIG_FILENAME) : null;
}

/** Stable per-firmware-file key (workspace-relative, posix); null outside a workspace. */
export function fileScopeKey(documentUri: vscode.Uri): string | null {
    const root = workspaceRootOf(documentUri);
    if (!root) { return null; }
    const rel = vscode.workspace.asRelativePath(documentUri, false);
    return rel.split('\\').join('/');
}

/** Read + normalize `.hexscope/config.json`; null when absent or unreadable. */
export async function readWorkspaceConfig(documentUri: vscode.Uri): Promise<WorkspaceConfig | null> {
    const uri = workspaceConfigUri(documentUri);
    if (!uri) { return null; }
    try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8').decode(raw));
        return normalizeWorkspaceConfig(parsed);
    } catch {
        return null;
    }
}

/** Atomically write `.hexscope/config.json`; false when the document is outside a workspace. */
export async function writeWorkspaceConfig(documentUri: vscode.Uri, config: WorkspaceConfig): Promise<boolean> {
    const root = workspaceRootOf(documentUri);
    if (!root) { return false; }
    const dir = vscode.Uri.joinPath(root, HEXSCOPE_DIR);
    await vscode.workspace.fs.createDirectory(dir);
    const uri = vscode.Uri.joinPath(dir, WORKSPACE_CONFIG_FILENAME);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(config, null, 2)));
    return true;
}