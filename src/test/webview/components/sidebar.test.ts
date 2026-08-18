import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../cssImportHook';

import { Sidebar, SidebarSections, type SidebarPanel } from '../../../webview/components/sidebar/sidebar';

let currentDom: JSDOM | null = null;

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
    localStorage: Storage;
};

function installDom(panels: SidebarPanel[] = makePanels(), headerSlot?: (root: HTMLElement) => void): { dom: JSDOM; sidebar: Sidebar } {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as Globalish;
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    g.localStorage = dom.window.localStorage;
    const sidebar = new Sidebar({ panels, headerSlot });
    document.body.innerHTML = sidebar.toHtml();
    return { dom, sidebar };
}

function cleanupDom(): void {
    if (currentDom) {
        currentDom.window.close();
        currentDom = null;
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    }
}

function makePanels(): SidebarPanel[] {
    return [
        { id: 'inspector', label: 'Inspector', mount: root => { root.innerHTML = '<div class="insp-content"></div>'; } },
        { id: 'struct', label: 'Struct', mount: root => { root.innerHTML = '<div class="struct-content"></div>'; } },
    ];
}

suite('Sidebar shell render', () => {
    test('renders resizer, settings slot, panels and tabs from the config', () => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hexscope.test/' });
        const sidebar = new Sidebar({ panels: makePanels() });
        const body = dom.window.document.body;
        body.innerHTML = sidebar.toHtml();

        assert.ok(body.querySelector('#sidebar-resizer'), 'renders #sidebar-resizer');
        assert.ok(body.querySelector('#sidebar'), 'renders #sidebar');
        assert.ok(body.querySelector('#sidebar-common-settings'), 'renders #sidebar-common-settings');
        assert.ok(body.querySelector('#side-tabs'), 'renders #side-tabs');

        // Panels: slot + tab per configured panel
        assert.ok(body.querySelector('#sbp-inspector'));
        assert.ok(body.querySelector('#sbp-struct'));
        assert.strictEqual(body.querySelector('#sbp-struct')!.textContent, '');
        assert.strictEqual(body.querySelector('#stab-inspector')!.textContent, 'Inspector');
        assert.strictEqual(body.querySelector('#stab-struct')!.textContent, 'Struct');
        assert.strictEqual(body.querySelectorAll('#sidebar .sb-tab-panel').length, 2);
        assert.strictEqual(body.querySelectorAll('#side-tabs .stab').length, 2);
        dom.window.close();
    });

    test('defaults the first configured panel to active', () => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hexscope.test/' });
        const sidebar = new Sidebar({ panels: makePanels() });
        const body = dom.window.document.body;
        body.innerHTML = sidebar.toHtml();

        assert.strictEqual(body.querySelector('#sbp-inspector')!.className, 'sb-tab-panel active');
        assert.strictEqual(body.querySelector('#sbp-struct')!.className, 'sb-tab-panel');
        assert.strictEqual(body.querySelector('#stab-inspector')!.className, 'stab active');
        assert.strictEqual(body.querySelector('#stab-struct')!.className, 'stab');
        dom.window.close();
    });

    test('is config-driven: arbitrary panel ids/labels are rendered verbatim', () => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hexscope.test/' });
        const sidebar = new Sidebar({
            panels: [
                { id: 'integrity', label: 'Checks & <Bugs>', mount: () => {} },
                { id: 'scripts', label: 'Scripts', mount: () => {} },
            ],
        });
        const body = dom.window.document.body;
        body.innerHTML = sidebar.toHtml();

        assert.ok(body.querySelector('#sbp-integrity'));
        assert.ok(body.querySelector('#sbp-scripts'));
        assert.strictEqual(body.querySelector('#stab-integrity')!.className, 'stab active', 'first configured panel is default');
        const labelEl = body.querySelector('#stab-integrity')!;
        assert.strictEqual(labelEl.textContent, 'Checks & <Bugs>', 'labels are escaped in markup, plain in text');
        assert.ok(labelEl.innerHTML.includes('Checks &amp; &lt;Bugs&gt;'), 'untrusted-looking label is HTML-escaped');
        dom.window.close();
    });
});

suite('Sidebar interaction', () => {
    let dom: JSDOM;
    let sidebar: Sidebar;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        sidebar = installed.sidebar;
        currentDom = dom;
    });

    teardown(() => {
        cleanupDom();
    });

    test('mount renders the header slot into #sidebar-common-settings', () => {
        const installed = installDom(makePanels(), root => {
            root.innerHTML = '<span>Byte order</span><button id="be-btn">BE</button>';
        });
        const dom2 = installed.dom;
        currentDom = dom2;
        try {
            installed.sidebar.mount();
            const settings = document.getElementById('sidebar-common-settings')!;
            assert.ok(settings.querySelector('#be-btn'), 'header slot markup rendered');
        } finally {
            currentDom = null;
            dom2.window.close();
        }
    });

    test('tab click reports onTabChange and lazy-activates the panel once', () => {
        const changes: string[] = [];
        const activates: string[] = [];
        const mountPanel = (t: string): void => {
            activates.push(t);
            makePanels().find(p => p.id === t)!.mount(document.getElementById(`sbp-${t}`)!);
        };
        sidebar.setCallbacks({ onTabChange: t => changes.push(t), onPanelActivate: mountPanel });
        sidebar.mount();

        document.getElementById('stab-struct')!.click();
        assert.deepStrictEqual(changes, ['struct']);
        assert.deepStrictEqual(activates, ['struct']);
        assert.ok(document.getElementById('sbp-struct')!.classList.contains('active'));
        assert.ok(document.getElementById('sbp-struct')!.querySelector('.struct-content'), 'panel mounted on first activation');

        // Clicking the active tab again: reports change, does not re-activate
        document.getElementById('stab-struct')!.click();
        assert.deepStrictEqual(changes, ['struct', 'struct']);
        assert.deepStrictEqual(activates, ['struct']);
    });

    test('setTab paints classes and reports onPanelActivate only on change', () => {
        const activates: string[] = [];
        sidebar.setCallbacks({ onPanelActivate: t => activates.push(t) });
        sidebar.mount();

        sidebar.setTab('struct');
        assert.deepStrictEqual(activates, ['struct']);
        assert.strictEqual(document.getElementById('sbp-inspector')!.className, 'sb-tab-panel');
        assert.strictEqual(document.getElementById('stab-inspector')!.className, 'stab');
        assert.strictEqual(document.getElementById('sbp-struct')!.className, 'sb-tab-panel active');

        sidebar.setTab('struct');
        assert.deepStrictEqual(activates, ['struct'], 'no re-activate on same tab');

        sidebar.setTab('inspector');
        assert.deepStrictEqual(activates, ['struct', 'inspector']);
    });

    test('mount is idempotent: re-mount does not double-report', () => {
        const changes: string[] = [];
        const activates: string[] = [];
        sidebar.setCallbacks({ onTabChange: t => changes.push(t), onPanelActivate: t => activates.push(t) });
        sidebar.mount();
        sidebar.mount();
        sidebar.mount();

        document.getElementById('stab-inspector')!.click();
        document.getElementById('stab-struct')!.click();
        assert.deepStrictEqual(changes, ['inspector', 'struct']);
        assert.deepStrictEqual(activates, ['struct'], 'inspector is default-active; only struct activates once');
    });

    test('setCallbacks swaps the reporters', () => {
        const first: string[] = [];
        const second: string[] = [];
        sidebar.setCallbacks({ onTabChange: t => first.push(t) });
        sidebar.mount();
        sidebar.setCallbacks({ onTabChange: t => second.push(t) });

        document.getElementById('stab-struct')!.click();
        assert.deepStrictEqual(first, []);
        assert.deepStrictEqual(second, ['struct']);
    });
});

suite('SidebarSections header model', () => {
    let dom: JSDOM;
    let root: HTMLElement;
    let actions: HTMLElement;
    let actionRuns: number;

    setup(() => {
        dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hexscope.test/' });
        const g = globalThis as unknown as Globalish;
        g.window = dom.window as unknown as Window;
        g.document = dom.window.document as unknown as Document;
        root = document.body.appendChild(document.createElement('div'));
        actionRuns = 0;
        new SidebarSections(root, 'test', [
            { id: 'first', label: 'First' },
            { id: 'last', label: 'Last', mountActions: actionRoot => {
                actions = actionRoot;
                const button = document.createElement('button');
                button.textContent = 'Run';
                button.addEventListener('click', () => { actionRuns++; });
                actionRoot.appendChild(button);
            } },
            { id: 'plain', label: 'Plain', collapsible: false },
        ]);
    });

    teardown(() => {
        dom.window.close();
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
    });

    test('uses whole-header semantics and preserves plain headers', () => {
        const head = document.querySelector<HTMLElement>('#test-first .sb-section-head')!;
        const plain = document.querySelector<HTMLElement>('#test-plain .sb-section-head')!;
        assert.strictEqual(head.getAttribute('role'), 'button');
        assert.strictEqual(head.tabIndex, 0);
        assert.strictEqual(head.getAttribute('aria-expanded'), 'true');
        assert.strictEqual(head.getAttribute('aria-label'), 'First');
        assert.strictEqual(head.querySelector('.sb-section-chevron')?.getAttribute('aria-hidden'), 'true');
        assert.strictEqual(plain.getAttribute('role'), null);
        assert.strictEqual(plain.getAttribute('tabindex'), '-1', 'plain headers are programmatically focusable only (header nav)');
        assert.strictEqual(plain.getAttribute('aria-expanded'), null);
        assert.strictEqual(plain.querySelector('.sb-section-chevron'), null);
    });

    test('click and keyboard toggle collapse state', () => {
        const head = document.querySelector<HTMLElement>('#test-first .sb-section-head')!;
        const section = document.getElementById('test-first')!;
        head.click();
        assert.ok(section.classList.contains('collapsed'));
        head.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.ok(!section.classList.contains('collapsed'));
        head.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        assert.ok(section.classList.contains('collapsed'));
        head.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        assert.ok(!section.classList.contains('collapsed'));
        head.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        assert.ok(section.classList.contains('collapsed'));
        assert.strictEqual(head.getAttribute('aria-expanded'), 'false');
    });

    test('actions run without toggling their header on click or keydown', () => {
        const head = document.querySelector<HTMLElement>('#test-last .sb-section-head')!;
        const section = document.getElementById('test-last')!;
        const button = actions.querySelector<HTMLButtonElement>('button')!;
        button.click();
        assert.strictEqual(actionRuns, 1);
        assert.ok(!section.classList.contains('collapsed'));
        button.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.ok(!section.classList.contains('collapsed'));
        head.click();
        assert.ok(section.classList.contains('collapsed'));
    });

    test('ArrowUp and ArrowDown move among headers and stop at ends', () => {
        const activeSection = () => document.activeElement?.closest<HTMLElement>('.sb-section')?.id;
        const first = document.querySelector<HTMLElement>('#test-first .sb-section-head')!;
        const last = document.querySelector<HTMLElement>('#test-last .sb-section-head')!;
        const plain = document.querySelector<HTMLElement>('#test-plain .sb-section-head')!;
        first.focus();
        first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        assert.strictEqual(activeSection(), 'test-last');
        last.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        assert.strictEqual(activeSection(), 'test-plain');
        plain.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        assert.strictEqual(activeSection(), 'test-plain');
        plain.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        assert.strictEqual(activeSection(), 'test-last');
        first.focus();
        first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        assert.strictEqual(activeSection(), 'test-first');
    });
});

suite('Sidebar resizer', () => {
    let dom: JSDOM;
    let sidebar: Sidebar;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        sidebar = installed.sidebar;
        currentDom = dom;
    });

    teardown(() => {
        cleanupDom();
    });

    test('initializes --sidebar-w to the css default (360px) when nothing is saved', () => {
        sidebar.mount();
        assert.strictEqual(
            dom.window.document.documentElement.style.getPropertyValue('--sidebar-w'),
            '360px',
        );
    });

    test('restores a saved width from localStorage', () => {
        dom.window.localStorage.setItem('hexScope.sidebarWidth', '640');
        sidebar.mount();
        assert.strictEqual(
            dom.window.document.documentElement.style.getPropertyValue('--sidebar-w'),
            '640px',
        );
    });

    test('drag updates --sidebar-w live and persists on mouseup', () => {
        sidebar.mount();
        const resizer = document.getElementById('sidebar-resizer')!;

        resizer.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, bubbles: true }));
        dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 500, bubbles: true }));
        const live = dom.window.document.documentElement.style.getPropertyValue('--sidebar-w');
        assert.strictEqual(live, '524px', '1024 - 500 - 0 tabsWidth, clamped into [260, 804]');

        dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
        assert.strictEqual(dom.window.localStorage.getItem('hexScope.sidebarWidth'), '524');
        assert.ok(!resizer.classList.contains('dragging'));
        assert.strictEqual(document.body.style.cursor, '');
    });

    test('drag clamps to the minimum width', () => {
        sidebar.mount();
        const resizer = document.getElementById('sidebar-resizer')!;
        resizer.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, bubbles: true }));
        dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientX: 2000, bubbles: true }));
        dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
        assert.strictEqual(dom.window.localStorage.getItem('hexScope.sidebarWidth'), '260');
    });
});
