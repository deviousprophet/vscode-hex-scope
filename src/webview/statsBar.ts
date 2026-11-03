import { fmtB } from './utils';
import type { HexScopeFormat } from '../core/document';
import type { SerializedParseResult } from '../core/types';

export function renderStats(parseResult: SerializedParseResult | null, recordsStale = false): void {
    const el = document.getElementById('stats-bar');
    if (!el || !parseResult) { return; }

    el.textContent = '';
    addStatsItem(el, null, formatLabel(parseResult.format), 'si-fmt', 'fmt-pill');
    addStatsItem(el, 'Bytes', fmtB(parseResult.totalDataBytes));
    addRecordStats(el, parseResult, recordsStale);
    addStatsItem(el, 'Segments', String(parseResult.segments.length));
}

function addRecordStats(el: HTMLElement, parseResult: SerializedParseResult, recordsStale: boolean): void {
    if (parseResult.format === 'bin') { return; }
    const count = recordsStale ? '\u2014' : String(parseResult.recordCount ?? parseResult.records.length);
    addStatsItem(el, 'Records', count);
}

function addStatsItem(
    el: HTMLElement,
    label: string | null,
    value: string,
    extraClass = '',
    valueClass = '',
): void {
    const item = document.createElement('span');
    item.className = extraClass ? `si ${extraClass}` : 'si';

    if (label !== null) {
        const labelEl = document.createElement('span');
        labelEl.className = 'slb';
        labelEl.textContent = label;
        item.appendChild(labelEl);
    }

    const valueEl = document.createElement('span');
    valueEl.className = valueClass ? `svl ${valueClass}` : 'svl';
    valueEl.textContent = value;
    item.appendChild(valueEl);
    el.appendChild(item);
}

export function formatLabel(format: HexScopeFormat): string {
    if (format === 'bin') { return 'BIN'; }
    return format === 'srec' ? 'SREC' : 'IHEX';
}
