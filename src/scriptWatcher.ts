// ── Live script discovery ─────────────────────────────────────────
// Watches the same `.hexscope/scripts` folder `requestScriptList` scans
// (non-recursive, `*.js`/`*.ts`) and reports coalesced change events, so a
// script added/edited/deleted on disk refreshes the Scripts panel without a
// tab switch or manual Refresh. Events are debounced (trailing) and disposed
// with the session; the rescan itself stays owned by the session.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { isScriptFile } from './core/scripting/scriptCompiler';
import { EXAMPLE_SCRIPTS_DIR } from './core/scripting/examples';

/** Coalesce window for bursty watcher events (one save can emit several). */
const SCRIPT_RESCAN_DEBOUNCE_MS = 250;

/** Trailing debounce around one rescan callback (timer cleared on dispose). */
export class ScriptRescanDebounce {
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly rescan: () => void,
        private readonly delayMs: number = SCRIPT_RESCAN_DEBOUNCE_MS,
    ) {}

    /** (Re-)arm the timer; the callback fires once after the last event. */
    notify(): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.timer = setTimeout(() => {
            this.timer = null;
            this.rescan();
        }, this.delayMs);
    }

    dispose(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }
}

/** Injectable watch surface so the debounce/filter behaviour is testable without a window. */
export interface ScriptsWatcherDeps {
    /** Create the underlying watcher (window: `vscode.workspace.createFileSystemWatcher`). */
    watch: () => vscode.FileSystemWatcher;
    /** Rescan + post `scriptInfo` (coalesced). */
    rescan: () => void;
    debounceMs?: number;
}

/** Watch `.hexscope/scripts/*.{js,ts}` and debounce-rescan; dispose tears everything down. */
export function watchScriptsDir(deps: ScriptsWatcherDeps): vscode.Disposable {
    const watcher = deps.watch();
    const debounce = new ScriptRescanDebounce(deps.rescan, deps.debounceMs);
    // `.d.ts` declaration files are not scripts; ignore their events (scanScripts filters them too).
    const onChange = (uri: vscode.Uri): void => {
        if (!isScriptFile(path.basename(uri.fsPath))) { return; }
        debounce.notify();
    };
    const subscriptions = [
        watcher.onDidCreate(onChange),
        watcher.onDidChange(onChange),
        watcher.onDidDelete(onChange),
    ];
    return {
        dispose: () => {
            for (const subscription of subscriptions) { subscription.dispose(); }
            debounce.dispose();
            watcher.dispose();
        },
    };
}

/** Window-backed watcher for one session's scripts folder. */
export function createScriptsWatcher(root: string, rescan: () => void): vscode.Disposable {
    return watchScriptsDir({
        watch: () => vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(root, `${EXAMPLE_SCRIPTS_DIR}/*.{js,ts}`),
        ),
        rescan,
    });
}
