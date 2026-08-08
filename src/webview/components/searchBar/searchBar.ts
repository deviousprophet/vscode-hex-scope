// ── SearchBar component ──────────────────────────────────────────
// Self-contained search bar UI unit: owns its markup (toHtml), UI
// state (mode/endianness/query), input behaviours, and styles.
// The host owns search execution, match data, navigation, and
// match-count/busy feedback. This module never reads or writes the
// `S` global and never calls engine functions directly.

import { esc } from '../../utils';
import { activeClass, modeOptions, PLACEHOLDERS, type SearchTrigger } from './searchBarRender';
import type { SearchEndianness, SearchMode } from '../../../core/types';
import './searchBar.css';

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
        return `
            <div id="search-box">
                <div id="search-endian-toggle" class="compact-tabs search-endian-toggle"${this.endianToggleHiddenAttr()}>
                    <button id="search-btn-auto" class="${activeClass(this.endianness === 'auto')}" type="button">Auto</button>
                    <button id="search-btn-le" class="${activeClass(this.endianness === 'le')}" type="button">LE</button>
                    <button id="search-btn-be" class="${activeClass(this.endianness === 'be')}" type="button">BE</button>
                </div>
                <select id="search-mode">${modeOptions(this.mode)}</select>
                <div class="search-addr-wrap">
                    <span id="search-addr-prefix" class="search-addr-prefix"${this.addrPrefixHiddenAttr()}>0x</span>
                    <input id="search-input" type="text" placeholder="${PLACEHOLDERS[this.mode]}" autocomplete="off" spellcheck="false" maxlength="${this.addrInputMaxLength()}" value="${esc(this.query)}" class="${this.addrInputClass()}">
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

    /** Memory-view visibility (host-called; #search-box is component-owned DOM). */
    setVisible(visible: boolean): void {
        const el = document.getElementById('search-box');
        if (el) { el.style.display = visible ? '' : 'none'; }
    }

    private matchCountText(count: number, current: number): string {
        if (this.query.trim().length > 0 && count === 0) { return '0 / 0'; }
        if (count === 0) { return ''; }
        return `${current + 1} / ${count}`;
    }

    private static readonly CLICK_ACTIONS: ReadonlyArray<readonly [string, (bar: SearchBar) => void]> = [
        ['#btn-search', b => b.cb.onSearch(b.query, b.mode, b.endianness, 'button')],
        ['#btn-prev', b => b.cb.onPrev()],
        ['#btn-next', b => b.cb.onNext()],
        ['#btn-clear-search', b => b.clear()],
        ['#search-btn-auto', b => b.setEndianness('auto')],
        ['#search-btn-le', b => b.setEndianness('le')],
        ['#search-btn-be', b => b.setEndianness('be')],
    ];

    private onDocumentClick(e: Event): void {
        const target = e.target as HTMLElement | null;
        if (!target || typeof target.closest !== 'function') { return; }
        const action = SearchBar.CLICK_ACTIONS.find(([selector]) => target.closest(selector) !== null);
        if (action) { action[1](this); }
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

    private isSearchInputEnter(e: KeyboardEvent): boolean {
        return (e.target as HTMLElement | null)?.id === 'search-input' && e.key === 'Enter';
    }

    private isFindShortcut(e: KeyboardEvent): boolean {
        return (e.ctrlKey || e.metaKey) && e.key === 'f';
    }

    private onDocumentKeydown(e: KeyboardEvent): void {
        if (this.isSearchInputEnter(e)) {
            e.preventDefault();
            this.cb.onSearch(this.query, this.mode, this.endianness, e.shiftKey ? 'enter-prev' : 'enter-next');
            return;
        }
        if (this.isFindShortcut(e)) {
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

    private addrPrefixVisible(): boolean {
        return this.mode === 'addr' && this.query.length > 0;
    }

    private endianToggleHiddenAttr(): string {
        return this.mode === 'value' ? '' : ' hidden';
    }

    private addrPrefixHiddenAttr(): string {
        return this.addrPrefixVisible() ? '' : ' hidden';
    }

    private addrInputMaxLength(): number {
        return this.mode === 'addr' ? 8 : 100;
    }

    private addrInputClass(): string {
        return this.addrPrefixVisible() ? 'search-addr-mode' : '';
    }

    private updateAddrOverlay(): void {
        const show = this.addrPrefixVisible();
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
