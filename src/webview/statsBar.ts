import type { SerializedParseResult } from '../core/types';
import { fmtB } from './utils';

export function renderStats(parseResult: SerializedParseResult | null): void {
    const el = document.getElementById('stats-bar');
    if (!el || !parseResult) { return; }

    el.textContent = '';
    addStatsItem(el, null, formatLabel(parseResult.format), 'si-fmt');
    addStatsItem(el, 'Bytes', fmtB(parseResult.totalDataBytes));
    addStatsItem(el, 'Records', String(parseResult.recordCount ?? parseResult.records.length));
    addStatsItem(el, 'Segments', String(parseResult.segments.length));
}

function addStatsItem(el: HTMLElement, label: string | null, value: string, extraClass = ''): void {
    const item = document.createElement('span');
    item.className = extraClass ? `si ${extraClass}` : 'si';

    if (label !== null) {
        const labelEl = document.createElement('span');
        labelEl.className = 'slb';
        labelEl.textContent = label;
        item.appendChild(labelEl);
    }

    const valueEl = document.createElement('span');
    valueEl.className = 'svl';
    valueEl.textContent = value;
    item.appendChild(valueEl);

    el.appendChild(item);
}

function formatLabel(format: 'ihex' | 'srec'): string {
    return format === 'srec' ? 'SREC' : 'IHEX';
}
