import { esc } from '../../utils';
import { clearRunning } from './scriptList';

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
    return `<div class="script-output-block" data-path="${esc(scriptPath)}">
        <div class="script-output-hdr${headerClass}">${err ? '&#9888; Error' : '&#9654; Result'} &mdash; ${esc(name)}</div>${errorBlockHtml(err)}${resultsBlockHtml(results)}${writesBlockHtml(pendingWriteCount)}<div class="script-output-log"></div></div>`;
}

function writesBlockHtml(count: number): string {
    if (count <= 0) { return ''; }
    return `<div class="script-output-writes">&#128190; ${count} byte(s) written (not yet saved)</div>`;
}

function existingBlock(scriptPath: string): Element | null {
    const path = scriptPath.replace(/[\\/]/g, '\\/');
    return document.querySelector(`.script-output-block[data-path="${path}"]`);
}

export function showResult(scriptPath: string, results: Array<{ label: string; value: string }> | null, error: string, pendingWriteCount: number): void {
    clearRunning();
    const el = document.getElementById('script-output');
    if (!el) { return; }
    const existing = existingBlock(scriptPath);
    if (existing) {
        existing.outerHTML = scriptResultHtml(scriptPath, results, error, pendingWriteCount);
    } else {
        el.insertAdjacentHTML('afterbegin', scriptResultHtml(scriptPath, results, error, pendingWriteCount));
    }
}
