import { esc } from '../../utils';
import { postProviderMessage } from '../../vscodeApi';
import { S } from '../../state';

let currentScripts: Array<{ name: string; filePath: string }> = [];
let runningPath: string | null = null;

export function setScripts(scripts: Array<{ name: string; filePath: string }>): void {
    currentScripts = scripts;
}

export function requestScriptList(): void {
    postProviderMessage({ type: 'requestScriptList' });
}

export function setRunning(path: string | null): void {
    runningPath = path;
}

function runScript(filePath: string): void {
    runningPath = filePath;
    postProviderMessage({ type: 'runScript', scriptPath: filePath, generation: S.documentGeneration });
}

function extLabel(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx + 1) : '';
}

export function scriptListHtml(): string {
    if (currentScripts.length === 0) {
        return '<div class="sb-empty">No scripts found in .hexscope/scripts/</div>';
    }
    return currentScripts.map(s => {
        const ext = extLabel(s.name);
        const isRunning = runningPath === s.filePath;
        return `
        <div class="script-card" data-path="${esc(s.filePath)}">
            <div class="script-card-info">
                <span class="script-name" title="${esc(s.filePath)}">${esc(s.name)}</span>
                ${ext ? `<span class="script-ext">${esc(ext)}</span>` : ''}
                <button class="script-run-btn${isRunning ? ' running' : ''}" data-path="${esc(s.filePath)}">${isRunning ? 'Running…' : 'Run'}</button>
            </div>
            <div class="script-result-area" data-path="${esc(s.filePath)}"></div>
        </div>`;
    }).join('');
}

export function wireScriptList(container: HTMLElement): void {
    container.querySelectorAll<HTMLButtonElement>('.script-run-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            runScript(btn.dataset.path!);
            renderRunButtons();
        });
    });
}

function renderRunButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('.script-run-btn').forEach(btn => {
        const isRunning = btn.dataset.path === runningPath;
        btn.textContent = isRunning ? 'Running…' : 'Run';
        btn.classList.toggle('running', isRunning);
    });
}

export function clearRunning(): void {
    runningPath = null;
    renderRunButtons();
}
