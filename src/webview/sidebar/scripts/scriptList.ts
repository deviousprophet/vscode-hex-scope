import { esc } from '../../utils';
import { postProviderMessage } from '../../vscodeApi';
import { S } from '../../state';

let currentScripts: Array<{ name: string; filePath: string }> = [];
const scriptStatus = new Map<string, 'success' | 'error' | null>();
let runningPath: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

export function setScripts(scripts: Array<{ name: string; filePath: string }>): void {
    currentScripts = scripts;
    for (const s of scripts) {
        if (!scriptStatus.has(s.filePath)) { scriptStatus.set(s.filePath, null); }
    }
}

export function setScriptStatus(path: string, status: 'success' | 'error'): void {
    scriptStatus.set(path, status);
}

export function clearRunning(): void {
    runningPath = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    renderRunStates();
}

function setRunning(path: string): void {
    runningPath = path;
    if (pendingTimer) { clearTimeout(pendingTimer); }
    pendingTimer = setTimeout(() => {
        pendingTimer = null;
        renderRunStates();
    }, 200);
    renderRunStates();
}

export function requestScriptList(): void {
    postProviderMessage({ type: 'requestScriptList' });
}

export function updateScriptCount(count: number): void {
    const el = document.getElementById('scripts-count');
    if (el) { el.textContent = `(${count})`; }
}

function runScript(filePath: string): void {
    if (runningPath) { return; }
    setRunning(filePath);
    postProviderMessage({ type: 'runScript', scriptPath: filePath, generation: S.documentGeneration });
}

function cancelScript(filePath: string): void {
    runningPath = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    renderRunStates();
    // AbortController integration — post cancel message
    // Currently not wired to provider; timeout is the fallback
}

function extLabel(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(idx + 1) : '';
}

function statusDot(path: string): string {
    const st = scriptStatus.get(path);
    if (st === 'success') { return '<span class="script-dot dot-ok" title="Last run succeeded"></span>'; }
    if (st === 'error') { return '<span class="script-dot dot-err" title="Last run errored"></span>'; }
    return '<span class="script-dot dot-idle" title="Not yet run"></span>';
}

function runIconHtml(path: string): string {
    const isRun = runningPath === path;
    const isPending = isRun && pendingTimer !== null;
    if (isPending) { return '<span class="script-btn-icon spin"></span>'; }
    if (isRun) { return '<span class="script-btn-icon stop">&#9632;</span>'; }
    return '<span class="script-btn-icon play">&#9654;</span>';
}

export function scriptListHtml(): string {
    if (currentScripts.length === 0) {
        return '<div class="sb-empty">No scripts found in .hexscope/scripts/</div>';
    }
    return currentScripts.map(s => {
        const ext = extLabel(s.name);
        const isRun = runningPath === s.filePath;
        const isDisabled = ext === 'ts';
        return `
        <div class="script-card" data-path="${esc(s.filePath)}">
            <div class="script-card-info">
                ${statusDot(s.filePath)}
                <span class="script-name" title="${esc(s.filePath)}">${esc(s.name)}</span>
                ${ext ? `<span class="script-ext">${esc(ext)}</span>` : ''}
                <button class="script-run-btn${isRun ? ' running' : ''}${isDisabled ? ' disabled-ts' : ''}" data-path="${esc(s.filePath)}"${isDisabled ? ' title="TypeScript scripts require esbuild. Use .js or run npm install."' : ''}>
                    ${runIconHtml(s.filePath)}
                </button>
            </div>
            <div class="script-result-area" data-path="${esc(s.filePath)}"></div>
        </div>`;
    }).join('');
}

export function wireScriptList(container: HTMLElement): void {
    container.querySelectorAll<HTMLButtonElement>('.script-run-btn:not(.disabled-ts)').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.dataset.path;
            if (!path) { return; }
            if (runningPath === path) { cancelScript(path); }
            else { runScript(path); }
        });
    });
}

function renderRunStates(): void {
    document.querySelectorAll<HTMLButtonElement>('.script-run-btn').forEach(btn => {
        const path = btn.dataset.path;
        if (!path) { return; }
        const isRun = runningPath === path;
        const isPending = isRun && pendingTimer !== null;
        btn.classList.toggle('running', isRun);
        btn.innerHTML = runIconHtml(path);
        btn.title = isRun ? (isPending ? 'Running…' : 'Click to cancel') : '';
    });
}
