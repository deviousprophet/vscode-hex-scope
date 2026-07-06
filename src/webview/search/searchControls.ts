import { S } from '../state';
import { clearSearch, nextMatch, prevMatch, runSearch } from './searchEngine';

export function setupSearchControls(onUndo: () => void): void {
    const modeEl = document.getElementById('search-mode') as HTMLSelectElement;
    const inputEl = document.getElementById('search-input') as HTMLInputElement;
    const endianToggleEl = document.getElementById('search-endian-toggle') as HTMLDivElement;
    const searchBtnAuto = document.getElementById('search-btn-auto') as HTMLButtonElement;
    const searchBtnLE = document.getElementById('search-btn-le') as HTMLButtonElement;
    const searchBtnBE = document.getElementById('search-btn-be') as HTMLButtonElement;

    const applySearchModeUi = (): void => {
        endianToggleEl.style.display = S.searchMode === 'value' ? 'inline-flex' : 'none';
        inputEl.placeholder = searchPlaceholder();
    };
    const applyEndianUi = (): void => {
        searchBtnAuto.classList.toggle('active', S.searchEndianness === 'auto');
        searchBtnLE.classList.toggle('active', S.searchEndianness === 'le');
        searchBtnBE.classList.toggle('active', S.searchEndianness === 'be');
    };

    modeEl.addEventListener('change', () => {
        S.searchMode = modeEl.value as typeof S.searchMode;
        applySearchModeUi();
    });
    inputEl.addEventListener('keydown', e => runSearchOnEnter(e));
    document.getElementById('btn-search')!.addEventListener('click', () => runSearch('button'));
    document.getElementById('btn-prev')!.addEventListener('click', prevMatch);
    document.getElementById('btn-next')!.addEventListener('click', nextMatch);
    document.getElementById('btn-clear-search')!.addEventListener('click', clearSearch);
    searchBtnAuto.addEventListener('click', () => setSearchEndian('auto', applyEndianUi));
    searchBtnLE.addEventListener('click', () => setSearchEndian('le', applyEndianUi));
    searchBtnBE.addEventListener('click', () => setSearchEndian('be', applyEndianUi));
    document.addEventListener('keydown', e => handleGlobalKeydown(e, inputEl, onUndo));

    applySearchModeUi();
    applyEndianUi();
}

function runSearchOnEnter(e: KeyboardEvent): void {
    if (e.key !== 'Enter') { return; }
    e.preventDefault();
    runSearch(e.shiftKey ? 'enter-prev' : 'enter-next');
}

function searchPlaceholder(): string {
    const placeholders: Record<typeof S.searchMode, string> = {
        bytes: 'Bytes (e.g. DE AD BE EF)',
        value: 'Value (e.g. 0x12345678 or 305419896)',
        ascii: 'ASCII text',
        addr: 'Address (e.g. 0800 or 0x08001234)',
    };
    return placeholders[S.searchMode];
}

function setSearchEndian(value: typeof S.searchEndianness, updateUi: () => void): void {
    S.searchEndianness = value;
    updateUi();
}

function handleGlobalKeydown(e: KeyboardEvent, inputEl: HTMLInputElement, onUndo: () => void): void {
    if (isSearchShortcut(e)) {
        e.preventDefault();
        focusSearchInput(inputEl);
    }
    if (isUndoShortcut(e)) {
        e.preventDefault();
        onUndo();
    }
}

function isSearchShortcut(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && e.key === 'f';
}

function isUndoShortcut(e: KeyboardEvent): boolean {
    return (e.ctrlKey || e.metaKey) && e.key === 'z' && S.editMode;
}

function focusSearchInput(inputEl: HTMLInputElement): void {
    inputEl.focus();
    inputEl.select();
}
