// ── Search ────────────────────────────────────────────────────────
// Hex / ASCII / UTF-8 search with match navigation

import { S } from './state';
import { rerender } from './render';
import { applyMatchHighlights, scrollTo } from './memoryView';

let _switchToMemory: (() => void) | null = null;

export function initSearch(switchToMemory: () => void): void {
    _switchToMemory = switchToMemory;
}

// ── Run search ────────────────────────────────────────────────────

export function runSearch(): void {
    const raw = (document.getElementById('search-input') as HTMLInputElement | null)?.value ?? '';
    S.matchAddrs = [];
    S.matchIdx   = -1;

    if (raw.trim() === '') { applyMatchHighlights(); updMC(); return; }

    if (S.searchMode === 'addr') {
        const addr = parseAddr(raw.trim());
        if (addr !== null && S.flatBytes.has(addr)) {
            S.matchAddrs = [addr];
            S.matchIdx   = 0;
        }
        applyMatchHighlights();
        scrollToMatch();
        updMC();
        return;
    }

    const needle = buildNeedle(raw);

    if (needle.length === 0) { applyMatchHighlights(); updMC(); return; }

    const addrs = S.sortedAddrs;
    for (let i = 0; i <= addrs.length - needle.length; i++) {
        let match = true;
        for (let j = 0; j < needle.length; j++) {
            if (S.flatBytes.get(addrs[i + j]) !== needle[j]) { match = false; break; }
        }
        if (match) { S.matchAddrs.push(addrs[i]); }
    }

    if (S.matchAddrs.length > 0) { S.matchIdx = 0; }
    applyMatchHighlights();
    scrollToMatch();
    updMC();
}

export function clearSearch(): void {
    S.matchAddrs = [];
    S.matchIdx   = -1;
    const inp = document.getElementById('search-input') as HTMLInputElement | null;
    if (inp) { inp.value = ''; }
    applyMatchHighlights();
    updMC();
}

export function nextMatch(): void {
    if (S.matchAddrs.length === 0) { return; }
    S.matchIdx = (S.matchIdx + 1) % S.matchAddrs.length;
    goToMatch();
}

export function prevMatch(): void {
    if (S.matchAddrs.length === 0) { return; }
    S.matchIdx = (S.matchIdx - 1 + S.matchAddrs.length) % S.matchAddrs.length;
    goToMatch();
}

export function updMC(): void {
    const el = document.getElementById('match-count');
    if (!el) { return; }
    if (S.matchAddrs.length === 0) {
        el.textContent = '';
    } else {
        el.textContent = `${S.matchIdx + 1} / ${S.matchAddrs.length}`;
    }
}

// ── Private ───────────────────────────────────────────────────────

function goToMatch(): void {
    if (S.currentView !== 'memory') {
        if (_switchToMemory) { _switchToMemory(); }
    } else {
        applyMatchHighlights();
    }
    scrollToMatch();
    updMC();
}

function scrollToMatch(): void {
    if (S.matchIdx >= 0 && S.matchAddrs.length > 0) {
        scrollTo(S.matchAddrs[S.matchIdx]);
    }
}

function buildNeedle(raw: string): number[] {
    const mode = S.searchMode;
    if (mode === 'hex') {
        const tokens = raw.replace(/\s/g, '').match(/.{1,2}/g) ?? [];
        const bytes: number[] = [];
        for (const tok of tokens) {
            const v = parseInt(tok, 16);
            if (isNaN(v) || v < 0 || v > 255) { return []; }
            bytes.push(v);
        }
        return bytes;
    }
    // ascii / utf8 — encode as UTF-8
    return Array.from(new TextEncoder().encode(raw));
}

function parseAddr(raw: string): number | null {
    const s = raw.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{1,8}$/.test(s)) { return null; }
    const v = parseInt(s, 16);
    return isNaN(v) ? null : v;
}
