import { esc } from '../../utils';
import { postProviderMessage } from '../../vscodeApi';
import { S } from '../../state';

let currentScripts: Array<{ name: string; filePath: string }> = [];

export function setScripts(scripts: Array<{ name: string; filePath: string }>): void {
    currentScripts = scripts;
}

export function requestScriptList(): void {
    postProviderMessage({ type: 'requestScriptList' });
}

function runScript(filePath: string): void {
    postProviderMessage({ type: 'runScript', scriptPath: filePath, generation: S.documentGeneration });
}

export function scriptListHtml(): string {
    if (currentScripts.length === 0) {
        return '<div class="sb-empty">No scripts found in .hexscope/scripts/</div>';
    }
    return currentScripts.map(s => `
        <div class="script-item" data-path="${esc(s.filePath)}">
            <span class="script-name">${esc(s.name)}</span>
            <button class="script-run-btn" data-path="${esc(s.filePath)}">Run</button>
        </div>
    `).join('');
}

export function wireScriptList(container: HTMLElement): void {
    container.querySelectorAll<HTMLButtonElement>('.script-run-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            runScript(btn.dataset.path!);
        });
    });
}
