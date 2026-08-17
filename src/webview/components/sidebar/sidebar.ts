// ── Sidebar component ─────────────────────────────────────────────
// Generic config-driven tabbed sidebar shell: owns #sidebar +
// #side-tabs + #sidebar-resizer markup, tab switching/visibility, the
// resizer drag (with width persistence), and shell styles (Sidebar.css).
// Panels are injected via the `panels` config — this module never
// imports the `S` global, never posts provider messages, and holds no
// feature/panel logic. The host wires panel mounts, the header slot
// (feature-specific chrome like the endian toggle), and per-tab
// activation side effects through callbacks.
//
// SidebarSections (below) is the shared section-shell primitive: it
// renders section headers (label + collapse disclosure + optional
// header-actions slot) once per mount, and panels write only their
// body content through `body(id)`.

import { esc } from '../../utils';
import './sidebar.css';

export type SidebarTab = 'inspector' | 'struct' | 'integrity' | 'scripts';

export interface SidebarPanel {
    id: SidebarTab;
    label: string;
    /** Renders (or re-renders) the panel's content into its slot root. */
    mount: (root: HTMLElement) => void;
}

export interface SidebarCallbacks {
    /** Tab clicked; host owns S.sidebarTab + per-tab activation side effects. */
    onTabChange?: (tab: SidebarTab) => void;
    /** First activation / re-activation of a tab; host mounts-or-rerenders the lazy panel. */
    onPanelActivate?: (tab: SidebarTab) => void;
}

export interface SidebarOptions {
    panels: SidebarPanel[];
    /** Feature-specific chrome rendered into #sidebar-common-settings (e.g. endian toggle). */
    headerSlot?: (root: HTMLElement) => void;
    cb?: SidebarCallbacks;
}

const SIDEBAR_WIDTH_KEY = 'hexScope.sidebarWidth';
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 900;

function parseSidebarWidth(raw: string | null | undefined): number | null {
    if (!raw) { return null; }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) { return null; }
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, n));
}

/** Clamp a sidebar width to [min, max(min, viewport − tabs − gutter)]. */
function clampResizeWidth(width: number): number {
    const tabs = document.getElementById('side-tabs');
    const tabsWidth = tabs ? tabs.getBoundingClientRect().width : 0;
    const maxAllowed = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - tabsWidth - 220));
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxAllowed, width));
}

function persistSidebarWidth(width: number): void {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
}

export class Sidebar {
    private readonly panels: SidebarPanel[];
    private readonly tabByButtonId: ReadonlyMap<string, SidebarTab>;
    private readonly headerSlot: ((root: HTMLElement) => void) | undefined;
    private cb: SidebarCallbacks;
    private activeTab: SidebarTab | null;
    private mounted = false;

    constructor(options: SidebarOptions) {
        this.panels = options.panels;
        this.headerSlot = options.headerSlot;
        this.cb = options.cb ?? {};
        this.tabByButtonId = new Map(this.panels.map(panel => [`stab-${panel.id}`, panel.id] as const));
        // Default = first configured panel (host passes inspector first).
        this.activeTab = options.panels[0]?.id ?? null;
    }

    setCallbacks(cb: SidebarCallbacks): void {
        this.cb = cb;
    }

    /** Doc-delegated listeners attach once; header slot + width init rerun per full render. */
    mount(): void {
        if (!this.mounted) {
            document.addEventListener('click', this.handleTabClick);
            document.addEventListener('mousedown', this.handleResizeStart);
            document.addEventListener('keydown', this.handleResizeKeydown);
            this.mounted = true;
        }
        this.mountHeaderSlot();
        this.initSidebarWidth();
    }

    /** Active-tab classes + #sbp-* visibility; lazy-activates the panel on tab change. */
    setTab(tab: SidebarTab): void {
        if (this.activeTab === tab) { return; }
        this.activeTab = tab;
        this.paintTabState();
        this.cb.onPanelActivate?.(tab);
    }

    /** Full shell markup regenerated from the panels config. */
    toHtml(): string {
        const panelHtml = this.panels
            .map(panel => `<div class="${this.tabPanelClass(panel.id)}" id="sbp-${esc(panel.id)}"></div>`)
            .join('');
        const tabsHtml = this.panels
            .map(panel => `<button class="${this.tabClass(panel.id)}" id="stab-${esc(panel.id)}">${esc(panel.label)}</button>`)
            .join('');
        return `
        <div id="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" title="Drag to resize sidebar" tabindex="0"></div>
        <div id="sidebar">
            <div id="sidebar-common-settings"></div>
            ${panelHtml}
        </div>
        <div id="side-tabs">
            ${tabsHtml}
        </div>`;
    }

    // ── Tab switching ───────────────────────────────────────────

    private readonly handleTabClick = (ev: Event): void => {
        const tab = this.tabFromEvent(ev);
        if (tab !== null) {
            this.setTab(tab);
            this.cb.onTabChange?.(tab);
        }
    };

    private tabFromEvent(ev: Event): SidebarTab | null {
        const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.stab');
        if (!btn) { return null; }
        return this.tabByButtonId.get(btn.id) ?? null;
    }

    private paintTabState(): void {
        for (const panel of this.panels) {
            const isActive = panel.id === this.activeTab;
            document.getElementById(`sbp-${panel.id}`)?.classList.toggle('active', isActive);
            document.getElementById(`stab-${panel.id}`)?.classList.toggle('active', isActive);
        }
    }

    private tabPanelClass(tab: SidebarTab): string {
        return tab === this.activeTab ? 'sb-tab-panel active' : 'sb-tab-panel';
    }

    private tabClass(tab: SidebarTab): string {
        return tab === this.activeTab ? 'stab active' : 'stab';
    }

    // ── Header slot ─────────────────────────────────────────────

    private mountHeaderSlot(): void {
        if (!this.headerSlot) { return; }
        const root = document.getElementById('sidebar-common-settings');
        if (!root) { return; }
        this.headerSlot(root);
    }

    // ── Resizer ─────────────────────────────────────────────────

    private currentCssWidth(): number {
        return parseSidebarWidth(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) ?? 360;
    }

    private initSidebarWidth(): void {
        const root = document.documentElement;
        const savedWidth = parseSidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY));
        const sidebarWidth = savedWidth ?? this.currentCssWidth();
        root.style.setProperty('--sidebar-w', `${sidebarWidth}px`);
    }

    private readonly handleResizeStart = (ev: MouseEvent): void => {
        if (ev.button !== 0) { return; }
        const resizer = (ev.target as HTMLElement | null)?.closest<HTMLElement>('#sidebar-resizer');
        if (!resizer) { return; }
        ev.preventDefault();

        let sidebarWidth = this.currentCssWidth();
        let dragging = true;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = (moveEv: MouseEvent): void => {
            if (!dragging) { return; }
            const tabs = document.getElementById('side-tabs');
            const tabsWidth = tabs ? tabs.getBoundingClientRect().width : 0;
            sidebarWidth = clampResizeWidth(window.innerWidth - moveEv.clientX - tabsWidth);
            document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`);
        };
        const stopDrag = (): void => {
            if (!dragging) { return; }
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            persistSidebarWidth(sidebarWidth);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', stopDrag);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', stopDrag);
    };

    /** Arrow keys resize the sidebar while the resizer is focused (a11y parity with drag). */
    private readonly handleResizeKeydown = (e: KeyboardEvent): void => {
        const resizer = (e.target as HTMLElement | null)?.closest<HTMLElement>('#sidebar-resizer');
        const delta = resizer ? resizeKeyDelta(e.key) : 0;
        if (delta === 0) { return; }
        e.preventDefault();
        const closed = clampResizeWidth(this.currentCssWidth() + delta);
        document.documentElement.style.setProperty('--sidebar-w', `${closed}px`);
        persistSidebarWidth(closed);
    };
}

/** Pixel delta for a resize arrow key, or 0 when the key is not a resize arrow. */
function resizeKeyDelta(key: string): number {
    return key === 'ArrowLeft' ? -16 : key === 'ArrowRight' ? 16 : 0;
}

// ── Section shell framework ────────────────────────────────────────
// One shared header/collapse implementation replaces per-panel
// `applyCollapsibleSection` hand-rolling. Panels create a SidebarSections
// at mount, then rewrite only `body(id)` contents; collapse state is kept
// per mounted instance and resets when the panel shell is rebuilt.

export interface SidebarSectionSpec {
    id: string;
    label: string;
    /** Collapsed on first render (collapsible sections only); default false. */
    defaultCollapsed?: boolean;
    /** True by default; false renders a plain non-disclosure header (body always visible). */
    collapsible?: boolean;
    /** Optional header-action chrome mounted once beside the disclosure (compact controls only). */
    mountActions?: (root: HTMLElement) => void;
}

interface SidebarSectionDom {
    section: HTMLElement;
    body: HTMLElement;
    toggle: HTMLButtonElement | null;
    label: HTMLElement;
    badge: HTMLElement | null;
}

export class SidebarSections {
    private readonly idPrefix: string;
    private readonly root: HTMLElement;
    /** Optional bottom-dock reparent target for collapsed non-first sections. */
    private readonly dockContainer: HTMLElement | null;
    private readonly collapsed: Map<string, boolean>;
    private readonly dom: Map<string, SidebarSectionDom>;
    /** Original insertion index per section id (dock restore target slot). */
    private readonly order: Map<string, number>;

    constructor(root: HTMLElement, idPrefix: string, sections: readonly SidebarSectionSpec[], dockContainer?: HTMLElement) {
        const seen = new Set<string>();
        for (const spec of sections) {
            if (seen.has(spec.id)) { throw new Error(`SidebarSections: duplicate section id "${spec.id}"`); }
            seen.add(spec.id);
        }
        this.idPrefix = idPrefix;
        this.root = root;
        this.dockContainer = dockContainer ?? null;
        this.collapsed = new Map(sections.map(s => [s.id, s.collapsible !== false && s.defaultCollapsed === true]));
        this.dom = new Map();
        this.order = new Map();
        const fragment = document.createDocumentFragment();
        sections.forEach((spec, index) => {
            this.order.set(spec.id, index);
            this.dom.set(spec.id, this.buildSection(fragment, spec));
        });
        root.appendChild(fragment);
        if (this.dockContainer) {
            root.appendChild(this.dockContainer);
            // Default-collapsed sections start docked.
            for (const [id, collapsed] of this.collapsed) {
                if (collapsed) { this.moveForCollapse(id, true); }
            }
            this.syncDock();
        }
    }

    /** Section body root — panels write/rewrite only this. */
    body(id: string): HTMLElement | null {
        return this.dom.get(id)?.body ?? null;
    }

    setLabel(id: string, label: string): void {
        const entry = this.dom.get(id);
        if (!entry) { return; }
        entry.label.textContent = label;
    }

    /** Badge text right of the label; null/empty hides the badge. `danger` adds the danger variant. */
    setBadge(id: string, text: string | null, danger = false): void {
        const entry = this.dom.get(id);
        if (!entry?.badge) { return; }
        entry.badge.textContent = text ?? '';
        entry.badge.hidden = text === null || text === '';
        entry.badge.classList.toggle('sb-badge-danger', danger);
    }

    /** Collapse/expand a collapsible section (no-op for non-collapsible headers). */
    setCollapsed(id: string, collapsed: boolean): void {
        const entry = this.dom.get(id);
        if (!entry?.toggle) { return; }
        this.collapsed.set(id, collapsed);
        entry.section.classList.toggle('collapsed', collapsed);
        entry.toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        this.moveForCollapse(id, collapsed);
    }

    isCollapsed(id: string): boolean {
        return this.collapsed.get(id) ?? false;
    }

    /**
     * Bottom-dock support: a collapsed non-first section reparents into the
     * dock container (compact pill); expanding restores its original slot.
     * The first section (original index 0) never docks — panels without a
     * dockContainer keep the plain stacked behavior unchanged.
     */
    private moveForCollapse(id: string, collapsed: boolean): void {
        const dock = this.dockContainer;
        const entry = this.dom.get(id);
        const index = this.order.get(id) ?? 0;
        if (!dock || !entry || index === 0) { return; }
        const section = entry.section;
        if (collapsed && section.parentNode !== dock) {
            section.classList.add('docked');
            dock.appendChild(section);
        } else if (!collapsed && section.parentNode !== this.root) {
            section.classList.remove('docked');
            this.restoreToSlot(section, index);
        }
        this.syncDock();
    }

    /** Reinsert a docked section before its next non-docked sibling in original order. */
    private restoreToSlot(section: HTMLElement, index: number): void {
        const next = [...this.order.entries()]
            .filter(([, i]) => i > index)
            .map(([id]) => this.dom.get(id)?.section)
            .find(s => s !== undefined && s.parentNode === this.root);
        this.root.insertBefore(section, next ?? this.dockContainer);
    }

    private syncDock(): void {
        const dock = this.dockContainer;
        if (!dock) { return; }
        dock.hidden = dock.childElementCount === 0;
    }

    /** Build one `<section class="sb-section">` shell and append it to `fragment`. */
    private buildSection(fragment: DocumentFragment, spec: SidebarSectionSpec): SidebarSectionDom {
        const section = document.createElement('section');
        section.className = 'sb-section';
        section.id = `${this.idPrefix}-${spec.id}`;

        const head = document.createElement('div');
        head.className = 'sb-section-head';

        const title = document.createElement('h3');
        title.className = 'sb-section-title';
        title.id = `${this.idPrefix}-${spec.id}-title`;

        const label = document.createElement('span');
        label.className = 'sb-section-label';
        label.textContent = spec.label;

        const badge = document.createElement('span');
        badge.className = 'sb-badge';
        badge.hidden = true;
        label.appendChild(badge);

        const body = document.createElement('div');
        body.className = 'sb-body';
        body.id = `${this.idPrefix}-${spec.id}-body`;
        body.setAttribute('role', 'region');
        body.setAttribute('aria-labelledby', title.id);

        let toggle: HTMLButtonElement | null = null;
        if (spec.collapsible !== false) {
            toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'sb-section-toggle';
            toggle.setAttribute('aria-controls', body.id);
            const initial = this.collapsed.get(spec.id) ?? false;
            section.classList.toggle('collapsed', initial);
            toggle.setAttribute('aria-expanded', initial ? 'false' : 'true');
            toggle.addEventListener('click', () => this.setCollapsed(spec.id, !this.isCollapsed(spec.id)));
            toggle.appendChild(label);
            title.appendChild(toggle);
        } else {
            title.appendChild(label);
        }
        head.appendChild(title);

        if (spec.mountActions) {
            const actions = document.createElement('div');
            actions.className = 'sb-section-actions';
            head.appendChild(actions);
            spec.mountActions(actions);
        }

        section.appendChild(head);
        section.appendChild(body);
        fragment.appendChild(section);
        return { section, body, toggle, label, badge };
    }
}

// ── Shared popover-menu wiring ────────────────────────────────────
// One implementation of open/close, Escape, click-outside and
// aria-expanded for every sidebar popover menu (struct card ⋮, struct
// field context menu, integrity profile menu). All live popups share a
// single per-document click listener, so re-mounts never stack handlers.

export interface MenuPopupOptions {
    /** Anchor button; aria-expanded is synced to the popup's open state. Omit for unanchored context menus. */
    button?: HTMLButtonElement;
    /** Clicks inside this element never close the popup. Defaults to the popup itself. */
    root?: HTMLElement;
    /** Focus selector for the first item when the popup opens (e.g. '.menu-item:not(:disabled)'). */
    focusFirst?: string;
    /** Called whenever the popup closes (any reason). */
    onClose?: () => void;
}

interface MenuPopupEntry {
    pop: HTMLElement;
    root: HTMLElement;
    button: HTMLButtonElement | null;
    focusFirst: string | null;
    onClose: (() => void) | null;
}

const popupRegistry = new Map<HTMLElement, MenuPopupEntry>();
const popupClickDocs = new WeakSet<Document>();

/** Register one click-outside listener per document; later wires reuse it. */
function ensurePopupDocClick(doc: Document): void {
    if (popupClickDocs.has(doc)) { return; }
    popupClickDocs.add(doc);
    doc.addEventListener('click', (e: Event) => {
        const target = e.target as Node | null;
        for (const [pop, entry] of [...popupRegistry]) {
            if (!pop.isConnected) { popupRegistry.delete(pop); continue; }
            if (pop.hidden) { continue; }
            if (target && entry.root.contains(target)) { continue; }
            closeMenuPopup(pop);
        }
    });
}

/** Open a wired popup: show, sync aria-expanded, focus first item. */
export function openMenuPopup(pop: HTMLElement): void {
    const entry = popupRegistry.get(pop);
    if (!entry) { return; }
    pop.hidden = false;
    entry.button?.setAttribute('aria-expanded', 'true');
    if (entry.focusFirst) { pop.querySelector<HTMLElement>(entry.focusFirst)?.focus(); }
}

/** Close a wired popup: hide, sync aria-expanded, run onClose. */
export function closeMenuPopup(pop: HTMLElement): void {
    const entry = popupRegistry.get(pop);
    if (!entry) { return; }
    pop.hidden = true;
    entry.button?.setAttribute('aria-expanded', 'false');
    entry.onClose?.();
}

/** Toggle a wired popup's open state. */
export function toggleMenuPopup(pop: HTMLElement): void {
    if (pop.hidden) { openMenuPopup(pop); } else { closeMenuPopup(pop); }
}

/** Wire a popup into the shared menu machinery; returns a detach function. */
export function wireMenuPopup(pop: HTMLElement, opts: MenuPopupOptions = {}): () => void {
    popupRegistry.set(pop, {
        pop,
        root: opts.root ?? pop,
        button: opts.button ?? null,
        focusFirst: opts.focusFirst ?? null,
        onClose: opts.onClose ?? null,
    });
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            closeMenuPopup(pop);
            opts.button?.focus();
        }
    };
    pop.addEventListener('keydown', onKey);
    ensurePopupDocClick(pop.ownerDocument ?? document);
    return () => {
        pop.removeEventListener('keydown', onKey);
        popupRegistry.delete(pop);
    };
}
