// ── MenuRender: pure hex-grid menu markup ────────────────────────
// Pure renderer for the hex grid's right-click menu. Lives apart from
// MenuController (interaction) so render-only consumers (hexViewer,
// tests) never pull the controller, and controller churn never touches
// markup. Same `menu-*` class lexicon as MenuController.

import { formatAnalyzeCommand } from '../../../core/byteTools/analysis';
import { formatCopyCommand } from '../../../core/byteTools/copy';
import { formatAsciiByte, formatHexArrayByte, hexByte } from '../../../core/byteTools/hex';
import { esc } from '../../utils';

const MENU_SEP = `<div class="menu-sep" role="separator"></div>`;

export interface MenuState {
    selectionActive: boolean;
    len: number;
    bytes: number[];
    editMode: boolean;
    locked: boolean;
    endian: 'le' | 'be';
    /** Precomputed go-address target + mapped flag. null = not applicable (len !== 4). */
    goAddress: { address: number; valid: boolean } | null;
}

export function renderMenuHtml(state: MenuState): string {
    const body = state.len === 1 ? buildSingleByteBody(state) : buildMultiByteBody(state);

    return `<div class="menu-header">${esc(`${state.len} byte${state.len === 1 ? '' : 's'} selected`)}</div>` +
        (state.editMode ? `<div class="menu-edit-badge">&#9998; Editing</div>` : '') +
        MENU_SEP +
        body;
}

function menuItem(cmd: string, label: string, hint = ''): string {
    return `<div class="menu-item" data-cmd="${cmd}" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${esc(label)}</span>` +
        (hint ? `<span class="menu-hint">${esc(hint)}</span>` : '') +
        `</div>`;
}

function menuSubmenu(label: string, id: string, body: string): string {
    return `<div class="menu-item menu-has-sub" data-sub="${id}" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${esc(label)}</span>` +
        `<div class="menu-submenu">${body}</div>` +
        `</div>`;
}

function menuPreview(text: string): string {
    return text.length > 20 ? `${text.slice(0, 18)}\u2026` : text;
}

function goAddressRow(state: MenuState): string {
    if (!state.goAddress) { return ''; }
    const { address, valid } = state.goAddress;
    const preview = `0x${address.toString(16).toUpperCase().padStart(8, '0')} ${state.endian.toUpperCase()}`;
    return `<div class="menu-item menu-go-row${valid ? '' : ' menu-disabled'}" data-cmd="go-address" role="menuitem" tabindex="-1"${valid ? '' : ' aria-disabled="true" title="Not mapped"'}>` +
        `<span class="menu-label">Go address</span>` +
        `<span class="menu-hint menu-go">${esc(preview)}</span>` +
        `</div>`;
}

function interactionRows(state: MenuState): string {
    return goAddressRow(state) +
        menuItem('select-all', 'Select all') +
        menuItem('select-segment', 'Select segment');
}

/** "Edit selected bytes" session launcher; only meaningful for >= 2 mapped bytes. */
function editSelectedRow(state: MenuState): string {
    if (state.bytes.length < 2) { return ''; }
    const canEdit = state.editMode && !state.locked;
    const disabled = canEdit ? '' : ' menu-disabled';
    const title = state.locked ? 'File is locked' : 'Enter edit mode first';
    const aria = canEdit ? '' : ` aria-disabled="true" title="${title}"`;
    return `<div class="menu-item${disabled}" data-cmd="edit-selected" role="menuitem" tabindex="-1"${aria}>` +
        `<span class="menu-label">Edit selected bytes</span>` +
        `</div>`;
}

function buildFillMenu(len: number): string {
    const fillPresets: [number, string][] = [
        [0x00, 'Zero'],
        [0xFF, 'Erased flash'],
    ];
    const customRow =
        `<div class="menu-custom-row">` +
        `<span class="menu-label">Custom</span>` +
        `<div class="menu-custom-input-wrap">` +
        `<span class="menu-custom-prefix">0x</span>` +
        `<input class="menu-fill-input" type="text" maxlength="2" placeholder="FF" spellcheck="false">` +
        `<button class="menu-fill-apply" title="Apply">&#10003;</button>` +
        `</div></div>`;
    const hintFor = (v: number): string => `${v === 0 ? '(0x00)' : '(0xFF)'}${len > 1 ? ` \u00d7 ${len}` : ''}`;

    return fillPresets.map(([v, label]) => menuItem(`fill-${hexByte(v)}`, label, hintFor(v))).join('') +
        MENU_SEP +
        customRow;
}

/** Remaining copy formats: the direct top-level ones are omitted. */
function buildMultiCopyAsMenu(bytes: number[]): string {
    return menuItem('hex-raw', 'Hex (raw)', menuPreview(formatCopyCommand('hex-raw', bytes))) +
        menuItem('binary', 'Binary', menuPreview(formatCopyCommand('binary', bytes))) +
        menuItem('dec-array', 'Decimal Array', menuPreview(formatCopyCommand('dec-array', bytes))) +
        menuItem('hex-array', 'Hex Array', menuPreview(formatCopyCommand('hex-array', bytes))) +
        MENU_SEP +
        menuItem('base64', 'Base64', menuPreview(formatCopyCommand('base64', bytes)));
}

function buildSingleCopyAsMenu(value: number): string {
    const binValue = value.toString(2).padStart(8, '0');
    return menuItem('dec', 'Decimal', `${value}`) +
        menuItem('binary', 'Binary', `${binValue.slice(0, 4)} ${binValue.slice(4)}`);
}

function buildAnalyzeMenu(bytes: number[]): string {
    const sum = formatAnalyzeCommand('an-sum', bytes);
    const xor = formatAnalyzeCommand('an-xor', bytes);
    const crc8 = formatAnalyzeCommand('an-crc8', bytes);
    const crc16 = formatAnalyzeCommand('an-crc16', bytes);
    const crc32 = formatAnalyzeCommand('an-crc32', bytes);

    return menuItem('an-sum', 'Sum', sum.text.replace(' (', '  (')) +
        menuItem('an-xor', 'XOR', xor.text) +
        MENU_SEP +
        menuItem('an-crc8', 'CRC-8', crc8.text) +
        menuItem('an-crc16', 'CRC-16', crc16.text) +
        menuItem('an-crc32', 'CRC-32', crc32.text);
}

function buildMultiByteBody(state: MenuState): string {
    const { bytes, len, editMode } = state;
    const editRow = editSelectedRow(state);
    return menuItem('copy-hex', 'Copy Hex', menuPreview(formatCopyCommand('hex', bytes))) +
        menuItem('copy-ascii', 'Copy ASCII', menuPreview(formatCopyCommand('ascii', bytes))) +
        menuItem('copy-c-array', 'Copy C Array', menuPreview(`{${bytes.map(formatHexArrayByte).join(', ')}}`)) +
        menuSubmenu('Copy as\u2026', 'copy', buildMultiCopyAsMenu(bytes)) +
        MENU_SEP +
        menuSubmenu('Analyze', 'analyze', buildAnalyzeMenu(bytes)) +
        MENU_SEP +
        interactionRows(state) +
        (editRow ? (editMode ? '' : MENU_SEP) + editRow : '') +
        (editMode ? MENU_SEP + menuSubmenu('Patch / Fill', 'fill', buildFillMenu(len)) : '');
}

function buildSingleByteBody(state: MenuState): string {
    const value = state.bytes[0] ?? 0;
    const ascii = formatAsciiByte(value);
    const asciiRow = ascii !== '.'
        ? menuItem('copy-ascii', 'Copy ASCII', `'${ascii}'`)
        : '';
    return menuItem('copy-hex', 'Copy Hex', `0x${hexByte(value)}`) +
        asciiRow +
        menuSubmenu('Copy as\u2026', 'copy', buildSingleCopyAsMenu(value)) +
        MENU_SEP +
        interactionRows(state) +
        (state.editMode ? MENU_SEP + menuSubmenu('Patch / Fill', 'fill', buildFillMenu(1)) : '');
}