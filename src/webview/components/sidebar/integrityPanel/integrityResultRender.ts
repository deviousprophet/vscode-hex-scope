// ── Integrity result/card markup — pure helpers ──────────────────
// DOM-free markup + status derivation for integrity check cards and
// result bodies (split out of IntegrityPanel.ts so the class file stays
// focused on interaction + wiring). All functions are module-level and
// take the state they need as params — no class member access.

import {
    integrityByteOrder,
    integrityBytesEqual,
    integrityBytesToHex,
    integrityBytesToValueHex,
    integrityScriptName,
    isChecksumAlgorithm,
    scriptCheckPassed,
    type IntegrityAlgorithm,
    type IntegrityResult,
    type IntegrityScriptResult,
} from '../../../../core/integrity';
import { actionBtnsHtml, esc, formatHexHtml } from '../../../utils';
import type { IntegrityCheckState } from './integrityCheckModel';

export const ALGORITHM_LABELS: ReadonlyArray<readonly [IntegrityAlgorithm, string]> = [
    ['crc16-ccitt-false', 'CRC16/CCITT-FALSE'],
    ['crc32-iso-hdlc', 'CRC32/ISO-HDLC'],
    ['md5', 'MD5'],
    ['sha-1', 'SHA-1'],
    ['sha-256', 'SHA-256'],
    ['sha-512', 'SHA-512'],
];

export interface IntegrityResultRenderDeps {
    endian: () => 'le' | 'be';
    isAutoFixSuppressed: (check: IntegrityCheckState) => boolean;
}

function algorithmLabel(algorithm: IntegrityAlgorithm): string {    return ALGORITHM_LABELS.find(([value]) => value === algorithm)?.[1] ?? algorithm;
}

/** Card title: custom name, else the script file name / algorithm label. */
export function checkTitle(check: IntegrityCheckState): string {
    if (check.name) { return check.name; }
    if (check.kind === 'script') { return integrityScriptName(check.scriptPath) || 'Script'; }
    return algorithmLabel(check.algorithm);
}

/** Copy label for the calculated/value pane. */
export function calculatedCopyLabel(check: IntegrityCheckState): string {
    if (check.kind === 'script') { return `${integrityScriptName(check.scriptPath) || 'Script'} value`; }
    return `${algorithmLabel(check.algorithm)} calculated value`;
}

/** Hex text for the copy action; null when the result has no byte value. */
export function calculatedCopyValue(check: IntegrityCheckState): string | null {
    const result = check.result;
    if (!result) { return null; }
    if (result.kind === 'builtin') { return `0x${result.value}`; }
    return result.valueBytes ? `0x${integrityBytesToHex(result.valueBytes)}` : null;
}

/** Script checks never apply endianness — their bytes are already literal. */
function storedPaneLabel(check: IntegrityCheckState, endian: 'le' | 'be'): string {
    if (check.kind !== 'builtin') { return 'Stored'; }
    return isChecksumAlgorithm(check.algorithm) ? `Stored (${endian.toUpperCase()})` : 'Stored';
}

function checkRangeSummary(check: IntegrityCheckState): string {
    const range = check.startRaw && check.endRaw ? `${check.startRaw}–${check.endRaw}` : 'Not configured';
    return check.storedRaw ? `${range} · stored ${check.storedRaw}` : range;
}

function scriptChipHtml(check: IntegrityCheckState): string {
    if (check.kind !== 'script') { return ''; }
    const name = integrityScriptName(check.scriptPath) || 'script';
    return ` <span class="integrity-script-chip" title="${esc(check.scriptPath)}">Script · ${esc(name)}</span>`;
}

export function hasStoredValue(check: IntegrityCheckState): boolean {
    // A script check only knows its stored field length once a value result exists.
    if (check.kind === 'script') { return !!check.storedRaw && !!check.expectedBytes; }
    return !!check.storedRaw;
}

function hasComparableStoredValue(check: IntegrityCheckState): check is IntegrityCheckState & {
    expectedBytes: Uint8Array;
    storedBytes: Uint8Array;
} {
    return !!check.storedBytes && !!check.expectedBytes;
}

export function isMismatchedCheck(check: IntegrityCheckState): boolean {
    if (isBusyCheck(check)) { return false; }
    if (isVerifiedScriptCheck(check)) { return false; }
    return hasComparableStoredValue(check) &&
        !integrityBytesEqual(check.expectedBytes, check.storedBytes);
}

function isBusyCheck(check: IntegrityCheckState): boolean {
    return check.calculating || check.stale;
}

/** An authoritative `valid: true` script result never shows as a mismatch. */
function isVerifiedScriptCheck(check: IntegrityCheckState): boolean {
    return check.result?.kind === 'script' && check.result.valid === true;
}

export function highlightStatus(check: IntegrityCheckState): 'match' | 'mismatch' | 'unverified' {
    if (check.result?.kind === 'script') { return scriptHighlightStatus(check.result, check.storedBytes); }
    return storedHighlightStatus(check);
}

function scriptHighlightStatus(
    result: IntegrityScriptResult,
    storedBytes: Uint8Array | null,
): 'match' | 'mismatch' | 'unverified' {
    const passed = scriptCheckPassed(result, storedBytes);
    return passed === undefined ? 'unverified' : passedStatus(passed);
}

function storedHighlightStatus(check: IntegrityCheckState): 'match' | 'mismatch' | 'unverified' {
    if (!hasComparableStoredValue(check)) { return 'unverified'; }
    return passedStatus(integrityBytesEqual(check.expectedBytes, check.storedBytes));
}

function passedStatus(passed: boolean): 'match' | 'mismatch' {
    return passed ? 'match' : 'mismatch';
}

export function checkStatusLabel(check: IntegrityCheckState): string {
    if (check.error) { return 'Error'; }
    if (check.calculating) { return 'Calculating'; }
    if (check.stale) { return 'Stale'; }
    return completedCheckStatus(check);
}

function completedCheckStatus(check: IntegrityCheckState): string {
    const result = check.result;
    if (!result) { return 'Not configured'; }
    if (result.kind === 'script') { return scriptStatusLabel(result, check.storedBytes); }
    return storedStatusLabel(check);
}

function storedStatusLabel(check: IntegrityCheckState): string {
    if (!hasComparableStoredValue(check)) { return 'Calculated'; }
    return integrityBytesEqual(check.expectedBytes, check.storedBytes) ? 'Match' : 'Mismatch';
}

function scriptStatusLabel(result: IntegrityScriptResult, storedBytes: Uint8Array | null): string {
    const passed = scriptCheckPassed(result, storedBytes);
    if (passed === undefined) { return 'Calculated'; }
    return result.valid !== undefined ? verifiedLabel(passed) : passedStatusLabel(passed);
}

function verifiedLabel(passed: boolean): string {
    return passed ? 'Verified' : 'Failed';
}

function passedStatusLabel(passed: boolean): string {
    return passed ? 'Match' : 'Mismatch';
}

export function checkStatusClass(check: IntegrityCheckState): string {
    return checkStatusLabel(check).toLocaleLowerCase().replace(' ', '-');
}

export function resultBodyHtml(check: IntegrityCheckState, deps: IntegrityResultRenderDeps): string {
    if (check.error) { return `<div class="integrity-error">${esc(check.error)}</div>`; }
    if (check.result) { return calculatedResultBodyHtml(check, check.result, deps); }
    if (check.calculating) { return pendingResultBodyHtml(check, deps); }
    return emptyResultBodyHtml(check.meta);
}

function emptyResultBodyHtml(meta: string): string {
    return `<div class="integrity-card-empty">${esc(meta || 'No result yet.')}</div>`;
}

function pendingResultBodyHtml(check: IntegrityCheckState, deps: IntegrityResultRenderDeps): string {
    const stored = hasStoredValue(check) ? pendingStoredResultHtml(check, deps) : '';
    const label = check.kind === 'script' ? 'Value' : 'Calculated';
    return `
    <div class="integrity-comparison${singleComparisonClass(stored)}">
        <div class="integrity-value-pane calculated pending">
            <div class="integrity-value-hdr">
                <span>${label}</span>
                <button class="integrity-copy-btn" type="button" title="Copy calculated value" aria-label="Copy calculated value" disabled>⧉</button>
            </div>
            <code>${formatHexHtml('0x—')}</code>
        </div>
        ${stored}
    </div>
    <div class="integrity-result-meta">${esc(check.meta)}</div>`;
}

function pendingStoredResultHtml(check: IntegrityCheckState, deps: IntegrityResultRenderDeps): string {
    const storedLabel = storedPaneLabel(check, deps.endian());
    return `<div class="integrity-value-pane stored unverified pending">
    <div class="integrity-value-hdr"><span>${storedLabel}</span>${autoFixToggleHtml(check, deps.isAutoFixSuppressed(check))}</div>
    <code>${formatHexHtml('0x—')}</code>
</div>`;
}

function calculatedResultBodyHtml(
    check: IntegrityCheckState,
    result: IntegrityResult,
    deps: IntegrityResultRenderDeps,
): string {
    const stored = storedResultHtml(check, deps);
    const display = calculatedDisplay(result);
    const copy = display.copyValue === null
        ? ''
        : `<button class="integrity-copy-btn" type="button" data-copy-calculated data-check-id="${check.id}" title="Copy calculated value" aria-label="Copy calculated value">⧉</button>`;
    return `
    <div class="integrity-comparison${singleComparisonClass(stored)}">
        <div class="integrity-value-pane calculated${check.kind === 'script' ? ' script' : ''}">
            <div class="integrity-value-hdr">
                <span>${display.label}</span>
                ${copy}
            </div>
            <code>${display.html}</code>
        </div>
        ${stored}
    </div>
    ${staleNoteHtml(check)}
    <div class="integrity-result-meta">${esc(check.meta)}</div>`;
}

function calculatedDisplay(result: IntegrityResult): { label: string; copyValue: string | null; html: string } {
    if (result.kind === 'builtin') {
        return { label: 'Calculated', copyValue: `0x${result.value}`, html: formatHexHtml(`0x${result.value}`) };
    }
    if (result.valueBytes) {
        const hex = integrityBytesToHex(result.valueBytes);
        return { label: 'Value', copyValue: `0x${hex}`, html: formatHexHtml(`0x${hex}`) };
    }
    const text = result.valid ? 'PASS' : 'FAIL';
    return { label: 'Verify', copyValue: null, html: `<span>${text}</span>` };
}

function staleNoteHtml(check: IntegrityCheckState): string {
    return check.stale ? '<div class="integrity-stale-note">Stale — refresh</div>' : '';
}

function singleComparisonClass(storedHtml: string): string {
    return storedHtml ? '' : ' integrity-comparison-single';
}

function storedResultHtml(check: IntegrityCheckState, deps: IntegrityResultRenderDeps): string {
    if (!check.storedBytes) { return ''; }
    const state = highlightStatus(check);
    const raw = integrityBytesToHex(check.storedBytes);
    const value = check.kind === 'script'
        ? raw
        : integrityBytesToValueHex(check.storedBytes, integrityByteOrder(check.algorithm, deps.endian()));
    const storedLabel = storedPaneLabel(check, deps.endian());
    return `<div class="integrity-value-pane stored ${state}">
    <div class="integrity-value-hdr"><span>${storedLabel}</span>${autoFixToggleHtml(check, deps.isAutoFixSuppressed(check))}</div>
    <code title="Raw bytes: 0x${raw}">${formatHexHtml(`0x${value}`)}</code>
</div>`;
}

export function checkCardHtml(check: IntegrityCheckState, cardClass: string, bodyHtml: string): string {
    return `
    <div class="${cardClass}" data-check-id="${check.id}">
        <div class="sb-card-hdr" data-check-toggle>
            <span class="integrity-card-status" data-check-status></span>
            <div class="sb-card-info">
                <div class="integrity-card-title">${esc(checkTitle(check))}</div>
                <div class="integrity-card-meta">${esc(checkRangeSummary(check))}${scriptChipHtml(check)}</div>
            </div>
            ${scriptCardActionsHtml(check)}
            ${actionBtnsHtml(`data-check-id="${check.id}"`, `data-check-id="${check.id}"`)}
        </div>
        ${bodyHtml}
    </div>`;
}

/** Refresh + open-script actions on script check cards. */
function scriptCardActionsHtml(check: IntegrityCheckState): string {
    if (check.kind !== 'script') { return ''; }
    const disabled = check.calculating ? ' disabled' : '';
    return `<button type="button" class="act-btn integrity-script-btn" data-script-refresh data-check-id="${check.id}" title="Refresh script check" aria-label="Refresh script check"${disabled}>↻</button>` +
        `<button type="button" class="act-btn integrity-script-btn" data-script-open data-check-id="${check.id}" title="Open script" aria-label="Open script">↗</button>`;
}

export function checkCardClass(id: number, highlightedCheckId: number | null): string {
    const selected = highlightedCheckId === id ? ' integrity-card-selected' : '';
    return `sb-card integrity-card oi-expanded${selected}`;
}

export function checkCardBodyHtml(
    check: IntegrityCheckState,
    editingCheckId: number | null,
    editFormHtml: (check: IntegrityCheckState) => string,
): string {
    if (editingCheckId === check.id) { return editFormHtml(check); }
    return '<div class="integrity-card-body" data-check-body></div>';
}

function autoFixToggleHtml(check: IntegrityCheckState, paused: boolean): string {
    const checked = check.autoFixStoredValue ? ' checked' : '';
    const title = paused
        ? 'Auto fix paused for this discarded mismatch. Toggle off and on or use Fix all to re-apply.'
        : 'Automatically stage mismatched stored values';
    return `<label class="integrity-auto-fix${paused ? ' paused' : ''}" title="${title}">
    <input type="checkbox" data-auto-fix data-check-id="${check.id}"${checked}>
    <span class="integrity-auto-fix-label">Auto fix</span>
    <span class="integrity-auto-fix-track" aria-hidden="true"><span class="integrity-auto-fix-knob"></span></span>
</label>`;
}
