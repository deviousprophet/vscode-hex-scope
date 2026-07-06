import { S } from './state';

export function updateEditControls(): void {
    const inMemory = S.currentView === 'memory';
    document.getElementById('btn-edit-mode')!.style.display = inMemory ? '' : 'none';
    document.getElementById('edit-mode-group')!.style.display = inMemory && S.editMode ? '' : 'none';
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
