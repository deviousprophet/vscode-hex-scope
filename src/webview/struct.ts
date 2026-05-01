// ── Struct Overlay — UI layer ─────────────────────────────────────
// Single section rendered into #s-struct-pins.
// Type management (create / edit / delete) is inline within that section.
// Pure codec logic lives in struct-codec.ts.

import { S }        from './state';
import { esc }      from './utils';
import { vscode }   from './api';
import { rerender } from './render';
import {
    FIELD_TYPES,
    fieldByteSize, structByteSize, decodeStruct, allStructs,
    parseStructText, fieldsToText, structToC,
} from './struct-codec.js';
import type { DecodedField } from './struct-codec.js';
import type { StructDef, StructFieldType, StructPin } from './types';

// Re-export codec symbols so callers can import from a single path.
export {
    FIELD_TYPES, TYPE_TO_C,
    fieldByteSize, fieldAlignment, structByteSize, decodeStruct, allStructs,
    parseStructText, fieldsToText, structToC,
} from './struct-codec.js';
export type { DecodedField, ParseStructTextResult } from './struct-codec.js';

// ── Module state ──────────────────────────────────────────────────

/** Struct id currently selected in the add form. */
let _applyStructId: string | null = null;
/** Set of instance card ids that are expanded. */
const _expanded = new Set<string>();
/** Array field groups that are expanded. Key: `${pinId}::${baseName}`. Collapsed by default. */
const _expandedArrayFields = new Set<string>();

type ColType = 'hex' | 'dec' | 'ascii' | 'bin';
/** Default display type for value cells (per-field default). */
let _defaultValType: ColType = 'hex';
/** Per-field display override keyed by absolute byte-start address. */
const _fieldValTypes = new Map<number, ColType>();
/** Whether the inline add-instance form is open. */
let _addingPin = false;
/** Byte start address of the currently highlighted field row. */
let _selectedFieldAddr: number | null = null;
/** Array group key of the currently highlighted array header. */
let _selectedArrKey: string | null = null;
/** Byte start addresses marked with struct-arr-sep in the hex view. */
const _arrSepAddrs: number[] = [];
/** Pin id of the currently selected instance card. */
let _selectedPinId: string | null = null;
/** Pins whose type-definition preview is open inside the card. */
const _previewedPins = new Set<string>();
/**
 * When non-null the section is in "type editor" mode.
 * `existing` is null for new types, or the original def being edited.
 * `draft`    holds the working copy being modified.
 * `fromAdd`  is true when the editor was opened from the add-instance form.
 */
let _editingType: { draft: StructDef; existing: StructDef | null; fromAdd: boolean } | null = null;

// ── Inline type editor helpers ────────────────────────────────────

function sanitizeCIdent(raw: string): string {
    return raw.replace(/[^A-Za-z0-9_]/g, '').replace(/^(\d)/, '_$1');
}

function fieldRowHtml(f: import('./types').StructField, i: number, isOnly: boolean, total: number): string {
    const typeOpts = FIELD_TYPES.map(t =>
        `<option value="${t}"${f.type === t ? ' selected' : ''}>${t}</option>`
    ).join('');
    const isArr = f.count > 1;
    const delCell = isOnly
        ? `<span class="sfe-del-placeholder"></span>`
        : `<button class="sfe-del-btn" title="Remove field">\u2715</button>`;
    const upDis  = i === 0         ? ' disabled' : '';
    const dnDis  = i === total - 1 ? ' disabled' : '';
    return (
        `<div class="struct-field-row" data-idx="${i}">` +
        `<select class="sfe-type-sel">${typeOpts}</select>` +
        `<input class="sfe-name-inp" type="text" value="${esc(f.name)}" maxlength="64" ` +
               `placeholder="fieldName" spellcheck="false" autocomplete="off">` +
        `<div class="sfe-arr-cell${isArr ? ' is-array' : ''}">` +
        `<button class="sfe-arr-toggle${isArr ? ' active' : ''}" title="${isArr ? 'Remove array' : 'Make array'}">[ ]</button>` +
        `<input class="sfe-count-inp" type="text" inputmode="numeric" ` +
               `value="${isArr ? f.count : ''}" placeholder="N" maxlength="3">` +
        `</div>` +
        `<div class="sfe-move-btns">` +
        `<button class="sfe-move-btn sfe-move-up" title="Move up"${upDis}>&#x2192;</button>` +
        `<button class="sfe-move-btn sfe-move-dn" title="Move down"${dnDis}>&#x2192;</button>` +
        `</div>` +
        delCell +
        `</div>`
    );
}

// ── C syntax-highlighted HTML from a struct definition ──────────────────────

const SC_KW   = /\b(typedef|struct)\b/g;
const SC_ATTR = /__attribute__\(\(packed\)\)/g;

function structToCHtml(def: StructDef): string {
    const nameEscRe = def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scTyp = new RegExp(
        `\\b(uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|float|double|${nameEscRe})\\b`,
        'g'
    );
    return structToC(def).split('\n').map(line => {
        const ci = line.indexOf('/*');
        const code = ci >= 0 ? line.slice(0, ci) : line;
        const cmt  = ci >= 0 ? line.slice(ci) : '';
        const isPad = /\b_pad\w+/.test(code);
        let h = esc(code);
        if (isPad) {
            const n = code.match(/_pad\w+\[(\d+)\]/)?.[1] ?? '?';
            const indent = esc(line.slice(0, line.length - line.trimStart().length));
            return `${indent}<span class="sc-cmt">/* ${n} byte${n === '1' ? '' : 's'} padding */</span>`;
        }
        h = h.replace(SC_KW,   '<span class="sc-kw">$&</span>');
        h = h.replace(SC_ATTR, '<span class="sc-attr">$&</span>');
        h = h.replace(scTyp,   '<span class="sc-type">$&</span>');
        return h + (cmt ? `<span class="sc-cmt">${esc(cmt)}</span>` : '');
    }).join('\n');
}

function editorHtml(draft: StructDef, existing: StructDef | null): string {
    const n = draft.fields.length;
    const fieldRows = draft.fields.map((f, i) => fieldRowHtml(f, i, n === 1, n)).join('');
    return (
        `<div class="si-editor-wrap">` +
        `<div class="si-editor-hdr-row">` +
        `<span class="sb-hdr" style="margin:0">${existing ? 'Edit Type' : 'New Type'}</span>` +
        `</div>` +
        `<div class="se-form">` +
        `<input id="se-name" class="se-name-inp" type="text" value="${esc(draft.name)}" ` +
               `maxlength="64" placeholder="TypeName" spellcheck="false" autocomplete="off">` +
        `<button id="se-packed" class="se-packed-btn${draft.packed ? ' active' : ''}" ` +
               `title="Toggle packed struct">__attribute__((packed))</button>` +
        `<div class="se-field-hdr"><span>Type</span><span>Name</span><span>[ ]</span><span></span></div>` +
        `<div id="se-fields">${fieldRows}</div>` +
        `<button id="se-add" class="struct-add-field-btn">+ Add Field</button>` +
        `<div class="se-btns">` +
        `<button id="se-save" class="struct-btn struct-btn-apply">Save</button>` +
        `<button id="se-cancel" class="struct-btn struct-btn-secondary">Cancel</button>` +
        (existing ? `<button id="se-delete" class="struct-btn struct-btn-danger">Delete type</button>` : '') +
        `</div>` +
        `<div id="se-preview" class="se-preview"><pre class="si-c-preview">${structToCHtml(draft)}</pre></div>` +
        `</div>` +
        `</div>`
    );
}

function syncEditorDraft(sec: HTMLElement, draft: StructDef): void {
    draft.name   = (sec.querySelector<HTMLInputElement>('#se-name'))?.value.trim() || draft.name;
    draft.packed = sec.querySelector('#se-packed')?.classList.contains('active') ?? false;
    const rows = sec.querySelectorAll<HTMLElement>('.struct-field-row');
    draft.fields = Array.from(rows).map(row => ({
        name:   sanitizeCIdent((row.querySelector('.sfe-name-inp') as HTMLInputElement).value) || 'field',
        type:   (row.querySelector('.sfe-type-sel') as HTMLSelectElement).value as StructFieldType,
        count: (() => {
            const cell = row.querySelector<HTMLElement>('.sfe-arr-cell')!;
            if (!cell.classList.contains('is-array')) { return 1; }
            const v = parseInt((row.querySelector('.sfe-count-inp') as HTMLInputElement).value);
            return isNaN(v) || v < 1 ? 1 : Math.min(v, 256);
        })(),
        endian: 'inherit',
    }));
}

function wireEditorInSec(sec: HTMLElement): void {
    if (!_editingType) { return; }
    const { draft, existing } = _editingType;

    sec.querySelector('#se-packed')!.addEventListener('click', () => {
        const btn = sec.querySelector('#se-packed')!;
        const nowPacked = !btn.classList.contains('active');
        btn.classList.toggle('active', nowPacked);
        draft.packed = nowPacked;
        refreshEditorPreview(sec, draft);
    });

    function refreshEditorPreview(s: HTMLElement, d: StructDef): void {
        syncEditorDraft(s, d);
        const pre = s.querySelector<HTMLElement>('#se-preview pre');
        if (pre) { pre.innerHTML = structToCHtml(d); }
    }

    sec.querySelector('#se-add')!.addEventListener('click', () => {
        syncEditorDraft(sec, draft);
        draft.fields.push({ name: `field${draft.fields.length}`, type: 'uint8', count: 1, endian: 'inherit' });
        renderStructPins();
    });

    sec.querySelectorAll<HTMLElement>('.sfe-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            syncEditorDraft(sec, draft);
            const row = btn.closest<HTMLElement>('.struct-field-row')!;
            draft.fields.splice(parseInt(row.dataset.idx!), 1);
            renderStructPins();
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
            syncEditorDraft(sec, draft);
            const idx = parseInt(btn.closest<HTMLElement>('.struct-field-row')!.dataset.idx!);
            if (idx > 0) {
                [draft.fields[idx - 1], draft.fields[idx]] = [draft.fields[idx], draft.fields[idx - 1]];
                renderStructPins();
            }
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-move-dn').forEach(btn => {
        btn.addEventListener('click', () => {
            syncEditorDraft(sec, draft);
            const idx = parseInt(btn.closest<HTMLElement>('.struct-field-row')!.dataset.idx!);
            if (idx < draft.fields.length - 1) {
                [draft.fields[idx], draft.fields[idx + 1]] = [draft.fields[idx + 1], draft.fields[idx]];
                renderStructPins();
            }
        });
    });

    sec.querySelectorAll<HTMLElement>('.sfe-arr-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const cell = btn.closest<HTMLElement>('.sfe-arr-cell')!;
            const nowArr = !cell.classList.contains('is-array');
            cell.classList.toggle('is-array', nowArr);
            btn.classList.toggle('active', nowArr);
            btn.title = nowArr ? 'Remove array' : 'Make array';
            if (nowArr) {
                const inp = cell.querySelector<HTMLInputElement>('.sfe-count-inp')!;
                if (!inp.value) { inp.value = '2'; }
                inp.focus(); inp.select();
            }
            refreshEditorPreview(sec, draft);
        });
    });

    sec.querySelectorAll<HTMLInputElement>('.sfe-count-inp').forEach(inp => {
        inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
            refreshEditorPreview(sec, draft);
        });
    });

    sec.querySelectorAll<HTMLInputElement>('.sfe-name-inp').forEach(inp => {
        inp.addEventListener('input', () => { refreshEditorPreview(sec, draft); });
        inp.addEventListener('blur', () => {
            const clean = sanitizeCIdent(inp.value);
            if (clean !== inp.value) { inp.value = clean || 'field'; }
            refreshEditorPreview(sec, draft);
        });
    });

    sec.querySelectorAll<HTMLSelectElement>('.sfe-type-sel').forEach(sel => {
        sel.addEventListener('change', () => { refreshEditorPreview(sec, draft); });
    });

    sec.querySelector<HTMLInputElement>('#se-name')!.addEventListener('input', () => {
        refreshEditorPreview(sec, draft);
    });

    sec.querySelector('#se-save')!.addEventListener('click', () => {
        syncEditorDraft(sec, draft);
        const nameInp = sec.querySelector<HTMLInputElement>('#se-name')!;
        const name = nameInp.value.trim();
        if (!name) { nameInp.style.borderColor = 'var(--err)'; return; }
        if (draft.fields.length === 0) { return; }
        const def: StructDef = { id: draft.id, name, packed: draft.packed ?? false, fields: draft.fields };
        const idx = S.structs.findIndex(d => d.id === def.id);
        if (idx >= 0) { S.structs[idx] = def; } else { S.structs.push(def); }
        vscode.postMessage({ type: 'saveStructs', structs: S.structs });
        const wasFromAdd = _editingType!.fromAdd;
        _editingType = null;
        if (wasFromAdd) {
            _applyStructId = def.id;
            _addingPin = true;
        }
        renderStructPins();
    });

    sec.querySelector('#se-cancel')!.addEventListener('click', () => {
        const wasFromAdd = _editingType!.fromAdd;
        _editingType = null;
        if (wasFromAdd) { _addingPin = true; }
        renderStructPins();
    });

    sec.querySelector<HTMLElement>('#se-delete')?.addEventListener('click', () => {
        const id = _editingType!.draft.id;
        S.structs    = S.structs.filter(d => d.id !== id);
        S.structPins = S.structPins.filter(p => p.structId !== id);
        if (_applyStructId === id) { _applyStructId = null; }
        vscode.postMessage({ type: 'saveStructs',    structs: S.structs });
        vscode.postMessage({ type: 'saveStructPins', pins:    S.structPins });
        _editingType = null;
        renderStructPins();
    });
}

// ── No longer exported — type management is fully internal ─────────
/** @deprecated Use inline editing via renderStructPins */
export function renderStructPanel(): void { /* no-op: removed */ }
/** @deprecated Use inline editing via renderStructPins */
export function renderStructEditor(_existing: StructDef | null, _inEl?: HTMLElement): void { /* no-op: removed */ }

// ══════════════════════════════════════════════════════════════════
// SECTION 2 — Apply Panel + Saved Instances  (#s-struct-pins)
// ══════════════════════════════════════════════════════════════════

export function renderStructPins(): void {
    const sec = document.getElementById('s-struct-pins');
    if (!sec) { return; }

    const all = allStructs();

    // Keep _applyStructId valid
    if (_applyStructId && !all.some(d => d.id === _applyStructId)) {
        _applyStructId = all[0]?.id ?? null;
    } else if (!_applyStructId && all.length > 0) {
        _applyStructId = all[0].id;
    }

    // ── Editor mode: replace section content with the type editor ──
    if (_editingType) {
        sec.innerHTML = editorHtml(_editingType.draft, _editingType.existing);
        wireEditorInSec(sec);
        sec.querySelector<HTMLInputElement>('#se-name')?.focus();
        return;
    }

    const instBadge = S.structPins.length > 0 ? `<span class="sb-badge">${S.structPins.length}</span>` : '';

    // ── Inline add form ──
    let addFormHtml = '';
    if (_addingPin) {
        const applyDef = all.find(d => d.id === _applyStructId) ?? null;
        const addrVal  = S.activeStructAddr !== null
            ? S.activeStructAddr.toString(16).toUpperCase().padStart(8, '0') : '';

        let typeRowHtml: string;
        if (all.length === 0) {
            typeRowHtml =
                `<div class="sa-row sa-no-types-row">` +
                `<span class="sa-no-types-msg">No types yet.</span>` +
                `<button id="sa-new-type-btn" class="struct-btn struct-btn-secondary">New type</button>` +
                `</div>`;
        } else {
            const structOpts = all.map(d =>
                `<option value="${esc(d.id)}"${d.id === _applyStructId ? ' selected' : ''}>${esc(d.name)}</option>`
            ).join('');
            const previewHtml = applyDef
                ? `<pre class="si-c-preview">${structToCHtml(applyDef)}</pre>`
                : '';
            typeRowHtml =
                `<div class="sa-row">` +
                `<select id="sa-struct-sel" class="struct-sel">${structOpts}</select>` +
                `<button id="sa-new-type-btn" class="si-add-type-btn" title="New type">\uff0b</button>` +
                `</div>` +
                previewHtml;
        }

        addFormHtml =
            `<div id="si-add-form" class="si-add-form">` +
            typeRowHtml +
            `<div class="sa-row">` +
            `<span class="struct-addr-pfx">0x</span>` +
            `<input id="sa-addr" class="struct-addr-inp sa-addr-inp" type="text" maxlength="8" ` +
                   `placeholder="08000000" autocomplete="off" spellcheck="false" value="${esc(addrVal)}">` +
            `<input id="sa-name" class="sa-name-inp" type="text" maxlength="40" ` +
                   `placeholder="instance name" spellcheck="false" autocomplete="off">` +
            `</div>` +
            `<div class="sa-row sa-btn-row">` +
            `<button id="sa-confirm" class="struct-btn struct-btn-apply"${!_applyStructId ? ' disabled' : ''}>Confirm</button>` +
            `<button id="sa-cancel" class="struct-btn struct-btn-cancel">Cancel</button>` +
            `</div>` +
            `</div>`;
    }

    const instHtml = S.structPins.length === 0
        ? `<div class="sb-empty">No instances yet. Click \uff0b Add to create one.</div>`
        : S.structPins.map((pin, i) => buildInstanceCard(pin, i)).join('');

    sec.innerHTML =
        `<div class="si-hdr-row">` +
        `<span class="sb-hdr" style="margin:0">Struct Instances ${instBadge}</span>` +
        `<div class="endian-tabs sa-endian-tabs">` +
        `<button id="sa-btn-le" class="${S.endian === 'le' ? 'active' : ''}">LE</button>` +
        `<button id="sa-btn-be" class="${S.endian === 'be' ? 'active' : ''}">BE</button>` +
        `</div>` +
        `<button id="si-add-btn" class="si-add-btn"${_addingPin ? ' disabled' : ''}>\uff0b Add</button>` +
        `</div>` +
        addFormHtml +
        `<div id="si-list">${instHtml}</div>`;

    // ── ＋ Add button ──
    document.getElementById('si-add-btn')!.addEventListener('click', () => {
        _addingPin = true;
        renderStructPins();
        document.getElementById('sa-name')?.focus();
    });

    // ── Add-form wiring ──
    if (_addingPin) {
        document.getElementById('sa-struct-sel')?.addEventListener('change', e => {
            _applyStructId = (e.target as HTMLSelectElement).value || null;
            renderStructPins();
        });
        document.getElementById('sa-new-type-btn')?.addEventListener('click', () => {
            _addingPin = false;
            const draftId = `user_${Date.now()}`;
            _editingType = {
                draft: { id: draftId, name: '', packed: false, fields: [{ name: 'field0', type: 'uint32', count: 1, endian: 'inherit' }] },
                existing: null,
                fromAdd: true,
            };
            renderStructPins();
        });
        document.getElementById('sa-confirm')!.addEventListener('click', () => {
            if (!_applyStructId) { return; }
            const addrInp = document.getElementById('sa-addr') as HTMLInputElement;
            const nameInp = document.getElementById('sa-name') as HTMLInputElement;
            const addr    = parseInt(addrInp.value.replace(/^0x/i, ''), 16);
            const name    = nameInp.value.trim();
            let ok = true;
            if (isNaN(addr)) { addrInp.style.borderColor = 'var(--err)'; ok = false; }
            else              { addrInp.style.borderColor = ''; }
            if (!name)        { nameInp.style.borderColor = 'var(--err)'; ok = false; }
            else              { nameInp.style.borderColor = ''; }
            if (!ok) { return; }
            const pin: StructPin = { id: `pin_${Date.now()}`, structId: _applyStructId, addr, name };
            S.structPins       = [...S.structPins, pin];
            S.activeStructAddr = addr;
            _addingPin = false;
            vscode.postMessage({ type: 'saveStructPins', pins: S.structPins });
            renderStructPins();
        });
        document.getElementById('sa-cancel')!.addEventListener('click', () => {
            _addingPin = false;
            renderStructPins();
        });
    }

    // ── Endian tabs ──
    document.getElementById('sa-btn-le')!.addEventListener('click', () => {
        S.endian = 'le';
        document.getElementById('sa-btn-le')!.classList.add('active');
        document.getElementById('sa-btn-be')!.classList.remove('active');
        if (_expanded.size > 0) { renderStructPins(); }
    });
    document.getElementById('sa-btn-be')!.addEventListener('click', () => {
        S.endian = 'be';
        document.getElementById('sa-btn-be')!.classList.add('active');
        document.getElementById('sa-btn-le')!.classList.remove('active');
        if (_expanded.size > 0) { renderStructPins(); }
    });

    wireInstanceCards(sec);
}
/** Get a display string for a field given the requested column display type. */
function getValForType(r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    const bytes = r.bytesHex.split(' ').map(h => parseInt(h, 16));
    const buf   = new ArrayBuffer(bytes.length);
    const dv    = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    const le    = S.endian === 'le';
    const hexFn = (v: number, pad: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
    const binFn = () => {
        // Continuous bit string (MSB-first per byte), grouped into 4-bit nibbles.
        const bitSeq = bytes.map(b => b.toString(2).padStart(8, '0')).join('');
        const groups = bitSeq.match(/.{1,4}/g) || [];
        const renderGroups = (grps: string[]) => grps.map(g =>
            [...g].map(bit => `<span class="si-bit ${bit === '1' ? 'one' : 'zero'}">${bit}</span>`).join('')
        ).join(' ');

        // Full HTML broken into lines of max 16 bits (4 nibbles) per line.
        const groupsPerLine = 4; // 4 nibbles = 16 bits
        const lines: string[] = [];
        for (let i = 0; i < groups.length; i += groupsPerLine) {
            lines.push(renderGroups(groups.slice(i, i + groupsPerLine)));
        }
        const fullHtml = lines.join('<br>');

        // Always return the full, multi-line binary HTML.
        return `<span class="si-bin-wrap">${fullHtml}</span>`;
    };
    // Pointer always renders as arrow → hex address regardless of valType
    if (r.type === 'pointer') {
        const v = dv.getUint32(0, le) >>> 0;
        return `<span class="si-f-ptr-sym">\u2192</span>\u2009` +
               `0x${v.toString(16).toUpperCase().padStart(8, '0')}`;
    }
    if (valType === 'bin') { return binFn(); }
    if (valType === 'ascii') {
        const s = bytes.map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
        return `'${s}'`;
    }
    switch (r.type) {
        case 'uint8':  { const v = dv.getUint8(0);              return valType === 'hex' ? hexFn(v, 2) : String(v); }
        case 'int8':   { const v = dv.getInt8(0);               return valType === 'hex' ? hexFn(dv.getUint8(0), 2) : String(v); }
        case 'uint16': { const v = dv.getUint16(0, le);         return valType === 'hex' ? hexFn(v, 4) : String(v); }
        case 'int16':  { const v = dv.getInt16(0, le);          return valType === 'hex' ? hexFn(dv.getUint16(0, le), 4) : String(v); }
        case 'uint32': { const v = dv.getUint32(0, le) >>> 0;   return valType === 'hex' ? hexFn(v, 8) : String(v); }
        case 'int32':  { const v = dv.getInt32(0, le);          return valType === 'hex' ? hexFn(dv.getUint32(0, le), 8) : String(v); }
        case 'float32': {
            const v = dv.getFloat32(0, le);
            return valType === 'hex'
                ? bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')
                : isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : parseFloat(v.toPrecision(7)).toString();
        }
        case 'float64': {
            const v = dv.getFloat64(0, le);
            return valType === 'hex'
                ? bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')
                : isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : parseFloat(v.toPrecision(10)).toString();
        }
        default: return r.decoded;
    }
}

/** Get a plain-text representation suitable for copying. */
function getCopyText(r: DecodedField, valType: ColType): string {
    if (!r.hasData) { return '??'; }
    const bytes = r.bytesHex.split(' ').map(h => parseInt(h, 16));
    const le    = S.endian === 'le';
    const hexPad = (v: number, pad: number) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(pad, '0')}`;
    if (r.type === 'pointer') {
        const buf = new ArrayBuffer(bytes.length);
        const dv = new DataView(buf);
        bytes.forEach((b, i) => dv.setUint8(i, b));
        const v = dv.getUint32(0, le) >>> 0;
        return hexPad(v, 8);
    }
    if (valType === 'bin') {
        const bitSeq = bytes.map(b => b.toString(2).padStart(8, '0')).join('');
        const groups = bitSeq.match(/.{1,4}/g) || [];
        return groups.join(' ');
    }
    if (valType === 'ascii') {
        return bytes.map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    }
    const buf = new ArrayBuffer(bytes.length);
    const dv = new DataView(buf);
    bytes.forEach((b, i) => dv.setUint8(i, b));
    switch (r.type) {
        case 'uint8':  { const v = dv.getUint8(0);              return valType === 'hex' ? hexPad(v, 2) : String(v); }
        case 'int8':   { const v = dv.getInt8(0);               return valType === 'hex' ? hexPad(dv.getUint8(0), 2) : String(v); }
        case 'uint16': { const v = dv.getUint16(0, le);         return valType === 'hex' ? hexPad(v, 4) : String(v); }
        case 'int16':  { const v = dv.getInt16(0, le);          return valType === 'hex' ? hexPad(dv.getUint16(0, le), 4) : String(v); }
        case 'uint32': { const v = dv.getUint32(0, le) >>> 0;   return valType === 'hex' ? hexPad(v, 8) : String(v); }
        case 'int32':  { const v = dv.getInt32(0, le);          return valType === 'hex' ? hexPad(dv.getUint32(0, le), 8) : String(v); }
        case 'float32': {
            const v = dv.getFloat32(0, le);
            return valType === 'hex'
                ? bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')
                : isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : parseFloat(v.toPrecision(7)).toString();
        }
        case 'float64': {
            const v = dv.getFloat64(0, le);
            return valType === 'hex'
                ? bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')
                : isNaN(v) ? 'NaN' : !isFinite(v) ? String(v) : parseFloat(v.toPrecision(10)).toString();
        }
        default: return r.decoded;
    }
}

const TYPE_ABBREV: Record<string, string> = {
    uint8: 'u8',  uint16: 'u16', uint32: 'u32',
    int8:  'i8',  int16:  'i16', int32:  'i32',
    float32: 'f32', float64: 'f64', pointer: 'ptr',
};

function mkFieldRow(r: DecodedField, bs: number, bc: number): string {
    const nd  = !r.hasData ? ' si-no-data' : '';
    const ptr = r.type === 'pointer';
    const t   = _fieldValTypes.get(bs) ?? _defaultValType;
    const v   = getValForType(r, t);
    const valHtml = (t === 'bin' || ptr) ? v : esc(v);
    const abbrev  = TYPE_ABBREV[r.type] ?? r.type;
    return (
        `<div class="si-field${nd}${ptr ? ' si-ptr-field' : ''}" ` +
        `data-byte-start="${bs}" data-byte-cnt="${bc}">` +
        `<span class="si-f-off">+${r.byteOffset.toString(16).toUpperCase().padStart(3, '0')}</span>` +
        `<span class="si-f-type">${abbrev}</span>` +
        `<span class="si-f-body">` +
        `<span class="si-f-name">${esc(r.fieldName)}</span>` +
        `<span class="si-f-lead"></span>` +
        `<span class="si-f-val si-f-pri${ptr ? ' si-f-ptr' : ''}" data-val-type="${t}" data-bs="${bs}">${valHtml}</span>` +
        `</span>` +
        `</div>`
    );
}

function buildInstanceCard(pin: StructPin, i: number): string {
    const def        = allStructs().find(d => d.id === pin.structId);
    const defName    = def ? def.name : '?';
    const totalBytes = def ? structByteSize(def) : 0;
    const addrHex    = pin.addr.toString(16).toUpperCase().padStart(8, '0');
    const expanded   = _expanded.has(pin.id);

    let bodyHtml = '';
    if (expanded && def) {
        const rows = decodeStruct(def, pin.addr, S.flatBytes, S.endian);

        // Group consecutive rows by base field name (strip [N] suffix)
        const groups: Array<{ baseName: string; rows: typeof rows }> = [];
        for (const r of rows) {
            const base = r.fieldName.replace(/\[\d+\]$/, '');
            const last = groups[groups.length - 1];
            if (last && last.baseName === base) { last.rows.push(r); }
            else { groups.push({ baseName: base, rows: [r] }); }
        }

        const fieldHtml = groups.map(g => {
            if (g.rows.length === 1) {
                // Scalar field — render flat
                const r = g.rows[0];
                return mkFieldRow(r, pin.addr + r.byteOffset, fieldByteSize(r.type));
            } else {
                // Array field group — collapsible, collapsed by default
                const key     = `${pin.id}::${g.baseName}`;
                const isOpen  = _expandedArrayFields.has(key);
                const r0      = g.rows[0];
                const byteStart = pin.addr + r0.byteOffset;
                const totalCnt  = g.rows.reduce((s, r) => s + fieldByteSize(r.type), 0);
                const elHtml     = g.rows.map(r => mkFieldRow(r, pin.addr + r.byteOffset, fieldByteSize(r.type))).join('');
                const arrAbbrev  = TYPE_ABBREV[r0.type] ?? r0.type;
                const arrSummary = `[${g.rows.length}]\u202f\u00b7\u202f${arrAbbrev}`;
                return (
                    `<div class="si-arr-grp${isOpen ? ' open' : ''}" data-arr-key="${esc(key)}">` +
                    `<div class="si-arr-grp-hdr" ` +
                    `data-byte-start="${byteStart}" data-byte-cnt="${totalCnt}">` +
                    `<span class="si-f-off">+${r0.byteOffset.toString(16).toUpperCase().padStart(3, '0')}</span>` +
                    `<button class="si-arr-exp-btn">${isOpen ? '▾' : '▸'}</button>` +
                    `<span class="si-f-body">` +
                    `<span class="si-f-name">${esc(g.baseName)}</span>` +
                    `<span class="si-f-lead"></span>` +
                    `<span class="si-arr-addr">${esc(arrSummary)}</span>` +
                    `</span>` +
                    `</div>` +
                    `<div class="si-arr-grp-body"${isOpen ? '' : ' style=\"display:none\"'}>${elHtml}</div>` +
                    `</div>`
                );
            }
        }).join('');

        bodyHtml = `<div class="si-fields">${fieldHtml}</div>`;
    }

    const typePreviewHtml = def
        ? `<div class="si-type-preview"${_previewedPins.has(pin.id) ? '' : ' style="display:none"'}>` +
          `<pre class="si-c-preview">${structToCHtml(def)}</pre>` +
          `</div>`
        : '';

    return (
        `<div class="si-card${expanded ? ' si-expanded' : ''}" data-pin-id="${esc(pin.id)}" data-idx="${i}">` +
        `<div class="si-card-hdr">` +
        `<button class="si-expand-btn" data-pin-id="${esc(pin.id)}">${expanded ? '\u25be' : '\u25b8'}</button>` +
        `<div class="si-card-info">` +
        `<span class="si-cname">${esc(pin.name)}</span>` +
        `<div class="si-cmeta-row">` +
        `<span class="si-ctype">${esc(defName)}</span>` +
        `<button class="si-type-btn${_previewedPins.has(pin.id) ? ' active' : ''}" ` +
        `data-pin-id="${esc(pin.id)}" title="View type definition">&#x29C9;</button>` +
        (def ? `<button class="si-edit-type-btn" data-struct-id="${esc(def.id)}" title="Edit type">✎</button>` : '') +
        `<span class="si-caddr">0x${addrHex}\u202f\u00b7\u202f${totalBytes}B</span>` +
        `</div>` +
        `</div>` +
        `<button class="si-del-btn" data-idx="${i}" title="Remove">\u2715</button>` +
        `</div>` +
        typePreviewHtml +
        bodyHtml +
        `</div>`
    );
}

function clearArrSep(): void {
    for (const addr of _arrSepAddrs) {
        const ah = addr.toString(16).toUpperCase().padStart(8, '0');
        document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
            .forEach(el => el.classList.remove('struct-arr-sep'));
    }
    _arrSepAddrs.length = 0;
}

function clearSelRow(): void {
    document.querySelectorAll<HTMLElement>('.si-selected')
        .forEach(el => el.classList.remove('si-selected'));
}

function wireInstanceCards(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.si-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.pinId!;
            if (_expanded.has(id)) { _expanded.delete(id); } else { _expanded.add(id); }
            renderStructPins();
        });
    });

    // Array group: arrow button toggles expand; rest of row selects in hex view
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.si-arr-exp-btn')!;
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);

        expBtn.addEventListener('click', e => {
            e.stopPropagation();
            const grp  = hdr.closest<HTMLElement>('.si-arr-grp')!;
            const key  = grp.dataset.arrKey!;
            const body = grp.querySelector<HTMLElement>('.si-arr-grp-body')!;
            const isOpen = _expandedArrayFields.has(key);
            if (isOpen) {
                _expandedArrayFields.delete(key);
                grp.classList.remove('open');
                body.style.display = 'none';
                expBtn.textContent = '▸';
            } else {
                _expandedArrayFields.add(key);
                grp.classList.add('open');
                body.style.display = '';
                expBtn.textContent = '▾';
            }
        });

        hdr.addEventListener('mouseenter', () => {
            for (let i = 0; i < cnt; i++) {
                const ah = (start + i).toString(16).toUpperCase().padStart(8, '0');
                document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
                    .forEach(el => el.classList.add('struct-h'));
            }
        });
        hdr.addEventListener('mouseleave', () => {
            document.querySelectorAll<HTMLElement>('.struct-h')
                .forEach(el => el.classList.remove('struct-h'));
        });

        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-arr-exp-btn')) { return; }
            clearArrSep();
            clearSelRow();
            if (isNaN(start) || isNaN(cnt)) { return; }
            const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
            _selectedArrKey    = grp.dataset.arrKey!;
            _selectedFieldAddr = null;
            // Mark each element's first byte (except element 0) for visual separation
            grp.querySelectorAll<HTMLElement>('.si-field').forEach((row, i) => {
                if (i === 0) { return; }
                const bs = parseInt(row.dataset.byteStart!);
                if (isNaN(bs)) { return; }
                _arrSepAddrs.push(bs);
                const ah = bs.toString(16).toUpperCase().padStart(8, '0');
                document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
                    .forEach(el => el.classList.add('struct-arr-sep'));
            });
            S.selStart = start;
            S.selEnd   = start + cnt - 1;
            hdr.classList.add('si-selected');
            import('./memoryView.js').then(m => { m.applySel(); m.scrollTo(start); });
            import('./sidebar.js').then(m => m.updateInspector());
        });
    });

    sec.querySelectorAll<HTMLElement>('.si-card-hdr').forEach(hdr => {
        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-expand-btn, .si-del-btn')) { return; }
            clearArrSep();
            clearSelRow();
            _selectedFieldAddr = null;
            _selectedArrKey    = null;
            const card = hdr.closest<HTMLElement>('.si-card')!;
            const idx  = parseInt(card.dataset.idx!);
            const pin  = S.structPins[idx];
            if (!pin) { return; }
            const def  = allStructs().find(d => d.id === pin.structId);
            if (!def)  { return; }
            const size = structByteSize(def);
            S.selStart = pin.addr;
            S.selEnd   = pin.addr + size - 1;
            S.activeStructAddr = pin.addr;
            _selectedPinId = pin.id;
            sec.querySelectorAll<HTMLElement>('.si-card').forEach(c => c.classList.remove('si-card-selected'));
            card.classList.add('si-card-selected');
            rerender.toMemory();
            import('./memoryView.js').then(m => { m.applySel(); m.scrollTo(pin.addr); });
            import('./sidebar.js').then(m => m.updateInspector());
        });
    });

    sec.querySelectorAll<HTMLElement>('.si-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx!);
            const pin = S.structPins[idx];
            if (pin) { _expanded.delete(pin.id); }
            S.structPins = S.structPins.filter((_, i) => i !== idx);
            vscode.postMessage({ type: 'saveStructPins', pins: S.structPins });
            renderStructPins();
        });
    });

    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        const start = parseInt(row.dataset.byteStart!);
        const cnt   = parseInt(row.dataset.byteCnt!);

        row.addEventListener('mouseenter', () => {
            for (let i = 0; i < cnt; i++) {
                const ah = (start + i).toString(16).toUpperCase().padStart(8, '0');
                document.querySelectorAll<HTMLElement>(`[data-addr="${ah}"]`)
                    .forEach(el => el.classList.add('struct-h'));
            }
        });

        row.addEventListener('mouseleave', () => {
            document.querySelectorAll<HTMLElement>('.struct-h')
                .forEach(el => el.classList.remove('struct-h'));
        });

        row.addEventListener('click', () => {
            if (isNaN(start) || isNaN(cnt)) { return; }
            clearArrSep();
            clearSelRow();
            S.selStart = start;
            S.selEnd   = start + cnt - 1;
            row.classList.add('si-selected');
            _selectedFieldAddr = start;
            _selectedArrKey    = null;
            import('./memoryView.js').then(m => { m.applySel(); m.scrollTo(start); });
            import('./sidebar.js').then(m => m.updateInspector());
        });
    });

    // Right-click on a field row to open the value menu. Pass the pin index
    // so the menu can decode values when performing copy actions.
    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        row.addEventListener('contextmenu', ev => {
            ev.preventDefault(); ev.stopPropagation();
            const start = parseInt(row.dataset.byteStart!);
            const card = row.closest<HTMLElement>('.si-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            // Determine if this is a pointer field
            const valCell = row.querySelector<HTMLElement>('.si-f-val');
            const isPointer = valCell?.classList.contains('si-f-ptr');
            // Only allow per-element change, not group, for array elements
            showFieldValMenu(ev.clientX, ev.clientY, start, undefined, pinIdx, { isPointer });
        });
    });

    // Right-click on an array group header should allow actions on the
    // entire group (child elements).
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        hdr.addEventListener('contextmenu', ev => {
            ev.preventDefault(); ev.stopPropagation();
            const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
            const bsList = Array.from(grp.querySelectorAll<HTMLElement>('.si-field'))
                .map(r => parseInt(r.dataset.byteStart!));
            const card = hdr.closest<HTMLElement>('.si-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            const start = bsList[0];
            showFieldValMenu(ev.clientX, ev.clientY, start, bsList, pinIdx, { isArrayHeader: true });
        });
    });

    // Type-definition preview toggle inside card header
    sec.querySelectorAll<HTMLElement>('.si-type-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.dataset.pinId!;
            const card = btn.closest<HTMLElement>('.si-card')!;
            const preview = card.querySelector<HTMLElement>('.si-type-preview');
            if (_previewedPins.has(id)) {
                _previewedPins.delete(id);
                btn.classList.remove('active');
                if (preview) { preview.style.display = 'none'; }
            } else {
                _previewedPins.add(id);
                btn.classList.add('active');
                if (preview) { preview.style.display = ''; }
            }
        });
    });

    // Edit-type button on card
    sec.querySelectorAll<HTMLElement>('.si-edit-type-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const structId = btn.dataset.structId!;
            const existing = S.structs.find(d => d.id === structId) ?? null;
            if (!existing) { return; }
            _editingType = {
                draft: { id: existing.id, name: existing.name, packed: existing.packed ?? false, fields: existing.fields.map(f => ({ ...f })) },
                existing,
                fromAdd: false,
            };
            renderStructPins();
        });
    });

    // Re-apply selection highlight after DOM rebuild
    if (_selectedPinId !== null) {
        sec.querySelectorAll<HTMLElement>('.si-card').forEach(card => {
            if (card.dataset.pinId === _selectedPinId) {
                card.classList.add('si-card-selected');
            }
        });
    }
    if (_selectedFieldAddr !== null) {
        sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
            if (parseInt(row.dataset.byteStart!) === _selectedFieldAddr) {
                row.classList.add('si-selected');
            }
        });
    } else if (_selectedArrKey !== null) {
        sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
            const grp = hdr.closest<HTMLElement>('.si-arr-grp');
            if (grp?.dataset.arrKey === _selectedArrKey) {
                hdr.classList.add('si-selected');
            }
        });
    }
}

// Floating per-field value-type menu
let _valMenuEl: HTMLElement | null = null;
function hideFieldValMenu(): void {
    if (_valMenuEl) { _valMenuEl.remove(); _valMenuEl = null; }
    document.removeEventListener('click', hideFieldValMenu);
}
function showFieldValMenu(x: number, y: number, bs: number, bsList?: number[], pinIdx?: number, opts?: { isPointer?: boolean, isArrayHeader?: boolean }): void {
    hideFieldValMenu();
    const types: ColType[] = ['hex', 'dec', 'bin', 'ascii'];
    let cur: ColType | null = null;
    if (bsList && bsList.length > 0) {
        const vals = bsList.map(b => _fieldValTypes.get(b) ?? _defaultValType);
        const allSame = vals.every(v => v === vals[0]);
        cur = allSame ? (vals[0] as ColType) : null;
    } else {
        cur = _fieldValTypes.get(bs) ?? _defaultValType;
    }

    // Helpers for menu
    const item = (cmd: string, label: string, hint = '') =>
        `<div class="ctx-row" data-cmd="${cmd}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        (hint ? `<span class="ctx-hint">${esc(hint)}</span>` : '') +
        `</div>`;
    const sep = `<div class="ctx-sep"></div>`;
    const sub = (label: string, id: string, body: string) =>
        `<div class="ctx-row ctx-has-sub" data-sub="${id}">` +
        `<span class="ctx-label">${esc(label)}</span>` +
        `<div class="ctx-submenu">${body}</div>` +
        `</div>`;

    // Array header: copy start address + view-as for all elements
    if (opts?.isArrayHeader) {
        const TYPE_LABELS: Record<ColType, string> = { hex: 'Hex', dec: 'Decimal', bin: 'Binary', ascii: 'ASCII' };
        const dispMenu = types.map(t =>
            `<div class="ctx-row${t === cur ? ' active' : ''}" data-cmd="disp-${t}">` +
            `<span class="ctx-label">${TYPE_LABELS[t]}</span>` +
            `</div>`
        ).join('');
        const el = document.createElement('div');
        el.id = 'si-val-menu'; el.className = 'si-val-menu ctx-menu';
        el.innerHTML =
            item('copy-addr', 'Copy address') +
            sep +
            sub('View as', 'disp', dispMenu);
        document.body.appendChild(el);
        const mw = el.offsetWidth || 200; const mh = el.offsetHeight || 80;
        el.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
        el.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;
        el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row => {
            row.addEventListener('click', ev => {
                ev.stopPropagation();
                const cmd = row.dataset.cmd!;
                if (cmd === 'copy-addr') {
                    const addrStr = `0x${bs.toString(16).toUpperCase().padStart(8, '0')}`;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(addrStr).catch(() => {
                            const ta = document.createElement('textarea');
                            ta.value = addrStr; document.body.appendChild(ta); ta.select();
                            document.execCommand('copy'); ta.remove();
                        });
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = addrStr; document.body.appendChild(ta); ta.select();
                        document.execCommand('copy'); ta.remove();
                    }
                    hideFieldValMenu();
                    return;
                }
                if (cmd.startsWith('disp-') && bsList && bsList.length > 0) {
                    const t = cmd.replace('disp-', '') as ColType;
                    bsList.forEach(b => {
                        if (t === _defaultValType) { _fieldValTypes.delete(b); }
                        else { _fieldValTypes.set(b, t); }
                    });
                    hideFieldValMenu();
                    renderStructPins();
                }
            });
        });
        wireStructSubmenus(el);
        setTimeout(() => document.addEventListener('click', hideFieldValMenu), 0);
        _valMenuEl = el;
        return;
    }

    // Pointer: only allow copy address value
    if (opts?.isPointer) {
        const el = document.createElement('div');
        el.id = 'si-val-menu'; el.className = 'si-val-menu ctx-menu';
        el.innerHTML = item('copy-hex', 'Copy value');
        document.body.appendChild(el);
        const mw = el.offsetWidth || 180; const mh = el.offsetHeight || 60;
        el.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
        el.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;
        el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row => {
            row.addEventListener('click', ev => {
                ev.stopPropagation();
                // Always copy as hex address
                let pin: StructPin | undefined;
                const all = allStructs();
                if (typeof pinIdx === 'number' && pinIdx >= 0) {
                    pin = S.structPins[pinIdx];
                } else {
                    pin = S.structPins.find(p => {
                        const def = all.find(d => d.id === p.structId);
                        if (!def) { return false; }
                        const size = structByteSize(def);
                        return bs >= p.addr && bs < p.addr + size;
                    });
                }
                if (!pin) { hideFieldValMenu(); return; }
                const def = all.find(d => d.id === pin!.structId);
                if (!def) { hideFieldValMenu(); return; }
                const rows = decodeStruct(def, pin.addr, S.flatBytes, S.endian);
                const r = rows.find(rr => pin!.addr + rr.byteOffset === bs);
                const toCopy = r ? getCopyText(r, 'hex') : '??';
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(toCopy).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = toCopy; document.body.appendChild(ta); ta.select();
                        document.execCommand('copy'); ta.remove();
                    });
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = toCopy; document.body.appendChild(ta); ta.select();
                    document.execCommand('copy'); ta.remove();
                }
                hideFieldValMenu();
                return;
            });
        });
        setTimeout(() => document.addEventListener('click', hideFieldValMenu), 0);
        _valMenuEl = el;
        return;
    }

    const TYPE_LABELS: Record<ColType, string> = { hex: 'Hex', dec: 'Decimal', bin: 'Binary', ascii: 'ASCII' };

    // Copy submenu
    const copyMenu = types.map(t =>
        item(`copy-${t}`, TYPE_LABELS[t], '')
    ).join('');

    // Display type submenu
    const dispMenu = types.map(t =>
        `<div class="ctx-row${t===cur ? ' active' : ''}" data-cmd="disp-${t}">` +
        `<span class="ctx-label">${TYPE_LABELS[t]}</span>` +
        `</div>`
    ).join('');
    // Compose menu
    const el = document.createElement('div');
    el.id = 'si-val-menu'; el.className = 'si-val-menu ctx-menu';
    el.innerHTML =
        sub('Copy', 'copy', copyMenu) +
        sep +
        sub('View as', 'disp', dispMenu);

    document.body.appendChild(el);
    const mw = el.offsetWidth || 220; const mh = el.offsetHeight || 120;
    el.style.left = `${Math.min(x, window.innerWidth - mw - 8)}px`;
    el.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;

    // Wire leaf-item clicks
    el.querySelectorAll<HTMLElement>('.ctx-row[data-cmd]').forEach(row => {
        row.addEventListener('click', ev => {
            ev.stopPropagation();
            const cmd = row.dataset.cmd!;
            // Copy actions
            if (cmd.startsWith('copy-')) {
                const t = cmd.replace('copy-', '') as ColType;
                let pin: StructPin | undefined;
                const all = allStructs();
                if (typeof pinIdx === 'number' && pinIdx >= 0) {
                    pin = S.structPins[pinIdx];
                } else {
                    pin = S.structPins.find(p => {
                        const def = all.find(d => d.id === p.structId);
                        if (!def) { return false; }
                        const size = structByteSize(def);
                        return bs >= p.addr && bs < p.addr + size;
                    });
                }
                if (!pin) { hideFieldValMenu(); return; }
                const def = all.find(d => d.id === pin!.structId);
                if (!def) { hideFieldValMenu(); return; }
                const rows = decodeStruct(def, pin.addr, S.flatBytes, S.endian);
                const toCopy = (bsList && bsList.length > 0)
                    ? bsList.map(b => {
                        const r = rows.find(rr => pin!.addr + rr.byteOffset === b);
                        return r ? getCopyText(r, t) : '??';
                      }).join('\n')
                    : (() => {
                        const r = rows.find(rr => pin!.addr + rr.byteOffset === bs);
                        return r ? getCopyText(r, t) : '??';
                      })();
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(toCopy).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = toCopy; document.body.appendChild(ta); ta.select();
                        document.execCommand('copy'); ta.remove();
                    });
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = toCopy; document.body.appendChild(ta); ta.select();
                    document.execCommand('copy'); ta.remove();
                }
                hideFieldValMenu();
                return;
            }
            // Display type actions
            if (cmd.startsWith('disp-')) {
                const t = cmd.replace('disp-', '') as ColType;
                if (t === _defaultValType) { _fieldValTypes.delete(bs); }
                else { _fieldValTypes.set(bs, t); }
                hideFieldValMenu();
                renderStructPins();
                return;
            }
        });
    });

    // Wire submenus (hover logic)
    wireStructSubmenus(el);

    // Hide when clicking outside
    setTimeout(() => document.addEventListener('click', hideFieldValMenu), 0);
    _valMenuEl = el;
}
function wireStructSubmenus(menuEl: HTMLElement): void {
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSub: HTMLElement | null = null;
    const openSub = (sub: HTMLElement, row: HTMLElement) => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (activeSub && activeSub !== sub) { activeSub.style.display = 'none'; }
        activeSub = sub;
        sub.style.display = 'block';
        // Viewport edge: flip left if no room on right
        const rr = row.getBoundingClientRect();
        const sw = sub.offsetWidth || 220;
        if (rr.right + sw > window.innerWidth - 8) {
            sub.style.left = 'auto'; sub.style.right = '100%';
        } else {
            sub.style.left = '100%'; sub.style.right = 'auto';
        }
    };
    const scheduledClose = (sub: HTMLElement) => {
        closeTimer = setTimeout(() => {
            sub.style.display = 'none';
            if (activeSub === sub) { activeSub = null; }
        }, 100);
    };
    menuEl.querySelectorAll<HTMLElement>('.ctx-has-sub').forEach(row => {
        const sub = row.querySelector<HTMLElement>('.ctx-submenu');
        if (!sub) { return; }
        row.addEventListener('mouseenter', () => openSub(sub, row));
        row.addEventListener('mouseleave', e => {
            if (!sub.contains(e.relatedTarget as Node)) { scheduledClose(sub); }
        });
        sub.addEventListener('mouseenter', () => {
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        });
        sub.addEventListener('mouseleave', e => {
            if (!row.contains(e.relatedTarget as Node)) { scheduledClose(sub); }
        });
    });
}

// ── Selection sync ────────────────────────────────────────────────

/** Called when the user's byte selection changes. Fills the add-form address if open. */
export function onSelectionChangeForStruct(): void {
    clearArrSep();
    clearSelRow();
    _selectedFieldAddr = null;
    _selectedArrKey    = null;
    _selectedPinId     = null;
    if (S.selStart === null) { return; }
    S.activeStructAddr = S.selStart;
    if (S.sidebarTab === 'struct' && _addingPin) {
        const inp = document.getElementById('sa-addr') as HTMLInputElement | null;
        if (inp) { inp.value = S.selStart.toString(16).toUpperCase().padStart(8, '0'); }
    }
}
