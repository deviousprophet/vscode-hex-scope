import * as fs from 'node:fs';
import * as path from 'node:path';

/** Workspace-relative POSIX directory holding runnable scripts. */
export const EXAMPLE_SCRIPTS_DIR = '.hexscope/scripts';

/** One file copied by the "Add example scripts" command. Paths are POSIX, relative to their root. */
export interface ExampleInstallFile {
    /** Path under the bundled `examples/` directory. */
    source: string;
    /** Path under the workspace root. */
    target: string;
}

/**
 * Install manifest for the bundled catalog: the scripts plus the shared type
 * definition. `examples/README.md` and `examples/tsconfig.json` are repository
 * documentation/build files and are deliberately not copied.
 *
 * The order is the catalog order shown in the docs; installation is copy-only.
 */
export const EXAMPLE_INSTALL_FILES: readonly ExampleInstallFile[] = [
    { source: 'scripts/hello.js', target: `${EXAMPLE_SCRIPTS_DIR}/hello.js` },
    { source: 'scripts/verify-crc.js', target: `${EXAMPLE_SCRIPTS_DIR}/verify-crc.js` },
    { source: 'scripts/write-pattern.js', target: `${EXAMPLE_SCRIPTS_DIR}/write-pattern.js` },
    { source: 'scripts/follow-pointer.js', target: `${EXAMPLE_SCRIPTS_DIR}/follow-pointer.js` },
    { source: 'scripts/array-size-from-header.js', target: `${EXAMPLE_SCRIPTS_DIR}/array-size-from-header.js` },
    { source: 'scripts/verify-integrity.js', target: `${EXAMPLE_SCRIPTS_DIR}/verify-integrity.js` },
    { source: 'scripts/types/hexscope.d.ts', target: `${EXAMPLE_SCRIPTS_DIR}/types/hexscope.d.ts` },
];

export interface ExampleInstallResult {
    /** Workspace-relative paths written by this run. */
    added: string[];
    /** Workspace-relative paths left untouched because the file already exists. */
    skipped: string[];
}

function toFsPath(root: string, posixPath: string): string {
    return path.join(root, ...posixPath.split('/'));
}

/** One catalog row for the selective install picker (source key + current state). */
export interface ExamplePickerItem {
    /** Manifest source path (`scripts/hello.js`) — the selection key. */
    source: string;
    /** Workspace-relative target path (`.hexscope/scripts/hello.js`). */
    target: string;
    /** Basename shown as the picker label. */
    label: string;
    /** The target already exists, so the copy will skip it. */
    installed: boolean;
}

/** Catalog rows with current-installed state, in catalog order. */
export function examplePickerItems(targetRoot: string): ExamplePickerItem[] {
    return EXAMPLE_INSTALL_FILES.map(file => ({
        source: file.source,
        target: file.target,
        label: file.target.split('/').pop() ?? file.target,
        installed: fs.existsSync(toFsPath(targetRoot, file.target)),
    }));
}

/**
 * Copy the catalog into `targetRoot` (copy-only).
 *
 * `selectedSources` limits the manifest to those source paths (the selective
 * "Browse examples" flow); omitted = the whole catalog (the bulk action).
 * Existing targets are skipped and never read, replaced, or deleted, so a second
 * run changes nothing. Directories are created only for files actually written.
 * Throws when a bundled catalog file is missing — a packaging bug caught by the
 * catalog test rather than reported as a silent skip.
 */
export function installExampleScripts(
    catalogRoot: string,
    targetRoot: string,
    selectedSources?: readonly string[],
): ExampleInstallResult {
    const added: string[] = [];
    const skipped: string[] = [];
    for (const file of selectedInstallFiles(selectedSources)) {
        const source = toFsPath(catalogRoot, file.source);
        if (!fs.existsSync(source)) { throw new Error(`Example catalog file is missing: ${file.source}`); }
        const target = toFsPath(targetRoot, file.target);
        if (fs.existsSync(target)) { skipped.push(file.target); continue; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        added.push(file.target);
    }
    return { added, skipped };
}

/** Manifest subset for a selective install; unknown source paths are ignored. */
function selectedInstallFiles(selectedSources?: readonly string[]): readonly ExampleInstallFile[] {
    if (selectedSources === undefined) { return EXAMPLE_INSTALL_FILES; }
    const selected = new Set(selectedSources);
    return EXAMPLE_INSTALL_FILES.filter(file => selected.has(file.source));
}

/** Result message for the command (the docs quote this wording). */
export function installSummary(result: ExampleInstallResult): string {
    return `Added ${countOf(result.added.length, 'example file')}, skipped ${countOf(result.skipped.length, 'existing file')}.`;
}

function countOf(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
