// Diff renderer — summary bar only. The hex grid itself is rendered by the
// reusable `hexViewComponent` (label + header + address/cells + interaction).

import type { DiffMeta } from '../../core/diff';

export interface DiffSummaryState {
    meta: DiffMeta | null;
    aError: string | null;
    bError: string | null;
}

export function renderDiffSummaryHtml(state: DiffSummaryState): string {
    if (!state.meta) { return ''; }
    if (state.meta.identical && !state.aError && !state.bError) {
        return '<div class="diff-summary identical">Files are identical</div>';
    }
    return '';
}
