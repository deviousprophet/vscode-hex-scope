import { esc } from '../../utils';
import { clearRunning, setScriptStatus, updateStatusDot } from './scriptList';

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

function runningPathFromButton(): string | null {
    const el = document.querySelector('.script-card .script-run-btn.running');
    return el ? (el as HTMLElement).dataset.path ?? null : null;
}

function runningResultArea(): HTMLElement | null {
    const path = runningPathFromButton();
    return path ? resultAreaFor(path) : null;
}

function logAreaHtml(path: string | undefined): string {
    const name = path ? path.split(/[\\/]/).pop() ?? path : 'Script';
    return `<div class="script-output-block" data-path="${cssEscape(path ?? '')}">
        <div class="script-output-hdr" data-collapse> &mdash; ${esc(name)}</div>
        <div class="script-output-body-wrap"><div class="script-output-log"></div></div></div>`;
}

function ensureLogArea(area: HTMLElement): HTMLElement | null {
    let log = area.querySelector('.script-output-log') as HTMLElement | null;
    if (!log) {
        area.innerHTML = logAreaHtml(area.dataset.path);
        log = area.querySelector('.script-output-log') as HTMLElement | null;
        wireCollapse(area);
    }
    return log;
}

function logLinesHtml(lines: string[]): string {
    return lines.map(l => `<div>${esc(l)}</div>`).join('');
}

function flushBuffer(): void {
    if (outputBuffer.length === 0) { return; }
    const lines = outputBuffer.splice(0);
    const area = runningResultArea();
    if (!area) { return; }
    const log = ensureLogArea(area);
    if (log) { log.insertAdjacentHTML('beforeend', logLinesHtml(lines)); }
}

function appendRealtime(text: string): void {
    const area = runningResultArea();
    if (!area) { return; }
    const log = ensureLogArea(area);
    if (log) { log.insertAdjacentHTML('beforeend', `<div>${esc(text)}</div>`); }
}

export function appendOutput(text: string): void {
    outputCount++;
    if (outputCount <= BATCH_THRESHOLD) {
        appendRealtime(text);
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
    if (!err) { return { icon: '', label: 'Result', cssClass: '' }; }
    return ERROR_HEADERS[errType ?? ''] ?? { icon: '&#9888;', label: 'Error', cssClass: ' script-output-hdr-err' };
}

function scriptResultHtml(scriptPath: string, results: Array<{ label: string; value: string }> | null, log: string[] | null, err: string, errType: ErrorType, pendingWriteCount: number): string {
    const name = scriptPath.split(/[\\/]/).pop() ?? scriptPath;
    const h = headerFor(err, errType);
    const logHtml = log ? log.map(l => `<div>${esc(l)}</div>`).join('') : '';
    return `<div class="script-output-block collapsed" data-path="${esc(scriptPath)}">
        <div class="script-output-hdr${h.cssClass}" data-collapse>${h.icon} ${h.label} &mdash; ${esc(name)}</div>
        <div class="script-output-body-wrap">${errorBlockHtml(err)}${resultsBlockHtml(results)}${writesBlockHtml(pendingWriteCount)}<div class="script-output-log">${logHtml}</div></div></div>`;
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

function flushPendingOutput(): void {
    if (!flushTimer) { return; }
    clearTimeout(flushTimer);
    flushTimer = null;
    flushBuffer();
}

export function showResult(scriptPath: string, results: Array<{ label: string; value: string }> | null, log: string[] | null, error: string, errorType: string | undefined, pendingWriteCount: number): void {
    clearRunning();
    outputCount = 0;
    flushPendingOutput();
    setScriptStatus(scriptPath, error ? 'error' : 'success');
    updateStatusDot(scriptPath);

    const area = resultAreaFor(scriptPath);
    if (!area) { return; }
    area.innerHTML = scriptResultHtml(scriptPath, results, log, error, errorType as ErrorType, pendingWriteCount);
    const block = area.querySelector('.script-output-block');
    if (block) { block.classList.remove('collapsed'); }
    wireCollapse(area);
}
