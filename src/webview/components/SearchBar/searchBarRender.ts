// Pure render/state-model helpers for the SearchBar component.
// DOM-free; split out of SearchBar.ts to keep the interaction class lean.

import { canonicalizeQuery } from '../../../core/search';
import type { SearchEndianness, SearchMode } from '../../../core/types';

export type SearchTrigger = 'enter-next' | 'enter-prev' | 'button';

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

export function activeClass(active: boolean): string {
    return active ? 'active' : '';
}

export function modeOptions(selected: SearchMode): string {
    return MODE_LABELS
        .map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`)
        .join('');
}

export { PLACEHOLDERS };
