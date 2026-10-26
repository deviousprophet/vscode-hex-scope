// ── Raw-binary base address (host) ────────────────────────────────
// The base belongs to the file, not to the reusable annotation profile:
// it lives in the `binBases` table of `.hexscope/bindings.json`. Open and
// compare resolve silently (stored value when it still fits, else 0) and
// never write; only an explicit field commit persists a value.

import * as vscode from 'vscode';
import {
    binAddressRangeFits,
    DEFAULT_BIN_BASE_ADDRESS,
} from './core/parser/binImage';
import {
    perFileRelativePath,
    readBinBase,
    resolveHexScopeRoot,
    writeBinBase,
} from './hexScopeStorage';

export interface StoredBinBaseAddress {
    value: number;
    /** True when the file's binBases entry exists (0 is a real value). */
    hasBaseAddress: boolean;
}

function binBaseLocation(uri: vscode.Uri): { root: string; relPath: string } {
    const root = resolveHexScopeRoot(uri);
    return { root, relPath: perFileRelativePath(root, uri) };
}

/** Stored per-file base, or the `0x00000000` default when absent/unreadable. */
export async function readStoredBinBaseAddress(uri: vscode.Uri): Promise<StoredBinBaseAddress> {
    try {
        const { root, relPath } = binBaseLocation(uri);
        const stored = await readBinBase(root, relPath);
        return { value: stored.value, hasBaseAddress: stored.present };
    } catch {
        return defaultStoredBase();
    }
}

function defaultStoredBase(): StoredBinBaseAddress {
    return { value: DEFAULT_BIN_BASE_ADDRESS, hasBaseAddress: false };
}

/** Stored value when present and fitting this image, else `0x00000000`. */
export function effectiveBinBaseAddress(stored: StoredBinBaseAddress, byteLength: number): number {
    if (!stored.hasBaseAddress) { return DEFAULT_BIN_BASE_ADDRESS; }
    return binAddressRangeFits(stored.value, byteLength) ? stored.value : DEFAULT_BIN_BASE_ADDRESS;
}

/** Persistence-failure warning seam (the session keeps its chosen address either way). */
export type BinBaseWarn = (message: string) => void;

/** Persist + verify; false (and one warning) when `.hexscope` declined the value. */
export async function saveBinBaseAddress(
    uri: vscode.Uri,
    value: number,
    warn: BinBaseWarn = showSaveWarning,
): Promise<boolean> {
    try {
        const { root, relPath } = binBaseLocation(uri);
        await writeBinBase(root, relPath, value);
        await verifyPersisted(uri, value);
        return true;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`HexScope: could not persist the raw-binary base address (${detail}).`);
        warn('HexScope: could not save the base address to .hexscope; continuing with the selected address for this session.');
        return false;
    }
}

function showSaveWarning(message: string): void {
    void vscode.window.showWarningMessage(message);
}

/** Storage declines writes against a newer file without throwing; surface that
 *  as the documented one-time warning instead of silently losing the value. */
async function verifyPersisted(uri: vscode.Uri, value: number): Promise<void> {
    const stored = await readStoredBinBaseAddress(uri);
    if (stored.hasBaseAddress && stored.value === value) { return; }
    throw new Error('the binding table did not accept the value');
}

/** Editor-open base resolution: default-0, never prompts and never writes.
 *  A stored value that no longer fits this image warns once and maps at 0. */
export async function resolveOpenBinBaseAddress(
    uri: vscode.Uri,
    byteLength: number,
    warn: BinBaseWarn = showOverflowWarning,
): Promise<number> {
    const stored = await readStoredBinBaseAddress(uri);
    if (stored.hasBaseAddress && !binAddressRangeFits(stored.value, byteLength)) {
        warn('HexScope: the stored base address does not fit this file; mapping at 0x00000000. Enter a new base in the profile bar.');
    }
    return effectiveBinBaseAddress(stored, byteLength);
}

function showOverflowWarning(message: string): void {
    void vscode.window.showWarningMessage(message);
}

/** Compare-only resolution: same stored-if-fits else 0 rule (no warning, no write). */
export async function resolveCompareBinBaseAddress(uri: vscode.Uri, byteLength: number): Promise<number> {
    return effectiveBinBaseAddress(await readStoredBinBaseAddress(uri), byteLength);
}
