import { fmtB, formatHex } from './utils';
import type { HexScopeFormat } from '../core/document';
import type { SerializedParseResult } from '../core/types';

/** `onRequestBaseChange` makes the raw-binary Base value an interactive control. */
export function renderStats(
    parseResult: SerializedParseResult | null,
    onRequestBaseChange?: () => void,
): void {
    const el = document.getElementById('stats-bar');
    if (!el || !parseResult) { return; }

    el.textContent = '';
    addStatsItem(el, null, formatLabel(parseResult.format), 'si-fmt', 'fmt-pill');
    addBinBaseStat(el, parseResult, onRequestBaseChange);
    addStatsItem(el, 'Bytes', fmtB(parseResult.totalDataBytes));
    addRecordStats(el, parseResult);
    addStatsItem(el, 'Segments', String(parseResult.segments.length));
}

function addBinBaseStat(
    el: HTMLElement,
    parseResult: SerializedParseResult,
    onRequestBaseChange?: () => void,
): void {
    if (parseResult.format !== 'bin') { return; }
    // Raw images have no records; report the memory-map base instead.
    addStatsItem(el, 'Base', formatHex(binBaseOf(parseResult), 8), '', '', onRequestBaseChange);
}

function binBaseOf(parseResult: SerializedParseResult): number {
    return parseResult.baseAddress ?? parseResult.segments[0]?.startAddress ?? 0;
}

function addRecordStats(el: HTMLElement, parseResult: SerializedParseResult): void {
    if (parseResult.format === 'bin') { return; }
    addStatsItem(el, 'Records', String(parseResult.recordCount ?? parseResult.records.length));
}

function addStatsItem(
    el: HTMLElement,
    label: string | null,
    value: string,
    extraClass = '',
    valueClass = '',
    onValueClick?: () => void,
): void {
    const item = document.createElement('span');
    item.className = extraClass ? `si ${extraClass}` : 'si';

    if (label !== null) {
        const labelEl = document.createElement('span');
        labelEl.className = 'slb';
        labelEl.textContent = label;
        item.appendChild(labelEl);
    }

    item.appendChild(onValueClick ? baseValueButton(value, valueClass, onValueClick) : valueSpan(value, valueClass));
    el.appendChild(item);
}

function valueSpan(value: string, valueClass: string): HTMLSpanElement {
    const valueEl = document.createElement('span');
    valueEl.className = valueClass ? `svl ${valueClass}` : 'svl';
    valueEl.textContent = value;
    return valueEl;
}

/** The Base value is focusable and focuses the profile-bar field. */
function baseValueButton(value: string, valueClass: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'stats-base-change';
    button.className = valueClass ? `svl ${valueClass} base-change` : 'svl base-change';
    button.textContent = value;
    button.title = 'Edit raw binary base address';
    button.setAttribute('aria-label', `Edit raw binary base address (currently ${value})`);
    button.addEventListener('click', onClick);
    return button;
}

export function formatLabel(format: HexScopeFormat): string {
    if (format === 'bin') { return 'BIN'; }
    return format === 'srec' ? 'SREC' : 'IHEX';
}
