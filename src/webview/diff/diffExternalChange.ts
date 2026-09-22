import type { DiffWebviewToProvider } from '../../diffProtocol';
import { ExternalChange } from '../components/externalChange/externalChange';
import type { DiffExternalChangeErrorMessage, DiffExternalChangeMessage } from './diffMessages';
import { applyReload } from './diffGrid';
import { hydrateDiffSide } from './diffModel';
import { resetDiffSearch } from './diffSearch';
import { setDiffSummary } from './diffSummary';

export type DiffExternalChangePost = (message: DiffWebviewToProvider) => void;

export interface DiffExternalChangeBanner {
    applyChange(message: DiffExternalChangeMessage): void;
    applyError(message: DiffExternalChangeErrorMessage): void;
}

/** Reused hex-view banner for the diff surface: reload on click, repair/view actions for a broken side. */
export function createDiffExternalChangeBanner(post: DiffExternalChangePost): DiffExternalChangeBanner {
    const banner = new ExternalChange();
    return {
        applyChange: message => {
            // Host reload flow clears the stale error banner (hex-view model parity).
            banner.clearAll();
            banner.showReload(message, accepted => acceptReload(accepted, post));
        },
        applyError: message => {
            banner.clearAll();
            banner.showError(
                message.checksumErrors,
                message.malformedLines,
                message.canQuickRepair,
                () => post({ type: 'repairAndReload' }),
                () => post({ type: 'viewInNormalEditor' }),
            );
        },
    };
}

/** Apply the pending pair locally (view mode/scroll kept, selection/search reset) and acknowledge. */
function acceptReload(message: DiffExternalChangeMessage, post: DiffExternalChangePost): void {
    applyReload(hydrateDiffSide(message.a), hydrateDiffSide(message.b), message.diff);
    resetDiffSearch();
    setDiffSummary(message.diff);
    post({ type: 'reloadAccepted' });
}
