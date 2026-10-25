import * as vscode from 'vscode';
import {
    DEFAULT_BIN_BASE_ADDRESS,
    formatBinBaseAddress,
    parseBinBaseAddress,
    validateBinBaseAddressInput,
} from './core/parser/binImage';
import { fileName } from './core/pathName';
import {
    boundProfileId,
    createBoundProfile,
    perFileRelativePath,
    readProfileRecord,
    resolveHexScopeRoot,
    writeProfileRecord,
} from './hexScopeStorage';

export interface StoredBinBaseAddress {
    value: number;
    /** True when a `.hexscope` profile is bound to the file. */
    bound: boolean;
}

/** Test seam: the host input box (never called from webview code). */
export type AskForBaseAddress = (options: vscode.InputBoxOptions) => Thenable<string | undefined>;

export interface BinBasePromptOptions {
    /** Persist the accepted value on the bound profile (editor open), or keep it comparison-only. */
    persist: boolean;
    /** Test seam; defaults to `vscode.window.showInputBox`. */
    ask?: AskForBaseAddress;
}

function profileLocation(uri: vscode.Uri): { root: string; relPath: string } {
    const root = resolveHexScopeRoot(uri);
    return { root, relPath: perFileRelativePath(root, uri) };
}

/** Stored profile base address, or the `0x00000000` default when unbound/unreadable. */
export async function readStoredBinBaseAddress(uri: vscode.Uri): Promise<StoredBinBaseAddress> {
    try {
        const { root, relPath } = profileLocation(uri);
        return await readBoundBaseAddress(root, relPath);
    } catch {
        return unboundDefault();
    }
}

async function readBoundBaseAddress(root: string, relPath: string): Promise<StoredBinBaseAddress> {
    const profileId = await boundProfileId(root, relPath);
    if (!profileId) { return unboundDefault(); }
    const record = await readProfileRecord(root, profileId);
    if (!record) { return unboundDefault(); }
    return { value: record.baseAddress ?? DEFAULT_BIN_BASE_ADDRESS, bound: true };
}

function unboundDefault(): StoredBinBaseAddress {
    return { value: DEFAULT_BIN_BASE_ADDRESS, bound: false };
}

/** Store the accepted base address on the bound profile, creating the profile + binding when unbound. */
export async function persistBinBaseAddress(uri: vscode.Uri, value: number): Promise<void> {
    const { root, relPath } = profileLocation(uri);
    const profileId = await boundProfileId(root, relPath);
    if (!profileId) {
        await createBoundProfile(root, relPath, value);
        return;
    }
    const record = await readProfileRecord(root, profileId);
    if (!record) {
        await createBoundProfile(root, relPath, value);
        return;
    }
    if (record.baseAddress === value) { return; }
    await writeProfileRecord(root, { ...record, baseAddress: value });
}

/** Prompt for the raw image's base address; null on cancel. Persistence failures warn once and continue. */
export async function promptForBinBaseAddress(
    uri: vscode.Uri,
    byteLength: number,
    options: BinBasePromptOptions,
): Promise<number | null> {
    const stored = await readStoredBinBaseAddress(uri);
    const ask = options.ask ?? vscode.window.showInputBox;
    const accepted = acceptedBaseAddress(await ask({
        title: `Base address for ${fileName(uri)}`,
        prompt: 'Hexadecimal address where byte 0 maps (0x00000000–0xFFFFFFFF).',
        value: formatBinBaseAddress(stored.value),
        validateInput: value => validateBinBaseAddressInput(value, byteLength) ?? undefined,
    }), byteLength);
    if (accepted === null) { return null; }
    if (options.persist) { await persistOrWarn(uri, accepted); }
    return accepted;
}

/** Validate one prompt result; null on cancel or invalid text (validateInput blocks it in the UI). */
function acceptedBaseAddress(input: string | undefined, byteLength: number): number | null {
    if (input === undefined) { return null; }
    const parsed = parseBinBaseAddress(input, byteLength);
    return parsed.ok ? parsed.value : null;
}

async function persistOrWarn(uri: vscode.Uri, value: number): Promise<void> {
    try {
        await persistBinBaseAddress(uri, value);
        await verifyPersisted(uri, value);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`HexScope: could not persist the raw-binary base address (${detail}).`);
        void vscode.window.showWarningMessage(
            'HexScope: could not save the base address to .hexscope; continuing with the selected address for this session.',
        );
    }
}

/** Storage declines read-modify-writes against a newer registry without
 *  throwing; surface that as the documented one-time warning instead of
 *  silently losing the chosen address. */
async function verifyPersisted(uri: vscode.Uri, value: number): Promise<void> {
    const stored = await readStoredBinBaseAddress(uri);
    if (stored.bound && stored.value === value) { return; }
    throw new Error('the profile registry did not accept the value');
}

/**
 * Compare-only base resolution: a bound image uses its stored profile value
 * silently; an unbound image prompts and never writes `.hexscope`.
 */
export async function resolveCompareBinBaseAddress(
    uri: vscode.Uri,
    byteLength: number,
    ask?: AskForBaseAddress,
): Promise<number | null> {
    const stored = await readStoredBinBaseAddress(uri);
    if (stored.bound) { return stored.value; }
    return promptForBinBaseAddress(uri, byteLength, { persist: false, ask });
}
