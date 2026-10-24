// ── Integrity range/stored highlight helpers ─────────────────────
// Derivation + reporting of the check-range highlight and the stored
// value write target (split out of IntegrityPanel.ts). Pure derivation;
// reporting goes through the injected onHighlightChange hook.

import {
    parseIntegrityAddress,
    validateIntegrityAddressRange,
} from '../../../../core/integrity';
import type { IntegrityCheckState, StoredValueUpdate } from './integrityCheckModel';
import { hasStoredValue, highlightStatus } from './integrityResultRender';
import { integrityOutputByteLength } from './integrityCalculation';
import type { IntegrityHighlight } from './integrityPanel';

export interface IntegrityHighlightHooks {
    onHighlightChange: (highlight: IntegrityHighlight | null) => void;
}

export function syncHighlight(
    checks: IntegrityCheckState[],
    highlightedCheckId: number | null,
    hooks: IntegrityHighlightHooks,
): void {
    const check = checks.find(item => item.id === highlightedCheckId);
    if (!check) { clearHighlight(hooks); return; }
    const highlight = highlightForCheck(check);
    if (!highlight) { clearHighlight(hooks); return; }
    hooks.onHighlightChange(highlight);
}

function highlightForCheck(check: IntegrityCheckState): IntegrityHighlight | null {
    const range = validateIntegrityAddressRange(check.startRaw, check.endRaw);
    if (!range.ok) { return null; }
    const highlight: IntegrityHighlight = {
        rangeStart: range.value.startAddress,
        rangeEnd: range.value.endAddress,
        status: highlightStatus(check),
    };
    addStoredHighlight(highlight, check);
    return highlight;
}

function addStoredHighlight(highlight: IntegrityHighlight, check: IntegrityCheckState): void {
    if (!hasStoredValue(check)) { return; }
    const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!stored.ok) { return; }
    const byteLength = storedByteLength(check);
    if (!byteLength) { return; }
    highlight.storedStart = stored.value;
    highlight.storedLength = byteLength;
}

/** Built-in length comes from the algorithm; script length from the value bytes. */
function storedByteLength(check: IntegrityCheckState): number | null {
    return check.kind === 'script'
        ? scriptStoredByteLength(check)
        : integrityOutputByteLength(check.algorithm);
}

function scriptStoredByteLength(check: IntegrityCheckState): number | null {
    const expected = byteArrayLength(check.expectedBytes);
    return expected !== undefined ? expected : (byteArrayLength(check.storedBytes) ?? null);
}

function byteArrayLength(bytes: Uint8Array | null): number | undefined {
    return bytes ? bytes.length : undefined;
}

export function clearHighlight(hooks: IntegrityHighlightHooks): void {
    hooks.onHighlightChange(null);
}

export function storedValueUpdate(check: IntegrityCheckState): StoredValueUpdate | null {
    if (!check.expectedBytes) { return null; }
    if (!check.storedRaw) { return null; }
    const stored = parseIntegrityAddress(check.storedRaw, 'Stored value');
    if (!stored.ok) { return null; }
    return { address: stored.value, expected: Uint8Array.from(check.expectedBytes) };
}
