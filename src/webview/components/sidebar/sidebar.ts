// ── Sidebar component ─────────────────────────────────────────────
// Generic config-driven tabbed sidebar shell: owns #sidebar +
// #side-tabs + #sidebar-resizer markup, tab switching/visibility, the
// resizer drag (with width persistence), and shell styles (Sidebar.css).
// Panels are injected via the `panels` config — this module never
// imports the `S` global, never posts provider messages, and holds no
// feature/panel logic. The host wires panel mounts, the header slot
// (feature-specific chrome like the endian toggle), and per-tab
// activation side effects through callbacks.

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
