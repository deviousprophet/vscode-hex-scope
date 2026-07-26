import { esc } from '../../utils';
import { postProviderMessage } from '../../vscodeApi';
import { S } from '../../state';
import { currentSelectionRange } from '../../memory/selection';

interface ScriptEntry {
    name: string;
    filePath: string;
    capabilities: string[];
}

let currentScripts: ScriptEntry[] = [];
let trusted: boolean = true;
const scriptStatus = new Map<string, 'success' | 'error' | null>();
let runningPath: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let runStartCallback: (() => void) | null = null;

export function setRunStartCallback(cb: () => void): void {
    runStartCallback = cb;
}

export function setScripts(scripts: ScriptEntry[], isTrusted: boolean): void {
    currentScripts = scripts;
    trusted = isTrusted;
    for (const s of scripts) {
        if (!scriptStatus.has(s.filePath)) { scriptStatus.set(s.filePath, null); }
    }
}

export function setScriptStatus(path: string, status: 'success' | 'error'): void {
    scriptStatus.set(path, status);
}

export function updateStatusDot(path: string): void {
    const st = scriptStatus.get(path);
    const dot = document.querySelector(`.script-card[data-path="${cssEscape(path)}"] .script-dot`);
    if (!dot) { return; }
    dot.className = 'script-dot';
    if (st === 'success') { dot.classList.add('dot-ok'); (dot as HTMLElement).title = 'Last run succeeded'; }
    else if (st === 'error') { dot.classList.add('dot-err'); (dot as HTMLElement).title = 'Last run errored'; }
    else { dot.classList.add('dot-idle'); (dot as HTMLElement).title = 'Not yet run'; }
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
    if (el) { el.textContent = String(count); el.hidden = count === 0; }
}

function runScript(filePath: string): void {
    if (runningPath) { return; }
    runStartCallback?.();
    setRunning(filePath);
    const selectionRange = currentSelectionRange() ?? undefined;
    postProviderMessage({ type: 'runScript', scriptPath: filePath, generation: S.documentGeneration, selectionRange });
}

function cancelScript(filePath: string): void {
    runningPath = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    renderRunStates();
    postProviderMessage({ type: 'cancelScript', scriptPath: filePath });
}

function cssEscape(path: string): string {
    return path.replace(/\\/g, '\\\\');
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

function capBadges(capabilities: string[]): string {
    return capabilities.map(c => {
        const label = c === 'exec' ? '⚡ exec' : c === 'network' ? '🌐 net' : c;
        return `<span class="script-cap">${esc(label)}</span>`;
    }).join('');
}

function btnTitle(noTrust: boolean, extTs: boolean): string {
    if (noTrust) { return ' title="Workspace not trusted"'; }
    if (extTs) { return ' title="TypeScript scripts require esbuild. Use .js or run npm install."'; }
    return '';
}

function btnClass(path: string, noTrust: boolean, extTs: boolean): string {
    let cls = '';
    if (runningPath === path) { cls += ' running'; }
    if (extTs) { cls += ' disabled-ts'; }
    if (noTrust) { cls += ' disabled-trust'; }
    return cls;
}

function scriptBtnAttrs(path: string, noTrust: boolean, extTs: boolean): { btnClass: string; btnTitle: string } {
    return { btnClass: btnClass(path, noTrust, extTs), btnTitle: btnTitle(noTrust, extTs) };
}

function scriptCardHtml(s: ScriptEntry): string {
    const ext = extLabel(s.name);
    const noTrust = !trusted;
    const extTs = ext === 'ts' && !noTrust;
    const attrs = scriptBtnAttrs(s.filePath, noTrust, extTs);
    const extBadge = ext ? `<span class="script-ext">${esc(ext)}</span>` : '';
    const caps = s.capabilities.length > 0 ? capBadges(s.capabilities) : '';
    return `
        <div class="script-card" data-path="${esc(s.filePath)}">
            <div class="script-card-info">
                ${statusDot(s.filePath)}
                <span class="script-name" title="${esc(s.filePath)}">${esc(s.name)}</span>
                ${extBadge}${caps}
                <button class="script-run-btn${attrs.btnClass}" data-path="${esc(s.filePath)}"${attrs.btnTitle}>
                    ${runIconHtml(s.filePath)}
                </button>
            </div>
            <div class="script-result-area" data-path="${esc(s.filePath)}"></div>
        </div>`;
}

export function scriptListHtml(): string {
    if (currentScripts.length === 0) {
        return '<div class="sb-empty">No scripts found in .hexscope/scripts/</div>';
    }
    return currentScripts.map(scriptCardHtml).join('');
}

export function wireScriptList(container: HTMLElement): void {
    container.querySelectorAll<HTMLButtonElement>('.script-run-btn:not(.disabled-ts):not(.disabled-trust)').forEach(btn => {
        btn.addEventListener('click', () => {
            const path = btn.dataset.path;
            if (!path) { return; }
            if (runningPath === path) { cancelScript(path); }
            else { runScript(path); }
        });
    });
}

function updateBtnState(btn: HTMLButtonElement): void {
    const path = btn.dataset.path;
    if (!path) { return; }
    const isRun = runningPath === path;
    btn.classList.toggle('running', isRun);
    btn.innerHTML = runIconHtml(path);
    btn.title = isRun ? (pendingTimer !== null ? 'Running…' : 'Click to cancel') : '';
}

function renderRunStates(): void {
    document.querySelectorAll<HTMLButtonElement>('.script-run-btn').forEach(updateBtnState);
}
