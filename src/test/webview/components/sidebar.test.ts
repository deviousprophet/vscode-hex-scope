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
            { id: 'plain', label: 'Plain' },
        ]);
    });

    teardown(() => {
        dom.window.close();
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    });

    test('every section uses whole-header semantics (all collapsible)', () => {
        const heads = document.querySelectorAll<HTMLElement>('#test-first .sb-section-head, #test-last .sb-section-head, #test-plain .sb-section-head');
        assert.strictEqual(heads.length, 3);
        for (const head of heads) {
            assert.strictEqual(head.getAttribute('role'), 'button');
            assert.strictEqual(head.tabIndex, 0);
            assert.strictEqual(head.getAttribute('aria-expanded'), 'true');
            assert.ok(head.getAttribute('aria-label'));
            assert.strictEqual(head.querySelector('.sb-section-chevron')?.getAttribute('aria-hidden'), 'true');
        }
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

suite('SidebarSections pane view', () => {
    let dom: JSDOM;
    let root: HTMLElement;
    let sections: SidebarSections;

    const PANEL_ID = 'panetest';

    setup(() => {
        dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hexscope.test/' });
        const g = globalThis as unknown as Globalish;
        g.window = dom.window as unknown as Window;
        g.document = dom.window.document as unknown as Document;
        g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
        g.localStorage = dom.window.localStorage;
        root = document.body.appendChild(document.createElement('div'));
    });

    teardown(() => {
        dom.window.close();
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    });

    function mount(idsAndLabels: Array<[string, string]>, height = 300): void {
        sections = new SidebarSections(root, 'test', idsAndLabels.map(([id, label]) => ({ id, label })), PANEL_ID);
        // jsdom reports clientHeight 0; give the pane-view a real height so
        // layout() distributes instead of bailing out, then force a layout.
        Object.defineProperty(root.querySelector<HTMLElement>('.sb-pane-view')!, 'clientHeight', {
            value: height,
            configurable: true,
        });
        sections.setCollapsed(idsAndLabels[0][0], false);
    }

    function pane(id: string): HTMLElement {
        return document.getElementById(`test-${id}`)!;
    }

    function basis(id: string): number {
        return parseFloat(pane(id).style.flexBasis);
    }

    function paneOrder(): string[] {
        return [...root.querySelectorAll<HTMLElement>('.sb-pane-view > .sb-section')].map(el => el.id.slice('test-'.length));
    }

    function sashes(): HTMLElement[] {
        return [...root.querySelectorAll<HTMLElement>('.sb-pane-view > .sb-pane-sash')];
    }

    function dragSash(sash: HTMLElement, dy: number): void {
        sash.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, clientY: 0, bubbles: true }));
        dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientY: dy, bubbles: true }));
        dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
    }

    test('renders a split container with one sash between consecutive sections', () => {
        mount([['first', 'First'], ['second', 'Second'], ['third', 'Third']]);
        const view = root.querySelector<HTMLElement>('.sb-pane-view')!;
        assert.ok(view, 'renders .sb-pane-view');
        assert.strictEqual(view.querySelectorAll('.sb-section.sb-pane').length, 3, 'sections carry sb-pane');
        const sashEls = sashes();
        assert.strictEqual(sashEls.length, 2, 'sashes = sections - 1');
        assert.strictEqual(sashEls[0].getAttribute('role'), 'separator');
        assert.strictEqual(sashEls[0].getAttribute('aria-orientation'), 'vertical');
        assert.strictEqual(sashEls[0].tabIndex, 0);
        assert.strictEqual(sashEls[0].getAttribute('aria-label'), 'Resize First section');
        // Sashes are direct children between their sections.
        assert.strictEqual(sashEls[0].previousElementSibling?.id, 'test-first');
        assert.strictEqual(sashEls[0].nextElementSibling?.id, 'test-second');
        assert.strictEqual(sashEls[1].previousElementSibling?.id, 'test-second');
    });

    test('single-section panel: one pane fills, no sash', () => {
        mount([['only', 'Only']]);
        assert.strictEqual(sashes().length, 0);
        assert.ok(pane('only').classList.contains('sb-pane'));
    });

    test('first mount distributes free space equally among expanded panes', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        assert.strictEqual(basis('first') + basis('second'), 294, 'height minus one sash');
        assert.ok(Math.abs(basis('first') - basis('second')) <= 1, '50/50 default split');
    });

    test('collapsing keeps the pane in place at 22px and grows the sibling', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        const before = basis('second');
        sections.setCollapsed('first', true);
        assert.deepStrictEqual(paneOrder(), ['first', 'second'], 'pane stays in DOM order (in-place collapse)');
        assert.ok(pane('first').classList.contains('collapsed'));
        assert.strictEqual(basis('first'), 22, 'collapsed basis = header height');
        assert.ok(basis('second') > before, 'expanded sibling grows into the freed space');
        assert.strictEqual(document.querySelector<HTMLElement>('#test-first .sb-section-head')!.getAttribute('aria-expanded'), 'false');
    });

    test('expand keeps in-place order; sash is disabled next to a collapsed pane', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        sections.setCollapsed('first', true);
        // Collapsed neighbor → sash is inert.
        const sash = sashes()[0];
        assert.ok(sash.classList.contains('disabled'), 'sash next to a collapsed pane is inert');
        assert.strictEqual(sash.getAttribute('aria-disabled'), 'true');
        assert.strictEqual(sash.tabIndex, -1, 'disabled sash leaves the tab order');

        sections.setCollapsed('first', false);
        assert.deepStrictEqual(paneOrder(), ['first', 'second'], 'no reorder across a collapse/expand cycle');
        assert.strictEqual(sash.previousElementSibling?.id, 'test-first');
        assert.strictEqual(sash.nextElementSibling?.id, 'test-second');
        assert.ok(!sash.classList.contains('disabled'), 'both expanded → sash enabled');
        assert.strictEqual(sash.getAttribute('aria-disabled'), null);
        assert.strictEqual(sash.tabIndex, 0, 'sash back in the tab order');
        assert.strictEqual(sash.getAttribute('aria-label'), 'Resize First section', 'label references the pane above the sash');
    });

    test('collapsing a middle section disables both adjacent sashes; expanding re-enables', () => {
        mount([['first', 'First'], ['second', 'Second'], ['third', 'Third']], 400);
        sections.setCollapsed('second', true);
        const sashEls = sashes();
        assert.ok(sashEls[0].classList.contains('disabled'), 'sash above the collapsed middle is inert');
        assert.ok(sashEls[1].classList.contains('disabled'), 'sash below the collapsed middle is inert');
        sections.setCollapsed('second', false);
        assert.ok(!sashEls[0].classList.contains('disabled'));
        assert.ok(!sashEls[1].classList.contains('disabled'));
        assert.ok(sashEls[0].tabIndex === 0 && sashEls[1].tabIndex === 0);
    });

    test('collapsing a middle section keeps DOM order', () => {
        mount([['first', 'First'], ['second', 'Second'], ['third', 'Third']], 400);
        sections.setCollapsed('second', true);
        assert.deepStrictEqual(paneOrder(), ['first', 'second', 'third'], 'middle pane stays in place');
        sections.setCollapsed('second', false);
        assert.deepStrictEqual(paneOrder(), ['first', 'second', 'third']);
        const sashEls = sashes();
        assert.strictEqual(sashEls[0].getAttribute('aria-label'), 'Resize First section');
        assert.strictEqual(sashEls[1].getAttribute('aria-label'), 'Resize Second section');
    });

    test('expand restores the saved height; sibling shrinks', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        sections.setCollapsed('first', true);
        const grew = basis('second');
        sections.setCollapsed('first', false);
        assert.ok(!pane('first').classList.contains('collapsed'));
        assert.strictEqual(basis('first'), 147, 'restores the px it had before collapsing');
        assert.strictEqual(basis('second'), 147, 'sibling shrinks back proportionally');
        assert.strictEqual(basis('second') + basis('first'), 294, 'total unchanged');
    });

    test('sash drag moves the pane above and the pane below absorbs, clamped', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        const beforeA = basis('first');
        const beforeB = basis('second');
        dragSash(sashes()[0], 40);
        assert.strictEqual(basis('first'), beforeA + 40, 'above pane grows by the delta');
        assert.strictEqual(basis('second'), beforeB - 40, 'below pane absorbs the delta');
        // Clamp: growing beyond (combined - MIN_PANE) leaves the below pane at MIN_PANE.
        dragSash(sashes()[0], 10000);
        assert.strictEqual(basis('first'), beforeA + beforeB - 82, 'above clamped so below keeps MIN_PANE');
        assert.strictEqual(basis('second'), 82);
    });

    test('first-time expand splits evenly even when a sibling filled the space', () => {
        sections = new SidebarSections(root, 'test', [
            { id: 'first', label: 'First' },
            { id: 'second', label: 'Second', defaultCollapsed: true },
        ], PANEL_ID);
        Object.defineProperty(root.querySelector<HTMLElement>('.sb-pane-view')!, 'clientHeight', {
            value: 300,
            configurable: true,
        });
        sections.setCollapsed('first', false);
        assert.strictEqual(basis('second'), 22, 'second starts collapsed');
        assert.ok(basis('first') > 250, 'first alone fills the space');
        sections.setCollapsed('second', false);
        assert.ok(Math.abs(basis('first') - basis('second')) <= 1, 'first-time expand defaults to an even split');
        assert.strictEqual(basis('first') + basis('second'), 294, 'total unchanged (height minus one sash)');
    });

    test('first-time expand keeps a persisted sibling size (no even-re-split of user sizes)', () => {
        const key = 'hexScope.sidebarPanes.panetest.first';
        localStorage.setItem(key, '350');
        sections = new SidebarSections(root, 'test', [
            { id: 'first', label: 'First' },
            { id: 'second', label: 'Second', defaultCollapsed: true },
        ], PANEL_ID);
        Object.defineProperty(root.querySelector<HTMLElement>('.sb-pane-view')!, 'clientHeight', {
            value: 400,
            configurable: true,
        });
        sections.setCollapsed('first', false);
        assert.strictEqual(basis('second'), 22, 'second starts collapsed');
        sections.setCollapsed('second', false);
        // First is user-persisted (350) but the free space only allows 312;
        // it must NOT collapse to an even 50/50, and second takes its min floor.
        assert.strictEqual(basis('second'), 82, 'second lands at the min floor');
        assert.strictEqual(basis('first'), 400 - 6 - 82, 'persisted sibling keeps its size (clamped to space)');
    });

    test('reopen restores a user-resized size; untouched panes reopen evenly (no min-floor)', () => {
        sections = new SidebarSections(root, 'test', [
            { id: 'first', label: 'First' },
            { id: 'second', label: 'Second', defaultCollapsed: true },
        ], PANEL_ID);
        Object.defineProperty(root.querySelector<HTMLElement>('.sb-pane-view')!, 'clientHeight', {
            value: 300,
            configurable: true,
        });
        sections.setCollapsed('first', false);
        // Untouched panes: expanding the collapsed one splits evenly (50/50), not MIN.
        sections.setCollapsed('second', false);
        assert.ok(Math.abs(basis('first') - basis('second')) <= 1, 'untouched panes reopen evenly');
        // User resize (drag the sash up) grows the pane below it (second).
        dragSash(sashes()[0], -60);
        const resized = basis('second');
        assert.ok(resized > basis('first'), 'resize grew second beyond first');
        // Collapse → reopen: restored, NOT the min floor.
        sections.setCollapsed('second', true);
        sections.setCollapsed('second', false);
        assert.strictEqual(basis('second'), resized, 'reopen restores the resized size, not MIN');
        assert.strictEqual(basis('first') + basis('second'), 294, 'total unchanged');
    });

    test('sash drag writes to localStorage only on release', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        const keyA = 'hexScope.sidebarPanes.panetest.first';
        const keyB = 'hexScope.sidebarPanes.panetest.second';
        const sash = sashes()[0];
        sash.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, clientY: 0, bubbles: true }));
        dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { clientY: 40, bubbles: true }));
        assert.strictEqual(localStorage.getItem(keyA), null, 'no storage write mid-drag');
        assert.strictEqual(localStorage.getItem(keyB), null);
        dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
        assert.ok(localStorage.getItem(keyA) !== null, 'persisted once on release');
        assert.ok(localStorage.getItem(keyB) !== null);
    });

    test('sash drag toggles the no-transition dragging state on the pane view', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        const view = root.querySelector<HTMLElement>('.sb-pane-view')!;
        const sash = sashes()[0];
        sash.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 0, clientY: 0, bubbles: true }));
        assert.ok(view.classList.contains('dragging'), 'transition disabled while dragging');
        dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
        assert.ok(!view.classList.contains('dragging'), 'transition restored after drag');
    });

    test('sash ArrowUp/ArrowDown resize by 10px; double-click resets to 50/50', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        const sash = sashes()[0];
        // DOM order after mount: [first, sash, second]. The sash resizes the pane
        // above it (first). Collapse round-trip below uses the pack order instead.
        const beforeA = basis('first');
        const beforeB = basis('second');
        sash.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        assert.strictEqual(basis('first'), beforeA + 10, 'ArrowUp grows the pane above the sash');
        assert.strictEqual(basis('second'), beforeB - 10, 'below absorbs the same 10px');
        sash.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        assert.strictEqual(basis('first'), beforeA, 'ArrowDown shrinks it back');
        sash.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
        assert.ok(Math.abs(basis('first') - basis('second')) <= 1, 'double-click splits 50/50');
    });

    test('sizes persist to localStorage on resize and restore across mounts', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        dragSash(sashes()[0], 40);
        assert.strictEqual(dom.window.localStorage.getItem('hexScope.sidebarPanes.panetest.first'), '187');
        assert.strictEqual(dom.window.localStorage.getItem('hexScope.sidebarPanes.panetest.second'), '107');
        // Fresh mount with the persisted sizes restores them.
        root.innerHTML = '';
        mount([['first', 'First'], ['second', 'Second']], 300);
        assert.strictEqual(basis('first'), 187);
        assert.strictEqual(basis('second'), 107);
    });

    test('restore clamps out-of-range values and drops malformed entries', () => {
        dom.window.localStorage.setItem('hexScope.sidebarPanes.panetest.first', '9999'); // clamped on layout
        dom.window.localStorage.setItem('hexScope.sidebarPanes.panetest.second', 'abc'); // dropped as invalid
        mount([['first', 'First'], ['second', 'Second']], 300);
        assert.strictEqual(basis('first'), 212, 'oversized persisted px clamps to the pool minus the other pane\'s min');
        assert.strictEqual(basis('second'), 82, 'malformed entry falls back to the min floor');
        assert.strictEqual(dom.window.localStorage.getItem('hexScope.sidebarPanes.panetest.second'), null, 'invalid key removed');
        assert.strictEqual(dom.window.localStorage.getItem('hexScope.sidebarPanes.panetest.first'), '9999', 'oversized key stays raw in storage (display clamps each layout)');
    });

    test('collapse keeps the last expanded sizes for re-expand across reloads', () => {
        mount([['first', 'First'], ['second', 'Second']], 300);
        dragSash(sashes()[0], 40); // first=187, second=107 persisted
        sections.setCollapsed('first', true);
        assert.strictEqual(dom.window.localStorage.getItem('hexScope.sidebarPanes.panetest.first'), '187', 'collapse keeps the last expanded px');
        assert.strictEqual(dom.window.localStorage.getItem('hexScope.sidebarPanes.panetest.second'), '107', 'grown sibling growth is display-only, not persisted');
        root.innerHTML = '';
        mount([['first', 'First'], ['second', 'Second']], 300);
        sections.setCollapsed('first', true); // restore keeps saved px across reloads
        sections.setCollapsed('first', false);
        assert.strictEqual(basis('first'), 187, 're-expand after reload restores the saved px');
        assert.strictEqual(basis('second'), 107);
    });
});
