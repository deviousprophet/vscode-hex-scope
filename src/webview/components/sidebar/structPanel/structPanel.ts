/** Struct Overlay — UI layer. Self-contained Struct sidebar panel.
Owns the pins/instances track + types/editor track, all their UI state
(add/edit struct definitions, C preview, add/edit/delete pins, decoded
instance rows incl. bit units / arrays / pointers, bit-field allocation
toggle, expansion state, field-value menus, pointer follow/create).
Data is pushed via setters; actions report via callbacks. This module
never imports the `S` global, never posts provider messages, and never
touches the render registry. Pure codec logic lives in structCodec.ts. */

import { esc, actionBtnsHtml, wireActionBtns, formatHex } from '../../../utils';
import {
    makeStructPin,
    uniqueStructPinName as uniquePinName,
    upsertPointerStructPin,
    withEditedStructPin,
    withoutStructDefinition,
    withoutStructPin,
} from './structPinsModel';
import {
    fieldByteSize, structByteSize, decodeStruct, allStructs, validateStructs, MAX_NESTED_DEPTH,
    structDefKind, isUnsignedScalarType,
} from '../../../../core/struct/structCodec.js';
import type { DecodedField } from '../../../../core/struct/structCodec.js';
import type { BitFieldAllocation, BitFieldChild, EnumEntry, StructBaseType, StructDef, StructDefKind, StructField, StructFieldType, StructPin } from '../../../../core/types';
import { SidebarSections } from '../sidebar';
import { menuController } from '../../menuController/menuController';
import { showToast } from '../../toast';
import './structPanel.css';
import { hydrateStructPreviews, renderStructCPreview } from './structCPreview';
import {
    applyBitHighlightsInPlace, bitUnitUsesFullStorage, isBitFieldRow, makeBitRowKey, parseBitRowMeta,
    parseDatasetInt, scalarValKey, singleLineCopyText,
} from './structBinaryView';
import {
    bitChildButtonState, childFieldRowHtml, fieldRowHtml, isPointerBlocked, overrideAutoTitle,
    overrideHelpTitle, overrideSelectHtml,
} from './structEditorFields';
import { SAMPLE_TYPE_MENUS, TYPE_LABELS, getCopyText, implicitDisplayType } from './structValueFormat';
import type { ColType, PointerFollowState, StructRenderCtx } from './structValueFormat';
import { buildBitUnitAggregateRow, pointerTargetStructDef, renderStructBody, syncCompositeHeaderOffset } from './structRowRenderer';


/** Per-kind slots filled into the shared bit-field / enum editor shell. */
interface KindDefEditorParts {
    placeholder: string;
    badge: string;
    baseSelectId: string;
    baseAria: string;
    rowsHtml: string;
    addBtnHtml: string;
}

export interface StructCallbacks {
    /** Required — host memory adapter for byte reads (keeps byte access host-owned, like Inspector). */
    readByte: (addr: number) => number | undefined;
    /** Any struct-definition mutation (save/delete struct) → host persists + syncs. */
    onStructsChange?: (structs: StructDef[]) => void;
    /** Any pin mutation (add/edit/delete/pointer-create) → host persists + syncs. */
    onPinsChange?: (pins: StructPin[]) => void;
    /** Both changed in one action (e.g. delete struct cascades pins). */
    onStateChange?: (structs: StructDef[], pins: StructPin[]) => void;
    /** Struct row/range selection → host sets S.selStart/selEnd + rerender.jumpTo + rerender.inspector. */
    onSelectRange?: (start: number, count: number) => void;
    /** Hex-row highlight: apply class at address range (moved highlightAddress). */
    onHighlightHex?: (addrs: number[], cls: string) => void;
    /** Hex-row highlight: remove class everywhere (moved clearArrSep / struct-h clear). */
    onClearHighlightHex?: (cls: string) => void;
    /** Global bit-field allocation toggle (MSB/LSB in bit-layout detail) → host persists. */
    onBitAllocationChange?: (bitAllocation: BitFieldAllocation) => void;
    /** Global "show hidden fields" toggle (Struct Instances header) → host persists. */
    onShowHiddenFieldsChange?: (showHiddenFields: boolean) => void;
}

type ValueKeyKind = 'default' | 'bit' | 'bitunit';

type FieldValMenuOptions = {
    isPointer?: boolean;
    isArrayHeader?: boolean;
    isBitUnitHeader?: boolean;
    valKey?: string;
    keyList?: string[];
    pointerAllowCreate?: boolean;
    sourceStructId?: string;
    sourceBaseAddr?: number;
};

type FieldValMenuContext = {
    bs: number;
    bsList: number[] | undefined;
    pinIdx: number | undefined;
    opts: FieldValMenuOptions;
    key: string;
    types: ColType[];
    cur: ColType | null;
    findFieldAt: (addr: number) => DecodedField | null;
};

type CopySourceRows = { pin: StructPin; rows: DecodedField[]; structId: string; baseAddr: number };
type PointerMenuSource = { pin: StructPin; row: DecodedField; sourceStructId: string; sourceBaseAddr: number };

type PointerFollowGuard = (row: DecodedField | null) => string | null;

type StructPointerCreateState =
    | { ok: true; def: StructDef; addr: number; structId: string }
    | { ok: false; reason: string }
    | null;

export class StructPanel {
    private readonly cb: StructCallbacks;
    private _root: HTMLElement | null = null;
    private sections: SidebarSections | null = null;
    private _structs: StructDef[] = [];
    private _pins: StructPin[] = [];
    private _endian: 'le' | 'be' = 'le';
    private _bitFieldAllocation: BitFieldAllocation = 'msb';
    /** Global "show hidden fields" toggle for the instance view (host-owned, pushed). */
    private _showHiddenFields = false;
    private _activeStructAddr: number | null = null;
    /** Whether the struct tab is the active sidebar tab (host pushes; guards add/edit address input sync). */
    private _tabActive = false;

    // ── UI/transient state (component-owned) ──────────────────────

    /** Struct id currently selected in the add form. */
    private _applyStructId: string | null = null;
    /** Set of instance card ids that are expanded. */
    private _expanded = new Set<string>();
    /** Array field groups that are expanded. Key: `${pinId}::${baseName}`. Collapsed by default. */
    private _expandedArrayFields = new Set<string>();
    /** Nested element groups that are expanded. Key: `${pinId}::${baseName}::${idx}`. Collapsed by default. */
    private _expandedArrayElements = new Set<string>();
    /** Default display type for value cells (per-field default). */
    private _defaultValType: ColType = 'hex';
/** Per-value display override keyed by stable row identity. */
private _fieldValTypes = new Map<string, ColType>();
/** Whether the inline add-instance form is open. */
private _addingPin = false;
/** Byte start address of the currently highlighted field row. */
private _selectedFieldAddr: number | null = null;
/** Array group key of the currently highlighted array header. */
private _selectedArrKey: string | null = null;
/** Nested array element key of the currently highlighted element header. */
private _selectedArrElemKey: string | null = null;
/** Selected bit-field range to highlight on its parent bit-unit value. */
private _selectedBitRange: { parentByteStart: number; startBit: number; endBit: number } | null = null;
/** Hovered bit-field range to preview highlight on parent bit-unit value. */
private _hoveredBitRange: { parentByteStart: number; startBit: number; endBit: number } | null = null;
/** Selected bit-field child row identity: `${byteStart}:${bitStart}:${bitWidth}`. */
private _selectedBitRowKey: string | null = null;
/** Hovered bit-field child row identity: `${byteStart}:${bitStart}:${bitWidth}`. */
private _hoveredBitRowKey: string | null = null;
/** Byte start addresses marked with struct-arr-sep in the hex view. */
private _arrSepAddrs: number[] = [];
/** Pin id of the currently selected instance card. */
private _selectedPinId: string | null = null;
/** Pins whose type-definition preview is open inside the card. */
private _previewedPins = new Set<string>();
/** Pin id currently being edited in the full-width editor (name/addr/type). */
private _editingPinId: string | null = null;
/** Struct type id selected in the inline instance-edit form (may differ from the saved pin). */
private _editingPinDraftStructId: string | null = null;
/**
 * When non-null the section is in "type editor" mode.
 * `existing` is null for new types, or the original def being edited.
 * `draft` holds the working copy being modified.
 * `fromManage` is true when opened from the manage-types list.
 */
private _editingType: { draft: StructDef; existing: StructDef | null; fromManage: boolean } | null = null;
/** True while the Types `＋ Add` action is showing the kind picker (struct / bit-field / enum). */
private _choosingKind = false;
private _editorError: string | null = null;

constructor(cb: StructCallbacks) {
    this.cb = cb;
}

/** Renders both stacked sections into the given root (was renderStructPins onto #s-struct-pins). */
mount(root: HTMLElement): void {
    this._root = root;
    root.innerHTML = '';
    this.sections = new SidebarSections(root, 'si', [
        { id: 'instances', label: 'Struct Instances', mountActions: r => this.mountInstancesAction(r) },
        { id: 'types', label: 'Struct Types', defaultCollapsed: false, mountActions: r => this.mountTypesAction(r) },
    ]);
    // Field-menu click-outside / focus-loss dismissal + keyboard nav live in the
    // shared MenuController (menuController.ts), so shell re-mounts never stack
    // document listeners.
    this.render();
}

    private addPinFormOrEmpty(): string {
        return (this._addingPin || this._editingPinId) ? this.addStructPinFormHtml(this.pinnableStructs()) : '';
    }

    /** Re-renders the whole panel from pushed state (was renderStructPins). No-op until mounted. */
    render(): void {
        const sec = this._root;
        if (!sec || !this.sections) { return; }

        const all = allStructs(this._structs);
        this.prepareStructPanelState();

        if (this.typePanelForcedOpen()) { this.sections.setCollapsed('types', false); }

        this.sections.setLabel('types', this.typePanelTitle());
        this.sections.body('instances')!.innerHTML = this.structInstancesBodyHtml(
            this.addPinFormOrEmpty(),
            this.instanceCardsHtml(),
        );
        this.sections.body('types')!.innerHTML = this.typePanelBodyHtml(this.typeRowsHtml(all));
        this.updateHeaderActions();

        this.hydrateStructPreviews(sec);
        this.wireStructPinsPanel(sec);

        this.wireInstanceCards(sec);
        this.wireEditorState(sec);
    }

    /** Whether the type editor is open (header actions + panel focus). */
    private isEditorOpen(): boolean {
        return Boolean(this._editingType);
    }

    /** The type panel stays expanded while the editor or the kind picker is active. */
    private typePanelForcedOpen(): boolean {
        return this.isEditorOpen() || this._choosingKind;
    }

    private wireEditorState(sec: HTMLElement): void {
        if (this._editingType) {
            this.wireEditorInSec(sec);
            sec.querySelector<HTMLInputElement>('#se-name')?.focus();
        }
    }

/** Keep compact header actions in sync with panel state (static shell across re-renders). */
    private updateHeaderActions(): void {
        const root = this._root;
        if (!root) { return; }
        this.syncInstanceAddButton(root);
        this.syncTypeAddButton(root);
    }

    private syncInstanceAddButton(root: HTMLElement): void {
        const add = root.querySelector<HTMLButtonElement>('#si-add-btn');
        if (!add) { return; }
        add.disabled = this.instanceAddBusy() || this.noStructTypes();
        add.title = this.noStructTypes() ? 'No struct types defined' : 'Add instance';
        add.setAttribute('aria-label', add.title);
    }

    private syncTypeAddButton(root: HTMLElement): void {
        const disabled = this.isEditorOpen() || this._choosingKind;
        const addType = root.querySelector<HTMLButtonElement>('#sm-add-btn');
        if (addType) { addType.disabled = disabled; }
    }

    private noStructTypes(): boolean {
        return this.pinnableStructs().length === 0;
    }

    /** Plain-struct defs eligible as Struct Instances (bit-field/enum defs are not pinnable). */
    private pinnableStructs(): StructDef[] {
        return this._structs.filter(d => structDefKind(d) === 'struct');
    }

    private instanceAddBusy(): boolean {
        return this._addingPin || this._editingPinId !== null;
    }

/** Instances header action: ＋ Add (primary/status control usable while collapsed). */
private mountInstancesAction(root: HTMLElement): void {
    const add = document.createElement('button');
    add.id = 'si-add-btn';
    add.className = 'sb-btn sb-btn-add sb-section-action';
    add.textContent = '\uff0b Add';
    add.addEventListener('click', () => {
        this._addingPin = true;
        this.render();
        this._root?.querySelector<HTMLInputElement>('#sa-name')?.focus();
    });
    root.appendChild(add);
}

/** Types header action: one ＋ Add entry point that opens the kind picker (struct / bit-field / enum). */
private mountTypesAction(root: HTMLElement): void {
    const add = document.createElement('button');
    add.id = 'sm-add-btn';
    add.className = 'sb-btn sb-btn-add sb-section-action';
    add.textContent = '\uff0b Add';
    add.title = 'New type';
    add.addEventListener('click', () => {
        this._editorError = null;
        this._editingType = null;
        this._choosingKind = true;
        this.render();
    });
    root.appendChild(add);
}

/** Push both tracks' data (after full render / external change) and re-render. */
setData(structs: StructDef[], pins: StructPin[]): void {
    this._structs = structs;
    this._pins = pins;
    this.render();
}

/** Shared byte-order decode source (host pushes S.endian). */
setEndian(endian: 'le' | 'be'): void {
    this._endian = endian;
    this.render();
}

/** Bit-field allocation source (host pushes S.bitFieldAllocation). */
setBitFieldAllocation(alloc: BitFieldAllocation): void {
    this._bitFieldAllocation = alloc;
    this.render();
}

/** "Show hidden fields" source (host pushes S.showHiddenFields). */
setShowHiddenFields(show: boolean): void {
    this._showHiddenFields = show;
    this.render();
}

/** Hex-view byte selection → clear stale struct selection + sync add/edit form (was onSelectionChangeForStruct). */
setSelection(start: number | null): void {
    if (typeof document === 'undefined') { return; }
    this.clearStructSelectionState();
    if (start === null) { return; }
    this._activeStructAddr = start;
    this.updateStructAddressInputs(start);
}

/** Host pushes the active sidebar tab (guards add/edit address input sync to the visible struct tab). */
setTabActive(active: boolean): void {
    this._tabActive = active;
}

/** Resets all transient view state and re-renders. Call when switching away and back (was resetStructViewState). */
resetViewState(): void {
    this._editingType             = null;
    this._choosingKind            = false;
    this._addingPin               = false;
    this._editingPinId            = null;
    this._editingPinDraftStructId = null;
    this._selectedArrElemKey      = null;
    this._selectedBitRange        = null;
    this._hoveredBitRange         = null;
    this._selectedBitRowKey       = null;
    this._hoveredBitRowKey        = null;
    this.render();
}

// ── Inline type editor helpers ────────────────────────────────────

private sanitizeCIdent(raw: string): string {
    return raw.replace(/[^A-Za-z0-9_]/g, '').replace(/^(\d)/, '_$1');
}

/** Dispatch the type editor form by the draft's kind (absent = plain struct). */
private editorHtml(draft: StructDef, existing: StructDef | null): string {
    const kind = structDefKind(draft);
    if (kind === 'bitfield') { return this.bitFieldDefEditorHtml(draft); }
    if (kind === 'enum') { return this.enumDefEditorHtml(draft); }
    return this.structEditorHtml(draft, existing);
}

private structEditorHtml(draft: StructDef, existing: StructDef | null): string {
    const fieldRows = this.fieldRowsHtml(draft);
    const errorHtml = this._editorError ? `<div class="se-error">${esc(this._editorError)}</div>` : '';
    return (
        `<div class="si-editor-wrap">` +
        this.editorTabsHtml() +
        `<div class="se-view" data-se-view="edit">` +
        `<div class="se-form">` +
        `<label class="se-name-lbl" for="se-name">Type name</label>` +
        `<input id="se-name" class="se-name-inp sb-input" type="text" value="${esc(draft.name)}" ` +
               `maxlength="64" placeholder="MyStruct" spellcheck="false" autocomplete="off">` +
        `<div class="se-struct-default-row">` +
        `<button id="se-packed" class="se-packed-btn${draft.packed ? ' active' : ''}" ` +
               `title="__attribute__((packed))" aria-label="Toggle packed struct">packed</button>` +
        `<span class="se-struct-default-ptr"></span>` +
        `<span class="se-struct-default-lbl">struct default</span>` +
        this.overrideSelectHtml(draft.endian, 'endian', 'se-struct-default-sel', 'se-endian', this._endian.toUpperCase()) +
        `</div>` +
        `<div class="se-field-hdr"><span>Type</span><span>Ptr</span><span>Name</span><span>Endian</span><span>Alloc</span><span>Hide</span><span>[ ]</span><span></span><span></span></div>` +
        `<div id="se-fields">${fieldRows}</div>` +
        `<button id="se-add" class="sb-btn sb-btn-add">+ Add Field</button>` +
        errorHtml +
        `<div class="se-btns">` +
        `<button id="se-save" class="sb-btn sb-btn-primary">Save</button>` +
        `<button id="se-cancel" class="sb-btn sb-btn-secondary">Cancel</button>` +
        `</div>` +
        `</div>` +
        `</div>` +
        `<div class="se-view" data-se-view="preview" hidden>` +
        `<div id="se-preview" class="se-preview"><pre class="si-c-preview" data-struct-preview-id="${esc(draft.id)}"></pre></div>` +
        `</div>` +
        `</div>`
    );
}

/** Edit/Preview tab bar that toggles which editor view is visible (markdown raw/preview style). */
private editorTabsHtml(): string {
    return (
        `<div class="se-tabs compact-tabs" role="tablist" aria-label="Struct editor views">` +
        `<button type="button" class="se-tab active" role="tab" aria-selected="true" data-se-view="edit">Edit</button>` +
        `<button type="button" class="se-tab" role="tab" aria-selected="false" data-se-view="preview">Preview</button>` +
        `</div>`
    );
}

/** Bit-field type form: name + base unsigned width + name/width child rows (no struct fields/nesting). */
private bitFieldDefEditorHtml(draft: StructDef): string {
    const { addBtnDisabled, addBtnTitle } = this.bitChildButtonState(this.availableBitFieldDefBits(draft));
    return this.kindDefEditorHtml(draft, {
        placeholder: 'MyBitField',
        badge: 'bitfield',
        baseSelectId: 'se-base-type',
        baseAria: 'Bit-field base width',
        rowsHtml: `<div id="se-bf-def-children" class="sfe-bf-children">${this.bitFieldDefChildRowsHtml(draft)}</div>`,
        addBtnHtml: `<button id="se-bf-def-add" class="sb-btn sb-btn-add" title="${addBtnTitle}"${addBtnDisabled}>+ Add bit</button>`,
    });
}

/** Per-kind slots for the shared bit-field / enum editor shell. */
private kindDefEditorHtml(draft: StructDef, parts: KindDefEditorParts): string {
    return (
        this.kindDefEditorShellHtml(draft, parts) +
        parts.rowsHtml +
        parts.addBtnHtml +
        this.kindDefEditorFooterHtml(draft)
    );
}

/** Shared editor shell: tab bar, form open, type-name input, and the base-width row. */
private kindDefEditorShellHtml(draft: StructDef, parts: KindDefEditorParts): string {
    return (
        `<div class="si-editor-wrap">` +
        this.editorTabsHtml() +
        `<div class="se-view" data-se-view="edit">` +
        `<div class="se-form">` +
        `<label class="se-name-lbl" for="se-name">Type name</label>` +
        `<input id="se-name" class="se-name-inp sb-input" type="text" value="${esc(draft.name)}" ` +
               `maxlength="64" placeholder="${parts.placeholder}" spellcheck="false" autocomplete="off">` +
        `<div class="se-struct-default-row">` +
        `<span class="se-kind-badge">${parts.badge}</span>` +
        `<span class="se-struct-default-ptr"></span>` +
        `<span class="se-struct-default-lbl">base width</span>` +
        `<select id="${parts.baseSelectId}" class="se-struct-default-sel" aria-label="${parts.baseAria}">${this.baseTypeOptionsHtml(draft.baseType)}</select>` +
        `</div>`
    );
}

/** Shared editor tail: error slot, save/cancel buttons, and the C preview pane. */
private kindDefEditorFooterHtml(draft: StructDef): string {
    const errorHtml = this._editorError ? `<div class="se-error">${esc(this._editorError)}</div>` : '';
    return (
        errorHtml +
        `<div class="se-btns">` +
        `<button id="se-save" class="sb-btn sb-btn-primary">Save</button>` +
        `<button id="se-cancel" class="sb-btn sb-btn-secondary">Cancel</button>` +
        `</div>` +
        `</div>` +
        `</div>` +
        `<div class="se-view" data-se-view="preview" hidden>` +
        `<div id="se-preview" class="se-preview"><pre class="si-c-preview" data-struct-preview-id="${esc(draft.id)}"></pre></div>` +
        `</div>` +
        `</div>`
    );
}

private baseTypeOptionsHtml(selected: StructBaseType | undefined): string {
    const value = selected ?? 'uint8';
    return (['uint8', 'uint16', 'uint32', 'uint64'] as StructBaseType[])
        .map(t => `<option value="${t}"${t === value ? ' selected' : ''}>${t}</option>`)
        .join('');
}

private availableBitFieldDefBits(def: StructDef): number {
    const baseType = def.baseType ?? 'uint8';
    const usedBits = (def.bitFields ?? []).reduce((sum, child) => sum + child.bitWidth, 0);
    return fieldByteSize(baseType) * 8 - usedBits;
}

private refreshBitFieldDefRows(sec: HTMLElement, draft: StructDef): void {
    const container = sec.querySelector<HTMLElement>('#se-bf-def-children');
    if (!container) { return; }
    container.innerHTML = this.bitFieldDefChildRowsHtml(draft);
    this.wireBitFieldDefChildRows(sec, draft);
    this.refreshBitFieldDefAddButton(sec, draft);
    const pre = sec.querySelector<HTMLElement>('#se-preview pre');
    if (pre) { this.renderStructCPreview(pre, draft); }
}

private bitFieldDefChildRowsHtml(draft: StructDef): string {
    const children = draft.bitFields ?? [];
    return children.map((child, ci) => this.childFieldRowHtml(child, ci, children.length)).join('');
}

private refreshBitFieldDefAddButton(sec: HTMLElement, draft: StructDef): void {
    const btn = sec.querySelector<HTMLButtonElement>('#se-bf-def-add');
    if (!btn) { return; }
    const { addBtnDisabled, addBtnTitle } = this.bitChildButtonState(this.availableBitFieldDefBits(draft));
    btn.disabled = addBtnDisabled !== '';
    btn.title = addBtnTitle;
}

private bitFieldChildIndex(btn: HTMLElement): number | null {
    const row = btn.closest<HTMLElement>('.sfe-bf-child-row');
    const idx = this.parseDatasetInt(row?.dataset.childIdx);
    return idx === null ? null : idx;
}

private wireBitFieldDefChildRows(sec: HTMLElement, draft: StructDef): void {
    const container = sec.querySelector<HTMLElement>('#se-bf-def-children');
    if (!container) { return; }
    container.querySelectorAll<HTMLInputElement>('.sfe-bf-child-name').forEach(inp =>
        inp.addEventListener('input', () => this.refreshEditorPreview(sec, draft)));
    container.querySelectorAll<HTMLInputElement>('.sfe-bf-child-width').forEach(inp =>
        inp.addEventListener('input', () => {
            this.syncBitFieldDefDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
            this.refreshBitFieldDefAddButton(sec, draft);
        }));
    container.querySelectorAll<HTMLSelectElement>('.sfe-bf-child-enum').forEach(sel =>
        sel.addEventListener('change', () => {
            this.syncBitFieldDefDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        }));
    this.wireClicks(container, '.sfe-bf-del-child', btn => {
        const ci = this.bitFieldChildIndex(btn);
        if (ci === null) { return; }
        this.syncBitFieldDefDraft(sec, draft);
        draft.bitFields!.splice(ci, 1);
        if (draft.bitFields!.length === 0) { draft.bitFields!.push({ name: 'bit0', bitWidth: 1 }); }
        this.refreshBitFieldDefRows(sec, draft);
    });
    this.wireClicks(container, '.sfe-bf-child-row .sfe-move-up', btn => {
        const ci = this.bitFieldChildIndex(btn);
        if (ci === null) { return; }
        this.syncBitFieldDefDraft(sec, draft);
        if (ci > 0) {
            [draft.bitFields![ci - 1], draft.bitFields![ci]] = [draft.bitFields![ci], draft.bitFields![ci - 1]];
            this.refreshBitFieldDefRows(sec, draft);
        }
    });
    this.wireClicks(container, '.sfe-bf-child-row .sfe-move-dn', btn => {
        const ci = this.bitFieldChildIndex(btn);
        if (ci === null) { return; }
        this.syncBitFieldDefDraft(sec, draft);
        if (ci < draft.bitFields!.length - 1) {
            [draft.bitFields![ci], draft.bitFields![ci + 1]] = [draft.bitFields![ci + 1], draft.bitFields![ci]];
            this.refreshBitFieldDefRows(sec, draft);
        }
    });
}

private syncBitFieldDefDraft(sec: HTMLElement, draft: StructDef): void {
    draft.name = this.sanitizeCIdent(this.inputValue(sec, '#se-name'));
    draft.baseType = this.readBaseType(this.selectValue(sec, '#se-base-type'));
    draft.fields = [];
    const rows = sec.querySelectorAll<HTMLElement>('#se-bf-def-children .sfe-bf-child-row');
    draft.bitFields = Array.from(rows).map(row => this.readEditorBitFieldChild(row));
}

private readBaseType(value: string | undefined): StructBaseType {
    return value !== undefined && isUnsignedScalarType(value as StructFieldType)
        ? value as StructBaseType
        : 'uint8';
}

private bitFieldDraftToStructDef(sec: HTMLElement, draft: StructDef): StructDef {
    return {
        id: draft.id,
        name: this.sanitizeCIdent(this.inputValue(sec, '#se-name')) || this.nextStructName(draft.id),
        kind: 'bitfield',
        baseType: draft.baseType ?? 'uint8',
        bitFields: (draft.bitFields ?? [{ name: 'bit0', bitWidth: 1 }]).map(child => ({ ...child })),
        fields: [],
    };
}

/** Enum type form: name + base unsigned width + name/value entry rows (no struct fields). */
private enumDefEditorHtml(draft: StructDef): string {
    return this.kindDefEditorHtml(draft, {
        placeholder: 'MyEnum',
        badge: 'enum',
        baseSelectId: 'se-enum-base-type',
        baseAria: 'Enum base width',
        rowsHtml: `<div id="se-enum-entries" class="sfe-enum-entries">${this.enumEntryRowsHtml(draft)}</div>`,
        addBtnHtml: `<button id="se-enum-add" class="sb-btn sb-btn-add" title="Add enum entry">+ Add entry</button>`,
    });
}

private enumEntryRowsHtml(draft: StructDef): string {
    const entries = draft.entries ?? [];
    return entries.map((entry, i) => this.enumEntryRowHtml(entry, i, entries.length)).join('');
}

private enumEntryRowHtml(entry: EnumEntry, i: number, total: number): string {
    const upDis = i === 0 ? ' disabled' : '';
    const dnDis = i === total - 1 ? ' disabled' : '';
    const delCell = total <= 1
        ? `<span class="sfe-del-placeholder"></span>`
        : `<button class="sfe-enum-del-entry" title="Remove entry" aria-label="Remove entry">\u2715</button>`;
    return (
        `<div class="sfe-enum-entry-row" data-entry-idx="${i}">` +
        `<span class="sfe-bf-child-indent"></span>` +
        `<input class="sfe-enum-entry-name sb-input sb-input-sm" type="text" value="${esc(entry.name)}" maxlength="64" ` +
               `placeholder="ENTRY${i}" spellcheck="false" autocomplete="off">` +
        `<span class="sfe-bf-child-unit">=</span>` +
        `<input class="sfe-enum-entry-value sb-input sb-input-sm" type="text" inputmode="numeric" ` +
               `value="${esc(this.enumEntryValueText(entry.value))}" placeholder="0" spellcheck="false" autocomplete="off">` +
        `<div class="sfe-bf-child-move">` +
        `<button class="sfe-move-btn sfe-move-up" title="Move up" aria-label="Move up"${upDis}>&#x2191;</button>` +
        `<button class="sfe-move-btn sfe-move-dn" title="Move down" aria-label="Move down"${dnDis}>&#x2193;</button>` +
        `</div>` +
        delCell +
        `</div>`
    );
}

private enumEntryValueText(value: number): string {
    return `0x${value.toString(16).toUpperCase()}`;
}

private enumEntryIndex(btn: HTMLElement): number | null {
    const row = btn.closest<HTMLElement>('.sfe-enum-entry-row');
    const idx = this.parseDatasetInt(row?.dataset.entryIdx);
    return idx === null ? null : idx;
}

private refreshEnumDefRows(sec: HTMLElement, draft: StructDef): void {
    const container = sec.querySelector<HTMLElement>('#se-enum-entries');
    if (!container) { return; }
    container.innerHTML = this.enumEntryRowsHtml(draft);
    this.wireEnumDefEntryRows(sec, draft);
    const pre = sec.querySelector<HTMLElement>('#se-preview pre');
    if (pre) { this.renderStructCPreview(pre, draft); }
}

private wireEnumDefEntryRows(sec: HTMLElement, draft: StructDef): void {
    const container = sec.querySelector<HTMLElement>('#se-enum-entries');
    if (!container) { return; }
    container.querySelectorAll<HTMLInputElement>('.sfe-enum-entry-name').forEach(inp => {
        inp.addEventListener('input', () => { this.syncEnumDefDraft(sec, draft); this.refreshEditorPreview(sec, draft); });
        inp.addEventListener('blur', () => {
            const clean = this.sanitizeCIdent(inp.value);
            if (clean !== inp.value) { inp.value = clean; }
            this.syncEnumDefDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        });
    });
    container.querySelectorAll<HTMLInputElement>('.sfe-enum-entry-value').forEach(inp =>
        inp.addEventListener('input', () => { this.syncEnumDefDraft(sec, draft); this.refreshEditorPreview(sec, draft); }));
    this.wireClicks(container, '.sfe-enum-del-entry', btn => {
        const i = this.enumEntryIndex(btn);
        if (i === null) { return; }
        this.syncEnumDefDraft(sec, draft);
        draft.entries!.splice(i, 1);
        if (draft.entries!.length === 0) { draft.entries!.push({ name: 'VALUE0', value: 0 }); }
        this.refreshEnumDefRows(sec, draft);
    });
    this.wireClicks(container, '.sfe-enum-entry-row .sfe-move-up', btn => {
        const i = this.enumEntryIndex(btn);
        if (i === null) { return; }
        this.syncEnumDefDraft(sec, draft);
        if (i > 0) {
            [draft.entries![i - 1], draft.entries![i]] = [draft.entries![i], draft.entries![i - 1]];
            this.refreshEnumDefRows(sec, draft);
        }
    });
    this.wireClicks(container, '.sfe-enum-entry-row .sfe-move-dn', btn => {
        const i = this.enumEntryIndex(btn);
        if (i === null) { return; }
        this.syncEnumDefDraft(sec, draft);
        if (i < draft.entries!.length - 1) {
            [draft.entries![i], draft.entries![i + 1]] = [draft.entries![i + 1], draft.entries![i]];
            this.refreshEnumDefRows(sec, draft);
        }
    });
}

private syncEnumDefDraft(sec: HTMLElement, draft: StructDef): void {
    draft.name = this.sanitizeCIdent(this.inputValue(sec, '#se-name'));
    draft.baseType = this.readBaseType(this.selectValue(sec, '#se-enum-base-type'));
    draft.fields = [];
    const rows = sec.querySelectorAll<HTMLElement>('#se-enum-entries .sfe-enum-entry-row');
    draft.entries = Array.from(rows).map(row => this.readEditorEnumEntry(row));
}

private readEditorEnumEntry(row: HTMLElement): EnumEntry {
    const idx = row.dataset.entryIdx ?? '0';
    const name = this.sanitizeCIdent(
        (row.querySelector('.sfe-enum-entry-name') as HTMLInputElement).value
    ) || `VALUE${idx}`;
    const value = this.parseEnumEntryValue((row.querySelector('.sfe-enum-entry-value') as HTMLInputElement).value);
    return { name, value };
}

private parseEnumEntryValue(raw: string): number {
    const text = raw.trim();
    if (text === '') { return 0; }
    return nonNegativeEnumValue(this.parseEnumEntryNumber(text));
}

/** Parse a hex (`0x`) or decimal enum entry number. */
private parseEnumEntryNumber(text: string): number {
    return isHexEnumEntryText(text) ? Number.parseInt(text.replace(/^0x/i, ''), 16) : Number.parseInt(text, 10);
}

private enumDraftToStructDef(sec: HTMLElement, draft: StructDef): StructDef {
    return {
        id: draft.id,
        name: this.sanitizeCIdent(this.inputValue(sec, '#se-name')) || this.nextStructName(draft.id),
        kind: 'enum',
        baseType: draft.baseType ?? 'uint8',
        entries: (draft.entries ?? [{ name: 'VALUE0', value: 0 }]).map(entry => ({ ...entry })),
        fields: [],
    };
}

private tabNavKey(key: string): boolean {
    return key === 'ArrowLeft' || key === 'ArrowRight';
}

private tabActivateKey(key: string): boolean {
    return key === 'Enter' || key === ' ';
}

private nextTabIndex(list: HTMLButtonElement[], btn: HTMLButtonElement, key: string): number {
    const idx = list.indexOf(btn);
    if (key === 'ArrowRight') { return (idx + 1) % list.length; }
    return (idx + list.length - 1) % list.length;
}

private editorInheritedEndian(): string {
    return (this._editingType?.draft.endian ?? this._endian).toUpperCase();
}

private editorInheritedAlloc(): string {
    return (this._editingType?.draft.allocation ?? this._bitFieldAllocation).toUpperCase();
}

/**
 * Rows markup for the current draft fields — shared by the full editor render
 * and the incremental `#se-fields` rebuild (so the two never diverge).
 */
private fieldRowsHtml(draft: StructDef): string {
    return draft.fields.map((f, i) => this.fieldRowHtml(f, i, draft.fields.length === 1, draft.fields.length, draft.id)).join('');
}

/**
 * Incremental editor refresh: rebuild only the `#se-fields` row container
 * instead of the whole editor. The scroll container (.se-form) is never
 * replaced, so its scrollTop survives — no jump to the top on Add Field /
 * Add bit / move / delete. Then re-wire row-level controls and refresh the
 * live C preview.
 */
private refreshFieldRows(sec: HTMLElement, draft: StructDef): void {
    const fields = sec.querySelector<HTMLElement>('#se-fields');
    if (!fields) { return; }
    fields.innerHTML = this.fieldRowsHtml(draft);
    this.wireFieldRows(fields, sec, draft);
    const pre = sec.querySelector<HTMLElement>('#se-preview pre');
    if (pre) { this.renderStructCPreview(pre, draft); }
}

/** Re-render the live C preview as the user edits the draft. */
private refreshEditorPreview(sec: HTMLElement, draft: StructDef): void {
    const kind = structDefKind(draft);
    if (kind === 'bitfield') { this.syncBitFieldDefDraft(sec, draft); }
    else if (kind === 'enum') { this.syncEnumDefDraft(sec, draft); }
    else { this.syncEditorDraft(sec, draft); }
    const pre = sec.querySelector<HTMLElement>('#se-preview pre');
    if (pre) { this.renderStructCPreview(pre, draft); }
}

/**
 * Row-level editor controls (type select, pointer, array, bit toggle, child
 * rows, move/delete, endian/alloc select). Called on initial mount and again
 * after every `#se-fields` rebuild so freshly inserted rows stay live.
 */
private wireFieldRows(fieldsEl: HTMLElement, sec: HTMLElement, draft: StructDef): void {
    const syncedFieldForButton = (btn: HTMLElement): { row: HTMLElement; idx: number; field: StructField | undefined } => {
        const row = btn.closest<HTMLElement>('.struct-field-row')!;
        this.syncEditorDraft(sec, draft);
        const idx = parseInt(row.dataset.idx!);
        return { row, idx, field: draft.fields[idx] };
    };

    fieldsEl.querySelectorAll<HTMLElement>('.sfe-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            this.syncEditorDraft(sec, draft);
            this._editorError = null;
            const row = btn.closest<HTMLElement>('.struct-field-row')!;
            const idx = parseInt(row.dataset.idx!);
            draft.fields.splice(idx, 1);
            this.refreshFieldRows(sec, draft);
            this.scrollEditorRowIntoView(sec, Math.max(0, idx - 1));
        });
    });

    fieldsEl.querySelectorAll<HTMLElement>('.sfe-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
            const { idx } = syncedFieldForButton(btn);
            this._editorError = null;
            if (idx > 0) {
                [draft.fields[idx - 1], draft.fields[idx]] = [draft.fields[idx], draft.fields[idx - 1]];
                this.refreshFieldRows(sec, draft);
                this.scrollEditorRowIntoView(sec, idx - 1);
            }
        });
    });

    fieldsEl.querySelectorAll<HTMLElement>('.sfe-move-dn').forEach(btn => {
        btn.addEventListener('click', () => {
            const { idx } = syncedFieldForButton(btn);
            this._editorError = null;
            if (idx < draft.fields.length - 1) {
                [draft.fields[idx], draft.fields[idx + 1]] = [draft.fields[idx + 1], draft.fields[idx]];
                this.refreshFieldRows(sec, draft);
                this.scrollEditorRowIntoView(sec, idx + 1);
            }
        });
    });

    fieldsEl.querySelectorAll<HTMLElement>('.sfe-arr-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const cell = btn.closest<HTMLElement>('.sfe-arr-cell')!;
            const nowArr = !cell.classList.contains('is-array');
            cell.classList.toggle('is-array', nowArr);
            btn.classList.toggle('active', nowArr);
            btn.title = nowArr ? 'Remove array' : 'Make array';
            btn.setAttribute('aria-label', btn.title);
            if (nowArr) {
                const inp = cell.querySelector<HTMLInputElement>('.sfe-count-inp')!;
                if (!inp.value) { inp.value = '2'; }
                inp.focus(); inp.select();
            }
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLElement>('.struct-field-row').forEach(row => {
        row.tabIndex = 0;
        row.addEventListener('contextmenu', ev => {
            this.showEditorFieldPointerMenu(sec, draft, row, ev);
        });
        row.addEventListener('keydown', ev => {
            if (this.fieldMenuKey(ev, row)) {
                ev.preventDefault();
                this.showEditorFieldPointerMenu(sec, draft, row, ev);
            }
        });
    });

    fieldsEl.querySelectorAll<HTMLElement>('.sfe-ptr-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest<HTMLElement>('.struct-field-row')!;
            if (!row) { return; }
            const want = !(row.dataset.ptr === '1');
            this.toggleFieldPointer(sec, draft, row, want);
        });
    });

    fieldsEl.querySelectorAll<HTMLInputElement>('.sfe-count-inp').forEach(inp => {
        inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '');
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLInputElement>('.sfe-name-inp').forEach(inp => {
        inp.addEventListener('input', () => { this.refreshEditorPreview(sec, draft); });
        inp.addEventListener('blur', () => {
            const clean = this.sanitizeCIdent(inp.value);
            if (clean !== inp.value) { inp.value = clean || 'field'; }
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLSelectElement>('.sfe-type-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            this.handleFieldTypeChange(sec, draft, sel);
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLSelectElement>('.sfe-endian-sel, .sfe-alloc-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            this.syncEditorDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLInputElement>('.sfe-hidden-chk').forEach(chk => {
        chk.addEventListener('change', () => {
            this.syncEditorDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        });
    });
}

/**
 * Refresh the "Auto — inherits <X>" titles (select + its Auto option) on all
 * endian/alloc override selects after the struct default changed — in place,
 * no editor rebuild (mirrors the tooltip text fieldRowHtml/editorHtml render
 * on mount).
 */
private updateEditorOverrideTitles(sec: HTMLElement): void {
    const endianInherit = this.editorInheritedEndian();
    const allocInherit = this.editorInheritedAlloc();
    sec.querySelectorAll<HTMLSelectElement>('.sfe-endian-sel').forEach(sel =>
        this.setOverrideSelectTitles(sel, 'endian', endianInherit));
    sec.querySelectorAll<HTMLSelectElement>('.sfe-alloc-sel').forEach(sel =>
        this.setOverrideSelectTitles(sel, 'allocation', allocInherit));
    const structEndian = sec.querySelector<HTMLSelectElement>('#se-endian');
    if (structEndian) { this.setOverrideSelectTitles(structEndian, 'endian', this._endian.toUpperCase()); }
}

private overrideSelectValue(sel: HTMLSelectElement, kind: 'endian' | 'allocation'): 'le' | 'be' | 'lsb' | 'msb' | undefined {
    return kind === 'endian' ? this.readEndianOverride(sel.value) : this.readAllocationOverride(sel.value);
}

private setOverrideSelectTitles(sel: HTMLSelectElement, kind: 'endian' | 'allocation', inherited: string): void {
    const autoTitle = this.overrideAutoTitle(this.overrideSelectValue(sel, kind), inherited);
    const fallbackTitle = this.overrideHelpTitle(kind);
    sel.title = autoTitle ?? fallbackTitle;
    const opt = sel.options[0];
    if (opt) { opt.title = autoTitle ?? ''; }
}

/** Attach a click handler to every element matching `selector` under `root`. */
private wireClicks(root: HTMLElement, selector: string, handler: (btn: HTMLElement) => void): void {
    root.querySelectorAll<HTMLElement>(selector).forEach(btn => btn.addEventListener('click', () => handler(btn)));
}

/** Scroll a field row at `idx` into (near) viewport — used after row-set rebuilds. */
private scrollEditorRowIntoView(sec: HTMLElement, idx: number): void {
    const row = sec.querySelectorAll<HTMLElement>('.struct-field-row')[idx];
    if (row && typeof row.scrollIntoView === 'function') { row.scrollIntoView({ block: 'nearest' }); }
}

private syncEditorDraft(sec: HTMLElement, draft: StructDef): void {
    draft.name   = this.sanitizeCIdent(this.inputValue(sec, '#se-name'));
    draft.packed = this.inputActive(sec, '#se-packed');
    draft.endian = this.readEndianOverride(this.selectValue(sec, '#se-endian'));
    const rows = sec.querySelectorAll<HTMLElement>('.struct-field-row');
    draft.fields = Array.from(rows).map(row => {
        return this.readEditorFieldRow(row);
    });
}

private inputValue(sec: HTMLElement, sel: string): string {
    return sec.querySelector<HTMLInputElement>(sel)?.value.trim() ?? '';
}

private inputActive(sec: HTMLElement, sel: string): boolean {
    return sec.querySelector(sel)?.classList.contains('active') ?? false;
}

private selectValue(sec: HTMLElement, sel: string): string | undefined {
    return sec.querySelector<HTMLSelectElement>(sel)?.value;
}

private readEditorFieldRow(row: HTMLElement): StructField {
    const typeInfo = this.readEditorFieldType(row);
    return {
        name: this.sanitizeCIdent(this.rowInputValue(row, '.sfe-name-inp')),
        type: typeInfo.type,
        refStructId: typeInfo.refStructId,
        isPointer: typeInfo.isPointer || undefined,
        count: this.readEditorArrayCount(row),
        endian: this.readEndianOverride(this.rowSelectValue(row, '.sfe-endian-sel')),
        // Only bit-field-reference rows render an alloc select; other rows hold
        // a placeholder, so this reads undefined and authors no allocation.
        allocation: this.readAllocationOverride(this.rowSelectValue(row, '.sfe-alloc-sel')),
        hidden: this.readHiddenFlag(row),
    };
}

/** Read a text input's current value inside a row. */
private rowInputValue(row: HTMLElement, sel: string): string {
    return (row.querySelector(sel) as HTMLInputElement).value;
}

/** Read a select's current value inside a row, or undefined when absent. */
private rowSelectValue(row: HTMLElement, sel: string): string | undefined {
    return row.querySelector<HTMLSelectElement>(sel)?.value;
}

/** Whether the row's hidden checkbox is ticked (absent = not hidden). */
private readHiddenFlag(row: HTMLElement): true | undefined {
    return row.querySelector<HTMLInputElement>('.sfe-hidden-chk')?.checked || undefined;
}

private readEndianOverride(value: string | undefined): 'le' | 'be' | undefined {
    return value === 'le' || value === 'be' ? value : undefined;
}

private readAllocationOverride(value: string | undefined): 'lsb' | 'msb' | undefined {
    return value === 'lsb' || value === 'msb' ? value : undefined;
}

private readEditorFieldType(row: HTMLElement): { type: StructFieldType; refStructId: string | undefined; isPointer: boolean } {
    const rawType = (row.querySelector('.sfe-type-sel') as HTMLSelectElement).value;
    const parsed = this.parseEditorFieldType(rawType);
    const ptrActive = row.dataset.ptr === '1';
    return {
        ...parsed,
        isPointer: ptrActive || parsed.type === 'void',
    };
}

private parseEditorFieldType(rawType: string): { type: StructFieldType; refStructId: string | undefined } {
    if (rawType.startsWith('struct:')) { return { type: 'struct', refStructId: rawType.slice('struct:'.length) }; }
    if (rawType.startsWith('bitfield:')) { return { type: 'bitfield', refStructId: rawType.slice('bitfield:'.length) }; }
    if (rawType.startsWith('enum:')) { return { type: 'enum', refStructId: rawType.slice('enum:'.length) }; }
    return { type: rawType as StructFieldType, refStructId: undefined };
}

/** Read a bit-field child row (used by the standalone bit-field def editor). */
private readEditorBitFieldChild(childRow: HTMLElement): BitFieldChild {
    const name = this.readBitChildName(childRow);
    const bitWidth = this.readBitChildWidth(childRow);
    const enumRef = this.rowSelectValue(childRow, '.sfe-bf-child-enum');
    return enumRef
        ? { name, bitWidth, refStructId: enumRef }
        : { name, bitWidth };
}

/** Child name, defaulting to the row index when blank. */
private readBitChildName(childRow: HTMLElement): string {
    const raw = this.rowInputValue(childRow, '.sfe-bf-child-name');
    return this.sanitizeCIdent(raw) || `bit${childRow.dataset.childIdx || '0'}`;
}

/** Child width, clamped to a positive value at most 64 bits. */
private readBitChildWidth(childRow: HTMLElement): number {
    const width = parseInt(this.rowInputValue(childRow, '.sfe-bf-child-width'), 10);
    return width > 0 ? Math.min(width, 64) : 1;
}

private readEditorArrayCount(row: HTMLElement): number {
    const cell = row.querySelector<HTMLElement>('.sfe-arr-cell')!;
    if (!cell.classList.contains('is-array')) { return 1; }
    const v = parseInt((row.querySelector('.sfe-count-inp') as HTMLInputElement).value);
    return isNaN(v) || v < 1 ? 1 : v;
}

private wireEditorInSec(sec: HTMLElement): void {
    if (!this._editingType) { return; }
    const { draft } = this._editingType;
    if (structDefKind(draft) === 'bitfield') { this.wireBitFieldDefEditor(sec, draft); return; }
    if (structDefKind(draft) === 'enum') { this.wireEnumDefEditor(sec, draft); return; }
    this.wireStructEditor(sec, draft);
}

private wireBitFieldDefEditor(sec: HTMLElement, draft: StructDef): void {
    this.wireEditorTabs(sec);
    this.wireBitFieldDefChildRows(sec, draft);

    sec.querySelector<HTMLSelectElement>('#se-base-type')?.addEventListener('change', () => {
        this.syncBitFieldDefDraft(sec, draft);
        this.refreshEditorPreview(sec, draft);
        this.refreshBitFieldDefAddButton(sec, draft);
    });
    sec.querySelector('#se-bf-def-add')?.addEventListener('click', () => {
        this.syncBitFieldDefDraft(sec, draft);
        if (!draft.bitFields) { draft.bitFields = []; }
        draft.bitFields.push({ name: `bit${draft.bitFields.length}`, bitWidth: 1 });
        this.refreshBitFieldDefRows(sec, draft);
    });
    this.wireEditorNameInput(sec, draft);
    this.wireEditorSaveCancel(sec, draft);
}

private wireEnumDefEditor(sec: HTMLElement, draft: StructDef): void {
    this.wireEditorTabs(sec);
    this.wireEnumDefEntryRows(sec, draft);

    sec.querySelector<HTMLSelectElement>('#se-enum-base-type')?.addEventListener('change', () => {
        this.syncEnumDefDraft(sec, draft);
        this.refreshEditorPreview(sec, draft);
    });
    sec.querySelector('#se-enum-add')?.addEventListener('click', () => {
        this.syncEnumDefDraft(sec, draft);
        if (!draft.entries) { draft.entries = []; }
        draft.entries.push({ name: `VALUE${draft.entries.length}`, value: draft.entries.length });
        this.refreshEnumDefRows(sec, draft);
    });
    this.wireEditorNameInput(sec, draft);
    this.wireEditorSaveCancel(sec, draft);
}

private wireStructEditor(sec: HTMLElement, draft: StructDef): void {
    const packedBtn = sec.querySelector<HTMLButtonElement>('#se-packed')!;
    packedBtn.addEventListener('click', () => {
        const nowPacked = !packedBtn.classList.contains('active');
        packedBtn.classList.toggle('active', nowPacked);
        draft.packed = nowPacked;
        this.refreshEditorPreview(sec, draft);
    });

    // Row-level controls are wired by wireFieldRows (also re-run after each
    // incremental #se-fields rebuild). The struct-level controls below are
    // mounted once and kept across those rebuilds.
    this.wireFieldRows(sec.querySelector<HTMLElement>('#se-fields')!, sec, draft);

    this.wireEditorTabs(sec);

    sec.querySelector('#se-add')!.addEventListener('click', () => {
        this.syncEditorDraft(sec, draft);
        this._editorError = null;
        const lastIdx = draft.fields.length;
        draft.fields.push({ name: `field${lastIdx}`, type: 'uint8', count: 1 });
        this.refreshFieldRows(sec, draft);
        this.scrollEditorRowIntoView(sec, lastIdx);
        sec.querySelectorAll<HTMLInputElement>('.struct-field-row .sfe-name-inp')[lastIdx]?.focus();
    });

    // Struct-level endian change: sync the draft, refresh per-field "Auto"
    // tooltips in place (no rebuild — the pane keeps its height/scroll), and
    // re-render the preview.
    this.wireStructLevelOverrideSelects(sec);
    this.wireEditorNameInput(sec, draft);
    this.wireEditorSaveCancel(sec, draft);
}

private wireStructLevelOverrideSelects(sec: HTMLElement): void {
    sec.querySelector<HTMLSelectElement>('#se-endian')?.addEventListener('change', () => {
        if (!this._editingType) { return; }
        const { draft } = this._editingType;
        this.syncEditorDraft(sec, draft);
        this.updateEditorOverrideTitles(sec);
        this.refreshEditorPreview(sec, draft);
    });
}

private wireEditorNameInput(sec: HTMLElement, draft: StructDef): void {
    sec.querySelector<HTMLInputElement>('#se-name')!.addEventListener('input', () => {
        this.refreshEditorPreview(sec, draft);
    });
    sec.querySelector<HTMLInputElement>('#se-name')!.addEventListener('blur', e => {
        const inp = e.target as HTMLInputElement;
        const clean = this.sanitizeCIdent(inp.value);
        if (clean !== inp.value) { inp.value = clean; }
        this.refreshEditorPreview(sec, draft);
    });
}

private wireEditorSaveCancel(sec: HTMLElement, draft: StructDef): void {
    sec.querySelector('#se-save')!.addEventListener('click', () => {
        this.saveEditorDraft(sec, draft);
    });
    sec.querySelector('#se-cancel')!.addEventListener('click', () => {
        this._editorError = null;
        this._editingType = null;
        this.render();
    });
}

/** Edit/Preview tab switch: attribute-only toggling (no re-render), so the draft and the section-body scroll keep their state when switching views. */
private wireEditorTabs(sec: HTMLElement): void {
    const tabButtons = sec.querySelectorAll<HTMLButtonElement>('.se-tab');
    const setEditorView = (view: string): void => {
        tabButtons.forEach(btn => {
            const on = btn.dataset.seView === view;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', String(on));
        });
        sec.querySelectorAll<HTMLElement>('.se-view').forEach(pane => {
            pane.hidden = pane.dataset.seView !== view;
        });
    };
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => { setEditorView(btn.dataset.seView!); });
        btn.addEventListener('keydown', ev => {
            if (this.tabNavKey(ev.key)) {
                ev.preventDefault();
                const list = Array.from(tabButtons);
                const next = list[this.nextTabIndex(list, btn, ev.key)]!;
                next.focus();
                setEditorView(next.dataset.seView!);
            } else if (this.tabActivateKey(ev.key)) {
                ev.preventDefault();
                setEditorView(btn.dataset.seView!);
            }
        });
    });
}

private saveEditorDraft(sec: HTMLElement, draft: StructDef): void {
    if (structDefKind(draft) === 'bitfield') {
        this.syncBitFieldDefDraft(sec, draft);
        this.commitEditorDraft(this.bitFieldDraftToStructDef(sec, draft));
        return;
    }
    if (structDefKind(draft) === 'enum') {
        this.syncEnumDefDraft(sec, draft);
        this.commitEditorDraft(this.enumDraftToStructDef(sec, draft));
        return;
    }
    this.syncEditorDraft(sec, draft);
    if (draft.fields.length === 0) { return; }
    this.commitEditorDraft(this.editorDraftToStructDef(sec, draft));
}

private commitEditorDraft(def: StructDef): void {
    const validationErrors = validateStructs(this.upsertStructList(this._structs, def), MAX_NESTED_DEPTH);
    if (validationErrors.length > 0) {
        this._editorError = validationErrors[0];
        this.render();
        return;
    }

    this._editorError = null;
    this._structs = this.upsertStructList(this._structs, def);
    this.cb.onStructsChange?.(this._structs);
    this.closeEditorAfterSave();
    this.render();
}

private editorDraftToStructDef(sec: HTMLElement, draft: StructDef): StructDef {
    return {
        id: draft.id,
        name: this.readEditorStructName(sec, draft.id),
        packed: draft.packed ?? false,
        endian: draft.endian,
        allocation: draft.allocation,
        fields: draft.fields.map((field, idx) => this.withSavedFieldName(field, idx, draft.fields)),
    };
}

private readEditorStructName(sec: HTMLElement, draftId: string): string {
    const nameInp = sec.querySelector<HTMLInputElement>('#se-name')!;
    const name = this.sanitizeCIdent(nameInp.value.trim());
    return name || this.nextStructName(draftId);
}

private nextStructName(draftId: string): string {
    const otherNames = new Set(this._structs.filter(d => d.id !== draftId).map(d => d.name));
    let candidate = 'MyStruct';
    let n = 1;
    while (otherNames.has(candidate)) { candidate = `MyStruct${n++}`; }
    return candidate;
}

private withSavedFieldName(field: StructField, idx: number, fields: StructField[]): StructField {
    if (field.name) { return { ...field }; }
    const takenNames = new Set(fields.map(f => f.name).filter(Boolean));
    let candidate = `field${idx}`;
    let n = 0;
    while (takenNames.has(candidate)) { candidate = `field${idx}_${n++}`; }
    return { ...field, name: candidate };
}

private upsertStructList(structs: StructDef[], def: StructDef): StructDef[] {
    const idx = structs.findIndex(d => d.id === def.id);
    if (idx < 0) { return [...structs, def]; }
    const clone = [...structs];
    clone[idx] = def;
    return clone;
}

    private closeEditorAfterSave(): void {
        this._editingType = null;
    }

private handleFieldTypeChange(sec: HTMLElement, draft: StructDef, sel: HTMLSelectElement): void {
    const row = sel.closest<HTMLElement>('.struct-field-row');
    if (!row) { return; }
    const isBitFieldRef = sel.value.startsWith('bitfield:');
    const ptr = fieldRowPtrFlag(sel.value, isBitFieldRef);
    if (ptr !== undefined) { row.dataset.ptr = ptr; }
    this.syncFieldAllocCell(sec, draft, row, isBitFieldRef);
}

/**
 * Swap the row's Alloc cell between the (only) bit-field-reference select and
 * the alignment placeholder as the type select changes — in place, so the row
 * keeps focus and the column stays aligned.
 */
private syncFieldAllocCell(sec: HTMLElement, draft: StructDef, row: HTMLElement, isBitFieldRef: boolean): void {
    const sel = row.querySelector<HTMLSelectElement>('.sfe-alloc-sel');
    const placeholder = row.querySelector<HTMLElement>('.sfe-alloc-placeholder');
    if (shouldInsertAllocSelect(isBitFieldRef, sel, placeholder)) {
        this.insertAllocSelect(sec, draft, row, placeholder);
    } else if (shouldRemoveAllocSelect(isBitFieldRef, sel)) {
        sel.outerHTML = '<span class="sfe-alloc-placeholder"></span>';
    }
}

/** Insert + live-wire the alloc override select into a bit-field-reference row. */
private insertAllocSelect(sec: HTMLElement, draft: StructDef, row: HTMLElement, placeholder: HTMLElement | null): void {
    if (!placeholder) { return; }
    placeholder.outerHTML = this.overrideSelectHtml(undefined, 'allocation', 'sfe-alloc-sel', undefined, this.editorInheritedAlloc());
    const inserted = row.querySelector<HTMLSelectElement>('.sfe-alloc-sel');
    if (!inserted) { return; }
    inserted.addEventListener('change', () => {
        this.syncEditorDraft(sec, draft);
        this.refreshEditorPreview(sec, draft);
    });
    this.setOverrideSelectTitles(inserted, 'allocation', this.editorInheritedAlloc());
}

    /** F10 / Shift+F10 and Enter/Space (when the row itself is focused) open the pointer menu. */
    private fieldMenuKey(ev: KeyboardEvent, row: HTMLElement): boolean {
        return this.contextMenuKey(ev) || this.activateKey(ev, row);
    }

    private contextMenuKey(ev: KeyboardEvent): boolean {
        return ev.key === 'F10' && ev.shiftKey;
    }

    private activateKey(ev: KeyboardEvent, row: HTMLElement): boolean {
        return (ev.key === 'Enter' || ev.key === ' ') && ev.target === row;
    }

    /** Pointer declaration lives on the row dataset (set by the * row button or context menu). */
    private editorRowIsPointer(row: HTMLElement): boolean {
    return row.dataset.ptr === '1' || (row.querySelector('.sfe-type-sel') as HTMLSelectElement).value === 'void';
}

    private cannotPointTo(field: StructField, want: boolean): boolean {
        return want && this.isPointerBlocked(field);
    }

    private setFieldPointerFlag(field: StructField, row: HTMLElement, want: boolean): void {
        field.isPointer = want ? true : undefined;
        row.dataset.ptr = want ? '1' : '';
    }

    private toggleFieldPointer(sec: HTMLElement, draft: StructDef, row: HTMLElement, want: boolean): void {
        this.syncEditorDraft(sec, draft);
        const field = draft.fields[parseInt(row.dataset.idx!)];
        if (!field) { return; }
        if (this.cannotPointTo(field, want)) { return; }
        this._editorError = null;
        this.setFieldPointerFlag(field, row, want);
        this.refreshFieldRows(sec, draft);
        const idx = parseInt(row.dataset.idx!);
        this.scrollEditorRowIntoView(sec, idx);
    }

    private fieldPointerMenuItems(row: HTMLElement, field: StructField): string {
        if (this.editorRowIsPointer(row)) {
            return this.menuItemHtml('field-ptr-off', 'Clear pointer', 'Revert to a plain (non-pointer) field');
        }
        if (this.isPointerBlocked(field)) {
            return this.disabledMenuItemHtml('Attach pointer', 'Bit-field / enum fields cannot be pointers');
        }
        return this.menuItemHtml('field-ptr-on', 'Attach pointer', 'Mark this field as a pointer (field ↔ address)');
    }

    private fieldMenuX(ev: Event, row: HTMLElement): number {
        return (ev as MouseEvent).clientX || row.getBoundingClientRect().left + 8;
    }

    private fieldMenuY(ev: Event, row: HTMLElement): number {
        return (ev as MouseEvent).clientY || row.getBoundingClientRect().bottom + 4;
    }

    private onFieldMenuCommand(sec: HTMLElement, draft: StructDef, row: HTMLElement, cmd: string): void {
        if (cmd === 'field-ptr-on' || cmd === 'field-ptr-off') {
            this.toggleFieldPointer(sec, draft, row, cmd === 'field-ptr-on');
        }
    }

    /** Per-field pointer context menu (right-click / Shift+F10 / focus+Enter) — secondary path alongside the * row button. */
    private showEditorFieldPointerMenu(sec: HTMLElement, draft: StructDef, row: HTMLElement, ev: Event): void {
        this.syncEditorDraft(sec, draft);
        const field = draft.fields[parseInt(row.dataset.idx!)];
        if (!field) { return; }
        const items = this.fieldPointerMenuItems(row, field);
        this.showFieldMenu(items, this.fieldMenuX(ev, row), this.fieldMenuY(ev, row), cmd => {
            this.onFieldMenuCommand(sec, draft, row, cmd);
        });
    }

private prepareStructPanelState(): void {
    this._applyStructId = this.nextApplyStructId(this.pinnableStructs());
}

private nextApplyStructId(all: StructDef[]): string | null {
    const fallbackId = all.length > 0 ? all[0].id : null;
    if (!this._applyStructId) { return fallbackId; }
    return all.some(d => d.id === this._applyStructId) ? this._applyStructId : fallbackId;
}

private typeRowsHtml(all: StructDef[]): string {
    if (all.length === 0) { return `<div class="sb-empty">No types defined yet.</div>`; }
    return all.map(def => this.structTypeRowHtml(def)).join('');
}

private structTypeRowHtml(def: StructDef): string {
    const kind = structDefKind(def);
    const meta = kind === 'bitfield'
        ? this.bitFieldDefMeta(def)
        : kind === 'enum'
            ? this.enumDefMeta(def)
            : this.structDefMeta(def);
    const badge = kind === 'struct' ? '' : `<span class="sd-kind">${kind}</span>`;
    return (
        `<div class="sd-row">` +
        `<span class="sd-name">${esc(def.name)}</span>` +
        badge +
        `<span class="sd-meta">${meta}</span>` +
        actionBtnsHtml(`data-struct-id="${esc(def.id)}"`, `data-struct-id="${esc(def.id)}"`) +
        `</div>`
    );
}

private structDefMeta(def: StructDef): string {
    const fieldCount = def.fields.length;
    return `${fieldCount} field${fieldCount !== 1 ? 's' : ''}`;
}

private bitFieldDefMeta(def: StructDef): string {
    const childCount = (def.bitFields ?? []).length;
    return `${def.baseType ?? 'uint8'} \u00b7 ${childCount} child${childCount !== 1 ? 'ren' : ''}`;
}

private enumDefMeta(def: StructDef): string {
    const entryCount = (def.entries ?? []).length;
    return `${def.baseType ?? 'uint8'} \u00b7 ${entryCount} entr${entryCount !== 1 ? 'ies' : 'y'}`;
}

private addStructPinFormHtml(all: StructDef[]): string {
    const pin = this.editingStructPin();
    return (
        `<div id="si-add-form" class="si-add-form">` +
        `<div class="sa-form-hdr ${pinFormClass(pin)}">${pinFormHeader(pin)}</div>` +
        `<div class="sa-row">` +
        `<input id="sa-name" class="sa-name-inp sb-input" type="text" maxlength="40" ` +
               `placeholder="instance name" spellcheck="false" autocomplete="off" value="${esc(pin?.name ?? '')}">` +
        `</div>` +
        `<div class="sa-row">` +
        `<span class="struct-addr-pfx">0x</span>` +
        `<input id="sa-addr" class="sb-input sa-addr-inp" type="text" maxlength="8" ` +
               `placeholder="08000000" autocomplete="off" spellcheck="false" value="${esc(this.pinFormAddress(pin))}">` +
        `</div>` +
        this.addStructPinTypeRowHtml(all) +
        `<div class="sa-row sa-btn-row">` +
        `<button id="sa-confirm" class="sb-btn sb-btn-primary"${this.saConfirmDisabledAttr()}>${pinFormConfirmLabel(pin)}</button>` +
        `<button id="sa-cancel" class="sb-btn sb-btn-secondary">Cancel</button>` +
        `</div>` +
        `</div>`
    );
}

private editingStructPin(): StructPin | null {
    if (!this._editingPinId) { return null; }
    return this._pins.find(p => p.id === this._editingPinId) ?? null;
}

private pinFormAddress(pin: StructPin | null): string {
    if (pin) { return pin.addr.toString(16).toUpperCase().padStart(8, '0'); }
    return this._activeStructAddr !== null
        ? this._activeStructAddr.toString(16).toUpperCase().padStart(8, '0')
        : '';
}

private saConfirmDisabledAttr(): string {
    return this.selectedApplyStructId() ? '' : ' disabled';
}

private addStructPinTypeRowHtml(all: StructDef[]): string {
    const selectedId = this.selectedApplyStructId();
    const structOpts = all.map(d =>
        `<option value="${esc(d.id)}"${d.id === selectedId ? ' selected' : ''}>${esc(d.name)}</option>`
    ).join('');
    const applyDef = all.find(d => d.id === selectedId);
    const previewHtml = applyDef
        ? `<pre class="si-c-preview" data-struct-preview-id="${esc(applyDef.id)}"></pre>`
        : '';
    return (
        `<div class="sa-row">` +
        `<select id="sa-struct-sel" class="sb-select">${structOpts}</select>` +
        `</div>` +
        previewHtml
    );
}

private selectedApplyStructId(): string | null {
    if (!this._editingPinId) { return this._applyStructId; }
    return this._editingPinDraftStructId ?? this.editingPinStructId() ?? null;
}

private editingPinStructId(): string | null {
    const pin = this._pins.find(p => p.id === this._editingPinId);
    return pin?.structId ?? null;
}

private instanceCardsHtml(): string {
    if (this._pins.length > 0) {
        return this._pins.map((pin, i) => this.buildInstanceCard(pin, i)).join('');
    }
    const msg = this.pinnableStructs().length === 0
        ? 'Define a struct type first.'
        : 'No instances yet. Click [\uff0b Add] to create one.';
    return `<div class="sb-empty">${msg}</div>`;
}

private structInstancesBodyHtml(addFormHtml: string, instHtml: string): string {
    if (addFormHtml) { return addFormHtml; }
    return (
        `<div class="si-hdr-row">` +
        this.bitLayoutToggleHtml() +
        this.showHiddenToggleHtml() +
        `</div>` +
        `<div id="si-list">${instHtml}</div>`
    );
}

private bitLayoutToggleHtml(): string {
    return (
        `<div class="si-toggle-group" title="Bit-field allocation: which side receives the first declared bit field">` +
        `<div class="compact-tabs sa-bit-order-tabs">` +
        `<button id="sa-btn-bit-lsb" class="${this._bitFieldAllocation === 'lsb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the least significant bit">LSB</button>` +
        `<button id="sa-btn-bit-msb" class="${this._bitFieldAllocation === 'msb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the most significant bit">MSB</button>` +
        `</div>` +
        `</div>`
    );
}

/** Global "show hidden fields" toggle (Struct Instances header). Off = hidden fields omitted. */
private showHiddenToggleHtml(): string {
    const title = 'Show fields marked hidden in the Struct Types editor';
    return (
        `<label class="si-show-hidden" title="${title}">` +
        `<input type="checkbox" id="si-show-hidden-chk"${this._showHiddenFields ? ' checked' : ''} ` +
               `title="${title}" aria-label="${title}">` +
        `<span>Show hidden</span>` +
        `</label>`
    );
}

    private typePanelTitle(): string {
        if (this._choosingKind) { return 'New Type'; }
        if (!this._editingType) { return 'Struct Types'; }
        return this._editingType.existing ? 'Edit Type' : 'New Type';
    }

    private typePanelBodyHtml(typeRows: string): string {
        if (this._choosingKind) { return this.kindChooserHtml(); }
        if (this._editingType) { return this.editorHtml(this._editingType.draft, this._editingType.existing); }
        return `<div id="sm-list">${typeRows}</div>`;
    }

    /** Three-tile kind picker shown in the Types body after the single `＋ Add` entry point. */
    private kindChooserHtml(): string {
        return (
            `<div id="sm-kind-picker" class="sm-kind-picker">` +
            `<div class="sm-kind-hdr">New type</div>` +
            `<div class="sm-kind-tiles">` +
            this.kindTileHtml('struct', 'Struct', 'A C-like layout of named fields') +
            this.kindTileHtml('bitfield', 'Bit-field', 'A reusable unsigned storage unit split into named bits') +
            this.kindTileHtml('enum', 'Enum', 'A named set of integer values') +
            `</div>` +
            `<div class="se-btns"><button id="sm-kind-cancel" class="sb-btn sb-btn-secondary">Cancel</button></div>` +
            `</div>`
        );
    }

    private kindTileHtml(kind: StructDefKind, label: string, hint: string): string {
        return (
            `<button class="sm-kind-tile" data-kind="${kind}" title="${esc(hint)}">` +
            `<span class="sm-kind-tile-name">${esc(label)}</span>` +
            `<span class="sm-kind-tile-hint">${esc(hint)}</span>` +
            `</button>`
        );
    }

    private pickKind(kind: StructDefKind): void {
        this._choosingKind = false;
        this._editorError = null;
        const id = `user_${Date.now()}`;
        this._editingType = { draft: this.newDraftForKind(kind, id), existing: null, fromManage: true };
        this.render();
    }

    private newDraftForKind(kind: StructDefKind, id: string): StructDef {
        if (kind === 'bitfield') {
            return { id, name: '', kind: 'bitfield', baseType: 'uint32', fields: [], bitFields: [{ name: 'bit0', bitWidth: 1 }] };
        }
        if (kind === 'enum') {
            return { id, name: '', kind: 'enum', baseType: 'uint8', fields: [], entries: [{ name: 'VALUE0', value: 0 }] };
        }
        return { id, name: '', packed: false, fields: [{ name: 'field0', type: 'uint32', count: 1 }] };
    }

    private wireKindChooser(typesPanel: HTMLElement): void {
        if (!this._choosingKind) { return; }
        typesPanel.querySelectorAll<HTMLElement>('.sm-kind-tile').forEach(tile => {
            tile.addEventListener('click', () => {
                const kind = tile.dataset.kind;
                if (kind === 'struct' || kind === 'bitfield' || kind === 'enum') { this.pickKind(kind); }
            });
        });
        typesPanel.querySelector('#sm-kind-cancel')?.addEventListener('click', () => {
            this._choosingKind = false;
            this.render();
        });
    }

private wireStructPinsPanel(sec: HTMLElement): void {
    this.wireTypesPanelControls(sec);
    this.wireAddStructPinControls(sec);
    this.wireBitLayoutTabs(sec);
    this.wireShowHiddenToggle(sec);
}

    private wireTypesPanelControls(sec: HTMLElement): void {
        const typesPanel = sec.querySelector<HTMLElement>('#si-types-body')!;
        this.wireKindChooser(typesPanel);
    wireActionBtns(
        typesPanel,
        '.act-btn-edit',
        '.act-btn-del',
        btn => {
            this._editorError = null;
            const existing = this._structs.find(d => d.id === btn.dataset.structId) ?? null;
            if (!existing) { return; }
            this._editingType = {
                draft: {
                    id: existing.id, name: existing.name, packed: existing.packed ?? false,
                    kind: structDefKind(existing),
                    baseType: existing.baseType,
                    endian: existing.endian, allocation: existing.allocation,
                    fields: existing.fields.map(f => ({ ...f })),
                    bitFields: existing.bitFields?.map(c => ({ ...c })),
                    entries: existing.entries?.map(e => ({ ...e })),
                },
                existing,
                fromManage: true,
            };
            this.render();
        },
        btn => {
            const id = btn.dataset.structId!;
            const next = withoutStructDefinition(this._structs, this._pins, id);
            this._structs = next.structs;
            this._pins = next.pins;
            if (this._applyStructId === id) { this._applyStructId = null; }
            this.cb.onStateChange?.(this._structs, this._pins);
            this.render();
        },
    );
}

private wireAddStructPinControls(sec: HTMLElement): void {
    if (!this._addingPin && !this._editingPinId) { return; }

    sec.querySelector('#sa-struct-sel')?.addEventListener('change', e => {
        const value = (e.target as HTMLSelectElement).value || null;
        if (this._editingPinId) { this._editingPinDraftStructId = value; }
        else { this._applyStructId = value; }
        this.preservePendingStructAddress();
        this.render();
    });
    sec.querySelector('#sa-addr')?.addEventListener('input', () => {
        const addrInp = sec.querySelector<HTMLInputElement>('#sa-addr');
        const confirmBtn = sec.querySelector<HTMLButtonElement>('#sa-confirm');
        if (!addrInp || !confirmBtn) { return; }
        const hasAddr = addrInp.value.trim().length > 0;
        confirmBtn.disabled = !this.selectedApplyStructId() || !hasAddr;
    });
    sec.querySelector('#sa-confirm')?.addEventListener('click', () => {
        this.confirmStructPin();
    });
    sec.querySelector('#sa-cancel')?.addEventListener('click', () => {
        this._addingPin = false;
        this._editingPinId = null;
        this._editingPinDraftStructId = null;
        this.render();
    });
}

private wireBitLayoutTabs(sec: HTMLElement): void {
    sec.querySelector('#sa-btn-bit-lsb')?.addEventListener('click', () => {
        this._bitFieldAllocation = 'lsb';
        sec.querySelector('#sa-btn-bit-lsb')?.classList.add('active');
        sec.querySelector('#sa-btn-bit-msb')?.classList.remove('active');
        if (this._expanded.size > 0) { this.render(); }
        this.cb.onBitAllocationChange?.(this._bitFieldAllocation);
    });
    sec.querySelector('#sa-btn-bit-msb')?.addEventListener('click', () => {
        this._bitFieldAllocation = 'msb';
        sec.querySelector('#sa-btn-bit-msb')?.classList.add('active');
        sec.querySelector('#sa-btn-bit-lsb')?.classList.remove('active');
        if (this._expanded.size > 0) { this.render(); }
        this.cb.onBitAllocationChange?.(this._bitFieldAllocation);
    });
}

/**
 * Global "show hidden fields" toggle. Flips the local view flag, reports the
 * change so the host persists it per profile, and refreshes only the instances
 * body in place — an open Types editor draft is left untouched (never reloaded).
 */
private wireShowHiddenToggle(sec: HTMLElement): void {
    sec.querySelector('#si-show-hidden-chk')?.addEventListener('change', e => {
        const show = (e.target as HTMLInputElement).checked;
        this._showHiddenFields = show;
        this.cb.onShowHiddenFieldsChange?.(show);
        this.refreshInstances();
    });
}

/**
 * Re-render just the Struct Instances *list* in place after the hidden-field
 * filter changed. The header (bit-layout tabs + `#si-show-hidden-chk`) is left
 * untouched, so the toggle keeps focus and the section body keeps its scroll
 * position — no whole-body `innerHTML` rebuild (Types editor also untouched).
 */
private refreshInstances(): void {
    const sec = this._root;
    if (!sec || !this.sections) { return; }
    const list = sec.querySelector<HTMLElement>('#si-list');
    if (!list) { return; }
    this.prepareStructPanelState();
    list.innerHTML = this.instanceCardsHtml();
    this.updateHeaderActions();
    this.hydrateStructPreviews(sec);
    this.wireInstanceCards(sec);
}

private confirmStructPin(): void {
    const addr = this.structApplyAddress();
    if (addr === null) { return; }
    if (this._editingPinId) { this.applyEditedPin(addr); }
    else { this.applyNewPin(addr); }
    this.render();
}

private structApplyAddress(): number | null {
    const addrInp = this._root?.querySelector<HTMLInputElement>('#sa-addr');
    const nameInp = this._root?.querySelector<HTMLInputElement>('#sa-name');
    if (!addrInp || !nameInp || !this.selectedApplyStructId()) { return null; }
    return this.parseStructApplyAddress(addrInp);
}

private applyEditedPin(addr: number): void {
    const idx = this._pins.findIndex(p => p.id === this._editingPinId);
    const pin = this._pins[idx];
    const name = this.editedPinName(pin);
    if (idx >= 0) {
        this._pins = withEditedStructPin(this._pins, idx, { name, addr, structId: this.selectedApplyStructId()! });
        this._activeStructAddr = addr;
        this.cb.onPinsChange?.(this._pins);
    }
    this._editingPinId = null;
    this._editingPinDraftStructId = null;
}

private editedPinName(pin: StructPin | undefined): string {
    const raw = this.rawPinName();
    if (raw) { return raw; }
    return pin?.name || 'inst';
}

private rawPinName(): string {
    return this._root?.querySelector<HTMLInputElement>('#sa-name')?.value.trim() ?? '';
}

private applyNewPin(addr: number): void {
    const name = this.structApplyName(this._root!.querySelector<HTMLInputElement>('#sa-name')!);
    const pin = makeStructPin({ structId: this.selectedApplyStructId()!, addr, name }, this.makePinId);
    this._pins = [...this._pins, pin];
    this._activeStructAddr = addr;
    this._expanded.add(pin.id);
    this._addingPin = false;
    this.cb.onPinsChange?.(this._pins);
}

private parseStructApplyAddress(addrInp: HTMLInputElement): number | null {
    const addr = parseInt(addrInp.value.replace(/^0x/i, ''), 16);
    if (!isNaN(addr)) {
        addrInp.style.borderColor = '';
        return addr;
    }
    addrInp.style.borderColor = 'var(--err)';
    return null;
}

private structApplyName(nameInp: HTMLInputElement): string {
    const name = nameInp.value.trim();
    return name || this.nextStructApplyName();
}

private nextStructApplyName(): string {
    const applyDef = this._structs.find(d => d.id === this._applyStructId);
    const base = applyDef ? applyDef.name : 'inst';
    return this.uniqueStructPinName(`${base}_0`, n => `${base}_${n}`);
}

private uniqueStructPinName(initialName: string, nextName: (n: number) => string): string {
    return uniquePinName(this._pins, initialName, nextName);
}

private makePinId(): string {
    return `pin_${Date.now()}`;
}

private preservePendingStructAddress(): void {
    const value = this.pendingStructAddressValue();
    if (value !== null) { this._activeStructAddr = value; }
}

private pendingStructAddressValue(): number | null {
    const curAddrInp = this.pendingAddrInput();
    if (!curAddrInp) { return null; }
    const value = parseInt(curAddrInp.value, 16);
    if (isNaN(value)) { return null; }
    return value;
}

private pendingAddrInput(): HTMLInputElement | null {
    return this._root?.querySelector<HTMLInputElement>('#sa-addr') ?? null;
}

private instanceTypePreviewHtml(def: StructDef | undefined, pin: StructPin): string {
    return def
        ? `<div class="si-type-preview"${this._previewedPins.has(pin.id) ? '' : ' style="display:none"'}>` +
                    `<pre class="si-c-preview" data-struct-preview-id="${esc(def.id)}"></pre>` +
          `</div>`
        : '';
}

private instanceBodyHtml(def: StructDef | undefined, pin: StructPin, expanded: boolean): string {
    return expanded && def ? this.renderStructBody(def, pin) : '';
}

/** Always-visible card actions: Edit | View type | Delete. */
private instanceActionsHtml(pin: StructPin, index: number): string {
    const previewActive = this._previewedPins.has(pin.id) ? ' active' : '';
    return (
        `<button type="button" class="act-btn act-btn-edit" data-pin-id="${esc(pin.id)}" title="Edit" aria-label="Edit">&#9998;</button>` +
        `<button type="button" class="act-btn act-btn-view-type${previewActive}" data-pin-id="${esc(pin.id)}" title="View type definition" aria-label="View type definition">{ }</button>` +
        `<button type="button" class="act-btn act-btn-del" data-idx="${index}" title="Delete" aria-label="Delete">&#128465;&#xFE0E;</button>`
    );
}

private instanceHeaderHtml(
    pin: StructPin,
    index: number,
    defName: string,
    totalBytes: number,
    addrHex: string,
    expanded: boolean,
): string {
    return (
        `<div class="sb-card-hdr">` +
        `<button class="si-expand-btn" data-pin-id="${esc(pin.id)}" title="${expanded ? 'Collapse instance' : 'Expand instance'}" aria-label="${expanded ? 'Collapse instance' : 'Expand instance'}">›</button>` +
        `<div class="sb-card-info">` +
        `<span class="si-cname">${esc(pin.name)}</span>` +
        `<div class="si-cmeta-row">` +
        `<span class="si-ctype">${esc(defName)}</span>` +
        `<span class="si-caddr">0x${addrHex}\u202f\u00b7\u202f${totalBytes}B</span>` +
        `</div>` +
        this.pointerSourceSubtitleHtml(pin) +
        `</div>` +
        `<div class="si-card-actions">` +
        this.instanceActionsHtml(pin, index) +
        `</div>` +
        `</div>`
    );
}

private instanceContentHtml(pin: StructPin, typePreviewHtml: string, bodyHtml: string): string {
    return typePreviewHtml + bodyHtml;
}

private buildInstanceCard(pin: StructPin, i: number): string {
    const def        = allStructs(this._structs).find(d => d.id === pin.structId);
    const defName    = def ? def.name : '?';
    const totalBytes = def ? structByteSize(def, this._structs) : 0;
    const addrHex    = pin.addr.toString(16).toUpperCase().padStart(8, '0');
    const expanded   = this._expanded.has(pin.id);

    const bodyHtml = this.instanceBodyHtml(def, pin, expanded);
    const typePreviewHtml = this.instanceTypePreviewHtml(def, pin);

    return (
        `<div class="sb-card${expanded ? ' si-expanded' : ''}" data-pin-id="${esc(pin.id)}" data-idx="${i}">` +
        this.instanceHeaderHtml(pin, i, defName, totalBytes, addrHex, expanded) +
        this.instanceContentHtml(pin, typePreviewHtml, bodyHtml) +
        `</div>`
    );
}

private clearArrSep(): void {
    this.cb.onClearHighlightHex?.('struct-arr-sep');
    this._arrSepAddrs.length = 0;
}

private clearSelRow(): void {
    this._root?.querySelectorAll<HTMLElement>('.si-selected')
        .forEach(el => el.classList.remove('si-selected'));
}

private setTreeLevel(el: HTMLElement, level: number): void {
    el.style.setProperty('--si-level', String(level));
}

private asHtml(el: Element | null): HTMLElement | null {
    if (!el) { return null; }
    const candidate = el as HTMLElement;
    return typeof candidate.classList !== 'undefined' ? candidate : null;
}

private firstDirectChildByClass(parent: HTMLElement, cls: string): HTMLElement | null {
    for (const child of Array.from(parent.children)) {
        const htmlChild = this.asHtml(child);
        if (htmlChild && htmlChild.classList.contains(cls)) {
            return htmlChild;
        }
    }
    return null;
}

private applyTreeDepthStyles(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('.si-fields').forEach(fields => {
        this.annotateTreeBody(fields, 0);
    });
}

private annotateTreeBody(body: HTMLElement, level: number): void {
    this.setTreeLevel(body, level);
    for (const child of Array.from(body.children)) {
        const htmlChild = this.asHtml(child);
        if (htmlChild) { this.annotateTreeChild(htmlChild, level); }
    }
}

private annotateTreeChild(child: HTMLElement, level: number): void {
    if (child.classList.contains('si-field')) {
        this.setTreeLevel(child, level);
        return;
    }
    if (child.classList.contains('si-arr-grp')) {
        this.annotateCompositeTreeChild(child, level, 'si-arr-grp-hdr', 'si-arr-grp-body');
        return;
    }
    if (child.classList.contains('si-arr-el-grp')) {
        this.annotateCompositeTreeChild(child, level, 'si-arr-el-hdr', 'si-arr-el-body');
    }
}

private annotateCompositeTreeChild(child: HTMLElement, level: number, headerClass: string, bodyClass: string): void {
    const hdr = this.firstDirectChildByClass(child, headerClass);
    if (hdr) { this.setTreeLevel(hdr, level); }
    const body = this.firstDirectChildByClass(child, bodyClass);
    if (body) { this.annotateTreeBody(body, level + 1); }
}

private wireInstanceCards(sec: HTMLElement): void {
    this.applyTreeDepthStyles(sec);

    // Keep bit hover highlight strictly tied to the current pointer target.
    sec.onmousemove = (ev: MouseEvent) => {
        this.updateHoveredBitRow(ev, sec);
    };
    sec.onmouseleave = () => {
        if (this._hoveredBitRange !== null || this._hoveredBitRowKey !== null) {
            this._hoveredBitRange = null;
            this._hoveredBitRowKey = null;
            this.applyBitHighlightsInPlace(sec);
        }
    };

    sec.querySelectorAll<HTMLElement>('.si-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.pinId!;
            if (this._expanded.has(id)) { this._expanded.delete(id); } else { this._expanded.add(id); }
            this.render();
        });
    });

    // Array group: arrow button toggles expand; rest of row selects in hex view
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.si-arr-exp-btn');
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);
        const isBitUnitHdr = hdr.classList.contains('si-bitunit-hdr');
        const isPointerHdr = hdr.classList.contains('si-ptr-hdr') || hdr.classList.contains('si-ptr-child-hdr');

        if (expBtn) {
            expBtn.addEventListener('click', e => {
                e.stopPropagation();
                if ((expBtn as HTMLButtonElement).disabled) { return; }
                this.toggleCompositeGroup(hdr, '.si-arr-grp', '.si-arr-grp-body', 'arrKey', this._expandedArrayFields);
            });
        }

        hdr.querySelector<HTMLElement>('.si-f-ptr')?.addEventListener('click', e => {
            e.stopPropagation();
            this.followPointerHeaderValue(hdr);
        });

        this.wireStructHoverRange(hdr, start, cnt);

        hdr.addEventListener('click', e => {
            if (isPointerHdr) {
                this.selectPointerHeaderRange(e, hdr, start, cnt);
                return;
            }
            this.selectArrayGroupHeader(e, hdr, start, cnt, isBitUnitHdr);
        });
    });

    // Nested element: arrow toggles expand; row selects that element range.
    sec.querySelectorAll<HTMLElement>('.si-arr-el-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.si-arr-el-exp-btn')!;
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);

        expBtn.addEventListener('click', e => {
            e.stopPropagation();
            this.toggleCompositeGroup(hdr, '.si-arr-el-grp', '.si-arr-el-body', 'arrElKey', this._expandedArrayElements);
        });

        this.wireStructHoverRange(hdr, start, cnt);

        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.si-arr-el-exp-btn')) { return; }
            this.clearStructSelectionVisuals();
            if (isNaN(start) || isNaN(cnt)) { return; }
            this._selectedArrElemKey = hdr.dataset.arrElKey!;
            this._selectedArrKey = null;
            this._selectedFieldAddr = null;
            this.selectStructRange(hdr, start, cnt);
        });
    });

    sec.querySelectorAll<HTMLElement>('.sb-card-hdr').forEach(hdr => {
        hdr.addEventListener('click', e => this.onCardHeaderClick(sec, hdr, e));
    });

    // Always-visible card actions: Edit | Delete | View type.
    sec.querySelectorAll<HTMLElement>('.sb-card').forEach(card => {
        wireActionBtns(
            card,
            '.act-btn-edit',
            '.act-btn-del',
            btn => {
                this._editingPinId = btn.dataset.pinId!;
                const editedPin = this._pins.find(p => p.id === this._editingPinId);
                this._editingPinDraftStructId = editedPin?.structId ?? null;
                this._expanded.delete(this._editingPinId);
                this.render();
            },
            btn => {
                const idx = parseInt(btn.dataset.idx!);
                const pin = this._pins[idx];
                if (pin) { this._expanded.delete(pin.id); }
                this._pins = withoutStructPin(this._pins, idx);
                this.cb.onPinsChange?.(this._pins);
                this.render();
            },
        );
        card.querySelectorAll<HTMLElement>('.act-btn-view-type').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this.toggleTypePreview(btn);
            });
        });
    });

    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        const start = parseInt(row.dataset.byteStart!);
        const cnt   = parseInt(row.dataset.byteCnt!);
        const bitStartRaw = row.dataset.bitStart;
        const bitWidthRaw = row.dataset.bitWidth;
        const isBitRow = bitStartRaw !== undefined && bitWidthRaw !== undefined;

        row.addEventListener('mouseenter', () => {
            if (isBitRow) { return; }
            const addrs: number[] = [];
            for (let i = 0; i < cnt; i++) { addrs.push(start + i); }
            this.cb.onHighlightHex?.(addrs, 'struct-h');
        });

        row.addEventListener('mouseleave', () => {
            if (isBitRow) { return; }
            this.cb.onClearHighlightHex?.('struct-h');
        });

        row.addEventListener('click', () => {
            if (isNaN(start) || isNaN(cnt)) { return; }
            if (isBitRow) {
                this.selectBitRow(row, sec);
                return;
            }
            this.selectStructFieldRow(row, start, cnt);
        });

        row.querySelector<HTMLElement>('.si-f-ptr')?.addEventListener('click', ev => {
            ev.stopPropagation();
            const card = row.closest<HTMLElement>('.sb-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            const valKey = row.dataset.valKey ?? this.scalarValKey(start);
            this.followPointerAt(start, pinIdx, valKey, this.sourceContextOptions(row));
        });
    });

    // Right-click on a field row to open the value menu. Pass the pin index
    // so the menu can decode values when performing copy actions.
    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        row.addEventListener('contextmenu', ev => {
            ev.preventDefault(); ev.stopPropagation();
            const start = parseInt(row.dataset.byteStart!);
            const card = row.closest<HTMLElement>('.sb-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            // Determine if this is a pointer field
            const valCell = row.querySelector<HTMLElement>('.si-f-val');
            const isPointer = valCell?.classList.contains('si-f-ptr');
            const isBitUnitHeader = row.classList.contains('si-bitunit-hdr');
            // Only allow per-element change, not group, for array elements
            const valKey = row.dataset.valKey ?? this.scalarValKey(start);
            this.showFieldValMenu(ev.clientX, ev.clientY, start, undefined, pinIdx, {
                isPointer,
                isBitUnitHeader,
                valKey,
                ...this.sourceContextOptions(row),
            });
        });
    });

    // Right-click on an array group header should allow actions on the
    // entire group (child elements).
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        hdr.addEventListener('contextmenu', ev => {
            if (hdr.classList.contains('si-ptr-hdr') || hdr.classList.contains('si-ptr-child-hdr')) {
                this.openPointerHeaderValueMenu(ev, hdr);
                return;
            }
            this.openArrayHeaderValueMenu(ev, hdr);
        });
    });

    this.applyBitHighlightsInPlace(sec);
    this.restoreStructSelection(sec);
}


    private onCardHeaderClick(sec: HTMLElement, hdr: HTMLElement, e: Event): void {
        if ((e.target as HTMLElement).closest('.si-expand-btn, .si-card-actions')) { return; }
    this.clearArrSep();
    this.clearSelRow();
    this._selectedBitRange = null;
    this._hoveredBitRange = null;
    this._selectedBitRowKey = null;
    this._hoveredBitRowKey = null;
    this._selectedFieldAddr = null;
    this._selectedArrKey    = null;
    this._selectedArrElemKey = null;
    const sel = this.cardSelection(hdr);
    if (!sel) { return; }
    const size = structByteSize(sel.def, this._structs);
    this._activeStructAddr = sel.pin.addr;
    this._selectedPinId = sel.pin.id;
    sec.querySelectorAll<HTMLElement>('.sb-card').forEach(c => c.classList.remove('si-card-selected'));
    sel.card.classList.add('si-card-selected');
    this.cb.onSelectRange?.(sel.pin.addr, size);
}

private cardSelection(hdr: HTMLElement): { card: HTMLElement; pin: StructPin; def: StructDef } | null {
    const card = hdr.closest<HTMLElement>('.sb-card');
    if (!card) { return null; }
    const idx = parseInt(card.dataset.idx!);
    const pin = this._pins[idx];
    if (!pin) { return null; }
    const def = allStructs(this._structs).find(d => d.id === pin.structId);
    if (!def) { return null; }
    return { card, pin, def };
}

/** View-type preview toggle — always-visible card action button (`.act-btn-view-type`). */
private toggleTypePreview(btn: HTMLElement): void {
    const id = btn.dataset.pinId!;
    const card = btn.closest<HTMLElement>('.sb-card')!;
    const preview = card.querySelector<HTMLElement>('.si-type-preview');
    const isOpen = this._previewedPins.has(id);
    this.setTypePreviewOpen(id, btn, preview, !isOpen);
}

private setTypePreviewOpen(id: string, btn: HTMLElement, preview: HTMLElement | null, isOpen: boolean): void {
    if (isOpen) { this._previewedPins.add(id); }
    else { this._previewedPins.delete(id); }
    btn.classList.toggle('active', isOpen);
    if (preview) { preview.style.display = isOpen ? '' : 'none'; }
}

private restoreStructSelection(sec: HTMLElement): void {
    this.restoreSelectedPin(sec);
    this.restoreSelectedValueRow(sec);
}

private restoreSelectedPin(sec: HTMLElement): void {
    if (this._selectedPinId === null) { return; }
    sec.querySelectorAll<HTMLElement>('.sb-card').forEach(card => {
        if (card.dataset.pinId === this._selectedPinId) {
            card.classList.add('si-card-selected');
        }
    });
}

private restoreSelectedValueRow(sec: HTMLElement): void {
    if (this.restoreSelectedBitRow(sec)) { return; }
    if (this.restoreSelectedFieldRow(sec)) { return; }
    if (this.restoreSelectedArrayElement(sec)) { return; }
    this.restoreSelectedArrayGroup(sec);
}

private restoreSelectedBitRow(sec: HTMLElement): boolean {
    if (this._selectedBitRowKey === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-field[data-bit-start][data-bit-width]').forEach(row => {
        const meta = this.parseBitRowMeta(row);
        if (!meta) { return; }
        const key = this.makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth);
        if (key === this._selectedBitRowKey) {
            row.classList.add('si-selected');
        }
    });
    return true;
}

private restoreSelectedFieldRow(sec: HTMLElement): boolean {
    if (this._selectedFieldAddr === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-field').forEach(row => {
        if (parseInt(row.dataset.byteStart!) === this._selectedFieldAddr) {
            row.classList.add('si-selected');
        }
    });
    return true;
}

private restoreSelectedArrayElement(sec: HTMLElement): boolean {
    if (this._selectedArrElemKey === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.si-arr-el-hdr').forEach(hdr => {
        if (hdr.dataset.arrElKey === this._selectedArrElemKey) {
            hdr.classList.add('si-selected');
        }
    });
    return true;
}

private restoreSelectedArrayGroup(sec: HTMLElement): void {
    if (this._selectedArrKey === null) { return; }
    sec.querySelectorAll<HTMLElement>('.si-arr-grp-hdr').forEach(hdr => {
        const grp = hdr.closest<HTMLElement>('.si-arr-grp');
        if (grp?.dataset.arrKey === this._selectedArrKey) {
            hdr.classList.add('si-selected');
        }
    });
}
// Floating per-field value-type menu (rendered into the shared MenuController container)

/** Show a struct field menu in the shared controller container; commands route through `onCommand`. */
private showFieldMenu(innerHtml: string, x: number, y: number, onCommand: (cmd: string) => void): void {
    menuController.show(x, y, { innerHTML: innerHtml, emit: onCommand });
    // The controller owns #menu; tag it with the struct modifier so the
    // .si-field-menu CSS (min/max width, wrapped hints) applies.
    menuController.openMenu()?.classList.add('si-field-menu');
}

private structPinAtAddress(addr: number, pinIdx: number | undefined, allDefs: StructDef[]): StructPin | undefined {
    if (typeof pinIdx === 'number' && pinIdx >= 0) { return this._pins[pinIdx]; }
    return this._pins.find(pin => {
        const def = allDefs.find(candidate => candidate.id === pin.structId);
        if (!def) { return false; }
        const size = structByteSize(def, this._structs);
        return addr >= pin.addr && addr < pin.addr + size;
    });
}

private structRowsAtAddress(addr: number, pinIdx: number | undefined, allDefs: StructDef[]): DecodedField[] {
    const pin = this.structPinAtAddress(addr, pinIdx, allDefs);
    if (!pin) { return []; }
    const def = allDefs.find(candidate => candidate.id === pin.structId);
    if (!def) { return []; }
    const rows = decodeStruct(def, pin.addr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._structs);
    return rows.filter(row => pin.addr + row.byteOffset === addr);
}

private sourceRowsAtAddress(
    addr: number,
    pinIdx: number | undefined,
    opts: FieldValMenuOptions,
    allDefs: StructDef[],
): DecodedField[] {
    const source = this.findCopySourceRows(addr, pinIdx, opts);
    return source
        ? source.rows.filter(row => source.baseAddr + row.byteOffset === addr)
        : this.structRowsAtAddress(addr, pinIdx, allDefs);
}

private parseBitValueKey(valKey: string): { bitStart: number; bitWidth: number } | null {
    const parts = valKey.split(':');
    const bitStart = this.parseDatasetInt(parts[2]);
    if (bitStart === null) { return null; }
    const bitWidth = this.parseDatasetInt(parts[3]);
    if (bitWidth === null) { return null; }
    return { bitStart, bitWidth };
}

private matchesBitValueKey(row: DecodedField, key: { bitStart: number; bitWidth: number }): boolean {
    if (!this.isBitFieldRow(row)) { return false; }
    if (row.bitOffset !== key.bitStart) { return false; }
    return row.bitWidth === key.bitWidth;
}

private findBitFieldForValueKey(rows: DecodedField[], valKey: string): DecodedField | undefined {
    const key = this.parseBitValueKey(valKey);
    return key ? rows.find(row => this.matchesBitValueKey(row, key)) : undefined;
}



private valueKeyKind(valKey?: string): ValueKeyKind {
    if (valKey?.startsWith('bitunit:')) { return 'bitunit'; }
    if (valKey?.startsWith('bit:')) { return 'bit'; }
    return 'default';
}

private firstValueKeyField(rows: DecodedField[]): DecodedField | null {
    return rows[0] ?? null;
}

private bitUnitValueKeyField(rows: DecodedField[]): DecodedField | null {
    return this.buildBitUnitAggregateRow(rows.filter(r => this.isBitFieldRow(r)));
}

private bitValueKeyField(rows: DecodedField[], valKey?: string): DecodedField | null {
    return valKey ? (this.findBitFieldForValueKey(rows, valKey) ?? this.firstValueKeyField(rows)) : this.firstValueKeyField(rows);
}

private readonly VALUE_KEY_FIELD: Record<ValueKeyKind, (rows: DecodedField[], valKey?: string) => DecodedField | null> = {
    default: rows => this.firstValueKeyField(rows),
    bit: (rows, valKey) => this.bitValueKeyField(rows, valKey),
    bitunit: rows => this.bitUnitValueKeyField(rows),
};

private findFieldForValueKey(rows: DecodedField[], addr: number, valKey?: string): DecodedField | null {
    const atAddr = rows.filter(row => row.byteOffset === addr);
    return this.VALUE_KEY_FIELD[this.valueKeyKind(valKey)](atAddr, valKey);
}

private handleArrayHeaderMenuCommand(
    cmd: string,
    bs: number,
    bsList: number[] | undefined,
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    if (cmd === 'copy-addr') {
        this.copyAddressToClipboard(bs);
        return;
    }
    if (!cmd.startsWith('disp-')) { return; }
    if (!this.hasValueRows(bsList)) { return; }
    this.applyArrayHeaderDisplayType(cmd.replace('disp-', '') as ColType, bsList, keyList, findFieldAt);
    this.render();
}

private copyAddressToClipboard(bs: number): void {
    this.copyTextToClipboard(`0x${bs.toString(16).toUpperCase().padStart(8, '0')}`);
}

private hasValueRows(bsList: number[] | undefined): bsList is number[] {
    return Boolean(bsList && bsList.length > 0);
}

private applyArrayHeaderDisplayType(
    t: ColType,
    bsList: number[],
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    bsList.forEach((b, idx) => {
        this.setArrayHeaderDisplayType(t, b, keyList?.[idx], findFieldAt);
    });
}

private setArrayHeaderDisplayType(
    t: ColType,
    byteStart: number,
    keyOverride: string | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): void {
    const listKey = keyOverride ?? this.scalarValKey(byteStart);
    const field = findFieldAt(byteStart);
    const implicit = this.implicitDisplayType(field, listKey.startsWith('bitunit:'));
    if (t === implicit) { this._fieldValTypes.delete(listKey); }
    else { this._fieldValTypes.set(listKey, t); }
}

private updateHoveredBitRow(ev: MouseEvent, sec: HTMLElement): void {
    const target = ev.target as HTMLElement | null;
    const bitRow = target?.closest<HTMLElement>('.si-field[data-bit-start][data-bit-width]') ?? null;
    const hover = this.bitRowHoverState(bitRow);
    if (this._hoveredBitRowKey === hover.key) { return; }
    this._hoveredBitRange = hover.range;
    this._hoveredBitRowKey = hover.key;
    this.applyBitHighlightsInPlace(sec);
}

private bitRowHoverState(bitRow: HTMLElement | null): { range: { parentByteStart: number; startBit: number; endBit: number } | null; key: string | null } {
    if (!bitRow) { return { range: null, key: null }; }
    const meta = this.parseBitRowMeta(bitRow);
    if (!meta) { return { range: null, key: null }; }
    return this.bitSelectionState(meta);
}

private bitSelectionState(meta: { byteStart: number; bitStart: number; bitWidth: number }): { range: { parentByteStart: number; startBit: number; endBit: number }; key: string } {
    return {
        range: { parentByteStart: meta.byteStart, startBit: meta.bitStart, endBit: meta.bitStart + meta.bitWidth - 1 },
        key: this.makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth),
    };
}

private selectBitRow(row: HTMLElement, sec: HTMLElement): void {
    this.applyBitRowSelection(this.parseBitRowMeta(row));
    this.clearFieldSelectionState();
    this.clearSelRow();
    row.classList.add('si-selected');
    this.applyBitHighlightsInPlace(sec);
}

private applyBitRowSelection(meta: ReturnType<typeof this.parseBitRowMeta>): void {
    if (!meta) {
        this._selectedBitRange = null;
        this._selectedBitRowKey = null;
        return;
    }
    const state = this.bitSelectionState(meta);
    this._selectedBitRange = state.range;
    this._selectedBitRowKey = state.key;
}

private clearFieldSelectionState(): void {
    this._hoveredBitRange = null;
    this._hoveredBitRowKey = null;
    this._selectedFieldAddr = null;
    this._selectedArrKey = null;
    this._selectedArrElemKey = null;
}

private selectStructFieldRow(row: HTMLElement, start: number, cnt: number): void {
    this.clearArrSep();
    this.clearSelRow();
    this.clearBitSelectionState();
    row.classList.add('si-selected');
    this._selectedFieldAddr = start;
    this._selectedArrKey = null;
    this._selectedArrElemKey = null;
    this.cb.onSelectRange?.(start, cnt);
    this.render();
}

private clearBitSelectionState(): void {
    this._selectedBitRange = null;
    this._hoveredBitRange = null;
    this._selectedBitRowKey = null;
    this._hoveredBitRowKey = null;
}

private selectArrayGroupHeader(e: MouseEvent, hdr: HTMLElement, start: number, cnt: number, isBitUnitHdr: boolean): void {
    if (this.shouldSkipArrayGroupClick(e, isBitUnitHdr)) { return; }
    this.clearStructSelectionVisuals();
    if (this.hasInvalidRange(start, cnt)) { return; }
    const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
    this._selectedArrKey = grp.dataset.arrKey!;
    this._selectedArrElemKey = null;
    this._selectedFieldAddr = null;
    this.markArraySeparators(this.arrayGroupSeparatorRows(grp));
    this.selectStructRange(hdr, start, cnt);
}

private shouldSkipArrayGroupClick(e: MouseEvent, isBitUnitHdr: boolean): boolean {
    return isBitUnitHdr || Boolean((e.target as HTMLElement).closest('.si-arr-exp-btn'));
}

private hasInvalidRange(start: number, cnt: number): boolean {
    return isNaN(start) || isNaN(cnt);
}

private selectPointerHeaderRange(e: MouseEvent, hdr: HTMLElement, start: number, cnt: number): void {
    if ((e.target as HTMLElement).closest('.si-arr-exp-btn')) { return; }
    this.clearStructSelectionVisuals();
    if (this.hasInvalidRange(start, cnt)) { return; }
    this.selectStructRange(hdr, start, cnt);
}

private followPointerHeaderValue(hdr: HTMLElement): void {
    const storageStart = parseInt(hdr.dataset.pointerStorageStart ?? '');
    const pinIdx = this.pinIndexFromHeader(hdr);
    const valKey = hdr.dataset.valKey ?? this.scalarValKey(storageStart);
    this.followPointerAt(storageStart, pinIdx, valKey, this.sourceContextOptions(hdr));
}

private arrayGroupSeparatorRows(grp: HTMLElement): HTMLElement[] {
    const elementHeaders = Array.from(grp.querySelectorAll<HTMLElement>('.si-arr-el-hdr'));
    return elementHeaders.length > 0 ? elementHeaders : Array.from(grp.querySelectorAll<HTMLElement>('.si-field'));
}

private openArrayHeaderValueMenu(ev: MouseEvent, hdr: HTMLElement): void {
    if (hdr.classList.contains('si-bitunit-hdr')) { return; }
    ev.preventDefault();
    ev.stopPropagation();
    const directValueRows = this.directArrayHeaderValueRows(hdr);
    const bsList = directValueRows.map(r => this.rowByteStart(r));
    const start = bsList[0];
    if (start === undefined) { return; }
    const keyList = directValueRows.map(r => this.rowValueKey(r));
    const pinIdx = this.pinIndexFromHeader(hdr);
    this.showFieldValMenu(ev.clientX, ev.clientY, start, bsList, pinIdx, { isArrayHeader: true, keyList });
}

private openPointerHeaderValueMenu(ev: MouseEvent, hdr: HTMLElement): void {
    ev.preventDefault();
    ev.stopPropagation();
    const storageStart = parseInt(hdr.dataset.pointerStorageStart ?? '');
    if (isNaN(storageStart)) { return; }
    const pinIdx = this.pinIndexFromHeader(hdr);
    const valKey = hdr.dataset.valKey ?? this.scalarValKey(storageStart);
    this.showFieldValMenu(ev.clientX, ev.clientY, storageStart, undefined, pinIdx, {
        isPointer: true,
        valKey,
        pointerAllowCreate: hdr.dataset.pointerAllowCreate === 'true',
        ...this.sourceContextOptions(hdr),
    });
}

private directArrayHeaderValueRows(hdr: HTMLElement): HTMLElement[] {
    const body = this.arrayGroupBody(hdr);
    return body ? Array.from(body.children).flatMap(c => this.directValueRowsFromChild(c)) : [];
}

private arrayGroupBody(hdr: HTMLElement): HTMLElement | undefined {
    const grp = hdr.closest<HTMLElement>('.si-arr-grp')!;
    return Array.from(grp.children).find(c => this.isArrayGroupBody(c)) as HTMLElement | undefined;
}

private isArrayGroupBody(child: Element): boolean {
    return child.classList.contains('si-arr-grp-body');
}

private directValueRowsFromChild(child: Element): HTMLElement[] {
    const childEl = child as HTMLElement;
    if (childEl.classList.contains('si-field')) { return [childEl]; }
    if (childEl.classList.contains('si-arr-el-grp')) { return this.nestedValueHeaderRows(childEl); }
    return [];
}

private nestedValueHeaderRows(child: HTMLElement): HTMLElement[] {
    const hdr = Array.from(child.children).find(c => this.isNestedValueHeader(c)) as HTMLElement | undefined;
    return hdr ? [hdr] : [];
}

private isNestedValueHeader(child: Element): boolean {
    return child.classList.contains('si-arr-el-hdr') && child.classList.contains('si-field');
}

private rowByteStart(row: HTMLElement): number {
    return parseInt(row.dataset.byteStart!);
}

private rowValueKey(row: HTMLElement): string {
    return row.dataset.valKey ?? this.scalarValKey(this.rowByteStart(row));
}

private pinIndexFromHeader(hdr: HTMLElement): number {
    const card = hdr.closest<HTMLElement>('.sb-card');
    return card ? parseInt(card.dataset.idx!) : -1;
}

private sourceContextOptions(el: HTMLElement): Pick<FieldValMenuOptions, 'sourceStructId' | 'sourceBaseAddr'> {
    const sourceStructId = el.dataset.sourceStructId;
    const sourceBaseAddr = this.parseOptionalInt(el.dataset.sourceBaseAddr);
    return sourceStructId && sourceBaseAddr !== undefined ? { sourceStructId, sourceBaseAddr } : {};
}

private parseOptionalInt(raw: string | undefined): number | undefined {
    if (raw === undefined) { return undefined; }
    const parsed = parseInt(raw);
    return isNaN(parsed) ? undefined : parsed;
}





private showFieldValMenu(
    x: number,
    y: number,
    bs: number,
    bsList?: number[],
    pinIdx?: number,
    opts: FieldValMenuOptions = {},
): void {
    const ctx = this.createFieldValMenuContext(bs, bsList, pinIdx, opts);

    if (opts.isArrayHeader) {
        this.showArrayHeaderFieldValMenu(ctx, x, y);
        return;
    }
    if (opts.isPointer) {
        this.showPointerFieldValMenu(ctx, x, y);
        return;
    }
    this.showScalarFieldValMenu(ctx, x, y);
}

private createFieldValMenuContext(
    bs: number,
    bsList: number[] | undefined,
    pinIdx: number | undefined,
    opts: FieldValMenuOptions,
): FieldValMenuContext {
    const allDefs = allStructs(this._structs);
    const findRowsAt = (addr: number): DecodedField[] => this.sourceRowsAtAddress(addr, pinIdx, opts, allDefs);
    const findFieldAt = (addr: number): DecodedField | null => findRowsAt(addr)[0] ?? null;
    const sampleField = findFieldAt(this.sampleAddress(bs, bsList));
    const key = opts.valKey ?? this.scalarValKey(bs);
    return {
        bs,
        bsList,
        pinIdx,
        opts,
        key,
        types: this.fieldValueMenuTypes(bs, bsList, opts, sampleField, findRowsAt),
        cur: this.currentFieldValueType(bs, bsList, opts, key, sampleField, findFieldAt),
        findFieldAt,
    };
}

private sampleAddress(bs: number, bsList: number[] | undefined): number {
    return bsList && bsList.length > 0 ? bsList[0] : bs;
}

private fieldValueMenuTypes(
    bs: number,
    bsList: number[] | undefined,
    opts: FieldValMenuOptions,
    sampleField: DecodedField | null,
    findRowsAt: (addr: number) => DecodedField[],
): ColType[] {
    if (opts.isBitUnitHeader) { return this.bitUnitMenuTypes([bs], findRowsAt); }
    if (this.arrayHeaderHasBitUnits(opts)) { return this.bitUnitMenuTypes(bsList ?? [bs], findRowsAt); }
    return this.sampleFieldValueTypes(sampleField);
}

private arrayHeaderHasBitUnits(opts: FieldValMenuOptions): boolean {
    return !!opts.isArrayHeader && (opts.keyList?.some(k => k.startsWith('bitunit:')) ?? false);
}

private bitUnitMenuTypes(addresses: number[], findRowsAt: (addr: number) => DecodedField[]): ColType[] {
    const hasPartialUnit = addresses.some(addr => !this.bitUnitUsesFullStorage(findRowsAt(addr)));
    return hasPartialUnit ? ['bin', 'bin-sliced', 'hex', 'dec'] : ['bin', 'hex', 'dec'];
}

private sampleFieldValueTypes(sampleField: DecodedField | null): ColType[] {
    if (!sampleField) { return ['hex', 'dec', 'bin', 'ascii']; }
    const typeMenu = SAMPLE_TYPE_MENUS[sampleField.type];
    if (typeMenu) { return typeMenu; }
    if (this.isBitFieldRow(sampleField)) { return ['bin', 'hex', 'dec']; }
    return ['hex', 'dec', 'bin', 'ascii'];
}

private currentFieldValueType(
    bs: number,
    bsList: number[] | undefined,
    opts: FieldValMenuOptions,
    key: string,
    sampleField: DecodedField | null,
    findFieldAt: (addr: number) => DecodedField | null,
): ColType | null {
    if (bsList && bsList.length > 0) {
        return this.commonFieldValueType(bsList, opts.keyList, findFieldAt);
    }
    const implicit = this.implicitDisplayType(sampleField, !!opts.isBitUnitHeader);
    return this._fieldValTypes.get(key) ?? implicit;
}

private commonFieldValueType(
    bsList: number[],
    keyList: string[] | undefined,
    findFieldAt: (addr: number) => DecodedField | null,
): ColType | null {
    const vals = bsList.map((b, idx) => {
        const listKey = keyList?.[idx] ?? this.scalarValKey(b);
        const field = findFieldAt(b);
        const implicit = this.implicitDisplayType(field, listKey.startsWith('bitunit:'));
        return this._fieldValTypes.get(listKey) ?? implicit;
    });
    return vals.every(v => v === vals[0]) ? vals[0] : null;
}

private menuItemHtml(cmd: string, label: string, hint = ''): string {
    return (
        `<div class="menu-item" data-cmd="${cmd}" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${esc(label)}</span>` +
        (hint ? `<span class="menu-hint">${esc(hint)}</span>` : '') +
        `</div>`
    );
}

private disabledMenuItemHtml(label: string, hint: string): string {
    return (
        `<div class="menu-item menu-disabled">` +
        `<span class="menu-label">${esc(label)}</span>` +
        `<span class="menu-hint">${esc(hint)}</span>` +
        `</div>`
    );
}

private pointerSourceSubtitleHtml(pin: StructPin): string {
    const source = pin.pointerSources?.[0];
    if (!source) { return ''; }
    const addr = formatHex(source.pointerStorageAddress, 8);
    return `<div class="si-csource">from ${esc(source.sourcePinName)}.${esc(source.sourceFieldPath)} @${esc(addr)}</div>`;
}

private menuSubHtml(label: string, id: string, body: string): string {
    return (
        `<div class="menu-item menu-has-sub" data-sub="${id}" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${esc(label)}</span>` +
        `<div class="menu-submenu">${body}</div>` +
        `</div>`
    );
}

private menuSeparatorHtml(): string {
    return `<div class="menu-sep"></div>`;
}

private displayMenuHtml(types: ColType[], cur: ColType | null): string {
    return types.map(t =>
        `<div class="menu-item${t === cur ? ' active' : ''}" data-cmd="disp-${t}" role="menuitem" tabindex="-1">` +
        `<span class="menu-label">${TYPE_LABELS[t]}</span>` +
        `</div>`
    ).join('');
}

/** Build a View-as menu from a leading prefix block and route commands through onCommand. */
private createViewAsMenu(prefixHtml: string, x: number, y: number, ctx: FieldValMenuContext, onCommand: (cmd: string) => void): void {
    this.showFieldMenu(
        prefixHtml +
        this.menuSeparatorHtml() +
        this.menuSubHtml('View as', 'disp', this.displayMenuHtml(ctx.types, ctx.cur)),
        x,
        y,
        onCommand,
    );
}

private showArrayHeaderFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    this.createViewAsMenu(
        this.menuItemHtml('copy-addr', 'Copy address'),
        x,
        y,
        ctx,
        cmd => this.handleArrayHeaderMenuCommand(cmd, ctx.bs, ctx.bsList, ctx.opts.keyList, ctx.findFieldAt),
    );
}

private showPointerFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    const source = this.pointerMenuSource(ctx);
    const row = source?.row ?? null;
    this.showFieldMenu(
        this.pointerMenuHtml(row, source, ctx.opts.pointerAllowCreate === true),
        x,
        y,
        cmd => this.handlePointerMenuCommand(cmd, ctx, row, source),
    );
}

private pointerMenuHtml(row: DecodedField | null, source: PointerMenuSource | null, allowCreate: boolean): string {
    return this.menuItemHtml('copy-hex', 'Copy value') +
        this.menuSeparatorHtml() +
        this.pointerJumpMenuHtml(row) +
    (allowCreate ? this.pointerCreateMenuHtml(source) : '');
}

private pointerJumpMenuHtml(row: DecodedField | null): string {
    const jump = this.pointerFollowState(row);
    return jump.ok
        ? this.menuItemHtml('jump-ptr', 'Jump to Address')
        : this.disabledMenuItemHtml('Jump to Address', jump.reason);
}

private pointerCreateMenuHtml(source: PointerMenuSource | null): string {
    const create = this.structPointerCreateState(source);
    if (create === null) { return ''; }
    return create.ok
        ? this.menuItemHtml('create-struct-ptr', 'Create Struct Instance')
        : this.disabledMenuItemHtml('Create Struct Instance', create.reason);
}

private handlePointerMenuCommand(
    cmd: string,
    ctx: FieldValMenuContext,
    row: DecodedField | null,
    source: PointerMenuSource | null,
): void {
    if (cmd === 'jump-ptr') {
        this.followPointerRow(row);
        return;
    }
    if (cmd === 'create-struct-ptr') {
        this.createStructInstanceFromPointer(source);
        return;
    }
    this.copyPointerFieldValue(ctx);
}



private pointerMenuSource(ctx: FieldValMenuContext): PointerMenuSource | null {
    const source = this.findCopySourceRows(ctx.bs, ctx.pinIdx, ctx.opts);
    if (!source) { return null; }
    const row = this.findFieldForValueKey(source.rows, ctx.bs - source.baseAddr, ctx.opts.valKey);
    return row ? { pin: source.pin, row, sourceStructId: source.structId, sourceBaseAddr: source.baseAddr } : null;
}

private pointerMenuField(ctx: FieldValMenuContext): DecodedField | null {
    return this.pointerMenuSource(ctx)?.row ?? null;
}



private pointerFollowState(row: DecodedField | null): PointerFollowState {
    const reason = this.POINTER_FOLLOW_GUARDS.map(guard => guard(row)).find(Boolean);
    return reason ? { ok: false, reason } : { ok: true };
}


private readonly POINTER_FOLLOW_GUARDS: PointerFollowGuard[] = [
    row => row?.isPointer ? null : 'not pointer',
    row => row?.hasData && row.pointerValue !== undefined ? null : 'missing',
    row => row?.pointerValue === 0 ? 'null' : null,
    row => this.pointerTargetFullyMapped(row) ? null : 'unmapped',
];

private pointerTargetFullyMapped(row: DecodedField | null): boolean {
    const target = this.pointerMapTarget(row);
    if (!target) { return true; }
    return this.pointerTargetBytes(target.addr, target.byteCount).every(addr => this.cb.readByte(addr) !== undefined);
}

private pointerMapTarget(row: DecodedField | null): { addr: number; byteCount: number } | null {
    if (!row) { return null; }
    if (!row.isPointer) { return null; }
    if (row.pointerValue === undefined) { return null; }
    return { addr: row.pointerValue, byteCount: this.pointerMapByteCount(row) };
}

private pointerMapByteCount(row: DecodedField): number {
    const declared = row.pointerTargetByteSize;
    if (declared === undefined) { return 1; }
    return declared > 1 ? declared : 1;
}

private pointerTargetBytes(addr: number, byteCount: number): number[] {
    return Array.from({ length: byteCount }, (_, index) => addr + index);
}

private followPointerAt(byteStart: number, pinIdx: number, valKey: string, opts: FieldValMenuOptions = {}): void {
    const source = this.findCopySourceRows(byteStart, pinIdx, opts);
    if (!source) { return; }
    const row = this.findFieldForValueKey(source.rows, byteStart - source.baseAddr, valKey);
    this.followPointerRow(row);
}

private followPointerRow(row: DecodedField | null): void {
    const target = this.pointerFollowTarget(row);
    if (!target) { return; }
    this.selectPointerTarget(target.addr, target.byteCount);
}

private pointerFollowTarget(row: DecodedField | null): { addr: number; byteCount: number; structId?: string } | null {
    if (!this.pointerFollowState(row).ok) { return null; }
    return this.buildPointerFollowTarget(row as DecodedField & { pointerValue: number });
}

private buildPointerFollowTarget(row: DecodedField & { pointerValue: number }): { addr: number; byteCount: number; structId?: string } {
    const addr = row.pointerValue;
    return this.structPointerFollowTarget(row, addr) ?? this.scalarPointerFollowTarget(row, addr);
}

private structPointerFollowTarget(row: DecodedField, addr: number): { addr: number; byteCount: number; structId: string } | null {
    const def = this.pointerTargetStructDef(row);
    if (!def || !row.pointerTargetStructId) { return null; }
    return { addr, byteCount: structByteSize(def, this._structs), structId: row.pointerTargetStructId };
}

private scalarPointerFollowTarget(row: DecodedField, addr: number): { addr: number; byteCount: number } {
    return { addr, byteCount: Math.max(1, row.pointerTargetByteSize ?? 1) };
}



private structPointerCreateState(source: PointerMenuSource | null): StructPointerCreateState {
    const row = source?.row;
    if (!this.isStructPointerMenuRow(row)) { return null; }
    return this.validStructPointerCreateState(row);
}

private isStructPointerMenuRow(row: DecodedField | undefined): row is DecodedField {
    return !!row && row.pointerTargetType === 'struct';
}

private validStructPointerCreateState(row: DecodedField): Exclude<StructPointerCreateState, null> {
    const follow = this.pointerFollowState(row);
    if (!follow.ok) { return { ok: false, reason: follow.reason }; }
    return this.resolvedStructPointerCreateState(row);
}

private resolvedStructPointerCreateState(row: DecodedField): Exclude<StructPointerCreateState, null> {
    const structId = row.pointerTargetStructId;
    const def = this.pointerTargetStructDef(row);
    if (!structId || !def || row.pointerValue === undefined) { return { ok: false, reason: 'unknown target' }; }
    return { ok: true, def, addr: row.pointerValue, structId };
}

private createStructInstanceFromPointer(source: PointerMenuSource | null): void {
    const state = this.structPointerCreateState(source);
    if (!source || !state?.ok) { return; }
    this.applyPointerInstance(source, state);
}

private applyPointerInstance(source: PointerMenuSource, state: Extract<StructPointerCreateState, { ok: true }>): void {
    const result = upsertPointerStructPin(this._pins, {
        sourcePin: source.pin,
        sourceStructId: source.sourceStructId,
        sourceFieldPath: source.row.fieldName,
        sourceFieldByteOffset: source.row.byteOffset,
        sourceBaseAddr: source.sourceBaseAddr,
        targetAddress: state.addr,
        targetStructId: state.structId,
    }, this.makePinId);
    this._pins = result.pins;
    const pin = result.pin;
    this.selectCreatedPointerPin(pin, state);
    this.cb.onPinsChange?.(this._pins);
    this.render();
}

private selectCreatedPointerPin(pin: StructPin, state: Extract<StructPointerCreateState, { ok: true }>): void {
    this._expanded.add(pin.id);
    this._selectedPinId = pin.id;
    this._activeStructAddr = state.addr;
    this.selectPointerTarget(state.addr, structByteSize(state.def, this._structs));
}


private selectPointerTarget(addr: number, byteCount: number): void {
    this.cb.onSelectRange?.(addr, Math.max(1, byteCount));
}

private showScalarFieldValMenu(ctx: FieldValMenuContext, x: number, y: number): void {
    this.createViewAsMenu(
        this.menuSubHtml('Copy as', 'copy', this.copyMenuHtml(ctx.types)),
        x,
        y,
        ctx,
        cmd => this.handleScalarValueMenuCommand(cmd, ctx),
    );
}

private copyMenuHtml(types: ColType[]): string {
    return types.map(t => this.menuItemHtml(`copy-${t}`, TYPE_LABELS[t], '')).join('');
}

private copyPointerFieldValue(ctx: FieldValMenuContext): void {
    const source = this.pointerMenuSource(ctx);
    const row = source?.row ?? null;
    this.copyTextToClipboard(row ? this.singleLineCopyText(this.getCopyText(row, 'hex')) : '??');
}

private handleScalarValueMenuCommand(cmd: string, ctx: FieldValMenuContext): void {
    if (cmd.startsWith('copy-')) {
        this.copyScalarFieldValue(cmd.replace('copy-', '') as ColType, ctx);
        return;
    }
    if (cmd.startsWith('disp-')) {
        this.setScalarDisplayType(cmd.replace('disp-', '') as ColType, ctx);
    }
}

private copyScalarFieldValue(type: ColType, ctx: FieldValMenuContext): void {
    const source = this.findCopySourceRows(ctx.bs, ctx.pinIdx, ctx.opts);
    if (!source) { return; }
    const text = ctx.bsList && ctx.bsList.length > 0
        ? this.copyListText(ctx.bsList, ctx.opts.keyList, source.rows, source.baseAddr, type)
        : this.copySingleText(ctx.bs, ctx.opts.valKey, source.rows, source.baseAddr, type);
    this.copyTextToClipboard(text);
}

private copyListText(bsList: number[], keyList: string[] | undefined, rows: DecodedField[], pinAddr: number, type: ColType): string {
    return bsList.map((b, idx) => this.copySingleText(b, keyList?.[idx], rows, pinAddr, type)).join('; ');
}

private copySingleText(bs: number, key: string | undefined, rows: DecodedField[], pinAddr: number, type: ColType): string {
    const row = this.findFieldForValueKey(rows, bs - pinAddr, key);
    return row ? this.singleLineCopyText(this.getCopyText(row, type)) : '??';
}

private setScalarDisplayType(type: ColType, ctx: FieldValMenuContext): void {
    const field = ctx.findFieldAt(ctx.bs);
    const implicit = this.implicitDisplayType(field, !!ctx.opts.isBitUnitHeader);
    if (type === implicit) { this._fieldValTypes.delete(ctx.key); }
    else { this._fieldValTypes.set(ctx.key, type); }
    this.render();
}

private findCopySourcePin(bs: number, pinIdx: number | undefined, defs: StructDef[]): StructPin | undefined {
    if (typeof pinIdx === 'number' && pinIdx >= 0) {
        return this._pins[pinIdx];
    }
    return this._pins.find(p => {
        const def = defs.find(d => d.id === p.structId);
        if (!def) { return false; }
        const size = structByteSize(def, this._structs);
        return bs >= p.addr && bs < p.addr + size;
    });
}

private findCopySourceRows(bs: number, pinIdx: number | undefined, opts: FieldValMenuOptions = {}): CopySourceRows | undefined {
    const explicit = this.findExplicitCopySourceRows(pinIdx, opts);
    if (explicit) { return explicit; }
    const all = allStructs(this._structs);
    const pin = this.findCopySourcePin(bs, pinIdx, all);
    if (!pin) { return undefined; }
    const def = all.find(d => d.id === pin.structId);
    if (!def) { return undefined; }
    return {
        pin,
        rows: decodeStruct(def, pin.addr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._structs),
        structId: def.id,
        baseAddr: pin.addr,
    };
}

private findExplicitCopySourceRows(pinIdx: number | undefined, opts: FieldValMenuOptions): CopySourceRows | undefined {
    const context = this.explicitSourceContext(opts);
    if (!context) { return undefined; }
    const pin = this.copySourcePinFromIndex(pinIdx);
    const def = this.structDefById(context.structId);
    if (!pin || !def) { return undefined; }
    return {
        pin,
        rows: decodeStruct(def, context.baseAddr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._structs),
        structId: def.id,
        baseAddr: context.baseAddr,
    };
}

private explicitSourceContext(opts: FieldValMenuOptions): { structId: string; baseAddr: number } | undefined {
    return opts.sourceStructId && typeof opts.sourceBaseAddr === 'number'
        ? { structId: opts.sourceStructId, baseAddr: opts.sourceBaseAddr }
        : undefined;
}

private copySourcePinFromIndex(pinIdx: number | undefined): StructPin | undefined {
    return typeof pinIdx === 'number' && pinIdx >= 0 ? this._pins[pinIdx] : undefined;
}

private structDefById(structId: string): StructDef | undefined {
    return allStructs(this._structs).find(d => d.id === structId);
}

private copyTextToClipboard(text: string): void {
    showToast('Copied ✓');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => this.fallbackCopyText(text));
    } else {
        this.fallbackCopyText(text);
    }
}

private toggleCompositeGroup(
    hdr: HTMLElement,
    groupSelector: string,
    bodySelector: string,
    keyName: string,
    expandedKeys: Set<string>,
): void {
    const grp = hdr.closest<HTMLElement>(groupSelector)!;
    const key = grp.dataset[keyName]!;
    const body = grp.querySelector<HTMLElement>(bodySelector)!;
    const isOpen = expandedKeys.has(key);
    if (isOpen) {
        expandedKeys.delete(key);
        grp.classList.remove('open');
        body.style.display = 'none';
        this.syncCompositeHeaderOffset(hdr, false);
        return;
    }
    expandedKeys.add(key);
    grp.classList.add('open');
    body.style.display = '';
    this.syncCompositeHeaderOffset(hdr, true);
}

private wireStructHoverRange(el: HTMLElement, start: number, count: number): void {
    el.addEventListener('mouseenter', () => {
        const addrs: number[] = [];
        for (let i = 0; i < count; i++) { addrs.push(start + i); }
        this.cb.onHighlightHex?.(addrs, 'struct-h');
    });
    el.addEventListener('mouseleave', () => {
        this.cb.onClearHighlightHex?.('struct-h');
    });
}

private highlightAddress(addr: number, className: string): void {
    this.cb.onHighlightHex?.([addr], className);
}

private clearStructSelectionVisuals(): void {
    this.clearArrSep();
    this.clearSelRow();
    this._selectedBitRange = null;
    this._hoveredBitRange = null;
    this._selectedBitRowKey = null;
    this._hoveredBitRowKey = null;
}

private markArraySeparators(rows: HTMLElement[]): void {
    const addrs: number[] = [];
    rows.forEach((row, i) => {
        if (i === 0) { return; }
        const bs = parseInt(row.dataset.byteStart!);
        if (isNaN(bs)) { return; }
        this._arrSepAddrs.push(bs);
        addrs.push(bs);
    });
    this.cb.onHighlightHex?.(addrs, 'struct-arr-sep');
}

private selectStructRange(el: HTMLElement, start: number, count: number): void {
    el.classList.add('si-selected');
    this.cb.onSelectRange?.(start, count);
}

private fallbackCopyText(text: string): void {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
}

// ── Selection sync ────────────────────────────────────────────────

private clearStructSelectionState(): void {
    this.clearArrSep();
    this.clearSelRow();
    this._selectedFieldAddr = null;
    this._selectedArrKey    = null;
    this._selectedArrElemKey = null;
    this._selectedPinId     = null;
}

    private updateStructAddressInputs(addr: number): void {
        if (!this._tabActive) { return; }
        const addrHex = addr.toString(16).toUpperCase().padStart(8, '0');
        if (this._addingPin || this._editingPinId) {
            this.updateAddPinAddressInput(addrHex);
        }
    }

    private updateAddPinAddressInput(addrHex: string): void {
        const inp = this.addPinAddressInput();
        if (!inp) { return; }
        inp.value = addrHex;
        const confirmBtn = this.addPinConfirmButton();
        if (confirmBtn) { confirmBtn.disabled = !this.selectedApplyStructId(); }
    }

    private addPinAddressInput(): HTMLInputElement | null {
        return this._root?.querySelector<HTMLInputElement>('#sa-addr') ?? null;
    }

    private addPinConfirmButton(): HTMLButtonElement | null {
        return this._root?.querySelector<HTMLButtonElement>('#sa-confirm') ?? null;
    }

    // ── Extracted-module delegation (thin wrappers keep internal call sites stable) ──

    /** Narrow render context for the extracted row/value/binary render modules. */
    private renderCtx(): StructRenderCtx {
        return {
            structs: this._structs,
            pins: this._pins,
            endian: this._endian,
            bitFieldAllocation: this._bitFieldAllocation,
            showHiddenFields: this._showHiddenFields,
            fieldValTypes: this._fieldValTypes,
            defaultValType: this._defaultValType,
            readByte: this.cb.readByte,
            expandedArrayFields: this._expandedArrayFields,
            expandedArrayElements: this._expandedArrayElements,
            selectedBitRange: this._selectedBitRange,
            hoveredBitRange: this._hoveredBitRange,
            pointerFollowState: row => this.pointerFollowState(row),
        };
    }

    // C preview (structCPreview.ts)
    private renderStructCPreview(pre: HTMLElement, def: StructDef): void {
        renderStructCPreview(pre, def, this._structs);
    }
    private hydrateStructPreviews(root: HTMLElement): void {
        hydrateStructPreviews(root, this._structs, this._editingType?.draft ?? null);
    }

    // Binary view (structBinaryView.ts)
    private isBitFieldRow(r: DecodedField): boolean { return isBitFieldRow(r); }
    private makeBitRowKey(byteStart: number, bitStart: number, bitWidth: number): string { return makeBitRowKey(byteStart, bitStart, bitWidth); }
    private scalarValKey(byteStart: number): string { return scalarValKey(byteStart); }
    private bitUnitUsesFullStorage(rows: DecodedField[]): boolean { return bitUnitUsesFullStorage(rows); }
    private singleLineCopyText(text: string): string { return singleLineCopyText(text); }
    private parseDatasetInt(value: string | undefined): number | null { return parseDatasetInt(value); }
    private parseBitRowMeta(row: HTMLElement): { byteStart: number; bitStart: number; bitWidth: number } | null { return parseBitRowMeta(row); }
    private applyBitHighlightsInPlace(sec: HTMLElement): void { applyBitHighlightsInPlace(sec, this._selectedBitRange, this._hoveredBitRange); }

    // Editor fields (structEditorFields.ts)
    private fieldRowHtml(f: StructField, i: number, isOnly: boolean, total: number, draftId: string): string {
        return fieldRowHtml(f, i, isOnly, total, draftId, this._structs, this.editorInheritedEndian(), this.editorInheritedAlloc());
    }
    private childFieldRowHtml(child: BitFieldChild, ci: number, total: number): string { return childFieldRowHtml(child, ci, total, this._structs); }
    private overrideSelectHtml(value: 'le' | 'be' | 'lsb' | 'msb' | undefined, kind: 'endian' | 'allocation', cls: string, id?: string, inherited?: string): string { return overrideSelectHtml(value, kind, cls, id, inherited); }
    private overrideAutoTitle(value: 'le' | 'be' | 'lsb' | 'msb' | undefined, inherited?: string): string | undefined { return overrideAutoTitle(value, inherited); }
    private overrideHelpTitle(kind: 'endian' | 'allocation'): string { return overrideHelpTitle(kind); }
    private isPointerBlocked(field: StructField): boolean { return isPointerBlocked(field); }
    private bitChildButtonState(remainingBits: number): { addBtnDisabled: string; addBtnTitle: string } { return bitChildButtonState(remainingBits); }

    // Value format (structValueFormat.ts)
    private getCopyText(r: DecodedField, valType: ColType): string { return getCopyText(this.renderCtx(), r, valType); }
    private implicitDisplayType(field: DecodedField | null | undefined, forceBinary = false): ColType { return implicitDisplayType(this.renderCtx(), field, forceBinary); }

    // Row renderer (structRowRenderer.ts)
    private renderStructBody(def: StructDef, pin: StructPin): string { return renderStructBody(this.renderCtx(), def, pin); }
    private buildBitUnitAggregateRow(rows: DecodedField[]): DecodedField | null { return buildBitUnitAggregateRow(this.renderCtx(), rows); }
    private syncCompositeHeaderOffset(hdr: HTMLElement, isOpen: boolean): void { syncCompositeHeaderOffset(hdr, isOpen); }
    private pointerTargetStructDef(row: DecodedField): StructDef | undefined { return pointerTargetStructDef(this.renderCtx(), row); }
}

/** Pointer dataset flag a type change implies, or undefined to leave the row's flag untouched. */
function fieldRowPtrFlag(value: string, isBitFieldRef: boolean): string | undefined {
    if (isBitFieldRef || value.startsWith('enum:')) { return ''; }
    return value === 'void' ? '1' : undefined;
}

/** A bit-field-reference row with a placeholder shows the alloc select. */
function shouldInsertAllocSelect(
    isBitFieldRef: boolean,
    sel: HTMLSelectElement | null,
    placeholder: HTMLElement | null,
): boolean {
    return isBitFieldRef && !sel && placeholder !== null;
}

/** A non-bit-field-reference row that still shows the alloc select swaps it back. */
function shouldRemoveAllocSelect(isBitFieldRef: boolean, sel: HTMLSelectElement | null): sel is HTMLSelectElement {
    return !isBitFieldRef && sel !== null;
}

/** Whether an enum entry's text is a `0x`-prefixed hex number. */
function isHexEnumEntryText(text: string): boolean {
    return /^0x/i.test(text) && /^[0-9a-fA-F]+$/.test(text.replace(/^0x/i, ''));
}

/** Clamp a parsed enum value to a non-negative finite number. */
function nonNegativeEnumValue(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

function pinFormHeader(pin: StructPin | null): string {
    return pin ? '\u270E Edit Instance' : '\uff0b New Instance';
}

function pinFormClass(pin: StructPin | null): string {
    return pin ? 'sa-form-hdr-edit' : 'sa-form-hdr-new';
}

function pinFormConfirmLabel(pin: StructPin | null): string {
    return pin ? 'Save' : 'Confirm';
}
