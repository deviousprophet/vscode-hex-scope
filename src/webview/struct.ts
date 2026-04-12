// ── Struct Overlay — UI layer ─────────────────────────────────────
// Two sections rendered into separate DOM containers:
//   #s-struct      — struct type definitions (create / edit / delete)
//   #s-struct-pins — apply panel + saved instances (expandable decoded cards)
// Pure codec logic lives in struct-codec.ts.

import { S }        from './state';
import { esc }      from './utils';
import { vscode }   from './api';
import { rerender } from './render';
import {
    FIELD_TYPES,
    fieldByteSize, structByteSize, decodeStruct, allStructs,
    parseStructText, fieldsToText,
} from './struct-codec.js';
import type { DecodedField } from './struct-codec.js';
import type { StructDef, StructFieldType, StructPin } from './types';

// Re-export codec symbols so callers can import from a single path.
export {
    FIELD_TYPES, TYPE_TO_C,
    fieldByteSize, structByteSize, decodeStruct, allStructs,
    parseStructText, fieldsToText,
} from './struct-codec.js';
export type { DecodedField, ParseStructTextResult } from './struct-codec.js';

// ── Module state ──────────────────────────────────────────────────

/** Struct id currently selected in the apply panel. */
let _applyStructId: string | null = null;
/** Set of instance card ids that are expanded. */
const _expanded = new Set<string>();
/** Array field groups that are expanded. Key: `${pinId}::${baseName}`. Collapsed by default. */
const _expandedArrayFields = new Set<string>();

type ColType = 'hex' | 'dec' | 'ascii';
/** Display type for value column 1 (always shown). Default: hex. */
let _col1Type: ColType = 'hex';
/** Display type for value column 2. 'none' means hidden. Default: none. */
let _col2Type: ColType | 'none' = 'none';
/** Whether the inline add-instance form is open. */
let _addingPin = false;

// ══════════════════════════════════════════════════════════════════
// SECTION 1 — Struct Type Definitions  (#s-struct)
// ══════════════════════════════════════════════════════════════════

export function renderStructPanel(): void {
    const sec = document.getElementById('s-struct');
    if (!sec) { return; }

    const badge = S.structs.length > 0
        ? `<span class="sb-badge">${S.structs.length}</span>` : '';

    const listHtml = S.structs.length === 0
        ? `<div class="sb-empty sd-empty">No struct types yet.</div>`
        : S.structs.map(def => {
            const sz = structByteSize(def);
            return (
                `<div class="sd-row">` +
                `<span class="sd-name">${esc(def.name)}</span>` +
                `<span class="sd-meta">${def.fields.length}f · ${sz}B</span>` +
                `<button class="sd-btn sd-edit" data-id="${esc(def.id)}" title="Edit">✎</button>` +
                `<button class="sd-btn sd-del"  data-id="${esc(def.id)}" title="Delete">✕</button>` +
                `</div>`
            );
        }).join('');

    sec.innerHTML =
        `<div class="sb-hdr-row">` +
        `<span class="sb-hdr">Struct Types ${badge}</span>` +
        `<button id="sd-new" class="struct-btn struct-btn-secondary">+ New</button>` +
        `</div>` +
        `<div id="sd-list">${listHtml}</div>`;

    document.getElementById('sd-new')!.addEventListener('click', () => {
        renderStructEditor(null);
    });

    sec.querySelectorAll<HTMLElement>('.sd-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const def = S.structs.find(d => d.id === btn.dataset.id) ?? null;
            renderStructEditor(def);
        });
    });

    sec.querySelectorAll<HTMLElement>('.sd-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id!;
            S.structs    = S.structs.filter(d => d.id !== id);
            S.structPins = S.structPins.filter(p => p.structId !== id);
            if (_applyStructId === id) { _applyStructId = null; }
            vscode.postMessage({ type: 'saveStructs',    structs: S.structs });
            vscode.postMessage({ type: 'saveStructPins', pins:    S.structPins });
            renderStructPanel();
            renderStructPins();
        });
    });
}

// ── Struct form editor (form-only) ────────────────────────────────

export function renderStructEditor(existing: StructDef | null): void {
    const sec = document.getElementById('s-struct');
    if (!sec) { return; }

    const draftId = existing?.id ?? `user_${Date.now()}`;
    const draft: StructDef = existing
        ? { id: draftId, name: existing.name, fields: existing.fields.map(f => ({ ...f })) }
        : { id: draftId, name: '', fields: [{ name: 'field0', type: 'uint32', count: 1, endian: 'inherit' }] };

    renderEditorInto(sec, draft, existing);
}

function fieldRowHtml(f: import('./types').StructField, i: number, isOnly: boolean): string {
    const typeOpts = FIELD_TYPES.map(t =>
        `<option value="${t}" ${f.type === t ? 'selected' : ''}>${t}</option>`
    ).join('');
    const isArr = f.count > 1;
    const delCell = isOnly
        ? `<span class="sfe-del-placeholder"></span>`
        : `<button class="sfe-del-btn" title="Remove field">✕</button>`;
    return (
        `<div class="struct-field-row" data-idx="${i}">` +
        `<select class="sfe-type-sel">${typeOpts}</select>` +
        `<input  class="sfe-name-inp" type="text" value="${esc(f.name)}" maxlength="64" ` +
                `placeholder="fieldName" spellcheck="false" autocomplete="off">` +
        `<div class="sfe-arr-cell${isArr ? ' is-array' : ''}">` +
        `<button class="sfe-arr-toggle${isArr ? ' active' : ''}" title="${isArr ? 'Remove array' : 'Make array'}">[ ]</button>` +
        `<input  class="sfe-count-inp" type="text" inputmode="numeric" ` +
                `value="${isArr ? f.count : ''}" placeholder="N" maxlength="3">` +
        `</div>` +
        delCell +
        `</div>`
    );
}

function sanitizeCIdent(raw: string): string {
    return raw.replace(/[^A-Za-z0-9_]/g, '').replace(/^(\d)/, '_$1');
}

function syncDraftFields(sec: HTMLElement, draft: StructDef): void {
    draft.name = (document.getElementById('se-name') as HTMLInputElement)?.value.trim() || draft.name;
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

function renderEditorInto(sec: HTMLElement, draft: StructDef, existing: StructDef | null): void {
    const n = draft.fields.length;
    const fieldRows = draft.fields.map((f, i) => fieldRowHtml(f, i, n === 1)).join('');

    sec.innerHTML =
        `<div class="sb-hdr">${existing ? 'Edit Struct' : 'New Struct'}</div>` +
        `<div class="se-form">` +
        `<input id="se-name" class="se-name-inp" type="text" value="${esc(draft.name)}" ` +
               `maxlength="64" placeholder="StructName" spellcheck="false" autocomplete="off">` +
        `<div class="se-field-hdr">` +
        `<span>Type</span><span>Name</span><span>[ ]</span><span></span>` +
        `</div>` +
        `<div id="se-fields">${fieldRows}</div>` +
        `<button id="se-add" class="struct-add-field-btn">+ Add Field</button>` +
        `<div class="se-btns">` +
        `<button id="se-save"   class="struct-btn struct-btn-apply">Save</button>` +
        `<button id="se-cancel" class="struct-btn struct-btn-secondary">Cancel</button>` +
        `</div>` +
        `</div>`;

    wireEditorEvents(sec, draft, existing);
}

function wireEditorEvents(sec: HTMLElement, draft: StructDef, existing: StructDef | null): void {
    document.getElementById('se-add')!.addEventListener('click', () => {
        syncDraftFields(sec, draft);
        draft.fields.push({ name: `field${draft.fields.length}`, type: 'uint8', count: 1, endian: 'inherit' });
        renderEditorInto(sec, draft, existing);
    });

    sec.querySelectorAll<HTMLElement>('.sfe-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            syncDraftFields(sec, draft);
            const row = btn.closest<HTMLElement>('.struct-field-row')!;
            const idx = parseInt(row.dataset.idx!);
            draft.fields.splice(idx, 1);
            renderEditorInto(sec, draft, existing);
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
        });
    });

    sec.querySelectorAll<HTMLInputElement>('.sfe-count-inp').forEach(inp => {
        inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
        });
    });

    sec.querySelectorAll<HTMLInputElement>('.sfe-name-inp').forEach(inp => {
        inp.addEventListener('blur', () => {
            const clean = sanitizeCIdent(inp.value);
            if (clean !== inp.value) { inp.value = clean || 'field'; }
        });
    });

    document.getElementById('se-save')!.addEventListener('click', () => {
        syncDraftFields(sec, draft);
        const nameInp = document.getElementById('se-name') as HTMLInputElement;
        const name = nameInp.value.trim();
        if (!name) { nameInp.style.borderColor = 'var(--err)'; return; }
        if (draft.fields.length === 0) { return; }
        const def: StructDef = { id: draft.id, name, fields: draft.fields };
        const idx = S.structs.findIndex(d => d.id === def.id);
        if (idx >= 0) { S.structs[idx] = def; } else { S.structs.push(def); }
        vscode.postMessage({ type: 'saveStructs', structs: S.structs });
        renderStructPanel();
        renderStructPins();
    });

    document.getElementById('se-cancel')!.addEventListener('click', () => {
        renderStructPanel();
    });
}

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

    const hasStructs  = all.length > 0;
    const instBadge   = S.structPins.length > 0 ? `<span class="sb-badge">${S.structPins.length}</span>` : '';

    // ── Inline add form ──
    let addFormHtml = '';
    if (_addingPin) {
        const applyDef   = all.find(d => d.id === _applyStructId) ?? null;
        const structOpts = hasStructs
            ? all.map(d => `<option value="${esc(d.id)}"${d.id === _applyStructId ? ' selected' : ''}>${esc(d.name)}</option>`).join('')
            : `<option value="">— no struct types —</option>`;
        const previewHtml = applyDef
            ? `<div class="sa-preview">${applyDef.fields.map(f =>
                `<div class="sa-pf"><span class="sa-pf-type">${esc(f.type)}</span> ` +
                `<span class="sa-pf-name">${esc(f.name)}${f.count > 1 ? `[${f.count}]` : ''}</span></div>`
              ).join('')}</div>`
            : `<div class="sa-preview sa-preview-empty">No struct types defined yet.</div>`;
        const addrVal = S.activeStructAddr !== null
            ? S.activeStructAddr.toString(16).toUpperCase().padStart(8, '0') : '';
        addFormHtml =
            `<div id="si-add-form" class="si-add-form">` +
            `<div class="sa-row">` +
            `<select id="sa-struct-sel" class="struct-sel" style="flex:1">${structOpts}</select>` +
            `</div>` +
            previewHtml +
            `<div class="sa-row">` +
            `<span class="struct-addr-pfx">0x</span>` +
            `<input id="sa-addr" class="struct-addr-inp sa-addr-inp" type="text" maxlength="8" ` +
                   `placeholder="08000000" autocomplete="off" spellcheck="false" value="${esc(addrVal)}">` +
            `<input id="sa-name" class="sa-name-inp" type="text" maxlength="40" ` +
                   `placeholder="instance name" spellcheck="false" autocomplete="off">` +
            `</div>` +
            `<div class="sa-row sa-btn-row">` +
            `<button id="sa-confirm" class="struct-btn struct-btn-apply"${!hasStructs ? ' disabled' : ''}>Confirm</button>` +
            `<button id="sa-cancel" class="struct-btn struct-btn-cancel">Cancel</button>` +
            `</div>` +
            `</div>`;
    }

    const instHtml = S.structPins.length === 0
        ? `<div class="sb-empty">No instances yet. Click ＋ Add to create one.</div>`
        : S.structPins.map((pin, i) => buildInstanceCard(pin, i)).join('');

    sec.innerHTML =
        `<div class="si-hdr-row">` +
        `<span class="sb-hdr" style="margin:0">Instances ${instBadge}</span>` +
        `<div class="endian-tabs sa-endian-tabs">` +
        `<button id="sa-btn-le" class="${S.endian === 'le' ? 'active' : ''}">LE</button>` +
        `<button id="sa-btn-be" class="${S.endian === 'be' ? 'active' : ''}">BE</button>` +
        `</div>` +
        `<button id="si-add-btn" class="si-add-btn"${!hasStructs || _addingPin ? ' disabled' : ''}>＋ Add</button>` +
        `</div>` +
        addFormHtml +
        `<div class="si-colcfg">` +
        `<span class="si-colcfg-lbl">Col 1</span>` +
        `<select id="si-col1-sel" class="si-colcfg-sel">` +
        `<option value="hex"${_col1Type==='hex'?' selected':''}>hex</option>` +
        `<option value="dec"${_col1Type==='dec'?' selected':''}>dec</option>` +
        `<option value="ascii"${_col1Type==='ascii'?' selected':''}>ascii</option>` +
        `</select>` +
        `<span class="si-colcfg-lbl">Col 2</span>` +
        `<select id="si-col2-sel" class="si-colcfg-sel">` +
        `<option value="none"${_col2Type==='none'?' selected':''}>—</option>` +
        `<option value="hex"${_col2Type==='hex'?' selected':''}>hex</option>` +
        `<option value="dec"${_col2Type==='dec'?' selected':''}>dec</option>` +
        `<option value="ascii"${_col2Type==='ascii'?' selected':''}>ascii</option>` +
        `</select>` +
        `</div>` +
        `<div id="si-list">${instHtml}</div>`;

    // ── ＋ Add button ──
    document.getElementById('si-add-btn')!.addEventListener('click', () => {
        _addingPin = true;
        renderStructPins();
        document.getElementById('sa-name')?.focus();
    });

    // ── Add-form wiring ──
    if (_addingPin) {
        document.getElementById('sa-struct-sel')!.addEventListener('change', e => {
            _applyStructId = (e.target as HTMLSelectElement).value || null;
            renderStructPins();
        });
        document.getElementById('sa-confirm')!.addEventListener('click', () => {
            if (!hasStructs || !_applyStructId) { return; }
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

    document.getElementById('si-col1-sel')?.addEventListener('change', e => {
        _col1Type = (e.target as HTMLSelectElement).value as ColType;
        renderStructPins();
    });
    document.getElementById('si-col2-sel')?.addEventListener('change', e => {
        _col2Type = (e.target as HTMLSelectElement).value as ColType | 'none';
        renderStructPins();
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
    // Pointer always renders as arrow + hex address regardless of valType
    if (r.type === 'pointer') {
        const v = dv.getUint32(0, le) >>> 0;
        return `\u2192 0x${v.toString(16).toUpperCase().padStart(8, '0')}`;
    }
    if (valType === 'ascii') {
        return bytes.map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
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

/** Build a single field row (5-col grid) for scalar fields and array elements. */
function mkFieldRow(r: DecodedField, bs: number, bc: number): string {
    const nd  = !r.hasData ? ' si-no-data' : '';
    const ptr = r.type === 'pointer';
    const v1  = getValForType(r, _col1Type);
    const v2  = _col2Type !== 'none' ? getValForType(r, _col2Type) : '';
    return (
        `<div class="si-field${nd}${ptr ? ' si-ptr-field' : ''}" ` +
        `data-byte-start="${bs}" data-byte-cnt="${bc}">` +
        `<span class="si-f-off">+${r.byteOffset.toString(16).toUpperCase().padStart(3, '0')}</span>` +
        `<span></span>` +
        `<span class="si-f-name">${esc(r.fieldName)}</span>` +
        `<span class="si-f-pri${ptr ? ' si-f-ptr' : ''}">${esc(v1)}</span>` +
        `<span class="si-f-sec">${esc(v2)}</span>` +
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
                const elHtml  = g.rows.map(r => mkFieldRow(r, pin.addr + r.byteOffset, fieldByteSize(r.type))).join('');
                return (
                    `<div class="si-arr-grp${isOpen ? ' open' : ''}" data-arr-key="${esc(key)}">` +
                    `<div class="si-arr-grp-hdr" ` +
                    `data-byte-start="${byteStart}" data-byte-cnt="${totalCnt}">` +
                    `<span class="si-f-off">+${r0.byteOffset.toString(16).toUpperCase().padStart(3, '0')}</span>` +
                    `<button class="si-arr-exp-btn">${isOpen ? '▾' : '▸'}</button>` +
                    `<span class="si-f-name">${esc(g.baseName)}</span>` +
                    `<span class="si-arr-count">[${g.rows.length}]</span>` +
                    `<span></span>` +
                    `</div>` +
                    `<div class="si-arr-grp-body"${isOpen ? '' : ' style="display:none"'}>${elHtml}</div>` +
                    `</div>`
                );
            }
        }).join('');

        bodyHtml = `<div class="si-fields">${fieldHtml}</div>`;
    }

    return (
        `<div class="si-card${expanded ? ' si-expanded' : ''}" data-pin-id="${esc(pin.id)}" data-idx="${i}">` +
        `<div class="si-card-hdr">` +
        `<button class="si-expand-btn" data-pin-id="${esc(pin.id)}">${expanded ? '▾' : '▸'}</button>` +
        `<span class="si-cname">${esc(pin.name)}</span>` +
        `<span class="si-cmeta">${esc(defName)} · 0x${addrHex} · ${totalBytes}B</span>` +
        `<button class="si-del-btn" data-idx="${i}" title="Remove">✕</button>` +
        `</div>` +
        bodyHtml +
        `</div>`
    );
}

function wireInstanceCards(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.si-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.pinId!;
            if (_expanded.has(id)) { _expanded.delete(id); } else { _expanded.add(id); }
            renderStructPins();
        });
    });

    // Array group toggle — DOM-only, no full re-render
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-field')) { return; }
            const grp  = hdr.closest<HTMLElement>('.si-arr-grp')!;
            const key  = grp.dataset.arrKey!;
            const body = grp.querySelector<HTMLElement>('.si-arr-grp-body')!;
            const btn  = hdr.querySelector<HTMLElement>('.si-arr-exp-btn')!;
            const isOpen = _expandedArrayFields.has(key);
            if (isOpen) {
                _expandedArrayFields.delete(key);
                grp.classList.remove('open');
                body.style.display = 'none';
                btn.textContent = '▸';
            } else {
                _expandedArrayFields.add(key);
                grp.classList.add('open');
                body.style.display = '';
                btn.textContent = '▾';
            }
        });
    });

    // Array group header hover → highlight all its bytes
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        const start = parseInt(hdr.dataset.byteStart!);
        const cnt   = parseInt(hdr.dataset.byteCnt!);
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
    });

    sec.querySelectorAll<HTMLElement>('.si-card-hdr').forEach(hdr => {
        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-expand-btn, .si-del-btn')) { return; }
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
            S.selStart = start;
            S.selEnd   = start + cnt - 1;
            import('./memoryView.js').then(m => { m.applySel(); m.scrollTo(start); });
            import('./sidebar.js').then(m => m.updateInspector());
        });
    });
}

// ── Selection sync ────────────────────────────────────────────────

/** Called when the user's byte selection changes. Fills the add-form address if open. */
export function onSelectionChangeForStruct(): void {
    if (S.selStart === null) { return; }
    S.activeStructAddr = S.selStart;
    if (S.sidebarTab === 'struct' && _addingPin) {
        const inp = document.getElementById('sa-addr') as HTMLInputElement | null;
        if (inp) { inp.value = S.selStart.toString(16).toUpperCase().padStart(8, '0'); }
    }
}
