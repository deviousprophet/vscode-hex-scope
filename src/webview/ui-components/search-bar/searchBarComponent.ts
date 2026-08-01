// Reusable search-bar UI component. Owns the search box (mode select,
// endian toggle, input, run/prev/next/clear, match count) and its input
// behaviours; the host runs the actual search and applies/navigates matches.

import type { SearchEndianness, SearchMode } from '../../../core/types';
import { esc } from '../../utils';

export interface SearchBarCallbacks {
    onSearch: (query: string, mode: SearchMode, endianness: SearchEndianness) => void;
    onPrev: () => void;
    onNext: () => void;
    onClear: () => void;
}

function placeholderFor(mode: SearchMode): string {
    const placeholders: Record<SearchMode, string> = {
        bytes: 'Bytes (e.g. DE AD BE EF)',
        value: 'Value (e.g. 0x12345678 or 305419896)',
        ascii: 'ASCII text',
        addr: 'Addr (e.g. 1A0)',
    };
    return placeholders[mode];
}

export class SearchBarComponent {
    private mode: SearchMode = 'bytes';
    private endianness: SearchEndianness = 'le';
    private query = '';
    private cb: SearchBarCallbacks;
    private _mounted = false;
    private readonly _listeners: Array<[string, EventListener]> = [];

    constructor(cb: SearchBarCallbacks) {
        this.cb = cb;
    }

    setCallbacks(cb: SearchBarCallbacks): void { this.cb = cb; }

    /** HTML for the host to inject into its toolbar. */
    toHtml(): string {
        const modeOpts = (['bytes', 'value', 'ascii', 'addr'] as const).map(m =>
            `<option value="${m}"${this.mode === m ? ' selected' : ''}>${m}</option>`
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

    /** Attach document-delegated listeners; survives host re-renders. */
    mount(): void {
        if (this._mounted) { return; }
        this._mounted = true;
        const on = (type: string, fn: EventListener): void => {
            document.addEventListener(type, fn);
            this._listeners.push([type, fn]);
        };
        const input = (): HTMLInputElement => document.getElementById('search-input') as HTMLInputElement;
        const run = (): void => this.cb.onSearch(input().value.trim(), this.mode, this.endianness);
        const updateAddrOverlay = (inp: HTMLInputElement): void => {
            const prefix = document.getElementById('search-addr-prefix') as HTMLElement | null;
            const show = this.mode === 'addr' && inp.value.length > 0;
            if (prefix) { prefix.style.display = show ? '' : 'none'; }
            inp.classList.toggle('search-addr-mode', show);
        };
        const updateModeUi = (): void => {
            const endianToggle = document.getElementById('search-endian-toggle') as HTMLElement | null;
            if (endianToggle) { endianToggle.style.display = this.mode === 'value' ? 'inline-flex' : 'none'; }
            const inp = input();
            inp.placeholder = placeholderFor(this.mode);
            inp.maxLength = this.mode === 'addr' ? 8 : 100;
            updateAddrOverlay(inp);
        };
        const updateEndianUi = (): void => {
            for (const end of ['auto', 'le', 'be'] as const) {
                document.getElementById(`search-btn-${end}`)?.classList.toggle('active', this.endianness === end);
            }
        };

        on('change', e => {
            if ((e.target as HTMLElement).id !== 'search-mode') { return; }
            this.mode = (e.target as HTMLSelectElement).value as SearchMode;
            updateModeUi();
            run();
        });
        on('input', e => {
            if ((e.target as HTMLElement).id !== 'search-input') { return; }
            const inp = e.target as HTMLInputElement;
            this.query = inp.value;
            if (this.mode === 'addr') { this.query = this.query.replace(/[^0-9a-fA-F]/g, ''); inp.value = this.query; }
            updateAddrOverlay(inp);
        });
        on('keydown', e => {
            const k = e as KeyboardEvent;
            if (k.target instanceof HTMLInputElement && (k.target as HTMLInputElement).id === 'search-input' && k.key === 'Enter') {
                k.preventDefault();
                run();
                if (k.shiftKey) { this.cb.onPrev(); }
                return;
            }
            if ((k.ctrlKey || k.metaKey) && k.key === 'f') {
                k.preventDefault();
                input().focus();
                input().select();
            }
        });
        on('click', e => {
            const id = (e.target as HTMLElement).id;
            if (id === 'btn-search') { run(); }
            else if (id === 'btn-prev') { this.cb.onPrev(); }
            else if (id === 'btn-next') { this.cb.onNext(); }
            else if (id === 'btn-clear-search') {
                this.query = '';
                const inp = input();
                inp.value = '';
                updateAddrOverlay(inp);
                this.cb.onClear();
            }
            else if (id === 'search-btn-auto' || id === 'search-btn-le' || id === 'search-btn-be') {
                this.endianness = id === 'search-btn-auto' ? 'auto' : id === 'search-btn-le' ? 'le' : 'be';
                updateEndianUi();
                run();
            }
        });
    }

    destroy(): void {
        for (const [type, fn] of this._listeners) { document.removeEventListener(type, fn); }
        this._listeners.length = 0;
        this._mounted = false;
    }

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
    }
}


