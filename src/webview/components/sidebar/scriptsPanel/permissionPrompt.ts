/** Inline permission prompt for a dangerous script call.
 *
 * One prompt at a time, rendered inside the script's own card above the result
 * area. The primary action allows exactly one call; broader scopes live behind
 * "More options". Escape denies, focus starts on the primary action and returns
 * to the card's Run button when the prompt closes. The component stores nothing
 * — it forwards the decision through the callback.
 *
 * `scriptsPanel.ts` owns lifecycle (`showPermissionRequest` / `showResult`) and
 * posts the decision via `onScriptPermissionDecision`. */

import { esc } from '../../../utils';
import {
    SCRIPT_PERMISSION_TIMEOUT_MS,
    type ProviderToWebviewMessage,
    type ScriptCapability,
    type ScriptCapabilityGrant,
    type ScriptPermissionScope,
} from '../../../../webviewProtocol';

export type ScriptPermissionRequest = Extract<ProviderToWebviewMessage, { type: 'scriptPermissionRequest' }>;
export type PermissionDecision = 'allow' | 'deny';

export interface PermissionPromptCallbacks {
    onDecision: (
        requestId: number,
        decision: PermissionDecision,
        scope: ScriptPermissionScope,
        capability: ScriptCapabilityGrant,
    ) => void;
}

type ScopeOption = {
    scope: ScriptPermissionScope;
    grant: ScriptCapabilityGrant;
    label: string;
};

const PROMPT_CLASS = 'script-perm';

/** Human sentence for the capability being requested. */
function capabilityPhrase(capability: ScriptCapability): string {
    if (capability === 'write') { return 'write bytes to this file'; }
    if (capability === 'exec') { return 'run an external command'; }
    return 'make a network request';
}

/** Scope choices offered for one request (workspace is never offered for exec).
 *  Labels state the real lifetime: script/session grants live in memory until
 *  the host exits; workspace grants persist across restarts. */
function scopeOptions(request: ScriptPermissionRequest): ScopeOption[] {
    const cap = request.capability;
    const options: ScopeOption[] = [
        { scope: 'script', grant: cap, label: `Allow ${cap} for this script, until VS Code restarts` },
        { scope: 'script', grant: '*', label: 'Allow all capabilities for this script, until VS Code restarts' },
        { scope: 'session', grant: cap, label: `Allow ${cap} for every script, until VS Code restarts` },
        { scope: 'session', grant: '*', label: 'Allow all capabilities for every script, until VS Code restarts' },
    ];
    if (request.scopes.includes('workspace')) {
        options.push(
            { scope: 'workspace', grant: cap, label: `Always allow ${cap} for this script in this workspace, across restarts` },
            { scope: 'workspace', grant: '*', label: 'Always allow all non-exec capabilities in this workspace, across restarts' },
        );
    }
    return options.filter(option => request.scopes.includes(option.scope));
}

function cardFor(scriptPath: string): HTMLElement | null {
    for (const card of document.querySelectorAll<HTMLElement>('.script-card')) {
        if (card.dataset.path === scriptPath) { return card; }
    }
    return null;
}

function optionsHtml(options: ScopeOption[]): string {
    return options.map(option => `
        <button type="button" class="script-perm-option" role="menuitem"
            data-scope="${esc(option.scope)}" data-grant="${esc(option.grant)}">${esc(option.label)}</button>`).join('');
}

export class PermissionPrompt {
    private request: ScriptPermissionRequest | null = null;
    /** Mirrors the host timeout so a dead prompt cannot linger if no result arrives. */
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly cb: PermissionPromptCallbacks,
        private readonly timeoutMs: number = SCRIPT_PERMISSION_TIMEOUT_MS,
    ) {}

    /** Render a request, denying any prompt it replaces. */
    show(request: ScriptPermissionRequest): void {
        if (this.request) { this.dismiss(true); }
        this.removePanels();
        const card = cardFor(request.scriptPath);
        const area = card?.querySelector<HTMLElement>('.script-result-area');
        if (!card || !area) {
            // No card to attach to (script list changed mid-run) → deny immediately.
            this.cb.onDecision(request.requestId, 'deny', 'once', request.capability);
            return;
        }
        this.request = request;
        const panel = this.buildPanel(request);
        card.insertBefore(panel, area);
        this.wire(panel, request);
        panel.querySelector<HTMLElement>('[data-perm-allow]')?.focus();
        this.timer = setTimeout(() => this.dismiss(false, false), this.timeoutMs);
    }

    /** Deny a still-open request and remove the prompt (result arrived / panel reset). */
    close(): void {
        this.dismiss(true);
    }

    /** Teardown: drop the prompt and its timer without a redundant deny message. */
    dispose(): void {
        this.dismiss(false, false);
    }

    /** True when the prompt currently on screen belongs to `scriptPath`. */
    isOpenFor(scriptPath: string): boolean {
        return this.request?.scriptPath === scriptPath;
    }

    private buildPanel(request: ScriptPermissionRequest): HTMLElement {
        const panel = document.createElement('div');
        panel.className = PROMPT_CLASS;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-labelledby', `script-perm-title-${request.requestId}`);
        const titleId = `script-perm-title-${request.requestId}`;
        const note = request.capability === 'write'
            ? 'Approved bytes are saved when the script finishes.'
            : 'The script continues after you choose.';
        panel.innerHTML = `
            <div class="script-perm-title" id="${esc(titleId)}">Allow ${esc(request.scriptName)} to ${esc(capabilityPhrase(request.capability))}?</div>
            <div class="script-perm-detail">${esc(request.detail)}</div>
            <div class="script-perm-note">${esc(note)}</div>
            <div class="script-perm-actions">
                <button type="button" class="sb-btn sb-btn-primary" data-perm-allow>Allow once</button>
                <button type="button" class="sb-btn sb-btn-secondary" data-perm-menu
                    aria-haspopup="menu" aria-expanded="false">More options</button>
                <button type="button" class="sb-btn sb-btn-secondary" data-perm-deny>Deny</button>
            </div>
            <div class="script-perm-menu" role="menu" hidden>${optionsHtml(scopeOptions(request))}</div>`;
        return panel;
    }

    private wire(panel: HTMLElement, request: ScriptPermissionRequest): void {
        panel.querySelector('[data-perm-allow]')?.addEventListener('click', () => {
            this.decide('allow', 'once', request.capability);
        });
        panel.querySelector('[data-perm-deny]')?.addEventListener('click', () => this.dismiss(true));
        const menu = panel.querySelector<HTMLElement>('.script-perm-menu');
        const menuBtn = panel.querySelector<HTMLElement>('[data-perm-menu]');
        menuBtn?.addEventListener('click', () => this.toggleMenu(menu, menuBtn));
        panel.querySelectorAll<HTMLElement>('.script-perm-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const scope = opt.dataset.scope as ScriptPermissionScope | undefined;
                const grant = opt.dataset.grant as ScriptCapabilityGrant | undefined;
                if (!scope || !grant) { return; }
                this.decide('allow', scope, grant);
            });
        });
        panel.addEventListener('keydown', ev => {
            const e = ev as KeyboardEvent;
            if (e.key !== 'Escape') { return; }
            e.preventDefault();
            this.dismiss(true);
        });
    }

    private toggleMenu(menu: HTMLElement | null, menuBtn: HTMLElement): void {
        if (!menu) { return; }
        const open = menu.hidden;
        menu.hidden = !open;
        menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) { menu.querySelector<HTMLElement>('.script-perm-option')?.focus(); }
    }

    private decide(decision: PermissionDecision, scope: ScriptPermissionScope, capability: ScriptCapabilityGrant): void {
        const request = this.request;
        if (!request) { return; }
        this.clearTimer();
        this.request = null;
        this.removePanels();
        this.focusRunButton(request.scriptPath);
        this.cb.onDecision(request.requestId, decision, scope, capability);
    }

    private dismiss(sendDeny: boolean, restoreFocus = sendDeny): void {
        this.clearTimer();
        const request = this.request;
        this.request = null;
        this.removePanels();
        if (!request) { return; }
        if (restoreFocus) { this.focusRunButton(request.scriptPath); }
        if (sendDeny) { this.cb.onDecision(request.requestId, 'deny', 'once', request.capability); }
    }

    private clearTimer(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    }

    private removePanels(): void {
        document.querySelectorAll(`.${PROMPT_CLASS}`).forEach(el => el.remove());
    }

    private focusRunButton(scriptPath: string): void {
        cardFor(scriptPath)?.querySelector<HTMLElement>('.script-run-btn')?.focus();
    }
}
