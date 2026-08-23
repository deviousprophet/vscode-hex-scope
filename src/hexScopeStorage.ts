import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * On-disk persistence for Hex Scope state under `.hexscope/` in the workspace.
 *
 * Layout (mirrors the workspace-relative path of the hex/srec file):
 *
 *   <root>/.hexscope/
 *     structs.json        StructDef[]                (shared, git-tracked)
 *     integrity.json      IntegrityProfile[]         (shared, git-tracked)
 *     data/<rel>.json     { labels, segmentNames }   (shared, git-tracked)
 *     local/<rel>.json    { pins, activeChecks, endian } (per-user, gitignored)
 *     .gitignore          contains "local/"
 *
 * Root resolution matches the scripts directory: the workspace folder for the
 * document, else the file's own directory (single-file-open fallback).
 */

const HEXSCOPE_DIR = '.hexscope';
const DEFAULT_DEBOUNCE_MS = 400;

export function resolveHexScopeRoot(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? folder.uri.fsPath : path.dirname(uri.fsPath);
}

/** Document path relative to the resolved root, POSIX separators. */
export function perFileRelativePath(root: string, uri: vscode.Uri): string {
    return path.relative(root, uri.fsPath).split(path.sep).join('/');
}

function hexScopeUri(root: string, ...segments: string[]): vscode.Uri {
    return vscode.Uri.file(path.join(root, HEXSCOPE_DIR, ...segments));
}

export function structsFileUri(root: string): vscode.Uri {
    return hexScopeUri(root, 'structs.json');
}

export function integrityFileUri(root: string): vscode.Uri {
    return hexScopeUri(root, 'integrity.json');
}

export function perFileDataUri(root: string, relPath: string): vscode.Uri {
    return hexScopeUri(root, 'data', `${relPath}.json`);
}

export function perFileLocalUri(root: string, relPath: string): vscode.Uri {
    return hexScopeUri(root, 'local', `${relPath}.json`);
}

type JsonRead =
    | { status: 'ok'; value: unknown }
    | { status: 'missing' }
    | { status: 'corrupt' };

export async function readJson(uri: vscode.Uri): Promise<JsonRead> {
    let bytes: Uint8Array;
    try {
        bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error) {
        return isFileNotFound(error) ? { status: 'missing' } : { status: 'corrupt' };
    }
    try {
        return { status: 'ok', value: JSON.parse(new TextDecoder('utf-8').decode(bytes)) };
    } catch {
        return { status: 'corrupt' };
    }
}

function isFileNotFound(error: unknown): boolean {
    const code = (error as { code?: unknown } | undefined)?.code;
    if (code === 'FileNotFound' || code === 'ENOENT') { return true; }
    return String(error).includes('FileNotFound');
}

export async function writeJson(uri: vscode.Uri, value: unknown, root: string): Promise<void> {
    await seedHexScopeGitignore(root);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
}

// ── .gitignore seeding ─────────────────────────────────────────────
// Seed `.hexscope/.gitignore` with "local/" once per root per session, on
// first write to `.hexscope/`. Never overwrite an existing file that already
// lists `local/`; do not re-add if the user removed the line mid-session.

const seededGitignoreRoots = new Set<string>();

async function seedHexScopeGitignore(root: string): Promise<void> {
    if (seededGitignoreRoots.has(root)) { return; }
    seededGitignoreRoots.add(root);
    try {
        if (!alreadyBlocksLocal(await readText(hexScopeUri(root, '.gitignore')))) {
            await writeGitignore(hexScopeUri(root, '.gitignore'));
        }
    } catch { /* non-fatal: never break persistence over gitignore bookkeeping */ }
}

function alreadyBlocksLocal(text: string | null): boolean {
    return text !== null && /(^|\r?\n)\s*local\/?\s*(\r?\n|$)/m.test(text);
}

async function writeGitignore(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('local/\n'));
}

async function readText(uri: vscode.Uri): Promise<string | null> {
    try {
        return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
    } catch {
        return null;
    }
}

// ── Debounced JSON file store ──────────────────────────────────────

export interface NormalizedValue<T> {
    value: T;
    changed: boolean;
}

export type ValueNormalizer<T> = (raw: unknown) => NormalizedValue<T>;

/**
 * One debounced JSON blob. The in-memory cache is the source of truth for
 * reads; writes are scheduled on an idle timer and flushed immediately on
 * dispose. External (non-self) file changes reload the cache via `reload()`.
 */
export class JsonStore<T> {
    private cache: T | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private loaded = false;
    private corruptNotified = false;

    constructor(
        readonly uri: vscode.Uri,
        private readonly root: string,
        private readonly normalize: ValueNormalizer<T>,
        private readonly empty: () => T,
        /** Stamps the session self-write horizon after any host-issued write. */
        private readonly onSelfWrite: () => void,
        private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
    ) {}

    /** Load (or reload) the file into the cache; self-heals when normalized output differs. */
    async load(force = false): Promise<T> {
        if (this.loaded && !force) { return this.cache as T; }
        return this.applyRead(await readJson(this.uri));
    }

    private async applyRead(read: JsonRead): Promise<T> {
        if (read.status === 'missing') { return this.loadEmpty(); }
        if (read.status === 'corrupt') {
            this.notifyCorrupt();
            return this.loadEmpty();
        }
        return this.loadNormalized(read.value);
    }

    private async loadEmpty(): Promise<T> {
        this.cache = this.empty();
        this.loaded = true;
        return this.cache;
    }

    private async loadNormalized(raw: unknown): Promise<T> {
        const { value, changed } = this.normalize(raw);
        this.cache = value;
        this.loaded = true;
        if (changed) { await this.flush(); }
        return this.cache;
    }

    get(): T | null {
        return this.cache;
    }

    /** Replace the cached value and schedule a debounced write. */
    set(next: T): void {
        this.cache = next;
        this.loaded = true;
        this.scheduleWrite();
    }

    /** Write now, clearing any pending debounce. */
    async flush(): Promise<void> {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (!this.loaded || this.cache === null) { return; }
        await writeJson(this.uri, this.cache, this.root);
        this.onSelfWrite();
    }

    dispose(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }

    private scheduleWrite(): void {
        if (this.timer) { clearTimeout(this.timer); }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, this.debounceMs);
    }

    private notifyCorrupt(): void {
        if (this.corruptNotified) { return; }
        this.corruptNotified = true;
        void vscode.window.showWarningMessage(
            `HexScope: could not parse ${path.basename(this.uri.fsPath)}; loaded empty. The file was left untouched.`,
        );
    }
}