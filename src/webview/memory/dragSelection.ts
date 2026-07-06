type DragSelectionRange = { start: number; end: number };

export function setupMemoryDragSelection(
    currentSelection: () => DragSelectionRange | null,
    applySelection: (start: number, end: number) => void,
): void {
    let dragAnchor: number | null = null;
    document.getElementById('mem-rows')!.addEventListener('mousedown', e => {
        if (e.button !== 0) { return; }
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-addr]');
        if (!el) { return; }
        dragAnchor = parseInt(el.dataset.addr!, 16);
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        dragAnchor = updateDragSelection(e, dragAnchor, currentSelection, applySelection);
    });
    document.addEventListener('mouseup', () => { dragAnchor = null; });
}

function updateDragSelection(
    e: MouseEvent,
    dragAnchor: number | null,
    currentSelection: () => DragSelectionRange | null,
    applySelection: (start: number, end: number) => void,
): number | null {
    if (!hasActiveDragSelection(e, dragAnchor)) { return null; }
    const addr = dragSelectionAddressFromPoint(e);
    if (addr === null) { return dragAnchor; }
    const newStart = Math.min(dragAnchor, addr);
    const newEnd = Math.max(dragAnchor, addr);
    if (isSameSelection(currentSelection(), newStart, newEnd)) { return dragAnchor; }
    applySelection(newStart, newEnd);
    return dragAnchor;
}

function dragSelectionAddressFromPoint(e: MouseEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-addr]');
    if (!el) { return null; }
    const addr = parseInt(el.dataset.addr!, 16);
    return isNaN(addr) ? null : addr;
}

function hasActiveDragSelection(e: MouseEvent, dragAnchor: number | null): dragAnchor is number {
    return dragAnchor !== null && Boolean(e.buttons & 1);
}

function isSameSelection(current: DragSelectionRange | null, start: number, end: number): boolean {
    return current?.start === start && current.end === end;
}
