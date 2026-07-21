import { setScripts, scriptListHtml, wireScriptList, requestScriptList, updateScriptCount } from './scriptList';
import { showResult, appendOutput } from './resultDisplay';

let initialized = false;

export function activateScripts(): void {
    if (initialized) { return; }
    initialized = true;
    requestScriptList();
}

export function updateScriptList(scripts: Array<{ name: string; filePath: string }>): void {
    setScripts(scripts);
    updateScriptCount(scripts.length);
    const sec = document.getElementById('s-scripts');
    if (!sec) { return; }
    let list = sec.querySelector('.s-scripts-list') as HTMLElement | null;
    if (!list) {
        list = document.createElement('div');
        list.className = 's-scripts-list';
        const body = sec.querySelector('.sb-body');
        if (body) { body.innerHTML = ''; body.appendChild(list); }
    }
    list.innerHTML = scriptListHtml();
    wireScriptList(list);
}

export function updateScriptResult(scriptPath: string, result: { results: Array<{ label: string; value: string }>; log: string[] } | null, error: string, errorType: string | undefined, pendingWriteCount: number): void {
    showResult(scriptPath, result?.results, result?.log, error, errorType, pendingWriteCount);
}

export function updateScriptOutput(scriptPath: string, text: string): void {
    appendOutput(text);
}

export function renderScripts(): void {
    const sec = document.getElementById('s-scripts');
    if (!sec) { return; }
    sec.innerHTML = `
        <div class="sb-hdr scripts-toolbar">
            <span class="scripts-toolbar-title">Scripts</span>
            <span class="scripts-count" id="scripts-count"></span>
            <button class="scripts-refresh-btn" id="scripts-refresh" title="Refresh script list">&#8635;</button>
        </div>
        <div class="sb-body">
            <div class="s-scripts-list">${scriptListHtml()}</div>
        </div>`;
    document.getElementById('scripts-refresh')?.addEventListener('click', () => {
        requestScriptList();
    });
}
