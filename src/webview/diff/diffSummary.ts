import type { DiffModel, DiffRun } from '../../core/diff';
import { scrollToDiff } from './diffGrid';

let runs: readonly DiffRun[] = [];
let index = -1;

export function setDiffSummary(diff: DiffModel): void {
    runs = diff.runs;
    index = -1;
    const summary = document.getElementById('diff-summary');
    if (summary) { summary.innerHTML = renderDiffSummaryHtml(diff); }
    wireNavButtons();
    updateNavButtons();
}

export function renderDiffSummaryHtml(diff: DiffModel): string {
    return `<span class="diff-count diff-count-chg">${diff.summary.changed} changed</span>` +
        `<span class="diff-count diff-count-add">${diff.summary.added} added</span>` +
        `<span class="diff-count diff-count-del">${diff.summary.removed} removed</span>` +
        `<span class="diff-nav-group">` +
        `<button type="button" id="diff-prev" class="diff-nav">Prev difference</button>` +
        `<button type="button" id="diff-next" class="diff-nav">Next difference</button>` +
        `</span>`;
}

function wireNavButtons(): void {
    navButton('diff-prev')?.addEventListener('click', () => step(-1));
    navButton('diff-next')?.addEventListener('click', () => step(1));
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
