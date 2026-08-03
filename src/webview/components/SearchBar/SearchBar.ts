// ── SearchBar component ──────────────────────────────────────────
// Self-contained search bar UI unit: owns its markup (toHtml), UI
// state (mode/endianness/query), input behaviours, and styles.
// The host owns search execution, match data, navigation, and
// match-count/busy feedback. This module never reads or writes the
// `S` global and never calls engine functions directly.

import { esc } from '../../utils';
import { canonicalizeQuery } from '../../../core/search';
import type { SearchEndianness, SearchMode } from '../../../core/types';
import './SearchBar.css';

export type SearchTrigger = 'enter-next' | 'enter-prev' | 'button';

export interface SearchBarCallbacks {
    onSearch: (query: string, mode: SearchMode, endianness: SearchEndianness, trigger: SearchTrigger) => void;
    onPrev: () => void;
    onNext: () => void;
    onClear: () => void;
}

export interface SearchBarSeedOptions {
    mode?: SearchMode;
    endianness?: SearchEndianness;
    query?: string;
}

const MODE_LABELS: ReadonlyArray<[SearchMode, string]> = [
    ['bytes', 'Bytes'],
    ['value', 'Value'],
    ['ascii', 'ASCII'],
    ['addr', 'Addr'],
];

const PLACEHOLDERS: Record<SearchMode, string> = {
    bytes: 'Bytes (e.g. DE AD BE EF)',
    value: 'Value (e.g. 0x12345678 or 305419896)',
    ascii: 'ASCII text',
    addr: 'Addr (e.g. 1A0)',
};

/** Canonical search key — engine reuses it for running-search parity. */
export function searchKeyFor(mode: SearchMode, raw: string, endianness: SearchEndianness): string {
    const canonical = canonicalizeQuery(mode, raw);
    const endianKey = mode === 'value' ? endianness : 'n/a';
    return `${mode}|${endianKey}|${canonical}`;
}

function activeClass(active: boolean): string {
    return active ? 'active' : '';
}

function modeOptions(selected: SearchMode): string {
    return MODE_LABELS
        .map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`)
        .join('');
}

export class SearchBar {
    private mode: SearchMode;
    private endianness: SearchEndianness;
    private query: string;
    private mounted = false;

    constructor(
        private readonly cb: SearchBarCallbacks,
        seed: SearchBarSeedOptions = {},
    ) {
        this.mode = seed.mode ?? 'bytes';
        this.endianness = seed.endianness ?? 'auto';
        this.query = seed.query ?? '';
    }

    /** Markup; host injects into the toolbar. Regenerated from internal state on each render. */
    toHtml(): string {
        const isAddr = this.mode === 'addr';
        const showAddr = isAddr && this.query.length > 0;
        return `
            <div id="search-box">
                <div id="search-endian-toggle" class="compact-tabs search-endian-toggle"${this.mode === 'value' ? '' : ' hidden'}>
                    <button id="search-btn-auto" class="${activeClass(this.endianness === 'auto')}" type="button">Auto</button>
                    <button id="search-btn-le" class="${activeClass(this.endianness === 'le')}" type="button">LE</button>
                    <button id="search-btn-be" class="${activeClass(this.endianness === 'be')}" type="button">BE</button>
                </div>
                <select id="search-mode">${modeOptions(this.mode)}</select>
                <div class="search-addr-wrap">
                    <span id="search-addr-prefix" class="search-addr-prefix"${showAddr ? '' : ' hidden'}>0x</span>
                    <input id="search-input" type="text" placeholder="${PLACEHOLDERS[this.mode]}" autocomplete="off" spellcheck="false" maxlength="${isAddr ? 8 : 100}" value="${esc(this.query)}" class="${showAddr ? 'search-addr-mode' : ''}">
                </div>
                <button class="nav-btn search-btn" id="btn-search" title="Run search" aria-label="Run search">🔍</button>
                <button class="nav-btn" id="btn-prev"         title="Previous match">▲</button>
                <button class="nav-btn" id="btn-next"         title="Next match">▼</button>
                <button class="nav-btn" id="btn-clear-search" title="Clear">✕</button>
                <span id="search-progress" class="search-progress" aria-hidden="true"></span>
                <span id="match-count"></span>
            </div>`;
    }

    /** Document-delegated listeners (survive re-renders). Idempotent. */
    mount(): void {
        if (this.mounted) { return; }
        this.mounted = true;
        document.addEventListener('click', e => this.onDocumentClick(e));
        document.addEventListener('input', e => this.onDocumentInput(e));
        document.addEventListener('change', e => this.onDocumentChange(e));
        document.addEventListener('keydown', e => this.onDocumentKeydown(e));
    }

    setCount(count: number, current: number): void {
        const el = document.getElementById('match-count');
        if (!el) { return; }
        el.textContent = this.matchCountText(count, current);
    }

    setBusy(busy: boolean): void {
        const el = document.getElementById('search-progress');
        if (!el) { return; }
        el.classList.toggle('active', busy);
        el.setAttribute('aria-hidden', String(!busy));
    }

    private matchCountText(count: number, current: number): string {
        if (this.query.trim().length > 0 && count === 0) { return '0 / 0'; }
        if (count === 0) { return ''; }
        return `${current + 1} / ${count}`;
    }

    private onDocumentClick(e: Event): void {
        const target = e.target as HTMLElement | null;
        if (!target || typeof target.closest !== 'function') { return; }
        if (target.closest('#btn-search')) { this.cb.onSearch(this.query, this.mode, this.endianness, 'button'); return; }
        if (target.closest('#btn-prev')) { this.cb.onPrev(); return; }
        if (target.closest('#btn-next')) { this.cb.onNext(); return; }
        if (target.closest('#btn-clear-search')) { this.clear(); return; }
        if (target.closest('#search-btn-auto')) { this.setEndianness('auto'); return; }
        if (target.closest('#search-btn-le')) { this.setEndianness('le'); return; }
        if (target.closest('#search-btn-be')) { this.setEndianness('be'); }
    }

    private onDocumentInput(e: Event): void {
        const target = e.target as HTMLInputElement | null;
        if (!target || target.id !== 'search-input') { return; }
        if (this.mode === 'addr') {
            target.value = target.value.replace(/[^0-9a-fA-F]/g, '');
        }
        this.query = target.value;
        this.updateAddrOverlay();
    }

    private onDocumentChange(e: Event): void {
        const target = e.target as HTMLSelectElement | null;
        if (!target || target.id !== 'search-mode') { return; }
        this.setMode(target.value as SearchMode);
    }

    private onDocumentKeydown(e: KeyboardEvent): void {
        const target = e.target as HTMLElement | null;
        if (target?.id === 'search-input' && e.key === 'Enter') {
            e.preventDefault();
            this.cb.onSearch(this.query, this.mode, this.endianness, e.shiftKey ? 'enter-prev' : 'enter-next');
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            this.focusInput();
        }
    }

    private setMode(mode: SearchMode): void {
        if (mode === this.mode) { return; }
        this.mode = mode;
        this.applyModeUi();
    }

    private setEndianness(endianness: SearchEndianness): void {
        if (endianness === this.endianness) { return; }
        this.endianness = endianness;
        this.applyEndianUi();
    }

    private clear(): void {
        this.query = '';
        const input = document.getElementById('search-input') as HTMLInputElement | null;
        if (input) { input.value = ''; }
        this.updateAddrOverlay();
        this.cb.onClear();
    }

    private focusInput(): void {
        const input = document.getElementById('search-input') as HTMLInputElement | null;
        if (!input) { return; }
        input.focus();
        input.select();
    }

    private updateAddrOverlay(): void {
        const show = this.mode === 'addr' && this.query.length > 0;
        const prefix = document.getElementById('search-addr-prefix');
        const input = document.getElementById('search-input') as HTMLInputElement | null;
        if (prefix) { prefix.hidden = !show; }
        input?.classList.toggle('search-addr-mode', show);
    }

    private applyModeUi(): void {
        const toggle = document.getElementById('search-endian-toggle');
        const input = document.getElementById('search-input') as HTMLInputElement | null;
        if (toggle) { toggle.hidden = this.mode !== 'value'; }
        if (input) {
            input.placeholder = PLACEHOLDERS[this.mode];
            input.maxLength = this.mode === 'addr' ? 8 : 100;
        }
        this.updateAddrOverlay();
    }

    private applyEndianUi(): void {
        const setActive = (id: string, active: boolean): void => {
            document.getElementById(id)?.classList.toggle('active', active);
        };
        setActive('search-btn-auto', this.endianness === 'auto');
        setActive('search-btn-le', this.endianness === 'le');
        setActive('search-btn-be', this.endianness === 'be');
    }
}
