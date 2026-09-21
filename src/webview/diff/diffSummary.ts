import type { DiffModel, DiffRun } from '../../core/diff';
import {
    getSyncScroll,
    getViewMode,
    scrollToDiff,
    setSyncScroll,
    setViewMode,
    swapSides,
    type DiffViewMode,
} from './diffGrid';
import { mountDiffSearch } from './diffSearch';

let runs: readonly DiffRun[] = [];
let index = -1;

export function setDiffSummary(diff: DiffModel): void {
    runs = diff.runs;
    index = -1;
    const summary = document.getElementById('diff-summary');
    if (summary) { summary.innerHTML = renderDiffSummaryHtml(diff); }
    mountDiffSearch();
    wireSummaryButtons();
    updateNavButtons();
    updateToggleButtons();
}

export function renderDiffSummaryHtml(
    diff: DiffModel,
    viewMode: DiffViewMode = getViewMode(),
    syncScroll: boolean = getSyncScroll(),
): string {
    return `<div class="diff-tb-row">` +
        `<div class="diff-tb-left">` +
        actionButton('diff-show-all', '≡', 'Show all rows', viewMode === 'all') +
        actionButton('diff-show-diff', '≠', 'Show differences only', viewMode === 'diff') +
        actionButton('diff-prev', '▲', 'Previous difference') +
        actionButton('diff-next', '▼', 'Next difference') +
        `</div>` +
        `<div class="diff-tb-center">${actionButton('diff-swap', '⇄', 'Swap sides')}</div>` +
        `<div class="diff-tb-right"><div class="diff-search-slot" id="diff-search"></div></div>` +
        `</div>` +
        `<div class="diff-tb-row">` +
        `<div class="diff-tb-left">${actionButton('diff-sync', '⇅', 'Sync scroll', syncScroll)}</div>` +
        `<div class="diff-tb-center diff-stat">${renderDiffStat(diff)}</div>` +
        `<div class="diff-tb-right"></div>` +
        `</div>`;
}

function renderDiffStat(diff: DiffModel): string {
    return `<span class="diff-count diff-count-chg">${diff.summary.changed} changed</span>` +
        `<span class="diff-count diff-count-add">${diff.summary.added} added</span>` +
        `<span class="diff-count diff-count-del">${diff.summary.removed} removed</span>`;
}

function actionButton(id: string, glyph: string, label: string, active = false): string {
    return `<button type="button" id="${id}" class="diff-action${active ? ' active' : ''}" title="${label}" aria-label="${label}">${glyph}</button>`;
}

function wireSummaryButtons(): void {
    navButton('diff-prev')?.addEventListener('click', () => step(-1));
    navButton('diff-next')?.addEventListener('click', () => step(1));
    navButton('diff-show-all')?.addEventListener('click', () => chooseViewMode('all'));
    navButton('diff-show-diff')?.addEventListener('click', () => chooseViewMode('diff'));
    navButton('diff-swap')?.addEventListener('click', () => {
        const next = swapSides();
        if (next) { setDiffSummary(next); }
    });
    navButton('diff-sync')?.addEventListener('click', () => toggleSync());
}

function chooseViewMode(mode: DiffViewMode): void {
    setViewMode(mode);
    updateToggleButtons();
}

function toggleSync(): void {
    setSyncScroll(!getSyncScroll());
    updateToggleButtons();
}

function updateToggleButtons(): void {
    navButton('diff-show-all')?.classList.toggle('active', getViewMode() === 'all');
    navButton('diff-show-diff')?.classList.toggle('active', getViewMode() === 'diff');
    navButton('diff-sync')?.classList.toggle('active', getSyncScroll());
}

function step(delta: number): void {
    if (runs.length === 0) { return; }
    const next = delta < 0 ? Math.max(0, index - 1) : (index < 0 ? 0 : Math.min(index + 1, runs.length - 1));
    index = next;
    const run = runs[index];
    scrollToDiff({ start: run.start, end: run.end });
    updateNavButtons();
}

function updateNavButtons(): void {
    setDisabled(navButton('diff-prev'), index <= 0);
    setDisabled(navButton('diff-next'), index >= runs.length - 1);
}

function setDisabled(button: HTMLButtonElement | null, atEnd: boolean): void {
    if (button) { button.disabled = atEnd || runs.length === 0; }
}

function navButton(id: string): HTMLButtonElement | null {
    return document.getElementById(id) as HTMLButtonElement | null;
}
