// ── Clipboard edit orchestration ────────────────────────────────────────────
// Copy/cut/paste over the memory grid. Clipboard payloads are plain hex text,
// so a copy in one HexScope editor pastes into another (or an external tool).
// Length-changing paste modes route through the structural edit layer; an
// equal-length replace stays a plain byte transaction.

import { formatCopyCommand } from '../core/byteTools/copy';
import { parseClipboardBytes } from './pasteUtils';
import { S } from './state';
import { currentSelectionRange, mappedSegments } from './memory/selection';
import { stageIntegrityEditTransaction } from './editStaging';
import {
    applyStructuralDelete,
    applyStructuralInsert,
    applyStructuralReplace,
    mappedSelectionBounds,
} from './structuralEdit';

export type PasteMode = 'replace' | 'insert-before' | 'insert-after';

export interface ClipboardActionResult {
    ok: boolean;
    message: string;
    selection?: { start: number; end: number };
    /** True when the action changed the document length/segments. */
    structural?: boolean;
}

/** Cut/paste are edit actions; copy remains read-only. */
function editBlocked(): boolean {
    return !S.editMode || S.lockedDueToExternalChange;
}

function fail(message: string): ClipboardActionResult {
    return { ok: false, message };
}

function byteWord(count: number): string {
    return count === 1 ? '' : 's';
}

function clipboardText(bytes: readonly number[]): string {
    return formatCopyCommand('hex', bytes as number[]);
}

function bytesInRange(start: number, end: number): number[] {
    const out: number[] = [];
    for (const segment of mappedSegments()) {
        appendRangeBytes(out, segment, start, end);
    }
    return out;
}

function appendRangeBytes(
    out: number[],
    segment: { startAddress: number; data: ArrayLike<number> },
    start: number,
    end: number,
): void {
    const from = Math.max(start, segment.startAddress);
    const to = Math.min(end, segment.startAddress + segment.data.length - 1);
    for (let addr = from; addr <= to; addr++) {
        out.push(S.edits.get(addr) ?? segment.data[addr - segment.startAddress]);
    }
}

async function writeClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

async function readClipboardBytes(): Promise<number[] | null> {
    try {
        const text = await navigator.clipboard.readText();
        return parseClipboardBytes(text);
    } catch {
        return null;
    }
}

/** Copy the selected mapped bytes without changing the selection. */
export async function copySelection(format: 'hex' | 'ascii' = 'hex'): Promise<ClipboardActionResult> {
    const bytes = selectedMappedBytes();
    if (bytes.length === 0) { return fail('Nothing to copy'); }
    return copyBytes(bytes, format);
}

async function copyBytes(bytes: number[], format: 'hex' | 'ascii'): Promise<ClipboardActionResult> {
    return (await writeClipboard(formatCopyCommand(format, bytes)))
        ? { ok: true, message: `Copied ${bytes.length} byte${byteWord(bytes.length)}` }
        : fail('Clipboard is unavailable');
}

/** Cut the selected mapped bytes: clipboard first, then structural delete. */
export async function cutSelection(): Promise<ClipboardActionResult> {
    if (editBlocked()) { return fail('Cut requires edit mode'); }
    const bounds = mappedSelectionBounds();
    if (!bounds) { return fail('Nothing to cut'); }
    return cutRange(bounds, '', 'Nothing to cut');
}

/** Cut the inclusive region after copying it. */
export async function cutRegion(from: number, to: number): Promise<ClipboardActionResult> {
    if (editBlocked()) { return fail('Cut requires edit mode'); }
    const range = validRegion(from, to);
    if (!range) { return fail('Invalid address range'); }
    return cutRange(range, ' from region', 'Nothing to cut in that range');
}

async function cutRange(
    range: { start: number; end: number },
    suffix: string,
    emptyMessage: string,
): Promise<ClipboardActionResult> {
    const bytes = bytesInRange(range.start, range.end);
    if (bytes.length === 0) { return fail(emptyMessage); }
    if (!(await writeClipboard(clipboardText(bytes)))) { return fail('Clipboard is unavailable'); }
    if (!applyStructuralDelete(range.start, range.end)) { return fail(emptyMessage); }
    return {
        ok: true,
        message: `Cut ${bytes.length} byte${byteWord(bytes.length)}${suffix}`,
        selection: { start: range.start, end: range.start },
        structural: true,
    };
}

/** Paste into the selection: overwrite, insert before, or insert after. */
export async function pasteSelection(mode: PasteMode): Promise<ClipboardActionResult> {
    if (editBlocked()) { return fail('Paste requires edit mode'); }
    const range = currentSelectionRange();
    if (!range) { return fail('Select a byte first'); }
    const bytes = await readClipboardBytes();
    if (!hasBytes(bytes)) { return fail('Clipboard has no bytes'); }
    return pasteAtRange(mode, range, bytes);
}

function hasBytes(bytes: number[] | null): bytes is number[] {
    return bytes !== null && bytes.length > 0;
}

function pasteAtRange(
    mode: PasteMode,
    range: { start: number; end: number },
    bytes: number[],
): ClipboardActionResult {
    if (mode === 'insert-before') { return insertAt(range.start, bytes); }
    if (mode === 'insert-after') { return insertAt(range.end + 1, bytes); }
    return replaceSelection(bytes);
}

/** Paste at an explicit address (creates memory when unmapped for HEX/SREC). */
export async function pasteAtAddress(addr: number): Promise<ClipboardActionResult> {
    if (editBlocked()) { return fail('Paste requires edit mode'); }
    const bytes = await readClipboardBytes();
    if (!hasBytes(bytes)) { return fail('Clipboard has no bytes'); }
    return insertAt(addr, bytes);
}

/** Copy the inclusive region without requiring a selection. */
export async function copyRegion(from: number, to: number): Promise<ClipboardActionResult> {
    const range = validRegion(from, to);
    if (!range) { return fail('Invalid address range'); }
    return copyRange(range);
}

async function copyRange(range: { start: number; end: number }): Promise<ClipboardActionResult> {
    const bytes = bytesInRange(range.start, range.end);
    if (bytes.length === 0) { return fail('Nothing to copy in that range'); }
    return (await writeClipboard(clipboardText(bytes)))
        ? { ok: true, message: `Copied ${bytes.length} byte${byteWord(bytes.length)} from region` }
        : fail('Clipboard is unavailable');
}

function selectedMappedBytes(): number[] {
    const bounds = mappedSelectionBounds();
    return bounds ? bytesInRange(bounds.start, bounds.end) : [];
}

function validRegion(from: number, to: number): { start: number; end: number } | null {
    return isValidRegionPair(from, to) ? { start: from, end: to } : null;
}

function isValidRegionPair(from: number, to: number): boolean {
    return isAddressNumber(from) && isAddressNumber(to) && from <= to;
}

function isAddressNumber(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF;
}

function insertAt(addr: number, bytes: number[]): ClipboardActionResult {
    if (!isValidInsertTarget(addr)) { return fail('Invalid address'); }
    if (!applyStructuralInsert(addr, bytes)) { return fail('Paste target is outside the editable range'); }
    return {
        ok: true,
        message: `Inserted ${bytes.length} byte${byteWord(bytes.length)}`,
        selection: { start: addr, end: addr + bytes.length - 1 },
        structural: true,
    };
}

function isValidInsertTarget(addr: number): boolean {
    return Number.isInteger(addr) && addr >= 0;
}

function replaceSelection(bytes: number[]): ClipboardActionResult {
    const bounds = mappedSelectionBounds();
    if (!bounds) { return fail('Select a mapped byte first'); }
    const selected = bytesInRange(bounds.start, bounds.end);
    return bytes.length === selected.length
        ? replaceBytes(bounds, bytes)
        : replaceStructurally(bounds, bytes, selected.length);
}

function replaceBytes(bounds: { start: number; end: number }, bytes: number[]): ClipboardActionResult {
    const count = stageIntegrityEditTransaction(pairMappedBytes(bounds, bytes));
    return count > 0
        ? { ok: true, message: `Replaced ${count} byte${byteWord(count)}`, selection: bounds }
        : fail('Pasted bytes already match the selection');
}

function replaceStructurally(
    bounds: { start: number; end: number },
    bytes: number[],
    selectedCount: number,
): ClipboardActionResult {
    if (!applyStructuralReplace(bounds.start, bounds.end, bytes)) { return fail('Paste failed'); }
    return {
        ok: true,
        message: `Replaced ${selectedCount} byte${byteWord(selectedCount)} with ${bytes.length}`,
        selection: { start: bounds.start, end: bounds.start + bytes.length - 1 },
        structural: true,
    };
}

/** Pair the clipboard bytes with mapped addresses in selection order. */
function pairMappedBytes(bounds: { start: number; end: number }, bytes: number[]): Array<[number, number]> {
    const edits: Array<[number, number]> = [];
    let index = 0;
    for (const segment of mappedSegments()) {
        index = appendSegmentPairs(edits, segment, bounds, bytes, index);
        if (index >= bytes.length) { break; }
    }
    return edits;
}

function appendSegmentPairs(
    edits: Array<[number, number]>,
    segment: { startAddress: number; data: ArrayLike<number> },
    bounds: { start: number; end: number },
    bytes: number[],
    index: number,
): number {
    const from = Math.max(bounds.start, segment.startAddress);
    const to = Math.min(bounds.end, segment.startAddress + segment.data.length - 1);
    for (let addr = from; addr <= to && index < bytes.length; addr++) {
        edits.push([addr, bytes[index]]);
        index++;
    }
    return index;
}


