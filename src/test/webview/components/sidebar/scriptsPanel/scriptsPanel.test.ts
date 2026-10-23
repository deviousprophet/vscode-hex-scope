import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../../../cssImportHook';

import {
    ScriptsPanel,
    type ScriptInfo,
    type ScriptUsageRef,
    type ScriptWriteSummary,
} from '../../../../../webview/components/sidebar/scriptsPanel/scriptsPanel';
import {
    PermissionPrompt,
    type ScriptPermissionRequest,
} from '../../../../../webview/components/sidebar/scriptsPanel/permissionPrompt';
import { menuController } from '../../../../../webview/components/menuController/menuController';
import type { ScriptTemplateId } from '../../../../../core/scripting/templates';

let currentDom: JSDOM | null = null;
let currentPanel: ScriptsPanel | null = null;

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
    navigator: Navigator;
};

type Decision = { requestId: number; decision: string; scope: string; capability?: string };
type RevokeAll = { scope?: string; scriptPath?: string };

type Cb = {
    requested: number;
    browsed: number;
    added: number;
    created: Array<ScriptTemplateId | undefined>;
    runs: Array<{ path: string; generation: number; selection?: { start: number; end: number } }>;
    cancels: string[];
    opens: string[];
    decisions: Decision[];
    revokes: Array<[string, string, string]>;
    revokeAlls: RevokeAll[];
    copies: string[];
    reveals: string[];
    deletes: string[];
    jsVersions: string[];
    guides: number;
    selectedUsages: ScriptUsageRef[];
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
    { name: 'crc-check.js', filePath: A, capabilities: ['exec'], roles: [], fingerprint: 'fp-1', hasRun: true },
    { name: 'crc-check.ts', filePath: 'D:\\sample\\crc-check.ts', capabilities: ['exec', 'network'], roles: [], fingerprint: 'fp-2', hasRun: true },
    { name: 'hello.js', filePath: B, capabilities: [], roles: [], fingerprint: 'fp-3', hasRun: true },
];

const PROVIDER: ScriptInfo = {
    name: 'follow-pointer.js',
    filePath: 'D:\\sample\\follow-pointer.js',
    capabilities: [],
    roles: ['address'],
    fingerprint: 'fp-provider',
    hasRun: false,
};

const BOTH: ScriptInfo = {
    name: 'checksum-both.js',
    filePath: 'D:\\sample\\checksum-both.js',
    capabilities: [],
    roles: ['integrity'],
    fingerprint: 'fp-both',
    hasRun: true,
};

const UNKNOWN: ScriptInfo = {
    name: 'mystery.js',
    filePath: 'D:\\sample\\mystery.js',
    capabilities: [],
    roles: [],
    fingerprint: 'fp-unknown',
    hasRun: false,
};

/** The six shipped examples, out of catalog order. */
const EXAMPLES: ScriptInfo[] = [
    { name: 'write-pattern.js', filePath: 'D:\\sample\\write-pattern.js', capabilities: ['write'], roles: [], fingerprint: 'e1', hasRun: true },
    { name: 'verify-integrity.js', filePath: 'D:\\sample\\verify-integrity.js', capabilities: [], roles: ['integrity'], fingerprint: 'e2', hasRun: false },
    { name: 'follow-pointer.js', filePath: 'D:\\sample\\follow-pointer.js', capabilities: [], roles: ['address'], fingerprint: 'e3', hasRun: false },
    { name: 'hello.js', filePath: 'D:\\sample\\hello.js', capabilities: [], roles: [], fingerprint: 'e4', hasRun: true },
    { name: 'array-size-from-header.js', filePath: 'D:\\sample\\array-size-from-header.js', capabilities: [], roles: ['size'], fingerprint: 'e5', hasRun: false },
    { name: 'verify-crc.js', filePath: 'D:\\sample\\verify-crc.js', capabilities: [], roles: [], fingerprint: 'e6', hasRun: true },
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

const USAGE_INTEGRITY: ScriptUsageRef = {
    scriptPath: BOTH.filePath,
    kind: 'integrity',
    label: 'Flash CRC',
    checkId: 7,
};

const USAGE_ADDRESS: ScriptUsageRef = {
    scriptPath: PROVIDER.filePath,
    kind: 'address',
    label: 'boot header',
    pinId: 'pin-1',
};

function permissionRequest(overrides: Partial<ScriptPermissionRequest> = {}): ScriptPermissionRequest {
    return { ...PERMISSION_REQUEST, ...overrides };
}

/** Saving-state write summary for card A; override writes/before/status per test. */
function writeSummary(overrides: Partial<ScriptWriteSummary> = {}): ScriptWriteSummary {
    return {
        scriptPath: A,
        writes: [[0x1000, 0xDE], [0x1001, 0xAD]],
        before: [[0x1000, 0xAA], [0x1001, 0xBB]],
        status: 'saving',
        ...overrides,
    };
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

    const cb: Cb = {
        requested: 0, browsed: 0, added: 0, created: [], runs: [], cancels: [], opens: [], decisions: [], revokes: [], revokeAlls: [],
        copies: [], reveals: [], deletes: [], jsVersions: [], guides: 0, selectedUsages: [],
    };
    const sel: { value: { start: number; end: number } | null } = { value: null };
    const generation: { value: number } = { value: 0 };
    const panel = new ScriptsPanel({
        onRequestList: () => { cb.requested++; },
        onBrowseExampleScripts: () => { cb.browsed++; },
        onAddExampleScripts: () => { cb.added++; },
        onCreateScript: template => { cb.created.push(template); },
        onRunScript: (scriptPath, gen, selectionRange) => {
            cb.runs.push({ path: scriptPath, generation: gen, selection: selectionRange });
        },
        onCancelScript: path => { cb.cancels.push(path); },
        onOpenScript: path => { cb.opens.push(path); },
        onScriptPermissionDecision: (requestId, decision, scope, capability) => {
            cb.decisions.push({ requestId, decision, scope, capability });
        },
        onRevokeScriptPermission: (scope, path, capability) => { cb.revokes.push([scope, path, capability]); },
        onRevokeAllScriptPermissions: (scope, scriptPath) => { cb.revokeAlls.push({ scope, scriptPath }); },
        onCopyPath: path => { cb.copies.push(path); },
        onRevealScript: path => { cb.reveals.push(path); },
        onDeleteScript: path => { cb.deletes.push(path); },
        onCreateJsVersion: path => { cb.jsVersions.push(path); },
        onOpenScriptingGuide: () => { cb.guides++; },
        onSelectUsage: usage => { cb.selectedUsages.push(usage); },
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
        menuController.hide();
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

function groupText(group: string, selector: string): string | null | undefined {
    return document.querySelector(`.script-group[data-group="${group}"] ${selector}`)?.textContent;
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
        assert.strictEqual(document.getElementById('scripts-add-examples'), null, 'no separate header install action');
        const badge = document.querySelector<HTMLElement>('#s-scripts .sb-badge')!;
        assert.ok(badge, 'framework badge span exists');
        assert.ok(badge.hidden, 'count badge hidden when no scripts');
    });

    test('empty state offers the "Browse examples\u2026" action', () => {
        const btn = document.querySelector<HTMLButtonElement>('.script-empty [data-browse-examples]');
        assert.ok(btn, 'empty-state browse button exists');
        assert.strictEqual(btn!.textContent?.trim(), 'Browse examples\u2026');
        assert.strictEqual(btn!.tagName, 'BUTTON', 'a native button is the keyboard entry point');
        assert.strictEqual(document.querySelector('.script-empty [data-add-examples]'), null, 'no bulk install button in the empty state');
        cb.browsed = 0;
        click(dom, btn);
        assert.strictEqual(cb.browsed, 1, 'empty-state action reports onBrowseExampleScripts');
        assert.strictEqual(cb.requested, 0, 'browsing is not a list refresh');
    });

    test('header has no separate install action', () => {
        assert.strictEqual(document.getElementById('scripts-add-examples'), null);
        assert.ok(document.getElementById('scripts-refresh'), 'Refresh remains the header action');
    });

    test('refresh button reports onRequestList', () => {
        cb.requested = 0;
        click(dom, document.getElementById('scripts-refresh'));
        assert.strictEqual(cb.requested, 1);
    });

    test('New split button: primary reports no template, the caret lists the four templates', () => {
        const primary = document.getElementById('scripts-new')!;
        const caret = document.getElementById('scripts-new-menu')!;
        const popup = document.querySelector<HTMLElement>('.script-new-popup')!;
        assert.ok(primary, 'primary New button exists');
        assert.ok(caret, 'template caret exists');
        assert.ok(popup.hidden, 'the template chooser starts closed');
        assert.strictEqual(caret.getAttribute('aria-expanded'), 'false');
        assert.ok(primary.classList.contains('sb-btn-secondary'), 'New rides sb-btn-secondary');

        cb.created = [];
        click(dom, primary);
        assert.deepStrictEqual(cb.created, [undefined], 'the primary action lets the host pick the template');

        click(dom, caret);
        assert.strictEqual(popup.hidden, false, 'caret opens the chooser');
        assert.strictEqual(caret.getAttribute('aria-expanded'), 'true');
        const options = Array.from(popup.querySelectorAll<HTMLElement>('.script-new-option[data-template]'));
        assert.deepStrictEqual(options.map(option => option.dataset.template), ['action', 'integrity', 'address', 'size']);
        assert.deepStrictEqual(options.map(option => option.textContent?.trim()), [
            'New action script', 'New integrity check', 'New instance address script', 'New array size script',
        ]);

        click(dom, caret);
        assert.ok(popup.hidden, 'the caret toggles the chooser closed');

        click(dom, caret);
        click(dom, options[2]);
        assert.deepStrictEqual(cb.created, [undefined, 'address'], 'choosing a template reports it');
        assert.ok(popup.hidden, 'choosing closes the chooser');
    });

    test('New caret menu lists the catalog actions under a separator', () => {
        const caret = document.getElementById('scripts-new-menu')!;
        const popup = document.querySelector<HTMLElement>('.script-new-popup')!;
        click(dom, caret);
        const rows = Array.from(popup.querySelectorAll<HTMLElement>('[data-example-action]'));
        assert.deepStrictEqual(rows.map(row => row.dataset.exampleAction), ['browse', 'all']);
        assert.deepStrictEqual(rows.map(row => row.textContent?.trim()), ['Browse examples\u2026', 'Add all examples']);
        const children = Array.from(popup.children);
        const sepIdx = children.findIndex(child => child.classList.contains('script-new-sep'));
        assert.ok(sepIdx >= 0, 'a separator row exists');
        assert.strictEqual(children[sepIdx].getAttribute('role'), 'separator');
        assert.strictEqual(sepIdx, 4, 'the catalog rows follow the four templates');
        assert.strictEqual(children.length, 7, 'four templates + separator + two catalog rows');

        cb.browsed = 0;
        click(dom, rows[0]);
        assert.strictEqual(cb.browsed, 1, 'Browse examples reports onBrowseExampleScripts');
        assert.deepStrictEqual(cb.created, [], 'catalog rows never create from a template');
        assert.ok(popup.hidden, 'choosing a catalog row closes the chooser');

        cb.added = 0;
        click(dom, caret);
        click(dom, rows[1]);
        assert.strictEqual(cb.added, 1, 'Add all examples reports onAddExampleScripts');
        assert.deepStrictEqual(cb.created, [], 'the bulk row never creates from a template');
        assert.ok(popup.hidden, 'choosing closes the chooser');
    });

    test('New caret menu closes on an outside click and toggles from the caret alone', () => {
        const caret = document.getElementById('scripts-new-menu')!;
        const popup = document.querySelector<HTMLElement>('.script-new-popup')!;
        click(dom, caret);
        assert.strictEqual(popup.hidden, false, 'caret opens the chooser');
        assert.deepStrictEqual(cb.created, [], 'opening the caret creates nothing');
        assert.strictEqual(cb.browsed, 0, 'opening the caret browses nothing');
        assert.strictEqual(cb.added, 0, 'opening the caret installs nothing');

        // The shared section header stops clicks on its actions, so the outside
        // click must land on the panel body (a real user click away from the menu).
        click(dom, document.body);
        assert.ok(popup.hidden, 'a click outside the chooser closes it');
        assert.strictEqual(caret.getAttribute('aria-expanded'), 'false', 'aria-expanded follows the outside close');

        click(dom, caret);
        assert.strictEqual(popup.hidden, false, 'the caret reopens after an outside close');
        click(dom, caret);
        assert.ok(popup.hidden, 'the caret alone toggles the chooser shut');
    });

    test('empty state offers Create script next to Browse examples', () => {
        const btn = document.querySelector<HTMLButtonElement>('.script-empty [data-create-script]')!;
        assert.ok(btn, 'empty-state create button exists');
        assert.strictEqual(btn.textContent?.trim(), 'Create script');
        assert.strictEqual(btn.tagName, 'BUTTON', 'a native button is the keyboard entry point');
        cb.created = [];
        click(dom, btn);
        assert.deepStrictEqual(cb.created, [undefined], 'the host asks which template to use');
        assert.strictEqual(cb.requested, 0, 'creating is not a list refresh');
        assert.strictEqual(cb.browsed, 0, 'creating never opens the example picker');
    });

    test('render is idempotent: re-render keeps a single shell', () => {
        panel.render();
        assert.strictEqual(document.querySelectorAll('#s-scripts').length, 1);
        assert.strictEqual(document.querySelectorAll('#s-scripts .sb-section').length, 1);
        assert.strictEqual(document.querySelectorAll('#scripts-refresh').length, 1);
        assert.strictEqual(document.querySelectorAll('#scripts-add-examples').length, 0, 'no separate header install action');
        assert.strictEqual(document.querySelectorAll('#scripts-new').length, 1);
        assert.strictEqual(document.querySelectorAll('.script-new-popup').length, 1);
        assert.strictEqual(document.querySelectorAll('[data-example-action]').length, 2, 'one browse + one bulk row in the New menu');
        assert.strictEqual(document.querySelectorAll('[data-browse-examples]').length, 1, 'one empty-state browse action');
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

    test('empty-state browse action follows the script list', () => {
        panel.setScripts(SCRIPTS, true);
        assert.strictEqual(document.querySelectorAll('[data-browse-examples]').length, 0, 'no browse action while scripts exist');
        panel.setScripts([], true);
        const btn = document.querySelector<HTMLButtonElement>('[data-browse-examples]')!;
        assert.ok(btn, 'browse action returns with the empty state');
        cb.browsed = 0;
        click(dom, btn);
        assert.strictEqual(cb.browsed, 1, 're-rendered empty state stays wired');
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

    test('renders declared role chips with job language and the raw role on data-role', () => {
        panel.setScripts([{ ...SCRIPTS[0], roles: ['address', 'size'] }, ...SCRIPTS.slice(1)], true);
        const badges = cardFor(A).querySelectorAll('.script-role');
        assert.strictEqual(badges.length, 2);
        assert.strictEqual(badges[0].textContent, 'Instance address');
        assert.strictEqual(badges[0].getAttribute('data-role'), 'address');
        assert.strictEqual(badges[0].getAttribute('title'), 'Used as: Instance address');
        assert.strictEqual(badges[1].textContent, 'Array size');
        assert.strictEqual(badges[1].getAttribute('data-role'), 'size');
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

    test('clicking the filename opens the script; the pencil stays as a secondary affordance', () => {
        panel.setScripts(SCRIPTS, true);
        const name = cardFor(A).querySelector<HTMLElement>('.script-name')!;
        assert.strictEqual(name.tagName, 'BUTTON', 'the name is a real button (keyboard reachable)');
        assert.strictEqual(name.getAttribute('aria-label'), 'Open crc-check.js');
        assert.strictEqual(name.title, A, 'path tooltip stays on the name');
        click(dom, name);
        click(dom, openBtn(A));
        assert.deepStrictEqual(cb.opens, [A, A], 'name and pencil both open the script');
        assert.deepStrictEqual(cb.runs, [], 'opening never runs the script');
    });

    test('status dot flips to ok/err after showResult', () => {
        panel.setScripts(SCRIPTS, true);
        panel.showResult(A, [], [], '', undefined, 0);
        assert.ok(cardFor(A).querySelector('.sb-status-dot.ok'));
        panel.showResult(A, [], [], 'boom', 'runtime', 0);
        assert.ok(cardFor(A).querySelector('.sb-status-dot.err'));
    });
});

suite('ScriptsPanel script kinds and grouping', () => {
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

    test('groups Actions before Providers with counts and expanded disclosure buttons', () => {
        panel.setScripts([...EXAMPLES], true);
        const groups = [...document.querySelectorAll<HTMLElement>('.script-group')];
        assert.deepStrictEqual(groups.map(g => g.dataset.group), ['actions', 'providers']);
        assert.strictEqual(groupText('actions', '.script-group-label'), 'Actions');
        assert.strictEqual(groupText('actions', '.script-group-count'), '3');
        assert.strictEqual(groupText('providers', '.script-group-label'), 'Providers');
        assert.strictEqual(groupText('providers', '.script-group-count'), '3');
        const hdrs = [...document.querySelectorAll<HTMLButtonElement>('.script-group-hdr')];
        assert.deepStrictEqual(hdrs.map(h => h.getAttribute('aria-expanded')), ['true', 'true']);
        assert.strictEqual(hdrs[0].tagName, 'BUTTON', 'group headers are native keyboard-toggleable buttons');
    });

    test('hello.js is the first action card and each group is alphabetical', () => {
        panel.setScripts(EXAMPLES, true);
        const actionNames = [...document.querySelectorAll('.script-group[data-group="actions"] .script-name')]
            .map(el => el.textContent);
        assert.deepStrictEqual(actionNames, ['hello.js', 'verify-crc.js', 'write-pattern.js']);
        const providerNames = [...document.querySelectorAll('.script-group[data-group="providers"] .script-name')]
            .map(el => el.textContent);
        assert.deepStrictEqual(providerNames, ['array-size-from-header.js', 'follow-pointer.js', 'verify-integrity.js']);
    });

    test('provider-only cards render Open and job-language chips, never a Run control', () => {
        panel.setScripts([PROVIDER], true);
        const card = cardFor(PROVIDER.filePath);
        assert.strictEqual(card.dataset.kind, 'provider');
        assert.strictEqual(card.querySelector('.script-run-btn'), null, 'no run button at all (not disabled, not hidden)');
        assert.strictEqual(card.querySelector('.script-result-area'), null, 'providers own no run result area');
        assert.strictEqual(card.querySelector('.sb-status-dot'), null, 'no run status on provider cards');
        const chip = card.querySelector('.script-role')!;
        assert.strictEqual(chip.textContent, 'Instance address');
        assert.strictEqual(chip.getAttribute('data-role'), 'address');
        click(dom, openBtn(PROVIDER.filePath));
        assert.deepStrictEqual(cb.opens, [PROVIDER.filePath]);
        assert.deepStrictEqual(cb.runs, []);
    });

    test('action cards keep Run/Cancel; both-kind cards keep Run plus provider chips', () => {
        panel.setScripts([BOTH, SCRIPTS[0]], true);
        const both = cardFor(BOTH.filePath);
        assert.strictEqual(both.dataset.kind, 'both');
        assert.ok(runBtn(BOTH.filePath), 'both-kind cards stay runnable');
        assert.strictEqual(both.querySelector('.script-role')?.textContent, 'Integrity check');
        startRun(dom, BOTH.filePath);
        assert.deepStrictEqual(cb.runs, [{ path: BOTH.filePath, generation: 0, selection: undefined }]);
        assert.strictEqual(cardFor(A).dataset.kind, 'action');
        assert.ok(runBtn(A));
    });

    test('unknown-export cards get Open and an inspect hint, never a silent failing Run', () => {
        panel.setScripts([UNKNOWN], true);
        const card = cardFor(UNKNOWN.filePath);
        assert.strictEqual(card.dataset.kind, 'unknown');
        assert.strictEqual(card.querySelector('.script-run-btn'), null);
        assert.ok(card.querySelector('.script-warn'), 'warning marker');
        assert.strictEqual(card.querySelector('.script-inspect-hint')?.textContent, 'Inspect exports');
        assert.match(card.querySelector('.script-inspect-hint')!.getAttribute('title')!, /@entry run/);
        click(dom, openBtn(UNKNOWN.filePath));
        assert.deepStrictEqual(cb.opens, [UNKNOWN.filePath]);
        assert.deepStrictEqual(cb.runs, []);
    });

    test('an empty group renders nothing; group headers never start a run', () => {
        panel.setScripts([PROVIDER], true);
        assert.strictEqual(document.querySelector('.script-group[data-group="actions"]'), null);
        assert.ok(document.querySelector('.script-group[data-group="providers"]'));
        click(dom, document.querySelector('.script-group-hdr'));
        assert.deepStrictEqual(cb.runs, []);
        assert.deepStrictEqual(cb.cancels, []);
    });

    test('collapsing a group toggles aria-expanded and preserves its result areas', () => {
        panel.setScripts(SCRIPTS, true);
        panel.showResult(A, [{ label: 'CRC32', value: '0x1' }], [], '', undefined, 0);
        const group = document.querySelector<HTMLElement>('.script-group[data-group="actions"]')!;
        const hdr = group.querySelector<HTMLButtonElement>('.script-group-hdr')!;
        click(dom, hdr);
        assert.ok(group.classList.contains('collapsed'));
        assert.strictEqual(hdr.getAttribute('aria-expanded'), 'false');
        assert.strictEqual(cardFor(A).querySelector('.script-result-label')?.textContent, 'CRC32', 'result area survives collapse');
        click(dom, hdr);
        assert.ok(!group.classList.contains('collapsed'));
        assert.strictEqual(hdr.getAttribute('aria-expanded'), 'true');
    });

    test('regrouping on a rescan moves result areas with their script', () => {
        panel.setScripts(SCRIPTS, true);
        panel.showResult(B, [{ label: 'Hello', value: 'Hex Scope' }], ['logged'], '', undefined, 0);
        panel.setScripts([{ ...SCRIPTS[2], roles: ['integrity'] }, ...SCRIPTS.slice(0, 2)], true);
        const card = cardFor(B);
        assert.strictEqual(card.closest('.script-group')?.getAttribute('data-group'), 'actions');
        assert.strictEqual(card.querySelector('.script-result-label')?.textContent, 'Hello', 'result kept across the rebuild');
        assert.strictEqual(card.querySelector('.script-output-log')?.textContent, 'logged');
    });

    test('legacy payloads without hasRun stay runnable unless they declare a role', () => {
        const legacyAction: ScriptInfo = { ...SCRIPTS[0], hasRun: undefined };
        const legacyProvider: ScriptInfo = { name: 'legacy-provider.js', filePath: 'D:\\sample\\legacy-provider.js', capabilities: [], roles: ['size'], fingerprint: 'legacy' };
        panel.setScripts([legacyAction, legacyProvider], true);
        assert.ok(runBtn(A), 'role-less legacy scripts keep a Run button');
        assert.strictEqual(cardFor(legacyProvider.filePath).querySelector('.script-run-btn'), null, 'role-bearing legacy scripts are providers');
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
        const area = cardFor(A).querySelector('.script-result-area')!;
        assert.ok(
            prompt.compareDocumentPosition(area) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
            'above the result area',
        );
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
        assert.match(options[0].textContent!, /Allow write for this script, until VS Code restarts/);
        assert.match(options[3].textContent!, /Allow all capabilities for every script, until VS Code restarts/);
        assert.match(options[4].textContent!, /Always allow write for this script in this workspace, across restarts/);
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

suite('ScriptsPanel permissions list (script, session, workspace)', () => {
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

    test('renders every stored grant above the script list in host-sorted order', () => {
        // The host sends `listGrants()` order (workspace → session → script, then path).
        panel.setPermissionGrants([
            { scriptPath: 'D:\\sample\\tools\\sign.js', capability: '*', scope: 'workspace' },
            { scriptPath: '*', capability: 'exec', scope: 'session' },
            { scriptPath: A, capability: 'write', scope: 'script' },
        ]);
        const section = document.querySelector('.script-perms-section')!;
        assert.ok(section, 'permissions section rendered');
        assert.match(section.querySelector('.script-perms-title')!.textContent!, /Permissions/);
        const rows = [...section.querySelectorAll<HTMLElement>('.script-perm-row')];
        assert.strictEqual(rows.length, 3);
        assert.deepStrictEqual(rows.map(r => r.dataset.scope), ['workspace', 'session', 'script']);
        assert.deepStrictEqual(
            rows.map(r => r.querySelector('.script-perm-scope')!.textContent),
            ['Workspace', 'This session', 'This script'],
        );
        assert.strictEqual(rows[0].querySelector('.script-perm-name')!.textContent, 'sign.js');
        assert.strictEqual(rows[0].querySelector('.script-perm-ability')!.textContent, 'all non-exec');
        assert.strictEqual(rows[1].querySelector('.script-perm-name')!.textContent, 'All scripts');
        assert.strictEqual(rows[1].querySelector('.script-perm-ability')!.textContent, 'exec');
        assert.strictEqual(rows[2].querySelector('.script-perm-name')!.textContent, 'crc-check.js');
        assert.ok(section.compareDocumentPosition(document.querySelector('.script-list')!) & 4, 'section precedes the list');

        click(dom, rows[2].querySelector('[data-revoke]'));
        click(dom, rows[1].querySelector('[data-revoke]'));
        click(dom, rows[0].querySelector('[data-revoke]'));
        assert.deepStrictEqual(cb.revokes, [
            ['script', A, 'write'],
            ['session', '*', 'exec'],
            ['workspace', 'D:\\sample\\tools\\sign.js', '*'],
        ]);
    });

    test('Manage reveals the bulk actions; each bulk revoke needs a confirming click', () => {
        panel.setPermissionGrants([
            { scriptPath: A, capability: 'write', scope: 'script' },
            { scriptPath: '*', capability: 'exec', scope: 'session' },
            { scriptPath: 'D:\\sample\\tools\\sign.js', capability: '*', scope: 'workspace' },
        ]);
        const section = document.querySelector<HTMLElement>('.script-perms-section')!;
        const manage = section.querySelector<HTMLElement>('[data-perms-manage]')!;
        assert.strictEqual(manage.getAttribute('aria-expanded'), 'false');
        assert.ok(!section.classList.contains('expanded'), 'collapsed until Manage is clicked');
        click(dom, manage);
        assert.ok(section.classList.contains('expanded'));
        assert.strictEqual(manage.getAttribute('aria-expanded'), 'true');

        const workspace = section.querySelector<HTMLElement>('[data-revoke-all-workspace]')!;
        click(dom, workspace);
        assert.deepStrictEqual(cb.revokeAlls, [], 'first click arms only');
        assert.strictEqual(workspace.textContent, 'Confirm?');
        click(dom, workspace);
        assert.deepStrictEqual(cb.revokeAlls, [{ scope: 'workspace', scriptPath: undefined }]);

        const session = section.querySelector<HTMLElement>('[data-revoke-all-session]')!;
        click(dom, session);
        click(dom, session);
        assert.deepStrictEqual(cb.revokeAlls[1], { scope: 'session', scriptPath: undefined });
    });

    test('a script with several grants gets an All action that confirms before revoking them', () => {
        panel.setPermissionGrants([
            { scriptPath: A, capability: 'fetch', scope: 'workspace' },
            { scriptPath: 'D:\\sample\\tools\\sign.js', capability: 'write', scope: 'workspace' },
            { scriptPath: A, capability: 'write', scope: 'script' },
        ]);
        const section = document.querySelector<HTMLElement>('.script-perms-section')!;
        const rows = [...section.querySelectorAll<HTMLElement>('.script-perm-row')];
        assert.deepStrictEqual(rows.map(r => r.dataset.path), [A, 'D:\\sample\\tools\\sign.js', A]);
        assert.strictEqual(section.querySelectorAll('[data-revoke-all]').length, 2, 'only the multi-grant script offers All');

        const all = rows[0].querySelector<HTMLElement>('[data-revoke-all]')!;
        click(dom, all);
        assert.deepStrictEqual(cb.revokeAlls, [], 'first click arms only');
        click(dom, all);
        assert.deepStrictEqual(cb.revokeAlls, [{ scope: undefined, scriptPath: A }]);
    });

    test('an empty grant list removes the section', () => {
        panel.setPermissionGrants([{ scriptPath: A, capability: 'write', scope: 'script' }]);
        assert.ok(document.querySelector('.script-perms-section'));
        panel.setPermissionGrants([]);
        assert.strictEqual(document.querySelector('.script-perms-section'), null);
    });

    test('permission list updates never clear existing result areas', () => {
        panel.showResult(A, [{ label: 'CRC32', value: '0x1' }], [], '', undefined, 0);
        panel.setPermissionGrants([{ scriptPath: A, capability: 'write', scope: 'script' }]);
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

suite('ScriptsPanel write summary', () => {
    let dom: JSDOM;
    let panel: ScriptsPanel;

    setup(() => {
        const harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        currentDom = dom;
        panel.setScripts(SCRIPTS, true);
    });

    teardown(cleanupDom);

    test('saving then saved shows range, bytes, before/after, and Ctrl+Z guidance', () => {
        panel.showWriteSummary(writeSummary());
        panel.showResult(A, [], [], '', undefined, 2);
        const line = cardFor(A).querySelector<HTMLElement>('.script-write-summary')!;
        assert.ok(line.classList.contains('script-write-summary-saving'));
        assert.match(line.textContent!, /Saving 2 byte\(s\) at 0x1000\u20130x1001/);
        assert.match(line.textContent!, /before AA BB/);
        assert.match(line.textContent!, /after DE AD/);
        assert.strictEqual(cardFor(A).querySelector('.script-output-writes'), null, 'the summary owns the writes notice');

        panel.markWritesSaved();
        const saved = cardFor(A).querySelector<HTMLElement>('.script-write-summary')!;
        assert.ok(saved.classList.contains('script-write-summary-saved'));
        assert.match(saved.textContent!, /Saved 2 byte\(s\) at 0x1000\u20130x1001/);
        assert.match(saved.textContent!, /Ctrl\+Z to undo/);
    });

    test('failed save is a distinct state, not "saving"', () => {
        panel.showWriteSummary(writeSummary());
        panel.showResult(A, [], [], '', undefined, 2);
        panel.markWritesFailed(A, 'EACCES: permission denied');
        const line = cardFor(A).querySelector<HTMLElement>('.script-write-summary')!;
        assert.ok(line.classList.contains('script-write-summary-failed'));
        assert.ok(!line.classList.contains('script-write-summary-saving'));
        assert.match(line.textContent!, /failed/);
        assert.match(line.textContent!, /nothing was saved/);
        assert.match(line.textContent!, /EACCES: permission denied/);
        assert.ok(!/Ctrl\+Z/.test(line.textContent!), 'no undo guidance for a failed save');
    });

    test('a failure for another script path leaves the pending summary alone', () => {
        panel.showWriteSummary(writeSummary());
        panel.showResult(A, [], [], '', undefined, 2);
        panel.markWritesFailed(B, 'boom');
        assert.ok(cardFor(A).querySelector('.script-write-summary-saving'));
        assert.ok(!/boom/.test(cardFor(A).textContent!), 'foreign failure stays out of the card');
    });

    test('a large range shows first/last byte instead of the full before/after', () => {
        const writes = Array.from({ length: 12 }, (_, i) => [0x1000 + i, i + 1] as [number, number]);
        const before = writes.map(([addr]) => [addr, 0] as [number, number]);
        panel.showWriteSummary(writeSummary({ writes, before }));
        panel.showResult(A, [], [], '', undefined, 12);
        const line = cardFor(A).querySelector<HTMLElement>('.script-write-summary')!;
        assert.match(line.textContent!, /Saving 12 byte\(s\) at 0x1000\u20130x100b/);
        assert.match(line.textContent!, /before 00 \u2026 00/);
        assert.match(line.textContent!, /after 01 \u2026 0C/);
    });

    test('a new run consumes the summary; the prior line survives in run history', () => {
        panel.showWriteSummary(writeSummary({ status: 'saved' }));
        panel.showResult(A, [], [], '', undefined, 2);
        startRun(dom, A);
        panel.showResult(A, [], [], 'boom', 'runtime', 0, 2);
        const latest = cardFor(A).querySelector('.script-output-block:not(.script-run-row)')!;
        assert.strictEqual(latest.querySelector('.script-write-summary'), null, 'no stale save line on the new result');
        assert.match(latest.querySelector('.script-output-writes')!.textContent!, /discarded/);
        assert.ok(cardFor(A).querySelector('.script-run-row .script-write-summary'), 'history snapshot keeps the saved line');
    });

    test('clear results drops the summary with the card results', () => {
        panel.showWriteSummary(writeSummary({ status: 'saved' }));
        panel.showResult(A, [], [], '', undefined, 2);
        click(dom, cardFor(A).querySelector('[data-clear]'));
        assert.strictEqual(cardFor(A).querySelector('.script-write-summary'), null);
        assert.strictEqual(cardFor(A).querySelector('.script-result-area')!.childElementCount, 0);
    });

    test('a summary without a result area renders nothing (no crash)', () => {
        panel.showWriteSummary(writeSummary({ scriptPath: 'D:\\sample\\missing.js' }));
        assert.strictEqual(document.querySelectorAll('.script-write-summary').length, 0);
    });
});

suite('ScriptsPanel details row', () => {
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

    test('chevron toggles the details row and the state survives a rescan', () => {
        const toggle = cardFor(A).querySelector<HTMLElement>('[data-details-toggle]')!;
        const details = cardFor(A).querySelector<HTMLElement>('.script-details')!;
        assert.ok(details.hidden, 'collapsed by default');
        assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
        click(dom, toggle);
        assert.ok(!details.hidden);
        assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');

        panel.setScripts(SCRIPTS, true); // rescan rebuilds the list
        const fresh = cardFor(A).querySelector<HTMLElement>('.script-details')!;
        assert.ok(!fresh.hidden, 'expanded state survives a rescan');
        assert.strictEqual(cardFor(A).querySelector<HTMLElement>('[data-details-toggle]')!.getAttribute('aria-expanded'), 'true');
    });

    test('details render roles, capabilities, used-by, entries, fingerprint, last run, and grants', () => {
        panel.setScripts([{ ...SCRIPTS[0], capabilities: ['write', 'exec'], roles: ['address'] }], true);
        panel.setUsages([{ ...USAGE_INTEGRITY, scriptPath: A, label: 'Flash CRC' }]);
        panel.showResult(A, [], [], 'slow', 'timeout', 0);
        panel.setPermissionGrants([{ scriptPath: A, capability: 'write', scope: 'script' }]);
        const values = [...cardFor(A).querySelectorAll('.script-details-value')].map(el => el.textContent);
        assert.deepStrictEqual(values.slice(0, 2), [
            'Instance address',
            'write, exec',
        ]);
        assert.strictEqual(values[2]?.startsWith('Flash CRC'), true, 'used-by link renders its label');
        assert.deepStrictEqual(values.slice(3, 5), [
            'run, getAddress',
            'fp-1',
        ]);
        assert.match(values[5]!, /^\d{2}:\d{2} · Timeout$/, 'last run shows time + terminal state');
        assert.strictEqual(values[6], '1', 'active grants count includes the script grant');
        assert.strictEqual(cardFor(A).querySelectorAll('.script-details-value').length, 7);
    });

    test('unknown scripts report no entries and an unsafe fingerprint stays escaped', () => {
        panel.setScripts([{ ...UNKNOWN, fingerprint: '<b>x</b>' }], true);
        const card = cardFor(UNKNOWN.filePath);
        const values = [...card.querySelectorAll('.script-details-value')].map(el => el.textContent);
        assert.strictEqual(values[0], 'None', 'no roles');
        assert.strictEqual(values[1], 'None', 'no capabilities');
        assert.strictEqual(values[2], 'None', 'no usages');
        assert.strictEqual(values[3], 'None detected', 'no entries');
        assert.strictEqual(values[4], '<b>x</b>', 'fingerprint text, not markup');
        assert.strictEqual(card.querySelectorAll('b').length, 0, 'escaped');
        assert.strictEqual(values[5], 'Not run yet');
    });

    test('details actions report open, copy path, and reveal for the card', () => {
        click(dom, cardFor(A).querySelector('[data-details-open]'));
        click(dom, cardFor(A).querySelector('[data-details-copy]'));
        click(dom, cardFor(A).querySelector('[data-details-reveal]'));
        assert.deepStrictEqual(cb.opens, [A]);
        assert.deepStrictEqual(cb.copies, [A]);
        assert.deepStrictEqual(cb.reveals, [A]);
        assert.deepStrictEqual(cb.runs, [], 'details actions never run the script');
    });

    test('Manage permissions appears only with grants and expands the Permissions section', () => {
        assert.ok(cardFor(A).querySelector<HTMLElement>('[data-details-manage]')!.hidden, 'no grants → no manage action');
        panel.setPermissionGrants([{ scriptPath: A, capability: 'write', scope: 'script' }]);
        const manage = cardFor(A).querySelector<HTMLElement>('[data-details-manage]')!;
        assert.ok(!manage.hidden, 'grant exists → manage action visible');
        const section = document.querySelector<HTMLElement>('.script-perms-section')!;
        assert.ok(!section.classList.contains('expanded'));
        click(dom, manage);
        assert.ok(section.classList.contains('expanded'), 'expands the bulk-revoke section');
    });

    test('session-wide grants count for every card', () => {
        panel.setPermissionGrants([{ scriptPath: '*', capability: '*', scope: 'session' }]);
        const grantsOf = (path: string): string | undefined =>
            cardFor(path).querySelector<HTMLElement>('[data-details-grants]')?.textContent ?? undefined;
        assert.strictEqual(grantsOf(A), '1');
        assert.strictEqual(grantsOf(B), '1');
    });
});

suite('ScriptsPanel used-by links', () => {
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        const harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
        panel.setScripts([PROVIDER, BOTH], true);
    });

    teardown(cleanupDom);

    function usageChip(path: string): HTMLElement {
        return cardFor(path).querySelector<HTMLElement>('[data-usage-chip]')!;
    }

    function usageCell(path: string): HTMLElement {
        return cardFor(path).querySelector<HTMLElement>('[data-details-usages]')!;
    }

    test('used-by links render in the details cell; the card carries a count chip', () => {
        panel.setUsages([USAGE_INTEGRITY, USAGE_ADDRESS]);
        const link = usageCell(BOTH.filePath).querySelector<HTMLElement>('.script-usage-link')!;
        assert.strictEqual(link.textContent, 'Flash CRCIntegrity check');
        assert.strictEqual(link.querySelector('.script-usage-kind')?.textContent, 'Integrity check');
        assert.strictEqual(link.title, 'Integrity check: Flash CRC');
        assert.strictEqual(usageChip(BOTH.filePath).textContent, 'Used by 1');
        assert.strictEqual(usageChip(BOTH.filePath).title, 'Integrity check: Flash CRC');

        assert.strictEqual(usageCell(PROVIDER.filePath).querySelector('.script-usage-kind')?.textContent, 'Instance address');
        assert.strictEqual(usageChip(PROVIDER.filePath).textContent, 'Used by 1');
    });

    test('cards without usages show the chip hidden and "None" in the details cell', () => {
        assert.ok(usageChip(BOTH.filePath).hidden, 'no usages → chip hidden');
        assert.strictEqual(usageCell(BOTH.filePath).textContent, 'None');
    });

    test('a usage link reports the derived usage for host navigation', () => {
        panel.setUsages([USAGE_INTEGRITY, USAGE_ADDRESS]);
        click(dom, usageCell(PROVIDER.filePath).querySelector('[data-usage-idx]'));
        assert.deepStrictEqual(cb.selectedUsages, [USAGE_ADDRESS]);
        click(dom, usageCell(BOTH.filePath).querySelector('[data-usage-idx]'));
        assert.deepStrictEqual(cb.selectedUsages, [USAGE_ADDRESS, USAGE_INTEGRITY]);
    });

    test('usage refresh re-renders in place and keeps result areas intact', () => {
        panel.showResult(BOTH.filePath, [], ['streamed'], '', undefined, 0);
        panel.setUsages([USAGE_INTEGRITY]);
        assert.strictEqual(usageChip(BOTH.filePath).textContent, 'Used by 1');
        const block = cardFor(BOTH.filePath).querySelector('.script-output-block');
        assert.ok(block, 'result block survives the usage refresh');
        assert.strictEqual(block!.querySelector('.script-output-log')?.textContent, 'streamed');
        panel.setUsages([]);
        assert.ok(usageChip(BOTH.filePath).hidden, 'cleared usages hide the chip again');
        assert.strictEqual(cardFor(BOTH.filePath).querySelector('.script-output-block'), block, 'the very same result DOM stays attached');
    });

    test('usages pushed before a rescan render into the rebuilt cards', () => {
        panel.setUsages([USAGE_INTEGRITY]);
        panel.setScripts([BOTH], true); // rebuild: fresh cards read the pushed usages
        const link = cardFor(BOTH.filePath).querySelector<HTMLElement>('.script-usage-link');
        assert.ok(link, 'rebuilt cards render the used-by link');
        assert.strictEqual(usageChip(BOTH.filePath).textContent, 'Used by 1');
    });

    test('an unmatched usage path renders nowhere and never crashes the list', () => {
        panel.setUsages([{ scriptPath: '.hexscope/scripts/deleted.js', kind: 'address', label: 'gone', pinId: 'p' }]);
        assert.strictEqual(document.querySelectorAll('.script-usage-link').length, 0);
        assert.ok(usageChip(BOTH.filePath).hidden);
    });
});

suite('ScriptsPanel card context menu', () => {
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

    function openCardMenu(path: string): void {
        cardFor(path).dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    }

    function menuRow(cmd: string): HTMLElement | null {
        return document.querySelector<HTMLElement>(`#menu .menu-item[data-cmd="${cmd}"]`);
    }

    test('right-click opens the card menu; Open/Copy/Reveal/Delete report the card path', () => {
        openCardMenu(A);
        assert.ok(document.getElementById('menu'), 'shared menu container opens');
        assert.ok(menuRow('script-open'));
        assert.ok(menuRow('script-copy'));
        assert.ok(menuRow('script-reveal'));
        assert.ok(menuRow('script-details'));
        assert.ok(menuRow('script-delete'));
        const disabledManage = document.querySelector<HTMLElement>('#menu .menu-item.menu-disabled');
        assert.strictEqual(disabledManage?.querySelector('.menu-label')?.textContent, 'Manage permissions');
        assert.strictEqual(disabledManage?.querySelector('.menu-hint')?.textContent, 'No active grants');

        click(dom, menuRow('script-open'));
        assert.strictEqual(menuController.openMenu(), null, 'the menu closes after a command');
        assert.deepStrictEqual(cb.opens, [A]);

        openCardMenu(A);
        click(dom, menuRow('script-copy'));
        openCardMenu(A);
        click(dom, menuRow('script-reveal'));
        openCardMenu(A);
        click(dom, menuRow('script-delete'));
        assert.deepStrictEqual(cb.copies, [A]);
        assert.deepStrictEqual(cb.reveals, [A]);
        assert.deepStrictEqual(cb.deletes, [A]);
        assert.deepStrictEqual(cb.runs, [], 'the card menu never runs the script');
    });

    test('Shift+F10 opens the menu from the keyboard; Escape closes it', () => {
        cardFor(A).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
        assert.ok(menuRow('script-open'), 'keyboard entry opens the card menu');

        document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.strictEqual(menuController.openMenu(), null, 'Escape closes the menu');

        cardFor(A).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));
        click(dom, menuRow('script-delete'));
        assert.deepStrictEqual(cb.deletes, [A], 'the keyboard-opened menu reaches the same Delete command');
    });

    test('Show details expands the card row; Manage permissions expands the section', () => {
        panel.setPermissionGrants([{ scriptPath: A, capability: 'write', scope: 'script' }]);
        assert.ok(cardFor(A).querySelector<HTMLElement>('.script-details')!.hidden);

        openCardMenu(A);
        assert.ok(!menuRow('script-permissions')!.classList.contains('menu-disabled'), 'grant exists → manage is actionable');
        click(dom, menuRow('script-details'));
        assert.ok(!cardFor(A).querySelector<HTMLElement>('.script-details')!.hidden, 'Show details expands the row');

        openCardMenu(A);
        click(dom, menuRow('script-permissions'));
        assert.ok(document.querySelector<HTMLElement>('.script-perms-section')!.classList.contains('expanded'));
    });
});

suite('ScriptsPanel filter bar', () => {
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        const harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    function bar(): HTMLElement {
        return document.querySelector<HTMLElement>('.script-filter-bar')!;
    }

    function typeFilter(value: string): void {
        const input = document.querySelector<HTMLInputElement>('.script-filter-input')!;
        input.value = value;
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    }

    function visibleCards(): string[] {
        return [...document.querySelectorAll<HTMLElement>('.script-card:not([hidden])')].map(card => card.dataset.path!);
    }

    test('the bar is hidden in the empty state and appears with scripts', () => {
        assert.ok(bar().hidden, 'no filter affordance without scripts');
        panel.setScripts(SCRIPTS, true);
        assert.ok(!bar().hidden);
        panel.setScripts([], true);
        assert.ok(bar().hidden, 'hidden again with the empty state');
    });

    test('text filter hides non-matching cards, keeps results, and "No matches" appears', () => {
        panel.setScripts(SCRIPTS, true);
        panel.showResult(A, [{ label: 'kept', value: '1' }], [], '', undefined, 0);
        typeFilter('hello');
        assert.deepStrictEqual(visibleCards(), [B]);
        assert.strictEqual(cardFor(A).hidden, true);
        assert.ok(cardFor(A).querySelector('.script-output-block'), 'result DOM survives hiding');
        typeFilter('zzz');
        assert.deepStrictEqual(visibleCards(), []);
        const noMatch = document.querySelector<HTMLElement>('.script-no-match')!;
        assert.ok(!noMatch.hidden, 'no-match state shows');
        assert.strictEqual(noMatch.textContent, 'No scripts match the filter');
        typeFilter('');
        assert.ok(noMatch.hidden);
        assert.strictEqual(visibleCards().length, 3);
    });

    test('kind chips narrow to a group; All restores the full list', () => {
        panel.setScripts(EXAMPLES, true); // includes a follow-pointer provider
        const providersChip = document.querySelector<HTMLElement>('[data-kind-filter="providers"]')!;
        const actionsChip = document.querySelector<HTMLElement>('[data-kind-filter="actions"]')!;
        click(dom, providersChip);
        assert.strictEqual(providersChip.getAttribute('aria-pressed'), 'true');
        assert.strictEqual(actionsChip.getAttribute('aria-pressed'), 'false');
        assert.deepStrictEqual(visibleCards(), [
            'D:\\sample\\array-size-from-header.js',
            'D:\\sample\\follow-pointer.js',
            'D:\\sample\\verify-integrity.js',
        ]);
        assert.ok(cardFor('D:\\sample\\hello.js').hidden, 'action card hidden');
        const actionsGroup = document.querySelector<HTMLElement>('.script-group[data-group="actions"]')!;
        const providersGroup = document.querySelector<HTMLElement>('.script-group[data-group="providers"]')!;
        assert.ok(actionsGroup.hidden, 'empty group hides');
        assert.ok(!providersGroup.hidden);

        click(dom, actionsChip);
        assert.ok(cardFor('D:\\sample\\follow-pointer.js').hidden);
        assert.ok(!cardFor('D:\\sample\\hello.js').hidden);
        assert.ok(!actionsGroup.hidden);
        assert.ok(providersGroup.hidden);

        click(dom, document.querySelector<HTMLElement>('[data-kind-filter="all"]')!);
        assert.strictEqual(visibleCards().length, 6);
    });

    test('filter stays applied across a rescan and run history survives it', () => {
        panel.setScripts(SCRIPTS, true);
        panel.showResult(A, [], ['first'], '', undefined, 0);
        panel.showResult(A, [], ['second'], '', undefined, 0); // collapses run #1 into history
        typeFilter('hello');
        panel.setScripts([...SCRIPTS].reverse(), true); // rescan with a different order
        assert.strictEqual(cardFor(A).hidden, true, 'filter re-applied after rebuild');
        assert.deepStrictEqual(visibleCards(), [B]);
        const area = cardFor(A).querySelector('.script-result-area')!;
        assert.strictEqual(area.querySelectorAll('.script-run-row').length, 1, 'run history survives the filtered rescan');
        assert.strictEqual(area.querySelector('.script-output-log')?.textContent, 'second');
        assert.strictEqual(cb.runs.length, 0, 'filtering never runs anything');
    });
});

suite('ScriptsPanel TypeScript path', () => {
    let dom: JSDOM;
    let panel: ScriptsPanel;
    let cb: Cb;

    setup(() => {
        const harness = installDom();
        dom = harness.dom;
        panel = harness.panel;
        cb = harness.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('.ts without esbuild keeps Run disabled and offers the action row', () => {
        panel.setScripts(SCRIPTS, true); // compilerAvailable defaults to false
        const btn = runBtn('D:\\sample\\crc-check.ts');
        assert.ok(btn.classList.contains('disabled-ts'));
        const help = cardFor('D:\\sample\\crc-check.ts').querySelector<HTMLElement>('.script-ts-help')!;
        assert.ok(help, 'actionable row replaces the silent dead end');
        click(dom, help.querySelector('[data-ts-guide]'));
        assert.strictEqual(cb.guides, 1, 'setup guide action is wired');
        click(dom, help.querySelector('[data-ts-convert]'));
        assert.deepStrictEqual(cb.jsVersions, ['D:\\sample\\crc-check.ts'], 'create-JS action reports the path');
        assert.strictEqual(cardFor(A).querySelector('.script-ts-help'), null, '.js cards get no TS row');
    });

    test('an available compiler enables .ts Run and hides the action row', () => {
        panel.setScripts(SCRIPTS, true, true);
        const btn = runBtn('D:\\sample\\crc-check.ts');
        assert.ok(!btn.classList.contains('disabled-ts'));
        assert.strictEqual(btn.disabled, false);
        assert.strictEqual(cardFor('D:\\sample\\crc-check.ts').querySelector('.script-ts-help'), null);
        click(dom, btn);
        assert.deepStrictEqual(cb.runs.map(run => run.path), ['D:\\sample\\crc-check.ts']);
    });

    test('untrusted workspaces keep disabled-trust and no TypeScript action row', () => {
        panel.setScripts(SCRIPTS, false);
        const btn = runBtn('D:\\sample\\crc-check.ts');
        assert.ok(btn.classList.contains('disabled-trust'));
        assert.ok(!btn.classList.contains('disabled-ts'));
        assert.strictEqual(cardFor('D:\\sample\\crc-check.ts').querySelector('.script-ts-help'), null);
    });
});

suite('ScriptsPanel last run', () => {
    let panel: ScriptsPanel;

    setup(() => {
        const harness = installDom();
        panel = harness.panel;
        currentDom = harness.dom;
        panel.setScripts(SCRIPTS, true);
    });

    teardown(cleanupDom);

    test('status tooltip and details row show time + terminal state', () => {
        panel.showResult(A, [], [], '', undefined, 0);
        const dot = cardFor(A).querySelector<HTMLElement>('.sb-status-dot')!;
        assert.match(dot.title, /^Last run succeeded · \d{2}:\d{2}$/);
        const cell = cardFor(A).querySelector<HTMLElement>('[data-details-last-run]')!;
        assert.match(cell.textContent!, /^\d{2}:\d{2} · Succeeded$/);

        panel.showResult(A, [], [], 'late', 'timeout', 0);
        assert.match(dot.title, /^Last run errored · \d{2}:\d{2}$/, 'tooltip follows the newest terminal state');
        assert.match(cell.textContent!, /^\d{2}:\d{2} · Timeout$/);
    });

    test('cancelled and contract runs report their own terminal states', () => {
        panel.showResult(A, [], [], 'cancelled', 'cancel', 0);
        assert.match(cardFor(A).querySelector<HTMLElement>('[data-details-last-run]')!.textContent!, / · Cancelled$/);
        panel.showResult(A, [], [], 'bad value', 'contract', 0);
        assert.match(cardFor(A).querySelector<HTMLElement>('[data-details-last-run]')!.textContent!, / · Contract error$/);
    });

    test('an untouched script reports "Not run yet"', () => {
        assert.strictEqual(cardFor(B).querySelector<HTMLElement>('[data-details-last-run]')!.textContent, 'Not run yet');
    });

    test('last-run state survives a panel rescan', () => {
        panel.showResult(A, [], [], '', undefined, 0);
        panel.setScripts(SCRIPTS, true); // rebuild: state comes from the panel's last-run map
        const dot = cardFor(A).querySelector<HTMLElement>('.sb-status-dot')!;
        assert.ok(dot.classList.contains('ok'));
        assert.match(dot.title, /^Last run succeeded · \d{2}:\d{2}$/);
        assert.match(cardFor(A).querySelector<HTMLElement>('[data-details-last-run]')!.textContent!, /^\d{2}:\d{2} · Succeeded$/);
    });
});