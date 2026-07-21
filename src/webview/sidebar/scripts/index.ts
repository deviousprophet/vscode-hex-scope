import { setScripts, scriptListHtml, wireScriptList, requestScriptList } from './scriptList';
import { showResult, appendOutput } from './resultDisplay';

let initialized = false;

export function activateScripts(): void {
    if (initialized) { return; }
    initialized = true;
    requestScriptList();
}

export function updateScriptList(scripts: Array<{ name: string; filePath: string }>): void {
    setScripts(scripts);
    const sec = document.getElementById('s-scripts');
    if (!sec) { return; }
    let list = sec.querySelector('.s-scripts-list') as HTMLElement | null;
    if (!list) {
        list = document.createElement('div');
        list.className = 's-scripts-list';
        sec.querySelector('.sb-body')?.prepend(list);
    }
    list.innerHTML = scriptListHtml();
    wireScriptList(list);
}

function appendLog(log: string[] | undefined): void {
    if (!log) { return; }
    for (const line of log) { appendOutput(line); }
}

export function updateScriptResult(scriptPath: string, result: { results: Array<{ label: string; value: string }>; log: string[] } | null, error: string, pendingWriteCount: number): void {
    showResult(scriptPath, result?.results ?? null, error, pendingWriteCount);
    appendLog(result?.log);
}

export function updateScriptOutput(scriptPath: string, text: string): void {
    appendOutput(text);
}

export function renderScripts(): void {
    const sec = document.getElementById('s-scripts');
    if (!sec) { return; }
    sec.innerHTML = `
        <div class="sb-hdr">Scripts</div>
        <div class="sb-body">
            <div class="s-scripts-list">${scriptListHtml()}</div>
        </div>`;
}
