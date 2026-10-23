import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../../../cssImportHook';

import { ScriptsPanel, type ScriptInfo } from '../../../../../webview/components/sidebar/scriptsPanel/scriptsPanel';
import {
    PermissionPrompt,
    type ScriptPermissionRequest,
} from '../../../../../webview/components/sidebar/scriptsPanel/permissionPrompt';

let currentDom: JSDOM | null = null;
let currentPanel: ScriptsPanel | null = null;

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
    navigator: Navigator;
};

type Decision = { requestId: number; decision: string; scope: string; capability?: string };

type Cb = {
    requested: number;
    added: number;
    runs: Array<{ path: string; generation: number; selection?: { start: number; end: number } }>;
    cancels: string[];
    opens: string[];
    decisions: Decision[];
    revokes: Array<[string, string]>;
};

type Harness = {
    dom: JSDOM;
    panel: ScriptsPanel;
    cb: Cb;
    sel: { value: { start: number; end: number } | null };
    generation: { value: number };
};

const A = 'D:\\sample\\crc-check.js';
const B = 'D:\\sample\\hello.js';

const SCRIPTS: ScriptInfo[] = [
    { name: 'crc-check.js', filePath: A, capabilities: ['exec'], roles: [], fingerprint: 'fp-1' },
    { name: 'crc-check.ts', filePath: 'D:\\sample\\crc-check.ts', capabilities: ['exec', 'network'], roles: [], fingerprint: 'fp-2' },
    { name: 'hello.js', filePath: B, capabilities: [], roles: [], fingerprint: 'fp-3' },
];

const PERMISSION_REQUEST: ScriptPermissionRequest = {
    type: 'scriptPermissionRequest',
    requestId: 11,
    capability: 'write',
    detail: 'Write 2 bytes at 0x8000000',
    scriptPath: A,
    scriptName: 'crc-check.js',
    fingerprint: 'fp-1',
    scopes: ['once', 'script', 'session', 'workspace'],
};

function permissionRequest(overrides: Partial<ScriptPermissionRequest> = {}): ScriptPermissionRequest {
    return { ...PERMISSION_REQUEST, ...overrides };
}

function installDom(): Harness {
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as Globalish;
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    Object.defineProperty(globalThis, 'navigator', {
        value: dom.window.navigator,
        configurable: true,
        writable: true,
    });

    const cb: Cb = { requested: 0, added: 0, runs: [], cancels: [], opens: [], decisions: [], revokes: [] };
    const sel: { value: { start: number; end: number } | null } = { value: null };
    const generation: { value: number } = { value: 0 };
    const panel = new ScriptsPanel({
        onRequestList: () => { cb.requested++; },
        onAddExampleScripts: () => { cb.added++; },
        onRunScript: (scriptPath, gen, selectionRange) => {
            cb.runs.push({ path: scriptPath, generation: gen, selection: selectionRange });
        },
        onCancelScript: path => { cb.cancels.push(path); },
        onOpenScript: path => { cb.opens.push(path); },
        onScriptPermissionDecision: (requestId, decision, scope, capability) => {
            cb.decisions.push({ requestId, decision, scope, capability });
        },
        onRevokeScriptPermission: (path, capability) => { cb.revokes.push([path, capability]); },
        getSelection: () => sel.value,
        getGeneration: () => generation.value,
    });
    panel.mount(document.getElementById('host')!);
    currentPanel = panel;
    return { dom, panel, cb, sel, generation };
}

function cleanupDom(): void {
    if (currentDom) {
        // Cancel any pending spinner/flush timer FIRST so its callback can
        // never fire after the jsdom globals are deleted (previously a
        // flaky ReferenceError: document is not defined under suite load).
        currentPanel?.dispose();
        currentPanel = null;
        currentDom.window.close();
        currentDom = null;
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
        delete (globalThis as unknown as { navigator?: Navigator }).navigator;
    }
}

function click(dom: JSDOM, el: Element | null): void {
    assert.ok(el, 'target element should exist');
    el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function cardFor(path: string): HTMLElement {
    return document.querySelector<HTMLElement>(`.script-card[data-path="${path.replace(/\\/g, '\\\\')}"]`)!;
}

function runBtn(path: string): HTMLButtonElement {
    return cardFor(path).querySelector<HTMLButtonElement>('.script-run-btn')!;
}

function openBtn(path: string): HTMLButtonElement {
    return cardFor(path).querySelector<HTMLButtonElement>('.script-open-btn')!;
}

/** Clicks a run button; the per-command prompt only appears when the host asks. */
function startRun(dom: JSDOM, path: string): void {
    click(dom, runBtn(path));
}

function keydown(dom: JSDOM, el: Element | null, key: string): void {
    assert.ok(el, 'target element should exist');
    el!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('ScriptsPanel mount + render', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('mount creates #s-scripts with framework header + empty state', () => {
        assert.ok(document.getElementById('s-scripts'));
        const label = document.querySelector('#s-scripts .sb-section-label')!;
        assert.strictEqual(label.childNodes[0]?.textContent?.trim(), 'Scripts', 'title text renders via sb-section-label');
        assert.strictEqual(document.querySelector('.sb-empty div')?.textContent, 'No scripts found in .hexscope/scripts/');
        assert.strictEqual(document.querySelectorAll('.script-card').length, 0);
        assert.ok(document.getElementById('scripts-refresh'));
        assert.ok(document.getElementById('scripts-refresh')!.classList.contains('sb-btn-secondary'), 'refresh rides sb-btn-secondary');
        assert.ok(document.getElementById('scripts-refresh')!.classList.contains('sb-section-action'), 'refresh is a compact header action');
        assert.ok(document.getElementById('scripts-add-examples'), 'header exposes the catalog install action');
        const badge = document.querySelector<HTMLElement>('#s-scripts .sb-badge')!;
        assert.ok(badge, 'framework badge span exists');
        assert.ok(badge.hidden, 'count badge hidden when no scripts');
    });

    test('empty state offers the "Add example scripts" action', () => {
        const btn = document.querySelector<HTMLButtonElement>('.script-empty [data-add-examples]');
        assert.ok(btn, 'empty-state install button exists');
        assert.strictEqual(btn!.textContent?.trim(), 'Add example scripts');
        assert.strictEqual(btn!.tagName, 'BUTTON', 'a native button is the keyboard entry point');
        cb.added = 0;
        click(dom, btn);
        assert.strictEqual(cb.added, 1, 'empty-state action reports onAddExampleScripts');
        assert.strictEqual(cb.requested, 0, 'installing is not a list refresh');
    });

    test('header add action reports onAddExampleScripts', () => {
        const btn = document.getElementById('scripts-add-examples')!;
        assert.ok(btn.classList.contains('sb-btn-secondary'), 'install rides sb-btn-secondary');
        assert.ok(btn.classList.contains('sb-section-action'), 'install is a compact header action');
        assert.strictEqual(btn.getAttribute('aria-label'), 'Add example scripts');
        cb.added = 0;
        click(dom, btn);
        assert.strictEqual(cb.added, 1);
    });

    test('refresh button reports onRequestList', () => {
        cb.requested = 0;
        click(dom, document.getElementById('scripts-refresh'));
        assert.strictEqual(cb.requested, 1);
    });

    test('render is idempotent: re-render keeps a single shell', () => {
        panel.render();
        assert.strictEqual(document.querySelectorAll('#s-scripts').length, 1);
        assert.strictEqual(document.querySelectorAll('#s-scripts .sb-section').length, 1);
        assert.strictEqual(document.querySelectorAll('#scripts-refresh').length, 1);
        assert.strictEqual(document.querySelectorAll('#scripts-add-examples').length, 1);
        assert.strictEqual(document.querySelectorAll('[data-add-examples]').length, 1, 'one empty-state install action');
    });
});

suite('ScriptsPanel setScripts', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('renders script cards with name/ext badges and status dots; no capability badges', () => {
        panel.setScripts(SCRIPTS, true);
        assert.strictEqual(document.querySelectorAll('.script-card').length, 3);
        const card = cardFor(A);
        assert.ok(card.classList.contains('sb-card'), 'card rides sb-card');
        assert.strictEqual(card.querySelector('.script-name')?.textContent, 'crc-check.js');
        assert.strictEqual(card.querySelector('.script-name')?.getAttribute('title'), A);
        assert.strictEqual(card.querySelector('.script-ext')?.textContent, 'js');
        assert.strictEqual(card.querySelectorAll('.script-cap').length, 1, 'declared capability badge stays visible');
        assert.strictEqual(card.querySelector('.script-cap')?.textContent, 'exec');
        assert.strictEqual(card.querySelector('.script-cap')?.getAttribute('title'), 'Requires approval: exec');
        assert.ok(runBtn(A).classList.contains('sb-btn-primary'), 'run button rides sb-btn-primary');
        assert.ok(card.querySelector('.sb-status-dot.idle'));
        assert.strictEqual((card.querySelector('.sb-status-dot') as HTMLElement).title, 'Not yet run');
    });

    test('section header has no count badge', () => {
        const badge = () => document.querySelector<HTMLElement>('#s-scripts .sb-badge')!;
        assert.ok(badge().hidden);
        panel.setScripts(SCRIPTS, true);
        assert.ok(badge().hidden);
        panel.setScripts([], true);
        assert.ok(badge().hidden);
    });

    test('empty-state install action follows the script list', () => {
        panel.setScripts(SCRIPTS, true);
        assert.strictEqual(document.querySelectorAll('[data-add-examples]').length, 0, 'no install action while scripts exist');
        panel.setScripts([], true);
        const btn = document.querySelector<HTMLButtonElement>('[data-add-examples]')!;
        assert.ok(btn, 'install action returns with the empty state');
        cb.added = 0;
        click(dom, btn);
        assert.strictEqual(cb.added, 1, 're-rendered empty state stays wired');
    });

    test('untrusted workspace disables run buttons with tooltip', () => {
        panel.setScripts(SCRIPTS, false);
        const btn = runBtn(A);
        assert.ok(btn.classList.contains('disabled-trust'));
        assert.strictEqual(btn.title, 'Workspace not trusted');
        assert.ok(btn.disabled, 'hard disabled attribute (out of the tab order)');
        assert.ok(!btn.classList.contains('disabled-ts'));
        // disabled buttons are not click-wired
        click(dom, btn);
        assert.strictEqual(cb.runs.length, 0);
        assert.strictEqual(cb.cancels.length, 0);
    });

    test('.ts scripts get disabled-ts class when trusted', () => {
        panel.setScripts(SCRIPTS, true);
        const btn = runBtn('D:\\sample\\crc-check.ts');
        assert.ok(btn.classList.contains('disabled-ts'));
        assert.ok(btn.disabled, 'hard disabled attribute (out of the tab order)');
        assert.match(btn.title, /require esbuild/);
        assert.ok(!runBtn(A).classList.contains('disabled-ts'));
        assert.ok(!runBtn(A).disabled, 'js scripts stay enabled');
    });

    test('renders declared role badges', () => {
        panel.setScripts([{ ...SCRIPTS[0], roles: ['address', 'size'] }, ...SCRIPTS.slice(1)], true);
        const badges = cardFor(A).querySelectorAll('.script-role');
        assert.strictEqual(badges.length, 2);
        assert.strictEqual(badges[0].textContent, 'address');
        assert.strictEqual(badges[1].textContent, 'size');
    });

    test('renders a contract error header', () => {
        panel.setScripts(SCRIPTS, true);
        panel.showResult(A, [], [], 'Script entry getAddress failed.', 'contract', 0);
        assert.match(document.querySelector('.script-output-hdr')?.textContent ?? '', /Contract Error/);
    });

    test('open action reports the script path without starting a run', () => {
        panel.setScripts(SCRIPTS, true);
        const btn = openBtn(A);
        assert.strictEqual(btn.title, 'Open crc-check.js');
        assert.strictEqual(btn.getAttribute('aria-label'), 'Open crc-check.js');
        click(dom, btn);
        assert.deepStrictEqual(cb.opens, [A]);
        assert.deepStrictEqual(cb.runs, [], 'opening never runs the script');
    });

    test('open action stays available when run buttons are blocked', () => {
        panel.setScripts(SCRIPTS, false);
        const jsBtn = openBtn(A);
        assert.strictEqual(jsBtn.disabled, false, 'untrusted workspace still allows opening');
        click(dom, jsBtn);
        assert.deepStrictEqual(cb.opens, [A]);

        panel.setScripts(SCRIPTS, true);
        const tsBtn = openBtn('D:\\sample\\crc-check.ts');
        assert.strictEqual(tsBtn.disabled, false, 'missing TS compiler still allows opening');
        click(dom, tsBtn);
        assert.deepStrictEqual(cb.opens, [A, 'D:\\sample\\crc-check.ts']);
        assert.deepStrictEqual(cb.runs, []);
    });

    test('status dot flips to ok/err after showResult', () => {
        panel.setScripts(SCRIPTS, true);
        panel.showResult(A, [], [], '', undefined, 0);
        assert.ok(cardFor(A).querySelector('.sb-status-dot.ok'));
        panel.showResult(A, [], [], 'boom', 'runtime', 0);
        assert.ok(cardFor(A).querySelector('.sb-status-dot.err'));
    });
});

suite('ScriptsPanel run/cancel state machine', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('click run reports onRunScript with generation + selection', () => {
        panel.setScripts(SCRIPTS, true);
        harness.sel.value = { start: 0x1000, end: 0x1002 };
        harness.generation.value = 7;
        startRun(dom, A);
        assert.deepStrictEqual(cb.runs, [{ path: A, generation: 7, selection: { start: 0x1000, end: 0x1002 } }]);
        assert.strictEqual(cb.cancels.length, 0);
    });

    test('no selection reports onRunScript without selection field', () => {
        panel.setScripts(SCRIPTS, true);
        startRun(dom, A);
        assert.deepStrictEqual(cb.runs, [{ path: A, generation: 0, selection: undefined }]);
        assert.strictEqual(cb.runs[0].selection, undefined);
    });

    test('play → pending spinner → running stop → cancel → play', async () => {
        panel.setScripts(SCRIPTS, true);
        const btn = runBtn(A);
        assert.ok(btn.querySelector('.script-btn-icon.play'));

        startRun(dom, A);
        assert.ok(btn.classList.contains('running'));
        assert.ok(btn.querySelector('.script-btn-icon.spin'), 'spinner during 200ms pending');
        assert.strictEqual(btn.title, 'Running…');

        await sleep(250);
        assert.ok(btn.querySelector('.script-btn-icon.stop'), 'stop icon after pending window');
        assert.strictEqual(btn.title, 'Click to cancel');

        click(dom, btn);
        assert.deepStrictEqual(cb.cancels, [A]);
        assert.ok(!btn.classList.contains('running'));
        assert.ok(btn.querySelector('.script-btn-icon.play'));
    });

    test('clicking the running button cancels during pending', () => {
        panel.setScripts(SCRIPTS, true);
        startRun(dom, A);
        click(dom, runBtn(A));
        assert.deepStrictEqual(cb.cancels, [A]);
        assert.strictEqual(cb.runs.length, 1);
    });

    test('dispose cancels the pending spinner timer (teardown flake regression)', async () => {
        panel.setScripts(SCRIPTS, true);
        startRun(dom, A);
        const btn = runBtn(A);
        assert.ok(btn.querySelector('.script-btn-icon.spin'), 'spinner during 200ms pending');
        panel.dispose(); // what cleanupDom does at teardown
        await sleep(250); // past the 200ms window
        assert.ok(btn.querySelector('.script-btn-icon.spin'), 'timer cleared — icon never flips to stop after teardown');
        click(dom, btn); // panel still interactive: cancel path intact
        assert.deepStrictEqual(cb.cancels, [A]);
    });

    test('while one script runs, other run buttons are truly disabled (tab-skipped, tooltip, no click path)', () => {
        panel.setScripts(SCRIPTS, true);
        startRun(dom, A);
        const btnB = runBtn(B);
        assert.ok(btnB.disabled, 'other run button carries real disabled attribute');
        assert.strictEqual(btnB.getAttribute('aria-disabled'), null, 'no fake aria-disabled path');
        assert.strictEqual(btnB.title, 'A script is already running');
        const before = cb.runs.length;
        click(dom, btnB);
        assert.strictEqual(cb.runs.length, before, 'disabled button swallows the click');
        assert.strictEqual(cb.cancels.length, 0, 'no cancel of the first');

        panel.showResult(A, [], [], '', undefined, 0);
        assert.ok(!runBtn(B).disabled, 'run button re-enabled after the run clears');
    });

    test('terminal showResult returns the button to play', async () => {
        panel.setScripts(SCRIPTS, true);
        const btn = runBtn(A);
        startRun(dom, A);
        await sleep(250);
        assert.ok(btn.querySelector('.script-btn-icon.stop'));
        panel.showResult(A, [], [], '', undefined, 0);
        assert.ok(btn.querySelector('.script-btn-icon.play'));
    });
});

suite('ScriptsPanel run history', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
        panel.setScripts(SCRIPTS, true);
    });

    teardown(cleanupDom);

    test('new result collapses prior run into a one-line history row; latest block stays top', () => {
        panel.showResult(A, [{ label: 'first', value: '1' }], ['first-log'], '', undefined, 0);
        panel.showResult(A, [{ label: 'second', value: '2' }], ['second-log'], '', undefined, 0);
        const area = cardFor(A).querySelector('.script-result-area')!;
        const blocks = area.querySelectorAll('.script-output-block');
        assert.strictEqual(blocks.length, 2);
        const latest = blocks[0];
        const row = blocks[1];
        assert.ok(!latest.classList.contains('collapsed'), 'latest block expanded');
        assert.strictEqual(area.querySelector('.script-result-label')?.textContent, 'second', 'latest-top order');
        assert.ok(row.classList.contains('collapsed'), 'older run collapsed');
        assert.ok(row.classList.contains('script-run-row'));
        assert.match(row.querySelector('.script-output-hdr')!.textContent!, /run #1 · \d{1,2}:\d{2} ✓/);
        click(dom, row.querySelector('[data-collapse]'));
        assert.ok(!row.classList.contains('collapsed'), 'clicking row header expands old block');
        assert.match(row.textContent!, /first/);
    });

    test('history rows stay expandable while a new run is streaming', () => {
        panel.showResult(A, [], ['old-log'], '', undefined, 0);
        startRun(dom, A); // snapshots run1 into a collapsed row, clears the area
        panel.appendOutput(A, 'stream line'); // ensureLogArea re-wires the area after inserting the Running block
        const row = cardFor(A).querySelector('.script-run-row')!;
        assert.ok(row.classList.contains('collapsed'));
        click(dom, row.querySelector('[data-collapse]'));
        assert.ok(!row.classList.contains('collapsed'), 'single toggle expands the row; no double-wired listeners');
        assert.match(row.textContent!, /old-log/);
        panel.showResult(A, [], [], '', undefined, 0); // clear pending spinner timer before DOM teardown
    });

    test('streamed output does not pollute collapsed history', () => {
        panel.showResult(A, [], ['first-log'], '', undefined, 0);
        startRun(dom, A); // new run snapshots run1 into history, clears the result area
        panel.appendOutput(A, 'stream line');
        panel.showResult(A, [], ['second-log'], '', undefined, 0);
        const row = cardFor(A).querySelector('.script-run-row')!;
        assert.match(row.textContent!, /first-log/, 'history row keeps run1 output');
        assert.ok(!row.textContent?.includes('stream line'), 'stream of run2 never enters run1 history');
        const latest = cardFor(A).querySelector('.script-output-block:not(.script-run-row)')!;
        assert.match(latest.textContent!, /second-log/);
    });

    test('clear button removes all rows and resets status to idle', () => {
        panel.showResult(A, [], ['one'], '', undefined, 0);
        panel.showResult(A, [], ['two'], '', undefined, 0);
        assert.ok(cardFor(A).querySelector('.script-run-row'));
        click(dom, cardFor(A).querySelector('[data-clear]'));
        assert.strictEqual(cardFor(A).querySelectorAll('.script-output-block').length, 0, 'result area emptied');
        assert.strictEqual(cardFor(A).querySelector('.script-run-row'), null);
        assert.ok(cardFor(A).querySelector('.sb-status-dot.idle'), 'status dot back to idle');
    });

    test('history is capped at 5 collapsed rows per script', () => {
        for (let i = 1; i <= 7; i++) { panel.showResult(A, [], [`run${i}`], '', undefined, 0); }
        const area = cardFor(A).querySelector('.script-result-area')!;
        assert.strictEqual(area.querySelectorAll('.script-run-row').length, 5, 'oldest rows dropped');
        const latest = area.querySelector('.script-output-block:not(.script-run-row)')!;
        assert.match(latest.textContent!, /run7/);
        const newestRow = area.querySelector('.script-run-row .script-output-hdr')!;
        assert.match(newestRow.textContent!, /run #6/, 'kept rows are the most recent');
    });
});

suite('ScriptsPanel permission prompt', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
        panel.setScripts(SCRIPTS, true);
    });

    teardown(cleanupDom);

    test('renders one inline prompt inside the card naming script, capability, and detail', () => {
        click(dom, runBtn(A)); // runs start immediately — no pre-run gate
        assert.deepStrictEqual(cb.runs, [{ path: A, generation: 0, selection: undefined }]);

        panel.showPermissionRequest(permissionRequest());
        const prompt = cardFor(A).querySelector('.script-perm')!;
        assert.ok(prompt, 'prompt lives inside the script card');
        assert.ok(prompt.previousElementSibling?.classList.contains('script-card-info'), 'above the result area');
        assert.match(prompt.querySelector('.script-perm-title')!.textContent!, /crc-check\.js/);
        assert.match(prompt.querySelector('.script-perm-title')!.textContent!, /write bytes/);
        assert.strictEqual(prompt.querySelector('.script-perm-detail')!.textContent, 'Write 2 bytes at 0x8000000');
        assert.strictEqual(document.querySelectorAll('.script-perm').length, 1);
    });

    test('Allow once sends an allow decision and returns focus to the run button', () => {
        panel.showPermissionRequest(permissionRequest());
        const allow = document.querySelector<HTMLElement>('.script-perm [data-perm-allow]')!;
        assert.strictEqual(document.activeElement, allow, 'primary action focused');
        click(dom, allow);
        assert.deepStrictEqual(cb.decisions, [
            { requestId: 11, decision: 'allow', scope: 'once', capability: 'write' },
        ]);
        assert.strictEqual(document.querySelector('.script-perm'), null, 'prompt closed');
        assert.strictEqual(document.activeElement, runBtn(A), 'focus returns to the card run button');
    });

    test('broader scope options send the chosen scope + grant breadth', () => {
        panel.showPermissionRequest(permissionRequest());
        const menuBtn = document.querySelector<HTMLElement>('.script-perm [data-perm-menu]')!;
        const menu = document.querySelector<HTMLElement>('.script-perm .script-perm-menu')!;
        assert.ok(menu.hidden, 'menu starts collapsed');
        click(dom, menuBtn);
        assert.strictEqual(menuBtn.getAttribute('aria-expanded'), 'true');
        assert.ok(!menu.hidden);
        const options = [...menu.querySelectorAll<HTMLElement>('.script-perm-option')];
        assert.deepStrictEqual(options.map(o => o.dataset.scope), [
            'script', 'script', 'session', 'session', 'workspace', 'workspace',
        ]);
        assert.match(options[0].textContent!, /Allow write in this script/);
        assert.match(options[5].textContent!, /all non-exec capabilities in this workspace/);

        click(dom, options[0]);
        assert.deepStrictEqual(cb.decisions, [
            { requestId: 11, decision: 'allow', scope: 'script', capability: 'write' },
        ]);
        assert.strictEqual(document.querySelector('.script-perm'), null);
    });

    test('all-capabilities option sends the "*" grant', () => {
        panel.showPermissionRequest(permissionRequest());
        click(dom, document.querySelector('.script-perm [data-perm-menu]'));
        const all = [...document.querySelectorAll<HTMLElement>('.script-perm-option')][1];
        click(dom, all);
        assert.deepStrictEqual(cb.decisions, [
            { requestId: 11, decision: 'allow', scope: 'script', capability: '*' },
        ]);
    });

    test('exec requests never offer workspace scope', () => {
        panel.showPermissionRequest(permissionRequest({
            capability: 'exec',
            detail: 'openssl dgst -sha256 firmware.bin',
            scopes: ['once', 'script', 'session'],
        }));
        click(dom, document.querySelector('.script-perm [data-perm-menu]'));
        const scopes = [...document.querySelectorAll<HTMLElement>('.script-perm-option')].map(o => o.dataset.scope);
        assert.deepStrictEqual(scopes, ['script', 'script', 'session', 'session']);
    });

    test('Escape denies, the Deny button denies, and focus returns to Run', () => {
        panel.showPermissionRequest(permissionRequest());
        keydown(dom, document.querySelector('.script-perm'), 'Escape');
        assert.deepStrictEqual(cb.decisions, [
            { requestId: 11, decision: 'deny', scope: 'once', capability: 'write' },
        ]);
        assert.strictEqual(document.querySelector('.script-perm'), null);
        assert.strictEqual(document.activeElement, runBtn(A));

        panel.showPermissionRequest(permissionRequest({ requestId: 12 }));
        click(dom, document.querySelector('.script-perm [data-perm-deny]'));
        assert.deepStrictEqual(cb.decisions[1], { requestId: 12, decision: 'deny', scope: 'once', capability: 'write' });
    });

    test('a new request replaces the stale prompt and denies the old id', () => {
        panel.showPermissionRequest(permissionRequest({ requestId: 11 }));
        panel.showPermissionRequest(permissionRequest({ requestId: 12, detail: 'Write 4 bytes at 0x8000010' }));
        assert.deepStrictEqual(cb.decisions, [
            { requestId: 11, decision: 'deny', scope: 'once', capability: 'write' },
        ]);
        assert.strictEqual(document.querySelectorAll('.script-perm').length, 1);
        assert.match(document.querySelector('.script-perm-detail')!.textContent!, /0x8000010/);
    });

    test('a terminal result closes the open prompt', () => {
        panel.showPermissionRequest(permissionRequest());
        panel.showResult(A, [], [], '', undefined, 0);
        assert.strictEqual(document.querySelector('.script-perm'), null);
        assert.strictEqual(cb.decisions[0].decision, 'deny');
    });

    test('cancelling the run denies the pending prompt', () => {
        startRun(dom, A);
        panel.showPermissionRequest(permissionRequest());
        click(dom, runBtn(A)); // running button = cancel
        assert.deepStrictEqual(cb.cancels, [A]);
        assert.strictEqual(document.querySelector('.script-perm'), null);
        assert.strictEqual(cb.decisions[0].decision, 'deny');
    });

    test('prompt for an unknown script path denies immediately', () => {
        panel.showPermissionRequest(permissionRequest({ scriptPath: 'D:\\missing\\gone.js', requestId: 13 }));
        assert.strictEqual(document.querySelector('.script-perm'), null);
        assert.deepStrictEqual(cb.decisions, [
            { requestId: 13, decision: 'deny', scope: 'once', capability: 'write' },
        ]);
    });
});

suite('ScriptsPanel workspace permissions list', () => {
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        const harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
        panel.setScripts(SCRIPTS, true);
    });

    teardown(cleanupDom);

    test('renders revocable workspace grants above the script list', () => {
        panel.setPermissionGrants([
            { scriptPath: A, capability: 'write' },
            { scriptPath: 'D:\\sample\\tools\\sign.js', capability: '*' },
        ]);
        const section = document.querySelector('.script-perms-section')!;
        assert.ok(section, 'permissions section rendered');
        assert.match(section.querySelector('.script-perms-title')!.textContent!, /Permissions/);
        assert.strictEqual(section.querySelectorAll('.script-perm-row').length, 2);
        const rows = [...section.querySelectorAll<HTMLElement>('.script-perm-row')];
        assert.strictEqual(rows[0].querySelector('.script-perm-name')!.textContent, 'crc-check.js');
        assert.strictEqual(rows[1].querySelector('.script-perm-name')!.textContent, 'sign.js');
        assert.strictEqual(rows[1].querySelector('.script-perm-ability')!.textContent, 'all non-exec');
        assert.ok(section.compareDocumentPosition(document.querySelector('.script-list')!) & 4, 'section precedes the list');

        click(dom, rows[0].querySelector('[data-revoke]'));
        assert.deepStrictEqual(cb.revokes, [[A, 'write']]);
    });

    test('an empty grant list removes the section', () => {
        panel.setPermissionGrants([{ scriptPath: A, capability: 'write' }]);
        assert.ok(document.querySelector('.script-perms-section'));
        panel.setPermissionGrants([]);
        assert.strictEqual(document.querySelector('.script-perms-section'), null);
    });

    test('permission list updates never clear existing result areas', () => {
        panel.showResult(A, [{ label: 'CRC32', value: '0x1' }], [], '', undefined, 0);
        panel.setPermissionGrants([{ scriptPath: A, capability: 'write' }]);
        assert.strictEqual(cardFor(A).querySelector('.script-result-label')?.textContent, 'CRC32');
    });
});

suite('PermissionPrompt timeout mirror', () => {
    let panel: ScriptsPanel;

    setup(() => {
        const harness = installDom();
        panel = harness.panel;
        currentDom = harness.dom;
        panel.setScripts(SCRIPTS, true);
    });

    teardown(cleanupDom);

    test('an unanswered prompt closes without sending a duplicate deny', async () => {
        const decisions: Decision[] = [];
        const prompt = new PermissionPrompt({
            onDecision: (requestId, decision, scope, capability) => {
                decisions.push({ requestId, decision, scope, capability });
            },
        }, 10);
        prompt.show(permissionRequest());
        assert.ok(document.querySelector('.script-perm'));
        await sleep(25);
        assert.strictEqual(document.querySelector('.script-perm'), null, 'mirror timeout closes the prompt');
        assert.deepStrictEqual(decisions, [], 'the host already denied on its own timeout');
        prompt.dispose();
    });
});

suite('ScriptsPanel showResult', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: ScriptsPanel;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        currentDom = dom;
        panel.setScripts(SCRIPTS, true);
    });

    teardown(cleanupDom);

    test('success renders Result header, results table, log; no error/writes', () => {
        panel.showResult(A, [{ label: 'CRC32', value: '0x9BE3E0A3' }], ['Done'], '', undefined, 0);
        const area = cardFor(A).querySelector('.script-result-area')!;
        assert.match(area.querySelector('.script-output-hdr')!.textContent!, /Result/);
        assert.strictEqual(area.querySelectorAll('.script-result-label').length, 1);
        assert.strictEqual(area.querySelector('.script-result-label')?.textContent, 'CRC32');
        assert.strictEqual(area.querySelector('.script-result-value')?.textContent, '0x9BE3E0A3');
        assert.strictEqual(area.querySelector('.script-output-log')?.textContent, 'Done');
        assert.ok(!area.querySelector('.script-output-error'));
        assert.ok(!area.querySelector('.script-output-writes'));
    });

    test('result auto-expands (block not collapsed) and header click collapses', () => {
        panel.showResult(A, [], [], '', undefined, 0);
        const block = cardFor(A).querySelector('.script-output-block')!;
        assert.ok(!block.classList.contains('collapsed'), 'auto-expanded');
        click(dom, block.querySelector('[data-collapse]'));
        assert.ok(block.classList.contains('collapsed'));
        click(dom, block.querySelector('[data-collapse]'));
        assert.ok(!block.classList.contains('collapsed'));
    });

    test('error-type headers: compile/runtime/timeout/cancel', () => {
        panel.showResult(A, [], [], 'syntax', 'compile', 0);
        assert.match(cardFor(A).querySelector('.script-output-hdr')!.textContent!, /Compile Error/);
        assert.ok(cardFor(A).querySelector('.script-output-hdr-err-compile'));
        assert.strictEqual(cardFor(A).querySelector('.script-output-error')?.textContent, 'syntax');

        panel.showResult(A, [], [], 'boom', 'runtime', 0);
        assert.match(cardFor(A).querySelector('.script-output-hdr')!.textContent!, /Script Error/);
        assert.ok(cardFor(A).querySelector('.script-output-hdr-err'));

        panel.showResult(A, [], [], 'slow', 'timeout', 0);
        assert.match(cardFor(A).querySelector('.script-output-hdr')!.textContent!, /Timeout/);
        assert.ok(cardFor(A).querySelector('.script-output-hdr-err-timeout'));

        panel.showResult(A, [], ['partial output'], 'cancelled', 'cancel', 0);
        assert.match(cardFor(A).querySelector('.script-output-hdr')!.textContent!, /Cancelled/);
        assert.ok(cardFor(A).querySelector('.script-output-hdr-err-cancel'));
        assert.strictEqual(cardFor(A).querySelector('.script-output-log')?.textContent, 'partial output');
    });

    test('writes notice reports auto-saved bytes with no action control', () => {
        panel.showResult(A, [], [], '', undefined, 3);
        const row = cardFor(A).querySelector('.script-output-writes') as HTMLElement | null;
        assert.ok(row);
        assert.match(row!.textContent!, /3 byte\(s\) written — saving/);
        assert.strictEqual(row!.querySelector('button'), null, 'no Apply & Save / Discard controls remain');
        assert.strictEqual(document.querySelector('[data-writes-apply]'), null);
        assert.strictEqual(document.querySelector('[data-writes-discard]'), null);
    });

    test('failed run reports discarded writes and nothing saved', () => {
        panel.showResult(A, [], [], 'boom', 'runtime', 0, 2);
        const row = cardFor(A).querySelector('.script-output-writes') as HTMLElement | null;
        assert.ok(row);
        assert.match(row!.textContent!, /2 byte\(s\) written, discarded/);
        assert.match(row!.textContent!, /nothing was saved/);
        assert.ok(row!.classList.contains('script-output-writes-discarded'));
        assert.strictEqual(row!.querySelector('button'), null);
    });

    test('a run without writes renders no writes notice', () => {
        panel.showResult(A, [], [], '', undefined, 0);
        assert.strictEqual(cardFor(A).querySelector('.script-output-writes'), null);
    });

    test('re-run collapses prior result into history row and shows latest', () => {
        panel.showResult(A, [{ label: 'first', value: '1' }], [], '', undefined, 0);
        panel.showResult(A, [{ label: 'second', value: '2' }], [], '', undefined, 0);
        const area = cardFor(A).querySelector('.script-result-area')!;
        const latest = area.querySelector('.script-output-block:not(.script-run-row)')!;
        const labels = latest.querySelectorAll('.script-result-label');
        assert.strictEqual(labels.length, 1);
        assert.strictEqual(labels[0].textContent, 'second');
        assert.strictEqual(area.querySelectorAll('.script-run-row').length, 1);
    });

    test('escapes user text in results/log/error', () => {
        panel.showResult(A, [{ label: '<b>x</b>', value: '<i>y</i>' }], ['<script>'], '<err>', 'runtime', 0);
        const area = cardFor(A).querySelector('.script-result-area')!;
        const label = area.querySelector('.script-result-label')!;
        const value = area.querySelector('.script-result-value')!;
        const log = area.querySelector('.script-output-log')!;
        const error = area.querySelector('.script-output-error')!;
        assert.strictEqual(area.querySelectorAll('b, i, script').length, 0);
        assert.strictEqual(label.textContent, '<b>x</b>');
        assert.strictEqual(value.textContent, '<i>y</i>');
        assert.strictEqual(log.textContent, '<script>');
        assert.strictEqual(error.textContent, '<err>');
    });

    test('showResult for unknown path is a no-op (no crash)', () => {
        panel.showResult('D:\\missing\\nope.js', [], [], '', undefined, 0);
        assert.strictEqual(document.querySelectorAll('.script-output-block').length, 0);
    });
});

suite('ScriptsPanel appendOutput streaming', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
        panel.setScripts(SCRIPTS, true);
        startRun(dom, A); // start a run so the running card resolves
    });

    teardown(cleanupDom);

    test('realtime lines appear immediately in the running card log', () => {
        panel.appendOutput(A, 'line one');
        panel.appendOutput(A, 'line two');
        const log = cardFor(A).querySelector('.script-output-log')!;
        assert.strictEqual(log.querySelectorAll('div').length, 2);
        assert.strictEqual(log.textContent, 'line oneline two');
        assert.strictEqual(cardFor(B).querySelector('.script-output-log'), null, 'output goes to the running card only');
    });

    test('escapes streamed text', () => {
        panel.appendOutput(A, '<b>bold</b>');
        const log = cardFor(A).querySelector('.script-output-log')!;
        assert.strictEqual(log.textContent, '<b>bold</b>');
        assert.strictEqual(log.querySelectorAll('b').length, 0);
    });

    test('first 100 lines realtime, then debounced batch flush', async () => {
        for (let i = 1; i <= 100; i++) { panel.appendOutput(A, `l${i}`); }
        assert.strictEqual(cardFor(A).querySelector('.script-output-log')!.querySelectorAll('div').length, 100);

        panel.appendOutput(A, 'l101');
        assert.strictEqual(cardFor(A).querySelector('.script-output-log')!.querySelectorAll('div').length, 100, 'buffered before flush');

        await sleep(10);
        const log = cardFor(A).querySelector('.script-output-log')!;
        assert.strictEqual(log.querySelectorAll('div').length, 101, 'flushed after microtask tick');
        assert.strictEqual(log.textContent, Array.from({ length: 101 }, (_, i) => `l${i + 1}`).join(''));
    });

    test('appendOutput before any run is a silent no-op', () => {
        panel.showResult(A, [], [], '', undefined, 0); // terminal → no running button
        panel.appendOutput(A, 'stray');
        assert.strictEqual(cardFor(A).querySelector('.script-output-log')?.textContent, '');
    });
});

suite('ScriptsPanel setTabActive lazy init', () => {
    let harness: Harness;
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('first activation requests the list exactly once', () => {
        assert.strictEqual(cb.requested, 0, 'no request before activation');
        panel.setTabActive(true);
        assert.strictEqual(cb.requested, 1);
        panel.setTabActive(true);
        panel.setTabActive(false);
        panel.setTabActive(true);
        assert.strictEqual(cb.requested, 1, 'gate never resets');
    });

    test('setScripts works without activation; activation only gates the list request', () => {
        panel.setScripts(SCRIPTS, true);
        assert.strictEqual(cb.requested, 0, 'setScripts never requests');
        assert.strictEqual(document.querySelectorAll('.script-card').length, 3);
        panel.setTabActive(true);
        assert.strictEqual(cb.requested, 1);
    });
});