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

function scriptResultHtml(scriptPath: string, results: Array<{ label: string; value: string }> | null, error: string, pendingWriteCount: number): string {
    const name = scriptPath.split(/[\\/]/).pop() ?? scriptPath;
    let html = `<div class="script-output-block">
        <div class="script-output-header">${esc(name)}</div>`;
    if (error) {
        html += `<div class="script-output-error">${esc(error)}</div>`;
    }
    if (results && results.length > 0) {
        html += '<div class="script-output-results">';
        for (const r of results) {
            html += `<div class="script-result-row"><span class="script-result-label">${esc(r.label)}:</span><span class="script-result-value">${esc(r.value)}</span></div>`;
        }
        html += '</div>';
    }
    if (pendingWriteCount > 0) {
        html += `<div class="script-output-writes">${pendingWriteCount} byte(s) written (not yet saved)</div>`;
    }
    html += '<div class="script-output-log"></div></div>';
    return html;
}

export function showResult(scriptPath: string, results: Array<{ label: string; value: string }> | null, error: string, pendingWriteCount: number): void {
    const el = document.getElementById('script-output');
    if (!el) { return; }
    el.insertAdjacentHTML('afterbegin', scriptResultHtml(scriptPath, results, error, pendingWriteCount));
}
