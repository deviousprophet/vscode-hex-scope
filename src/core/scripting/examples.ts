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
    { source: 'scripts/verify-crc.ts', target: `${EXAMPLE_SCRIPTS_DIR}/verify-crc.ts` },
    { source: 'scripts/write-pattern.js', target: `${EXAMPLE_SCRIPTS_DIR}/write-pattern.js` },
    { source: 'scripts/follow-pointer.ts', target: `${EXAMPLE_SCRIPTS_DIR}/follow-pointer.ts` },
    { source: 'scripts/array-size-from-header.ts', target: `${EXAMPLE_SCRIPTS_DIR}/array-size-from-header.ts` },
    { source: 'scripts/verify-integrity.ts', target: `${EXAMPLE_SCRIPTS_DIR}/verify-integrity.ts` },
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

/**
 * Copy the catalog into `targetRoot` (copy-only).
 *
 * Existing targets are skipped and never read, replaced, or deleted, so a second
 * run changes nothing. Directories are created only for files actually written.
 * Throws when a bundled catalog file is missing — a packaging bug caught by the
 * catalog test rather than reported as a silent skip.
 */
export function installExampleScripts(catalogRoot: string, targetRoot: string): ExampleInstallResult {
    const added: string[] = [];
    const skipped: string[] = [];
    for (const file of EXAMPLE_INSTALL_FILES) {
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

/** Result message for the command (the docs quote this wording). */
export function installSummary(result: ExampleInstallResult): string {
    return `Added ${countOf(result.added.length, 'example file')}, skipped ${countOf(result.skipped.length, 'existing file')}.`;
}

function countOf(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
