// ── Integrity result/card markup — pure helpers ──────────────────
// DOM-free markup + status derivation for integrity check cards and
// result bodies (split out of IntegrityPanel.ts so the class file stays
// focused on interaction + wiring). All functions are module-level and
// take the state they need as params — no class member access.

import {
    integrityBytesEqual,
    integrityBytesToHex,
    integrityBytesToValueHex,
    isChecksumAlgorithm,
    type IntegrityAlgorithm,
    type IntegrityResult,
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

export function algorithmLabel(algorithm: IntegrityAlgorithm): string {
    return ALGORITHM_LABELS.find(([value]) => value === algorithm)?.[1] ?? algorithm;
}

function checkRangeSummary(check: IntegrityCheckState): string {
    const range = check.startRaw && check.endRaw ? `${check.startRaw}–${check.endRaw}` : 'Not configured';
    return check.storedRaw ? `${range} · stored ${check.storedRaw}` : range;
}

export function hasStoredChecksum(check: IntegrityCheckState): boolean {
    return isChecksumAlgorithm(check.algorithm) && !!check.storedRaw;
}

function hasComparableStoredValue(check: IntegrityCheckState): check is IntegrityCheckState & {
    expectedBytes: Uint8Array;
    storedBytes: Uint8Array;
} {
    return !!check.storedBytes && !!check.expectedBytes;
}

export function isMismatchedCheck(check: IntegrityCheckState): boolean {
    return !check.calculating && hasComparableStoredValue(check) &&
        !integrityBytesEqual(check.expectedBytes, check.storedBytes);
}

export function highlightStatus(check: IntegrityCheckState): 'match' | 'mismatch' | 'unverified' {
    if (!hasComparableStoredValue(check)) { return 'unverified'; }
    return integrityBytesEqual(check.expectedBytes, check.storedBytes) ? 'match' : 'mismatch';
}

export function checkStatusLabel(check: IntegrityCheckState): string {
    if (check.error) { return 'Error'; }
    if (check.calculating) { return 'Calculating'; }
    return completedCheckStatus(check);
}

function completedCheckStatus(check: IntegrityCheckState): string {
    if (!check.result) { return 'Not configured'; }
    if (!hasComparableStoredValue(check)) { return 'Calculated'; }
    return integrityBytesEqual(check.expectedBytes, check.storedBytes) ? 'Match' : 'Mismatch';
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
    const stored = hasStoredChecksum(check) ? pendingStoredResultHtml(check, deps) : '';
    return `
    <div class="integrity-comparison${singleComparisonClass(stored)}">
        <div class="integrity-value-pane calculated pending">
            <div class="integrity-value-hdr">
                <span>Calculated</span>
                <button class="integrity-copy-btn" type="button" title="Copy calculated value" aria-label="Copy calculated value" disabled>⧉</button>
            </div>
            <code>${formatHexHtml('0x—')}</code>
        </div>
        ${stored}
    </div>
    <div class="integrity-result-meta">${esc(check.meta)}</div>`;
}

function pendingStoredResultHtml(check: IntegrityCheckState, deps: IntegrityResultRenderDeps): string {
    return `<div class="integrity-value-pane stored unverified pending">
    <div class="integrity-value-hdr"><span>Stored (${deps.endian().toUpperCase()})</span>${autoFixToggleHtml(check, deps.isAutoFixSuppressed(check))}</div>
    <code>${formatHexHtml('0x—')}</code>
</div>`;
}

function calculatedResultBodyHtml(check: IntegrityCheckState, result: IntegrityResult, deps: IntegrityResultRenderDeps): string {
    const stored = storedResultHtml(check, deps);
    const display = calculatedDisplay(result);
    return `
    <div class="integrity-comparison${singleComparisonClass(stored)}">
        <div class="integrity-value-pane calculated">
            <div class="integrity-value-hdr">
                <span>${display.label}</span>
                <button class="integrity-copy-btn" type="button" data-copy-calculated data-check-id="${check.id}" title="Copy calculated value" aria-label="Copy calculated value">⧉</button>
            </div>
            <code>${formatHexHtml(`0x${display.value}`)}</code>
        </div>
        ${stored}
    </div>
    <div class="integrity-result-meta">${esc(check.meta)}</div>`;
}

function calculatedDisplay(
    result: IntegrityResult,
): { label: string; value: string } {
    return { label: 'Calculated', value: result.value };
}

function singleComparisonClass(storedHtml: string): string {
    return storedHtml ? '' : ' integrity-comparison-single';
}

function storedResultHtml(check: IntegrityCheckState, deps: IntegrityResultRenderDeps): string {
    if (!isChecksumAlgorithm(check.algorithm) || !check.storedBytes) { return ''; }
    const state = highlightStatus(check);
    const raw = integrityBytesToHex(check.storedBytes);
    const value = integrityBytesToValueHex(check.storedBytes, deps.endian());
    return `<div class="integrity-value-pane stored ${state}">
    <div class="integrity-value-hdr"><span>Stored (${deps.endian().toUpperCase()})</span>${autoFixToggleHtml(check, deps.isAutoFixSuppressed(check))}</div>
    <code title="Raw bytes: 0x${raw}">${formatHexHtml(`0x${value}`)}</code>
</div>`;
}

export function checkCardHtml(check: IntegrityCheckState, cardClass: string, bodyHtml: string): string {
    return `
    <div class="${cardClass}" data-check-id="${check.id}">
        <div class="sb-card-hdr" data-check-toggle>
            <span class="integrity-card-status" data-check-status></span>
            <div class="sb-card-info">
                <div class="integrity-card-title">${esc(algorithmLabel(check.algorithm))}</div>
                <div class="integrity-card-meta">${esc(checkRangeSummary(check))}</div>
            </div>
            ${actionBtnsHtml(`data-check-id="${check.id}"`, `data-check-id="${check.id}"`)}
        </div>
        ${bodyHtml}
    </div>`;
}

export function checkCardClass(id: number, highlightedCheckId: number | null): string {
    const selected = highlightedCheckId === id ? ' integrity-card-selected' : '';
    return `sb-card integrity-card si-expanded${selected}`;
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
