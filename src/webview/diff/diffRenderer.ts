// Diff renderer — summary bar only. The hex grid itself is rendered by the
// reusable `hexViewComponent` (label + header + address/cells + interaction).

import type { DiffResult } from '../../core/diff';

export interface DiffSummaryState {
    result: DiffResult | null;
    aError: string | null;
    bError: string | null;
}

export function renderDiffSummaryHtml(state: DiffSummaryState): string {
    if (!state.result) { return ''; }
    if (state.result.identical && !state.aError && !state.bError) {
        return '<div class="diff-summary identical">Files are identical</div>';
    }
    return '';
}
