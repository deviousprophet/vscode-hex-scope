// ── Virtual Scrolling System ────────────────────────────────────
// Enables efficient rendering of large memory buffers by rendering
// only visible rows + a buffer instead of the entire DOM tree.
// This reduces DOM nodes from millions to hundreds, enabling 40x speedup.

import { S } from './state';

export interface VirtualScrollState {
    containerHeight: number;        // visible height in pixels
    rowHeight: number;              // assumed fixed row height
    gapHeight: number;              // height of gap rows
    scrollTop: number;              // current scroll position
    bufferSize: number;             // rows to render above/below viewport
    visibleRowIndices: [number, number];  // [start, end) indices into S.memRows
}

export interface VirtualScrollLayout {
    totalHeight: number;
    physicalHeight: number;
    logicalScrollable: number;
    physicalScrollable: number;
    isCompressed: boolean;
}

export const MAX_VIRTUAL_SCROLL_HEIGHT = 16_000_000;

let cacheLen = -1;
let cacheRowHeight = -1;
let cacheGapHeight = -1;
let cumulativeHeights: number[] = [];
let cachedTotalHeight = 0;

function ensureHeightCache(state: VirtualScrollState): void {
    if (
        cacheLen === S.memRows.length &&
        cacheRowHeight === state.rowHeight &&
        cacheGapHeight === state.gapHeight &&
        cumulativeHeights.length === S.memRows.length + 1
    ) { return; }
    cumulativeHeights = new Array<number>(S.memRows.length + 1);
    cumulativeHeights[0] = 0;
    for (let i = 0; i < S.memRows.length; i++) {
        const h = S.memRows[i].type === 'gap' ? state.gapHeight : state.rowHeight;
        cumulativeHeights[i + 1] = cumulativeHeights[i] + h;
    }
    cachedTotalHeight = cumulativeHeights[S.memRows.length] ?? 0;
    cacheLen = S.memRows.length;
    cacheRowHeight = state.rowHeight;
    cacheGapHeight = state.gapHeight;
}

function lowerBound(values: number[], target: number): number {
    let lo = 0;
    let hi = values.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (values[mid] < target) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/**
 * Calculate which rows (by index in S.memRows) should be rendered.
 * Returns [startIdx, endIdx) — the range of indices to render.
 */
export function calcVisibleRange(state: VirtualScrollState): [number, number] {
    if (S.memRows.length === 0) { return [0, 0]; }
    ensureHeightCache(state);

    const firstVisible = Math.max(0, Math.min(S.memRows.length - 1, lowerBound(cumulativeHeights, state.scrollTop + 1) - 1));
    const lastVisible = Math.max(firstVisible, Math.min(S.memRows.length - 1, lowerBound(cumulativeHeights, state.scrollTop + state.containerHeight + 1) - 1));

    const startIdx = Math.max(0, firstVisible - state.bufferSize);
    const endIdx = Math.min(S.memRows.length, lastVisible + state.bufferSize + 1);
    return [startIdx, endIdx];
}

/**
 * Calculate total pixel height of all rows (for phantom scroll height).
 */
export function calcTotalHeight(state: VirtualScrollState): number {
    ensureHeightCache(state);
    return cachedTotalHeight;
}

/**
 * Calculate pixel offset (top position) of a row by index.
 */
export function calcRowOffset(rowIndex: number, state: VirtualScrollState): number {
    ensureHeightCache(state);
    const clamped = Math.max(0, Math.min(rowIndex, S.memRows.length));
    return cumulativeHeights[clamped] ?? 0;
}

/**
 * Calculate the total height contribution of rows in range [start, end).
 */
function calcRangeHeight(start: number, end: number, state: VirtualScrollState): number {
    ensureHeightCache(state);
    const s = Math.max(0, Math.min(start, S.memRows.length));
    const e = Math.max(s, Math.min(end, S.memRows.length));
    return (cumulativeHeights[e] ?? 0) - (cumulativeHeights[s] ?? 0);
}

export function calcScrollLayout(state: VirtualScrollState, maxPhysicalHeight = MAX_VIRTUAL_SCROLL_HEIGHT): VirtualScrollLayout {
    const totalHeight = calcTotalHeight(state);
    const physicalHeight = Math.min(totalHeight, maxPhysicalHeight);
    const logicalScrollable = Math.max(0, totalHeight - state.containerHeight);
    const physicalScrollable = Math.max(0, physicalHeight - state.containerHeight);

    return {
        totalHeight,
        physicalHeight,
        logicalScrollable,
        physicalScrollable,
        isCompressed: totalHeight > physicalHeight,
    };
}

export function physicalToLogicalScroll(physicalScrollTop: number, state: VirtualScrollState): number {
    const layout = calcScrollLayout(state);
    if (!layout.isCompressed || layout.physicalScrollable <= 0 || layout.logicalScrollable <= 0) {
        return Math.max(0, Math.min(physicalScrollTop, layout.logicalScrollable));
    }
    const ratio = Math.max(0, Math.min(physicalScrollTop, layout.physicalScrollable)) / layout.physicalScrollable;
    return ratio * layout.logicalScrollable;
}

export function logicalToPhysicalScroll(logicalScrollTop: number, state: VirtualScrollState): number {
    const layout = calcScrollLayout(state);
    if (!layout.isCompressed || layout.physicalScrollable <= 0 || layout.logicalScrollable <= 0) {
        return Math.max(0, Math.min(logicalScrollTop, layout.physicalScrollable));
    }
    const ratio = Math.max(0, Math.min(logicalScrollTop, layout.logicalScrollable)) / layout.logicalScrollable;
    return ratio * layout.physicalScrollable;
}
