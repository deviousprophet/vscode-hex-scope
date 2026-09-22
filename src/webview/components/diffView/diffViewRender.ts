// ── DiffView render layer ────────────────────────────────────────
// Pure, DOM-free markup for the diff grid surface: the two-pane grid
// body shell and the empty-state card. The host builds the row slices;
// this layer only produces the static container markup.

import { esc } from '../../utils';

export function renderDiffViewBodyHtml(): string {
    return `<div class="diff-body" id="diff-body">` +
        `<div class="diff-side">` +
        `<div class="diff-side-head" id="diff-head-a"></div>` +
        `<div class="diff-grid-root" id="diff-a">` +
        `<div class="mem-header" id="diff-header-a"></div>` +
        `<div class="mem-scroll"><div class="mem-rows" id="diff-rows-a"></div></div>` +
        `</div></div>` +
        `<div class="diff-split" id="diff-split"></div>` +
        `<div class="diff-side">` +
        `<div class="diff-side-head" id="diff-head-b"></div>` +
        `<div class="diff-grid-root" id="diff-b">` +
        `<div class="mem-header" id="diff-header-b"></div>` +
        `<div class="mem-scroll"><div class="mem-rows" id="diff-rows-b"></div></div>` +
        `</div></div></div>`;
}

export function renderDiffEmptyHtml(message: string): string {
    return `<div class="diff-empty">${esc(message)}</div>`;
}
