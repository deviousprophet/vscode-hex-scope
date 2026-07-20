import { setScripts, scriptListHtml, wireScriptList, requestScriptList } from './scriptList';
import { resultDisplayHtml, showResult, appendOutput } from './resultDisplay';

let initialized = false;

export function activateScripts(): void {
    if (initialized) { return; }
    initialized = true;
    requestScriptList();
}

export function updateScriptList(scripts: Array<{ name: string; filePath: string }>): void {
    setScripts(scripts);
    const container = document.getElementById('s-scripts');
    if (!container) { return; }
    const body = container.querySelector('.sb-body');
    if (!body) { return; }
    body.innerHTML = scriptListHtml();
    wireScriptList(body as HTMLElement);
}

export function updateScriptResult(scriptPath: string, result: { results: Array<{ label: string; value: string }>; log: string[] } | null, error: string, pendingWriteCount: number): void {
    showResult(scriptPath, result?.results ?? null, error, pendingWriteCount);
    if (result?.log) {
        for (const line of result.log) {
            appendOutput(line);
        }
    }
}

export function updateScriptOutput(scriptPath: string, text: string): void {
    appendOutput(text);
}

export function scriptsSectionHtml(): string {
    return `
        <div class="sb-hdr">Scripts</div>
        <div class="sb-body">
            ${scriptListHtml()}
            ${resultDisplayHtml()}
        </div>`;
}
