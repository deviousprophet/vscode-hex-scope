import { esc } from '../../utils';
import { clearRunning, setScriptStatus } from './scriptList';

let outputCount = 0;
let outputBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_THRESHOLD = 100;

function cssEscape(path: string): string {
    return path.replace(/\\/g, '\\\\');
}

function resultAreaFor(scriptPath: string): HTMLElement | null {
    return document.querySelector(`.script-result-area[data-path="${cssEscape(scriptPath)}"]`);
}

function runningResultArea(): HTMLElement | null {
    const el = document.querySelector('.script-card .script-run-btn.running');
    if (!el) { return null; }
    const path = (el as HTMLElement).dataset.path;
    return path ? resultAreaFor(path) : null;
}

function logLinesHtml(lines: string[]): string {
    return lines.map(l => `<div>${esc(l)}</div>`).join('');
}

function flushBuffer(): void {
    if (outputBuffer.length === 0) { return; }
    const lines = outputBuffer.splice(0);
    const area = runningResultArea();
    if (!area) { return; }
    const log = area.querySelector('.script-output-log');
    if (log) {
        log.insertAdjacentHTML('beforeend', logLinesHtml(lines));
    }
}

export function appendOutput(text: string): void {
    outputCount++;
    if (outputCount <= BATCH_THRESHOLD) {
        const area = runningResultArea();
        if (!area) { return; }
        const log = area.querySelector('.script-output-log');
        if (log) { log.insertAdjacentHTML('beforeend', `<div>${esc(text)}</div>`); }
        return;
    }
    outputBuffer.push(text);
    if (flushTimer) { clearTimeout(flushTimer); }
    flushTimer = setTimeout(() => { flushTimer = null; flushBuffer(); }, 0);
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

type ErrorType = 'compile' | 'runtime' | 'timeout' | 'cancel' | undefined;

const ERROR_HEADERS: Record<string, { icon: string; label: string; cssClass: string }> = {
    compile: { icon: '&#9888;', label: 'Compile Error', cssClass: ' script-output-hdr-err-compile' },
    runtime: { icon: '&#128308;', label: 'Script Error', cssClass: ' script-output-hdr-err' },
    timeout: { icon: '&#9201;', label: 'Timeout', cssClass: ' script-output-hdr-err-timeout' },
    cancel: { icon: '&#9632;', label: 'Cancelled', cssClass: ' script-output-hdr-err-cancel' },
};

function headerFor(err: string, errType: ErrorType): { icon: string; label: string; cssClass: string } {
    if (!err) { return { icon: '&#9654;', label: 'Result', cssClass: '' }; }
    return ERROR_HEADERS[errType ?? ''] ?? { icon: '&#9888;', label: 'Error', cssClass: ' script-output-hdr-err' };
}

function scriptResultHtml(scriptPath: string, results: Array<{ label: string; value: string }> | null, err: string, errType: ErrorType, pendingWriteCount: number): string {
    const name = scriptPath.split(/[\\/]/).pop() ?? scriptPath;
    const h = headerFor(err, errType);
    return `<div class="script-output-block collapsed" data-path="${esc(scriptPath)}">
        <div class="script-output-hdr${h.cssClass}" data-collapse>${h.icon} ${h.label} &mdash; ${esc(name)}</div>
        <div class="script-output-body-wrap">${errorBlockHtml(err)}${resultsBlockHtml(results)}${writesBlockHtml(pendingWriteCount)}<div class="script-output-log"></div></div></div>`;
}

function writesBlockHtml(count: number): string {
    if (count <= 0) { return ''; }
    return `<div class="script-output-writes">&#128190; ${count} byte(s) written (not yet saved)</div>`;
}

function wireCollapse(area: HTMLElement): void {
    area.querySelectorAll('[data-collapse]').forEach(hdr => {
        hdr.addEventListener('click', () => {
            const block = (hdr as HTMLElement).closest('.script-output-block');
            if (block) { block.classList.toggle('collapsed'); }
        });
    });
}

export function showResult(scriptPath: string, results: Array<{ label: string; value: string }> | null, error: string, errorType: string | undefined, pendingWriteCount: number): void {
    clearRunning();
    outputCount = 0;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; flushBuffer(); }

    setScriptStatus(scriptPath, error ? 'error' : 'success');

    const area = resultAreaFor(scriptPath);
    if (!area) { return; }
    area.innerHTML = scriptResultHtml(scriptPath, results, error, errorType as ErrorType, pendingWriteCount);
    // Auto-expand: remove collapsed class so result is visible
    const block = area.querySelector('.script-output-block');
    if (block) { block.classList.remove('collapsed'); }
    wireCollapse(area);
}
