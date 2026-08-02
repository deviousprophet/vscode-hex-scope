// Reusable search-bar UI component. Owns the search box (mode select,
// endian toggle, input, run/prev/next/clear, match count) and its input
// behaviours; the host runs the actual search and applies/navigates matches.

import type { SearchEndianness, SearchMode } from '../../../core/types';
import { canonicalizeQuery } from '../../../core/search';
import { esc } from '../../utils';

export interface SearchBarCallbacks {
    onSearch: (query: string, mode: SearchMode, endianness: SearchEndianness) => void;
    onPrev: () => void;
    onNext: () => void;
    onClear: () => void;
}

const MODE_LABELS: Record<SearchMode, string> = {
    bytes: 'Bytes',
    value: 'Value',
    ascii: 'ASCII',
    addr: 'Addr',
};

function placeholderFor(mode: SearchMode): string {
    const placeholders: Record<SearchMode, string> = {
        bytes: 'Bytes (e.g. DE AD BE EF)',
        value: 'Value (e.g. 0x12345678 or 305419896)',
        ascii: 'ASCII text',
        addr: 'Addr (e.g. 1A0)',
    };
    return placeholders[mode];
}

function isSearchInput(k: KeyboardEvent): boolean {
    return k.target instanceof HTMLInputElement && k.target.id === 'search-input';
}

function isFindShortcut(k: KeyboardEvent): boolean {
    return (k.ctrlKey || k.metaKey) && k.key === 'f';
}

/** Canonical search key (mirrors the single view's Enter-nav key). */
function searchKeyFor(mode: SearchMode, raw: string, endianness: SearchEndianness): string {
    const canonical = canonicalizeQuery(mode, raw);
    const endianKey = mode === 'value' ? endianness : 'n/a';
    return `${mode}|${endianKey}|${canonical}`;
}

export class SearchBarComponent {
    /** Toolbar button id -> handler (data-driven click dispatch). */
    private static readonly TOOLBAR_CLICK: Record<string, (c: SearchBarComponent) => void> = {
        'btn-search': c => c.runSearch(),
        'btn-prev': c => c.cb.onPrev(),
        'btn-next': c => c.cb.onNext(),
        'btn-clear-search': c => c.clearSearch(),
        'search-btn-auto': c => c.applyEndian('auto'),
        'search-btn-le': c => c.applyEndian('le'),
        'search-btn-be': c => c.applyEndian('be'),
    };

    private mode: SearchMode = 'bytes';
    private endianness: SearchEndianness = 'le';
    private query = '';
    private cb: SearchBarCallbacks;
    private _mounted = false;
    // Enter-nav parity: Enter on an unchanged query whose search already
    // completed navigates matches instead of re-running.
    private _lastSearchKey = '';
    private _searchCompleted = false;

    constructor(cb: SearchBarCallbacks) {
        this.cb = cb;
    }

    // ponytail: setCallbacks() removed (unused; cb set once via constructor) — re-add when a host must swap the search callback set.
    /** HTML for the host to inject into its toolbar. */
    toHtml(): string {
        const modeOpts = (['bytes', 'value', 'ascii', 'addr'] as const).map(m =>
            `<option value="${m}"${this.mode === m ? ' selected' : ''}>${MODE_LABELS[m]}</option>`
        ).join('');
        const endBtn = (end: SearchEndianness, label: string) =>
            `<button id="search-btn-${end}" class="${this.endianness === end ? 'active' : ''}" type="button">${label}</button>`;
        return `<div id="search-box">
            <div id="search-endian-toggle" class="compact-tabs search-endian-toggle" style="display:${this.mode === 'value' ? 'inline-flex' : 'none'}">
                ${endBtn('auto', 'Auto')}${endBtn('le', 'LE')}${endBtn('be', 'BE')}
            </div>
            <select id="search-mode">${modeOpts}</select>
            <div class="search-addr-wrap">
                <span id="search-addr-prefix" class="search-addr-prefix" style="display:none">0x</span>
                <input id="search-input" type="text" placeholder="${esc(placeholderFor(this.mode))}" autocomplete="off" spellcheck="false"
                    maxlength="${this.mode === 'addr' ? 8 : 100}" value="${esc(this.query)}">
            </div>
            <button class="nav-btn search-btn" id="btn-search" title="Run search" aria-label="Run search">&#128269;</button>
            <button class="nav-btn" id="btn-prev" title="Previous match">&#9650;</button>
            <button class="nav-btn" id="btn-next" title="Next match">&#9660;</button>
            <button class="nav-btn" id="btn-clear-search" title="Clear">&#10005;</button>
            <span id="search-progress" class="search-progress" aria-hidden="true"></span>
            <span id="match-count"></span>
        </div>`;
    }

    private searchInput(): HTMLInputElement {
        return document.getElementById('search-input') as HTMLInputElement;
    }

    private runSearch(): void {
        const q = this.searchInput().value.trim();
        this._lastSearchKey = searchKeyFor(this.mode, q, this.endianness);
        this._searchCompleted = false;
        this.cb.onSearch(q, this.mode, this.endianness);
    }

    private clearSearch(): void {
        this.query = '';
        const inp = this.searchInput();
        inp.value = '';
        this.updateAddrOverlay(inp);
        this._lastSearchKey = '';
        this._searchCompleted = false;
        this.cb.onClear();
    }

    private updateAddrOverlay(inp: HTMLInputElement): void {
        const prefix = document.getElementById('search-addr-prefix') as HTMLElement | null;
        const show = this.mode === 'addr' && inp.value.length > 0;
        if (prefix) { prefix.style.display = show ? '' : 'none'; }
        inp.classList.toggle('search-addr-mode', show);
    }

    private updateModeUi(): void {
        const endianToggle = document.getElementById('search-endian-toggle') as HTMLElement | null;
        if (endianToggle) { endianToggle.style.display = this.mode === 'value' ? 'inline-flex' : 'none'; }
        const inp = this.searchInput();
        inp.placeholder = placeholderFor(this.mode);
        inp.maxLength = this.mode === 'addr' ? 8 : 100;
        this.updateAddrOverlay(inp);
    }

    private updateEndianUi(): void {
        for (const end of ['auto', 'le', 'be'] as const) {
            document.getElementById(`search-btn-${end}`)?.classList.toggle('active', this.endianness === end);
        }
    }

    private applyEndian(end: SearchEndianness): void {
        this.endianness = end;
        this.updateEndianUi();
        this.runSearch();
    }

    private isSearchInputEnter(k: KeyboardEvent): boolean {
        return k.key === 'Enter' && isSearchInput(k);
    }

    private shouldNavigate(k: KeyboardEvent, q: string, key: string): boolean {
        if (q.length === 0) { return false; }
        return key === this._lastSearchKey && this._searchCompleted;
    }

    private navigateMatches(shift: boolean): void {
        if (shift) { this.cb.onPrev(); } else { this.cb.onNext(); }
    }

    private handleSearchEnter(k: KeyboardEvent): void {
        k.preventDefault();
        const inp = k.target as HTMLInputElement;
        const q = inp.value.trim();
        const key = searchKeyFor(this.mode, q, this.endianness);
        if (this.shouldNavigate(k, q, key)) {
            this.navigateMatches(k.shiftKey);
            return;
        }
        this._lastSearchKey = key;
        this._searchCompleted = false;
        this.cb.onSearch(q, this.mode, this.endianness);
        if (k.shiftKey) { this.cb.onPrev(); }
    }

    private onKeyDown(k: KeyboardEvent): void {
        if (this.isSearchInputEnter(k)) {
            this.handleSearchEnter(k);
            return;
        }
        if (isFindShortcut(k)) {
            k.preventDefault();
            this.searchInput().focus();
            this.searchInput().select();
        }
    }

    private onToolbarClick(e: Event): void {
        const handler = SearchBarComponent.TOOLBAR_CLICK[(e.target as HTMLElement).id];
        if (handler) { handler(this); }
    }

    /** Attach document-delegated listeners; survives host re-renders. */
    mount(): void {
        if (this._mounted) { return; }
        this._mounted = true;

        document.addEventListener('change', e => {
            if ((e.target as HTMLElement).id !== 'search-mode') { return; }
            this.mode = (e.target as HTMLSelectElement).value as SearchMode;
            this.updateModeUi();
            this.runSearch();
        });
        document.addEventListener('input', e => {
            if ((e.target as HTMLElement).id !== 'search-input') { return; }
            const inp = e.target as HTMLInputElement;
            this.query = inp.value;
            if (this.mode === 'addr') { this.query = this.query.replace(/[^0-9a-fA-F]/g, ''); inp.value = this.query; }
            this.updateAddrOverlay(inp);
        });
        document.addEventListener('keydown', e => this.onKeyDown(e as KeyboardEvent));
        document.addEventListener('click', e => this.onToolbarClick(e));
    }

    // ponytail: destroy() removed (unused; sole user of _listeners registry) — re-add with a listener registry when a host must detach document listeners.
    /** Show "N / M" (blank when no query, "0 / 0" for a query with no hits). */
    setCount(count: number, current: number): void {
        const el = document.getElementById('match-count');
        if (!el) { return; }
        if (this.query.length === 0) { el.textContent = ''; return; }
        if (count === 0) { el.textContent = '0 / 0'; return; }
        el.textContent = `${current + 1} / ${count}`;
    }

    /** Toggle the animated spinner while a search runs. */
    setBusy(busy: boolean): void {
        const el = document.getElementById('search-progress');
        if (!el) { return; }
        el.classList.toggle('active', busy);
        el.setAttribute('aria-hidden', String(!busy));
        if (!busy) { this._searchCompleted = true; }
    }
}
