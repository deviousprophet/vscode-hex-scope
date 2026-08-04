import { S } from './state';

function inMemoryView(): boolean {
    return S.currentView === 'memory';
}

function editControlsVisible(): boolean {
    return inMemoryView() && S.editMode;
}

function editButtonVisible(): boolean {
    return inMemoryView() && !S.editMode;
}

export function updateEditControls(): void {
    document.getElementById('btn-edit-mode')!.style.display = editButtonVisible() ? '' : 'none';
    document.getElementById('edit-mode-group')!.style.display = editControlsVisible() ? '' : 'none';
}

export function updateDirtyBar(): void {
    const count = S.edits.size;
    const dirtySpan = document.getElementById('edit-dirty-count');
    const saveBtn = document.getElementById('btn-save') as HTMLButtonElement | null;
    if (!dirtySpan || !saveBtn) { return; }
    dirtySpan.textContent = dirtyEditText(count);
    saveBtn.disabled = count === 0;
}

function dirtyEditText(count: number): string {
    return count > 0 ? `${count} unsaved byte${count === 1 ? '' : 's'}` : '';
}
