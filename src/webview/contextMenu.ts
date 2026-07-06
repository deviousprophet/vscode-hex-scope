import { formatAnalyzeCommand } from '../core/byte-tools/analysis';
import { formatCopyCommand } from '../core/byte-tools/copy';
import { formatAsciiByte, formatHexArrayByte, hexByte } from '../core/byte-tools/hex';
import { esc } from './utils';

const CTX_SEP = `<div class="ctx-sep"></div>`;

export function renderContextMenuHtml(bytes: number[], len: number, editMode: boolean): string {
    const menuBody = len === 1 ? buildSingleByteCtxMenu(bytes[0], len, editMode) : buildMultiByteCtxMenu(bytes, len, editMode);

    return `<div class="ctx-hdr">${esc(`${len} byte${len === 1 ? '' : 's'} selected`)}</div>` +
        (editMode ? `<div class="ctx-edit-badge">✏ Editing</div>` : '') +
        CTX_SEP +
        menuBody;
}

function ctxItem(cmd: string, label: string, hint = ''): string {
    return `<div class="ctx-row" data-cmd="${cmd}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        (hint ? `<span class="ctx-hint">${esc(hint)}</span>` : '') +
        `</div>`;
}

function ctxSubmenu(label: string, id: string, body: string): string {
    return `<div class="ctx-row ctx-has-sub" data-sub="${id}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<div class="ctx-submenu">${body}</div>` +
        `</div>`;
}

function ctxPreview(text: string): string {
    return text.length > 20 ? `${text.slice(0, 18)}\u2026` : text;
}

function buildFillMenu(len: number): string {
    const fillPresets: [number, string][] = [
        [0x00, 'Zero              (0x00)'],
        [0xFF, 'Erased flash      (0xFF)'],
    ];
    const customRow =
        `<div class="ctx-custom-row">` +
        `<span class="ctx-label">Custom</span>` +
        `<div class="ctx-custom-input-wrap">` +
        `<span class="ctx-custom-prefix">0x</span>` +
        `<input class="ctx-fill-input" type="text" maxlength="2" placeholder="FF" spellcheck="false">` +
        `<button class="ctx-fill-apply" title="Apply">&#10003;</button>` +
        `</div></div>`;

    return fillPresets.map(([v, lbl]) => ctxItem(`fill-${hexByte(v)}`, lbl, len > 1 ? `× ${len}` : '')).join('') +
        CTX_SEP +
        customRow;
}

function buildSingleByteCtxMenu(value: number, len: number, editMode: boolean): string {
    const binValue = value.toString(2).padStart(8, '0');
    const copyMenu =
        ctxItem('hex', 'Hex', `0x${hexByte(value)}`) +
        ctxItem('dec', 'Decimal', `${value}`) +
        ctxItem('binary', 'Binary', `${binValue.slice(0, 4)} ${binValue.slice(4)}`) +
        (formatAsciiByte(value) !== '.' ? ctxItem('ascii', 'ASCII', `'${String.fromCharCode(value)}'`) : '');

    return ctxSubmenu('Copy', 'copy', copyMenu) +
        (editMode ? CTX_SEP + ctxSubmenu('Patch', 'fill', buildFillMenu(len)) : '');
}

function buildMultiByteCopyMenu(bytes: number[]): string {
    return ctxItem('hex', 'Hex (spaces)', ctxPreview(formatCopyCommand('hex', bytes))) +
        ctxItem('hex-raw', 'Hex (raw)', ctxPreview(formatCopyCommand('hex-raw', bytes))) +
        ctxItem('binary', 'Binary', ctxPreview(formatCopyCommand('binary', bytes))) +
        ctxItem('ascii', 'ASCII', ctxPreview(formatCopyCommand('ascii', bytes))) +
        CTX_SEP +
        ctxItem('dec-array', 'Decimal Array', ctxPreview(formatCopyCommand('dec-array', bytes))) +
        ctxItem('hex-array', 'Hex Array', ctxPreview(formatCopyCommand('hex-array', bytes))) +
        ctxItem('c-array', 'C Array', ctxPreview(`{${bytes.map(formatHexArrayByte).join(', ')}}`)) +
        CTX_SEP +
        ctxItem('base64', 'Base64', ctxPreview(formatCopyCommand('base64', bytes)));
}

function buildAnalyzeMenu(bytes: number[]): string {
    const sum = formatAnalyzeCommand('an-sum', bytes);
    const xor = formatAnalyzeCommand('an-xor', bytes);
    const crc8 = formatAnalyzeCommand('an-crc8', bytes);
    const crc16 = formatAnalyzeCommand('an-crc16', bytes);
    const crc32 = formatAnalyzeCommand('an-crc32', bytes);

    return ctxItem('an-sum', 'Sum', sum.text.replace(' (', '  (')) +
        ctxItem('an-xor', 'XOR', xor.text) +
        CTX_SEP +
        ctxItem('an-crc8', 'CRC-8', crc8.text) +
        ctxItem('an-crc16', 'CRC-16', crc16.text) +
        ctxItem('an-crc32', 'CRC-32', crc32.text);
}

function buildMultiByteCtxMenu(bytes: number[], len: number, editMode: boolean): string {
    return ctxSubmenu('Copy', 'copy', buildMultiByteCopyMenu(bytes)) +
        ctxSubmenu('Analyze', 'analyze', buildAnalyzeMenu(bytes)) +
        (editMode ? CTX_SEP + ctxSubmenu('Fill / Patch', 'fill', buildFillMenu(len)) : '');
}
