import type { DiffKind, DiffRun } from '../../core/diff';
import type { DiffSide } from '../../diffProtocol';
import type { HexScopeFormat } from '../../core/document';
import { buildSegmentIndex, getByteAt, type SegmentIndexEntry } from '../../core/memory';
import type { SegmentLabel, SerializedParseResult } from '../../core/types';
import { formatBinBaseAddress } from '../../core/parser/binImage';
import { BYTES_PER_ROW } from '../components/hexView/hexViewRender';
import { esc } from '../utils';

export interface DiffSideData {
    name: string;
    path: string;
    format: HexScopeFormat;
    parseResult: Omit<SerializedParseResult, 'records'>;
    segmentIndex: SegmentIndexEntry[];
    labels: SegmentLabel[];
    /** Raw-binary memory-map base captured at load; absent for text sides. */
    baseAddress?: number;
    /** Comparison-only base override active for this raw side. */
    baseOverride?: boolean;
}

export interface DiffBaseEditorView {
    /** Digits currently in the inline editor (the `0x` prefix is fixed chrome). */
    draft: string;
    /** Inline validation message; null while the draft is clean. */
    error: string | null;
}

export interface SideHeadRenderOptions {
    /** Side key for the raw base controls; absent means no controls (legacy callers). */
    side?: 'a' | 'b';
    /** Comparison-only override marker. */
    baseOverride?: boolean;
    /** Open inline base editor; null/undefined = closed. */
    baseEditor?: DiffBaseEditorView | null;
}

export interface DiffRow {
    address: number;
    kind: 'data' | 'gap';
    gap?: { from: number; to: number; bytes: number; line?: boolean };
}

const NO_EDITS: ReadonlyMap<number, number> = new Map();

export function hydrateDiffSide(side: DiffSide): DiffSideData {
    const parseResult: Omit<SerializedParseResult, 'records'> = {
        recordCount: side.parseResult.recordCount,
        segments: side.parseResult.segments.map(segment => ({
            startAddress: segment.startAddress,
            data: new Uint8Array(segment.data),
        })),
        totalDataBytes: side.parseResult.totalDataBytes,
        checksumErrors: side.parseResult.checksumErrors,
        malformedLines: side.parseResult.malformedLines,
        startAddress: side.parseResult.startAddress,
        baseAddress: side.parseResult.baseAddress,
        format: side.parseResult.format,
    };
    return {
        name: side.name,
        path: side.path,
        format: side.format,
        parseResult,
        segmentIndex: buildSegmentIndex(parseResult),
        labels: side.labels,
        baseAddress: parseResult.baseAddress,
        baseOverride: side.baseOverride,
    };
}

export function getSideByte(side: DiffSideData, addr: number): number | undefined {
    return getByteAt(side.parseResult, side.segmentIndex, NO_EDITS, addr);
}

/** One row model shared by both grids: union of mapped 16-byte blocks, gaps only where neither side maps. */
export function buildDiffRows(a: DiffSideData, b: DiffSideData): DiffRow[] {
    const bases = new Set<number>();
    collectRowBases(a, bases);
    collectRowBases(b, bases);
    const ordered = [...bases].sort((x, y) => x - y);
    const rows: DiffRow[] = [];
    for (let i = 0; i < ordered.length; i++) {
        appendGapBefore(rows, ordered, i);
        rows.push({ address: ordered[i], kind: 'data' });
    }
    return rows;
}

function collectRowBases(side: DiffSideData, bases: Set<number>): void {
    for (const segment of side.parseResult.segments) {
        const startRow = rowBase(segment.startAddress);
        const endRow = rowBase(segment.startAddress + segment.data.length - 1);
        for (let row = startRow; row <= endRow; row += BYTES_PER_ROW) { bases.add(row); }
    }
}

function rowBase(addr: number): number {
    return addr - (addr % BYTES_PER_ROW);
}

function appendGapBefore(rows: DiffRow[], ordered: number[], index: number): void {
    if (index === 0) { return; }
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current - previous > BYTES_PER_ROW) {
        rows.push({
            address: previous + BYTES_PER_ROW,
            kind: 'gap',
            gap: { from: previous + BYTES_PER_ROW, to: current - 1, bytes: current - previous - BYTES_PER_ROW },
        });
    }
}

export function diffKindAt(runs: readonly DiffRun[], addr: number): DiffKind | undefined {
    let lo = 0;
    let hi = runs.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const run = runs[mid];
        if (addr < run.start) { hi = mid - 1; }
        else if (addr > run.end) { lo = mid + 1; }
        else { return run.kind; }
    }
    return undefined;
}

const DIFF_CLASS: Record<DiffKind, string> = {
    changed: ' diff-chg',
    added: ' diff-add',
    removed: ' diff-del',
};

/** A run marks a cell only where that side owns it: changed everywhere, added on B, removed on A. */
export function diffClassForSide(side: 'a' | 'b', kind: DiffKind | undefined): string {
    if (!kind) { return ''; }
    return appliesTo(side, kind) ? DIFF_CLASS[kind] : '';
}

function appliesTo(side: 'a' | 'b', kind: DiffKind): boolean {
    if (kind === 'changed') { return true; }
    return side === (kind === 'removed' ? 'a' : 'b');
}

export function renderDiffErrorHtml(message: string): string {
    return `<div class="diff-error-card">` +
        `<div class="diff-error-title">Comparison failed</div>` +
        `<div class="diff-error-text">${esc(message)}</div>` +
        `</div>`;
}

/** Side head: file label, the shared format pill, and (raw only) the base controls. */
export function renderSideHeadHtml(
    label: string,
    format: HexScopeFormat,
    baseAddress?: number,
    options: SideHeadRenderOptions = {},
): string {
    const head = `<span class="diff-side-label">${esc(label)}</span> <span class="fmt-pill">${format.toUpperCase()}</span>`;
    return format === 'bin' ? head + renderRawSideHead(baseAddress ?? 0, options) : head;
}

const BASE_LABEL = ` <span class="diff-base-label">BASE ADDRESS</span>`;
const BASE_OVERRIDE_FLAG = ` <span class="diff-override-flag" title="Base overridden for this comparison only">override</span>`;

function renderRawSideHead(baseAddress: number, options: SideHeadRenderOptions): string {
    // Edit mode mirrors the profile-bar field: uppercase label + the shared
    // bordered address box + check/X icon actions.
    if (options.side && options.baseEditor) {
        return BASE_LABEL + renderBaseEditor(options.side, options.baseEditor);
    }
    return renderBaseView(baseAddress, options);
}

function renderBaseView(baseAddress: number, options: SideHeadRenderOptions): string {
    const head = BASE_LABEL +
        ` <span class="diff-side-base">${esc(formatBinBaseAddress(baseAddress))}</span>` +
        (options.baseOverride ? BASE_OVERRIDE_FLAG : '');
    if (!options.side) { return head; }
    return head + renderBaseActions(options.side, !!options.baseOverride);
}

function renderBaseActions(side: 'a' | 'b', overridden: boolean): string {
    const buttons = [baseIconButton('edit', side, '&#9998;', 'Edit base address', 'diff-base-edit')];
    if (overridden) {
        buttons.push(baseIconButton('reset', side, '&#8634;', 'Reset base address', 'diff-base-reset'));
    }
    return ` <span class="diff-base-actions">${buttons.join('')}</span>`;
}

function renderBaseEditor(side: 'a' | 'b', editor: DiffBaseEditorView): string {
    const invalid = editor.error !== null ? ' aria-invalid="true"' : '';
    return ` <span class="addr-field diff-base-field">` +
        `<span class="addr-pfx" aria-hidden="true">0x</span>` +
        `<input id="diff-base-input-${side}" class="addr-input" data-diff-base-input="${side}" ` +
        `type="text" maxlength="8" value="${esc(editor.draft)}" spellcheck="false" autocomplete="off"${invalid} ` +
        `aria-label="Raw binary base address, hexadecimal digits (0x prefix is fixed)">` +
        `</span>` +
        baseIconButton('apply', side, '&#10003;', 'Apply base address', 'diff-base-apply') +
        baseIconButton('cancel', side, '&#10005;', 'Cancel base address', 'diff-base-cancel') +
        renderBaseError(side, editor.error);
}

function renderBaseError(side: 'a' | 'b', error: string | null): string {
    return error === null
        ? `<span id="diff-base-error-${side}" class="diff-base-error" role="alert" hidden></span>`
        : `<span id="diff-base-error-${side}" class="diff-base-error" role="alert">${esc(error)}</span>`;
}

function baseIconButton(
    action: string,
    side: 'a' | 'b',
    glyph: string,
    label: string,
    className: string,
): string {
    return `<button type="button" class="addr-icon-btn ${className}" data-diff-base-action="${action}" ` +
        `data-side="${side}" title="${label}" aria-label="${label}">${glyph}</button>`;
}
