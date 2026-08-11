import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../../../cssImportHook';

import { ScriptsPanel, type ScriptInfo } from '../../../../../webview/components/sidebar/scriptsPanel/scriptsPanel';

let currentDom: JSDOM | null = null;

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
    navigator: Navigator;
};

type Cb = {
    requested: number;
    runs: Array<{ path: string; generation: number; selection?: { start: number; end: number } }>;
    cancels: string[];
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
    { name: 'crc-check.js', filePath: A, capabilities: ['exec'] },
    { name: 'crc-check.ts', filePath: 'D:\\sample\\crc-check.ts', capabilities: ['exec', 'network'] },
    { name: 'hello.js', filePath: B, capabilities: [] },
];

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

    const cb: Cb = { requested: 0, runs: [], cancels: [] };
    const sel: { value: { start: number; end: number } | null } = { value: null };
    const generation: { value: number } = { value: 0 };
    const panel = new ScriptsPanel({
        onRequestList: () => { cb.requested++; },
        onRunScript: (scriptPath, gen, selectionRange) => {
            cb.runs.push({ path: scriptPath, generation: gen, selection: selectionRange });
        },
        onCancelScript: path => { cb.cancels.push(path); },
        getSelection: () => sel.value,
        getGeneration: () => generation.value,
    });
    panel.mount(document.getElementById('host')!);
    return { dom, panel, cb, sel, generation };
}

function cleanupDom(): void {
    if (currentDom) {
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

    test('mount creates #s-scripts with toolbar + empty state', () => {
        assert.ok(document.getElementById('s-scripts'));
        assert.strictEqual(document.querySelector('.script-toolbar-title')?.textContent, 'Scripts');
        assert.strictEqual(document.querySelector('.sb-empty')?.textContent, 'No scripts found in .hexscope/scripts/');
        assert.strictEqual(document.querySelectorAll('.script-card').length, 0);
        assert.ok(document.getElementById('scripts-refresh'));
        assert.ok((document.getElementById('scripts-count') as HTMLElement).hidden, 'count badge hidden when no scripts');
    });

    test('refresh button reports onRequestList', () => {
        cb.requested = 0;
        click(dom, document.getElementById('scripts-refresh'));
        assert.strictEqual(cb.requested, 1);
    });

    test('render is idempotent: re-render keeps a single shell', () => {
        panel.render();
        assert.strictEqual(document.querySelectorAll('#s-scripts').length, 1);
        assert.strictEqual(document.querySelectorAll('.script-toolbar').length, 1);
        assert.strictEqual(document.querySelectorAll('#scripts-refresh').length, 1);
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

    test('renders script cards with name/ext/capability badges and status dots', () => {
        panel.setScripts(SCRIPTS, true);
        assert.strictEqual(document.querySelectorAll('.script-card').length, 3);
        const card = cardFor(A);
        assert.strictEqual(card.querySelector('.script-name')?.textContent, 'crc-check.js');
        assert.strictEqual(card.querySelector('.script-name')?.getAttribute('title'), A);
        assert.strictEqual(card.querySelector('.script-ext')?.textContent, 'js');
        assert.strictEqual(card.querySelector('.script-cap')?.textContent, '⚡ exec');
        assert.ok(card.querySelector('.script-dot.dot-idle'));
        assert.strictEqual((card.querySelector('.script-dot') as HTMLElement).title, 'Not yet run');
    });

    test('updates the count badge', () => {
        assert.ok((document.getElementById('scripts-count') as HTMLElement).hidden);
        panel.setScripts(SCRIPTS, true);
        const badge = document.getElementById('scripts-count') as HTMLElement;
        assert.strictEqual(badge.textContent, '3');
        assert.ok(!badge.hidden);
        panel.setScripts([], true);
        assert.strictEqual((document.getElementById('scripts-count') as HTMLElement).textContent, '0');
        assert.ok((document.getElementById('scripts-count') as HTMLElement).hidden);
    });

    test('untrusted workspace disables run buttons with tooltip', () => {
        panel.setScripts(SCRIPTS, false);
        const btn = runBtn(A);
        assert.ok(btn.classList.contains('disabled-trust'));
        assert.strictEqual(btn.title, 'Workspace not trusted');
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
        assert.match(btn.title, /require esbuild/);
        assert.ok(!runBtn(A).classList.contains('disabled-ts'));
    });

    test('status dot flips to ok/err after showResult', () => {
        panel.setScripts(SCRIPTS, true);
        panel.showResult(A, [], [], '', undefined, 0);
        assert.ok(cardFor(A).querySelector('.script-dot.dot-ok'));
        panel.showResult(A, [], [], 'boom', 'runtime', 0);
        assert.ok(cardFor(A).querySelector('.script-dot.dot-err'));
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

    teardown(() => {
        // clear any pending 200ms spinner timer so it never fires after DOM teardown
        panel.showResult(A, [], [], '', undefined, 0);
    });

    teardown(cleanupDom);

    test('click run reports onRunScript with generation + selection', () => {
        panel.setScripts(SCRIPTS, true);
        harness.sel.value = { start: 0x1000, end: 0x1002 };
        harness.generation.value = 7;
        click(dom, runBtn(A));
        assert.deepStrictEqual(cb.runs, [{ path: A, generation: 7, selection: { start: 0x1000, end: 0x1002 } }]);
        assert.strictEqual(cb.cancels.length, 0);
    });

    test('no selection reports onRunScript without selection field', () => {
        panel.setScripts(SCRIPTS, true);
        click(dom, runBtn(A));
        assert.deepStrictEqual(cb.runs, [{ path: A, generation: 0, selection: undefined }]);
        assert.strictEqual(cb.runs[0].selection, undefined);
    });

    test('play → pending spinner → running stop → cancel → play', async () => {
        panel.setScripts(SCRIPTS, true);
        const btn = runBtn(A);
        assert.ok(btn.querySelector('.script-btn-icon.play'));

        click(dom, btn);
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
        click(dom, runBtn(A));
        click(dom, runBtn(A));
        assert.deepStrictEqual(cb.cancels, [A]);
        assert.strictEqual(cb.runs.length, 1);
    });

    test('another script run is ignored while one is running; its button is disabled', () => {
        panel.setScripts(SCRIPTS, true);
        click(dom, runBtn(A));
        const btnB = runBtn(B);
        assert.ok(btnB.classList.contains('disabled-run'), 'other run button visually disabled');
        assert.ok(btnB.disabled, 'other run button disabled');
        assert.strictEqual(btnB.title, 'A script is already running');
        cb.runs.length = 0;
        click(dom, btnB);
        assert.strictEqual(cb.runs.length, 0, 'no second run started');
        assert.strictEqual(cb.cancels.length, 0, 'no cancel of the first');

        panel.showResult(A, [], [], '', undefined, 0);
        assert.ok(!runBtn(B).disabled, 'run button re-enabled after the run clears');
        assert.ok(!runBtn(B).classList.contains('disabled-run'));
    });

    test('terminal showResult returns the button to play', async () => {
        panel.setScripts(SCRIPTS, true);
        const btn = runBtn(A);
        click(dom, btn);
        await sleep(250);
        assert.ok(btn.querySelector('.script-btn-icon.stop'));
        panel.showResult(A, [], [], '', undefined, 0);
        assert.ok(btn.querySelector('.script-btn-icon.play'));
    });
});

suite('ScriptsPanel showResult', () => {
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

    test('writes notice when pendingWriteCount > 0', () => {
        panel.showResult(A, [], [], '', undefined, 3);
        assert.match(cardFor(A).querySelector('.script-output-writes')?.textContent!, /3 byte\(s\) written \(not yet saved\)/);
    });

    test('re-run replaces prior result', () => {
        panel.showResult(A, [{ label: 'first', value: '1' }], [], '', undefined, 0);
        panel.showResult(A, [{ label: 'second', value: '2' }], [], '', undefined, 0);
        const labels = cardFor(A).querySelectorAll('.script-result-label');
        assert.strictEqual(labels.length, 1);
        assert.strictEqual(labels[0].textContent, 'second');
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
        click(dom, runBtn(A)); // start a run so the running card resolves
    });

    teardown(() => {
        // clear the pending 200ms spinner timer so it never fires after DOM teardown
        panel.showResult(A, [], [], '', undefined, 0);
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
