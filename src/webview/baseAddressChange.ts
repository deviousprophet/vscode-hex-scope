import type { HexScopeFormat } from '../core/document';

export interface BaseAddressChangeState {
    format: HexScopeFormat | undefined;
    hasUnsavedEdits: boolean;
    lockedDueToExternalChange: boolean;
}

/**
 * Toast message when the base-address change request must be refused, or null
 * when the webview may post `changeBaseAddress`. Shared by the Base stat and
 * the `Set Raw Binary Base Address` command handler.
 */
export function baseAddressChangeRefusal(state: BaseAddressChangeState): string | null {
    if (state.format !== 'bin') { return 'Base address applies only to raw binary files.'; }
    if (state.hasUnsavedEdits) { return 'Save or discard your edits before changing the base address.'; }
    if (state.lockedDueToExternalChange) { return 'Resolve the external change before changing the base address.'; }
    return null;
}
