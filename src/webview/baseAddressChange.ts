import type { HexScopeFormat } from '../core/document';

export interface BaseAddressChangeState {
    format: HexScopeFormat | undefined;
    hasUnsavedEdits: boolean;
    lockedDueToExternalChange: boolean;
}

/** Tooltip/refusal text while a save or discard is pending. */
export const BASE_ADDRESS_DIRTY_MESSAGE = 'Save or discard your edits before changing the base address.';
/** Tooltip/refusal text while an external change is unresolved. */
export const BASE_ADDRESS_LOCKED_MESSAGE = 'Resolve the external change before changing the base address.';

export interface BaseAddressFieldState {
    /** The profile-bar field exists only for raw binaries. */
    visible: boolean;
    disabled: boolean;
    /** Explanatory tooltip while disabled (dirty/locked), else null. */
    tooltip: string | null;
}

/**
 * Toast message when the base-address change request must be refused, or null
 * when the webview may focus the field. Shared by the Base stat and the
 * `Set Raw Binary Base Address` command handler.
 */
export function baseAddressChangeRefusal(state: BaseAddressChangeState): string | null {
    if (state.format !== 'bin') { return 'Base address applies only to raw binary files.'; }
    if (state.hasUnsavedEdits) { return BASE_ADDRESS_DIRTY_MESSAGE; }
    if (state.lockedDueToExternalChange) { return BASE_ADDRESS_LOCKED_MESSAGE; }
    return null;
}

/** Visibility/disabled/tooltip state for the profile-bar base field. */
export function baseAddressFieldState(state: BaseAddressChangeState): BaseAddressFieldState {
    if (state.format !== 'bin') { return { visible: false, disabled: true, tooltip: null }; }
    if (state.hasUnsavedEdits) { return { visible: true, disabled: true, tooltip: BASE_ADDRESS_DIRTY_MESSAGE }; }
    if (state.lockedDueToExternalChange) { return { visible: true, disabled: true, tooltip: BASE_ADDRESS_LOCKED_MESSAGE }; }
    return { visible: true, disabled: false, tooltip: null };
}
