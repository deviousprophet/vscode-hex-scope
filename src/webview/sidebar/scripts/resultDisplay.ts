import { esc } from '../../utils';
import { clearRunning, setRunning } from './scriptList';

export function resultDisplayHtml(): string {
    return '';
}

function resultAreaFor(scriptPath: string): HTMLElement | null {
    return document.querySelector(`.script-result-area[data-path="${scriptPath}"]`);
}

function runningResultArea(): HTMLElement | null {
    const el = document.querySelector('.script-card .script-run-btn.running');
    if (!el) { return null; }
    const path = (el as HTMLElement).dataset.path;
    return path ? resultAreaFor(path) : null;
}

export function appendOutput(text: string): void {
    const area = runningResultArea();
    if (!area) { return; }
    const log = area.querySelector('.script-output-log');
    if (log) {
        log.innerHTML += `<div>${esc(text)}</div>`;
    }
}

function errorBlockHtml(error: string): string {
    return error ? `<div class="script-output-error">${esc(error)}</div>` : '';
}

function resultsBlockHtml(results: Array<{ label: string; value: string }> | null): string {
    if (!results || results.length === 0) { return ''; }
    const rows = results.map(r =>
        `<span class="script-result-label">${esc(r.label)}</span><span class="script-result-value">${esc(r.value)}</span>`
    ).join('</div><div class="script-result-row">');
    return `<div class="script-output-body"><div class="script-result-row">${rows}</div></div>`;
}

function scriptResultHtml(scriptPath: string, results: Array<{ label: string; value: string }> | null, err: string, pendingWriteCount: number): string {
    const name = scriptPath.split(/[\\/]/).pop() ?? scriptPath;
    const headerClass = err ? ' script-output-hdr-err' : '';
    const icon = err ? '&#9888;' : '&#9654;';
    return `<div class="script-output-block" data-path="${esc(scriptPath)}">
        <div class="script-output-hdr${headerClass}">${icon} ${err ? 'Error' : 'Result'} &mdash; ${esc(name)}</div>${errorBlockHtml(err)}${resultsBlockHtml(results)}${writesBlockHtml(pendingWriteCount)}<div class="script-output-log"></div></div>`;
}

function writesBlockHtml(count: number): string {
    if (count <= 0) { return ''; }
    return `<div class="script-output-writes">&#128190; ${count} byte(s) written (not yet saved)</div>`;
}

export function showResult(scriptPath: string, results: Array<{ label: string; value: string }> | null, error: string, pendingWriteCount: number): void {
    clearRunning();
    const area = resultAreaFor(scriptPath);
    if (!area) { return; }
    area.innerHTML = scriptResultHtml(scriptPath, results, error, pendingWriteCount);
}
