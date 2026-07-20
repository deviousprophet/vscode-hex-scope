import { esc } from '../../utils';

export function resultDisplayHtml(): string {
    return '<div id="script-output" class="script-output"><div class="sb-empty">Run a script to see output</div></div>';
}

export function appendOutput(text: string): void {
    const el = document.getElementById('script-output');
    if (!el) { return; }
    const block = el.querySelector('.script-output-block:last-child');
    if (block) {
        block.querySelector('.script-output-log')!.innerHTML += `<div>${esc(text)}</div>`;
    }
}

function errorBlock(error: string): string {
    return error ? `<div class="script-output-error">${esc(error)}</div>` : '';
}

function resultsBlock(results: Array<{ label: string; value: string }> | null): string {
    if (!results || results.length === 0) { return ''; }
    const rows = results.map(r =>
        `<span class="script-result-label">${esc(r.label)}:</span><span class="script-result-value">${esc(r.value)}</span>`
    ).join('</div><div class="script-result-row">');
    return `<div class="script-output-results"><div class="script-result-row">${rows}</div></div>`;
}

function writesBlock(count: number): string {
    return count > 0 ? `<div class="script-output-writes">${count} byte(s) written (not yet saved)</div>` : '';
}

function scriptResultHtml(scriptPath: string, results: Array<{ label: string; value: string }> | null, error: string, pendingWriteCount: number): string {
    const name = scriptPath.split(/[\\/]/).pop() ?? scriptPath;
    return `<div class="script-output-block">
        <div class="script-output-header">${esc(name)}</div>${errorBlock(error)}${resultsBlock(results)}${writesBlock(pendingWriteCount)}<div class="script-output-log"></div></div>`;
}

export function showResult(scriptPath: string, results: Array<{ label: string; value: string }> | null, error: string, pendingWriteCount: number): void {
    const el = document.getElementById('script-output');
    if (!el) { return; }
    el.insertAdjacentHTML('afterbegin', scriptResultHtml(scriptPath, results, error, pendingWriteCount));
}
