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
// One shared header/collapse/pane-resize implementation replaces per-panel
// `applyCollapsibleSection` hand-rolling. Panels create a SidebarSections
// at mount, then rewrite only `body(id)` contents; collapse state is kept
// per mounted instance and resets when the panel shell is rebuilt.
//
// PaneView model (VS Code PaneView/SplitView, Extensions-style): each
// section is a resizable pane with a fixed 22px whole-header toggle, an
// independently scrolling body, and a drag sash (`role=separator`) between
// consecutive sections. Collapsed panes stay in DOM order at the 22px header
// (in-place collapse) and expanded panes fill the freed space; sizes stay
// saved so re-expanding restores the last height.

export interface SidebarSectionSpec {
    id: string;
    label: string;
    /** Collapsed on first render; default false. Every section is collapsible. */
    defaultCollapsed?: boolean;
    /** Optional header-action chrome mounted once beside the disclosure (compact controls only). */
    mountActions?: (root: HTMLElement) => void;
}

interface SidebarSectionDom {
    section: HTMLElement;
    body: HTMLElement;
    head: HTMLElement | null;
    label: HTMLElement;
    badge: HTMLElement | null;
}

/** VS Code --pane-header-size: whole-header toggle row height. */
const HEADER_H = 22;
/** Smallest expanded pane keeps a usable body under the header. */
const MIN_PANE = HEADER_H + 60;
const SASH_H = 3;
const SASH_STEP = 10;
const PANE_KEY_PREFIX = 'hexScope.sidebarPanes';

function paneStorageKey(panelId: string, sectionId: string): string {
    return `${PANE_KEY_PREFIX}.${panelId}.${sectionId}`;
}

/** Restore a saved pane px; NaN/<=0 entries are dropped (invalid data self-heals). */
function loadSavedPx(panelId: string, sectionId: string): number | null {
    if (typeof localStorage === 'undefined') { return null; }
    const raw = localStorage.getItem(paneStorageKey(panelId, sectionId));
    if (raw === null) { return null; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        localStorage.removeItem(paneStorageKey(panelId, sectionId));
        return null;
    }
    return Math.max(MIN_PANE, n);
}

function savePanePx(panelId: string, sectionId: string, px: number): void {
    if (typeof localStorage === 'undefined') { return; }
    localStorage.setItem(paneStorageKey(panelId, sectionId), String(px));
}

/** Derive the persistence panel id from the mounted root when it is a `#sbp-*` slot. */
function panelIdFromRoot(root: HTMLElement, idPrefix: string): string {
    if (root.id.startsWith('sbp-')) { return root.id.slice(4); }
    if (root.id.startsWith('s-')) { return root.id.slice(2); }
    return idPrefix;
}

/**
 * Split `free` px among expanded panes. First-time panes (no saved size)
 * claim an equal share, then saved sizes are claimed smallest-first so a
 * re-expanding pane restores its saved height while bigger siblings shrink.
 * Every pane keeps MIN_PANE when the pool allows; the last pane absorbs the
 * remainder so the sum is exact. Degenerate tiny panels floor at MIN_PANE.
 */
function allocatePanes(free: number, panes: ReadonlyArray<{ id: string; saved: number | null }>): Map<string, number> {
    const out = new Map<string, number>();
    const n = panes.length;
    if (n === 0) { return out; }
    const pool = Math.max(free, n * MIN_PANE);
    const equal = Math.floor(pool / n);
    const order = [...panes].sort((a, b) => {
        const aNull = a.saved === null ? 0 : 1;
        const bNull = b.saved === null ? 0 : 1;
        if (aNull !== bNull) { return aNull - bNull; }
        return (a.saved ?? 0) - (b.saved ?? 0);
    });
    let remaining = pool;
    for (const [i, p] of order.entries()) {
        const isLast = i === order.length - 1;
        const max = Math.max(MIN_PANE, remaining - (order.length - i - 1) * MIN_PANE);
        const want = isLast ? remaining
            : p.saved === null ? equal
            : Math.max(MIN_PANE, Math.min(p.saved, remaining));
        out.set(p.id, Math.min(want, max));
        remaining -= out.get(p.id)!;
    }
    return out;
}

export class SidebarSections {
    private readonly idPrefix: string;
    private readonly panelId: string;
    private readonly root: HTMLElement;
    private readonly paneView: HTMLElement;
    private readonly collapsed: Map<string, boolean>;
    /** Per-section pane sizing: `saved` = px to restore on expand (persisted), `px` = last allocated px. */
    private readonly sizing: Map<string, { saved: number | null; px: number }>;
    private readonly dom: Map<string, SidebarSectionDom>;
    private resizeObserver: ResizeObserver | null = null;

    constructor(root: HTMLElement, idPrefix: string, sections: readonly SidebarSectionSpec[], panelId?: string) {
        const seen = new Set<string>();
        for (const spec of sections) {
            if (seen.has(spec.id)) { throw new Error(`SidebarSections: duplicate section id "${spec.id}"`); }
            seen.add(spec.id);
        }
        this.idPrefix = idPrefix;
        this.panelId = panelId ?? panelIdFromRoot(root, idPrefix);
        this.root = root;
        this.collapsed = new Map(sections.map(s => [s.id, s.defaultCollapsed === true]));
        this.sizing = new Map(sections.map(s => [s.id, { saved: loadSavedPx(this.panelId, s.id), px: HEADER_H }]));
        this.dom = new Map();
        this.paneView = document.createElement('div');
        this.paneView.className = 'sb-pane-view';
        const fragment = document.createDocumentFragment();
        sections.forEach((spec, i) => {
            this.dom.set(spec.id, this.buildSection(fragment, spec));
            if (i < sections.length - 1) {
                // Sash belongs to the section below it (divides it from the section above).
                this.buildSash(fragment, spec, sections[i + 1]);
            }
        });
        this.paneView.appendChild(fragment);
        root.appendChild(this.paneView);
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.layout());
            this.resizeObserver.observe(this.paneView);
        }
        root.addEventListener('keydown', this.navigateHeaders);
        this.layout();
    }

    /** Section body root — panels write/rewrite only this. */
    body(id: string): HTMLElement | null {
        return this.dom.get(id)?.body ?? null;
    }

    setLabel(id: string, label: string): void {
        const entry = this.dom.get(id);
        if (!entry) { return; }
        entry.label.textContent = label;
        entry.head?.setAttribute('aria-label', label);
    }

    /** Badge text right of the label; null/empty hides the badge. `danger` adds the danger variant. */
    setBadge(id: string, text: string | null, danger = false): void {
        const entry = this.dom.get(id);
        if (!entry?.badge) { return; }
        entry.badge.textContent = text ?? '';
        entry.badge.hidden = text === null || text === '';
        entry.badge.classList.toggle('sb-badge-danger', danger);
    }

    /**
     * Collapse/expand a section. Panes stay in DOM order (in-place collapse —
     * VS Code model): collapse shrinks flex-basis to the 22px header, expand
     * restores the saved px (or an equal share the first time); the freed
     * space redistributes over all expanded panes.
     */
    setCollapsed(id: string, collapsed: boolean): void {
        const entry = this.dom.get(id);
        if (!entry?.head) { return; }
        this.collapsed.set(id, collapsed);
        entry.section.classList.toggle('collapsed', collapsed);
        entry.head.setAttribute('aria-expanded', String(!collapsed));
        this.layout();
    }

    isCollapsed(id: string): boolean {
        return this.collapsed.get(id) ?? false;
    }

    /** Recomputed allocation/distribution; the flex-basis transition animates the change. */
    private layout(): void {
        const height = this.paneView.clientHeight;
        if (height <= 0) { return; } // hidden panel (display:none tab) — leave bases alone
        const ids = [...this.dom.keys()];
        const expanded = ids.filter(id => !this.collapsed.get(id));
        const collapsedCount = ids.length - expanded.length;
        // All dividers stay in the flex column (they double as the 3px divider line).
        const free = Math.max(0, height - collapsedCount * HEADER_H - (ids.length - 1) * SASH_H);
        const alloc = allocatePanes(free, expanded.map(id => ({ id, saved: this.sizing.get(id)!.saved })));
        for (const id of ids) {
            const st = this.sizing.get(id)!;
            const px = this.collapsed.get(id) ? HEADER_H : alloc.get(id)!;
            st.px = px;
            if (!this.collapsed.get(id)) {
                // Persist only once a user has set the size (saved !== null); first-time
                // default shares stay in-memory until the first drag/expand.
                if (st.saved !== null && st.saved !== px) {
                    savePanePx(this.panelId, id, px);
                }
                st.saved = px;
            }
            this.dom.get(id)!.section.style.flexBasis = `${px}px`;
        }
    }

    /** Section id for a `.sb-section` element (ids become `<idPrefix>-<sectionId>`). */
    private sectionIdOf(el: HTMLElement | null): string | null {
        if (!el?.classList.contains('sb-section')) { return null; }
        const id = el.id;
        return id.startsWith(`${this.idPrefix}-`) ? id.slice(this.idPrefix.length + 1) : null;
    }

    /** The expanded sections directly above/below a sash, or null when either side is collapsed. */
    private sashNeighbors(sash: HTMLElement): { above: HTMLElement; below: HTMLElement } | null {
        const above = sash.previousElementSibling as HTMLElement | null;
        const below = sash.nextElementSibling as HTMLElement | null;
        const aboveId = this.sectionIdOf(above);
        const belowId = this.sectionIdOf(below);
        if (aboveId === null || belowId === null) { return null; }
        if (this.collapsed.get(aboveId) || this.collapsed.get(belowId)) { return null; }
        return { above: above as HTMLElement, below: below as HTMLElement };
    }

    /** Resize the pane above a sash by `delta` px; the pane below absorbs the delta. */
    private shiftPane(above: HTMLElement, below: HTMLElement, delta: number): void {
        const aboveId = this.sectionIdOf(above);
        const belowId = this.sectionIdOf(below);
        if (aboveId === null || belowId === null) { return; }
        const a = this.sizing.get(aboveId)!;
        const b = this.sizing.get(belowId)!;
        if (this.collapsed.get(aboveId) || this.collapsed.get(belowId)) { return; }
        const combined = a.px + b.px;
        const na = Math.max(MIN_PANE, Math.min((a.saved ?? a.px) + delta, combined - MIN_PANE));
        a.saved = na;
        b.saved = combined - na;
        savePanePx(this.panelId, aboveId, na);
        savePanePx(this.panelId, belowId, b.saved);
        this.layout();
    }

    /** Double-click: split the two adjacent panes' combined space 50/50. */
    private resetSash(sash: HTMLElement): void {
        const neighbors = this.sashNeighbors(sash);
        const aboveId = this.sectionIdOf(neighbors?.above ?? null);
        const belowId = this.sectionIdOf(neighbors?.below ?? null);
        if (aboveId === null || belowId === null) { return; }
        const a = this.sizing.get(aboveId)!;
        const b = this.sizing.get(belowId)!;
        const combined = a.px + b.px;
        const half = Math.floor(combined / 2);
        a.saved = half;
        b.saved = combined - half;
        savePanePx(this.panelId, aboveId, half);
        savePanePx(this.panelId, belowId, combined - half);
        this.layout();
    }

    private readonly navigateHeaders = (event: KeyboardEvent): void => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') { return; }
        const HTMLElementCtor = this.root.ownerDocument.defaultView?.HTMLElement;
        const head = HTMLElementCtor && event.target instanceof HTMLElementCtor && event.target.matches('.sb-section-head') ? event.target : null;
        if (!head) { return; }
        const heads = [...this.root.querySelectorAll<HTMLElement>('.sb-section-head')];
        const next = heads[heads.indexOf(head) + (event.key === 'ArrowUp' ? -1 : 1)];
        if (!next) { return; }
        event.preventDefault();
        next.focus();
    };

    /**
     * One pane: `<section class="sb-section sb-pane">` with the whole-header
     * toggle (role=button, aria-expanded/aria-controls), decorative chevron,
     * and a `role=region` body that scrolls itself.
     */
    private buildSection(fragment: DocumentFragment, spec: SidebarSectionSpec): SidebarSectionDom {
        const section = document.createElement('section');
        section.className = 'sb-section sb-pane';
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

        const initial = this.collapsed.get(spec.id) ?? false;
        head.setAttribute('role', 'button');
        head.tabIndex = 0;
        head.setAttribute('aria-controls', body.id);
        head.setAttribute('aria-expanded', String(!initial));
        head.setAttribute('aria-label', spec.label);
        section.classList.toggle('collapsed', initial);
        const chevron = document.createElement('span');
        chevron.className = 'sb-section-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        // Header-row sibling before the title (VS Code .twisty-container):
        // reads "▸ Section Name".
        head.appendChild(chevron);
        head.addEventListener('click', event => {
            if (!(event.target as HTMLElement).closest('.sb-section-actions')) {
                this.setCollapsed(spec.id, !this.isCollapsed(spec.id));
            }
        });
        head.addEventListener('keydown', event => {
            if (event.target !== head) { return; }
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.setCollapsed(spec.id, !this.isCollapsed(spec.id));
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                this.setCollapsed(spec.id, true);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                this.setCollapsed(spec.id, false);
            }
        });
        title.appendChild(label);
        head.appendChild(title);

        if (spec.mountActions) {
            const actions = document.createElement('div');
            actions.className = 'sb-section-actions';
            actions.addEventListener('click', event => event.stopPropagation());
            actions.addEventListener('keydown', event => event.stopPropagation());
            head.appendChild(actions);
            spec.mountActions(actions);
        }

        section.appendChild(head);
        section.appendChild(body);
        fragment.appendChild(section);
        return { section, body, head, label, badge };
    }

    /** Divider between two sections: drag / ArrowUp/ArrowDown resize, double-click resets. */
    private buildSash(fragment: DocumentFragment, above: SidebarSectionSpec, below: SidebarSectionSpec): HTMLElement {
        const sash = document.createElement('div');
        sash.className = 'sb-pane-sash';
        sash.setAttribute('role', 'separator');
        sash.setAttribute('aria-orientation', 'vertical');
        sash.tabIndex = 0;
        sash.setAttribute('aria-label', `Resize ${above.label} section`);
        sash.addEventListener('mousedown', event => {
            if (event.button !== 0) { return; }
            const neighbors = this.sashNeighbors(sash);
            if (!neighbors) { return; }
            event.preventDefault();
            sash.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
            let lastY = event.clientY;
            // ponytail: no rAF throttle on mousemove — parity with the sidebar
            // resizer; wrap onMove in requestAnimationFrame if drag jank appears.
            const onMove = (moveEv: MouseEvent): void => {
                const delta = moveEv.clientY - lastY;
                lastY = moveEv.clientY;
                if (delta !== 0) { this.shiftPane(neighbors.above, neighbors.below, delta); }
            };
            const stopDrag = (): void => {
                sash.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', stopDrag);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', stopDrag);
        });
        sash.addEventListener('keydown', event => {
            const neighbors = this.sashNeighbors(sash);
            if (!neighbors) { return; }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                this.shiftPane(neighbors.above, neighbors.below, SASH_STEP);
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.shiftPane(neighbors.above, neighbors.below, -SASH_STEP);
            }
        });
        sash.addEventListener('dblclick', () => this.resetSash(sash));
        fragment.appendChild(sash);
        return sash;
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
