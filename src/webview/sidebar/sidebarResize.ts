const SIDEBAR_WIDTH_KEY = 'hexScope.sidebarWidth';
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 900;

function parseSidebarWidth(raw: string | null | undefined): number | null {
    if (!raw) { return null; }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) { return null; }
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, n));
}

export function setupSidebarResize(): void {
    const root = document.documentElement;
    const cssDefaultWidth = parseSidebarWidth(getComputedStyle(root).getPropertyValue('--sidebar-w')) ?? 360;
    const savedWidth = parseSidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    let sidebarWidth = savedWidth ?? cssDefaultWidth;
    root.style.setProperty('--sidebar-w', `${sidebarWidth}px`);

    const sidebarResizer = document.getElementById('sidebar-resizer');
    if (!sidebarResizer) { return; }

    let dragging = false;
    const onMove = (ev: MouseEvent) => {
        if (!dragging) { return; }
        const tabs = document.getElementById('side-tabs');
        const tabsWidth = tabs ? tabs.getBoundingClientRect().width : 0;
        const maxAllowed = Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth - tabsWidth - 220);
        sidebarWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxAllowed, window.innerWidth - ev.clientX - tabsWidth));
        root.style.setProperty('--sidebar-w', `${sidebarWidth}px`);
    };
    const stopDrag = () => {
        if (!dragging) { return; }
        dragging = false;
        sidebarResizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', stopDrag);
    };

    sidebarResizer.addEventListener('mousedown', ev => {
        if (ev.button !== 0) { return; }
        dragging = true;
        sidebarResizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', stopDrag);
        ev.preventDefault();
    });
}
