/** Type Overlay — UI layer. Self-contained Overlay sidebar panel.
Owns the pins/instances track + types/editor track, all their UI state
(add/edit type definitions, C preview, add/edit/delete pins, decoded
instance rows incl. bit units / arrays / pointers, bit-field allocation
toggle, expansion state, field-value menus, pointer follow/create).
Data is pushed via setters; actions report via callbacks. This module
never imports the `S` global, never posts provider messages, and never
touches the render registry. Pure codec logic lives in overlayCodec.ts. */

import { esc, actionBtnsHtml, wireActionBtns, formatHex } from '../../../utils';
import type { ScriptInfo, ScriptRole } from '../../../../core/scripting/types';
import {
    addressSourceError,
    effectiveInstanceAddress,
    effectiveInstanceParams,
    instanceParamResolutionError,
    instanceUsesScriptAddress,
    instanceUsesScriptParams,
    instanceUsesScriptResolution,
    makeTypeInstance,
    paramResolutionKey,
    parseParamResolutionKey,
    resolvedInstanceParams,
    uniqueTypeInstanceName as uniquePinName,
    upsertPointerTypeInstance,
    validateInstanceParamConfig,
    withEditedTypeInstance,
    withoutTypeDefinition,
    withoutTypeInstance,
} from './overlayInstancesModel';
import type { AddressResolution, ParamResolution, ParamResolutionKey } from './overlayInstancesModel';
import type { InstanceAddressResult, InstanceParamResult } from '../../../../webviewProtocol';
import {
    fieldByteSize, typeByteSize, decodeType, allTypes, validateTypes, MAX_NESTED_DEPTH,
    typeDefKind, isUnsignedScalarType,
} from '../../../../core/overlay/overlayCodec.js';
import type { DecodedField } from '../../../../core/overlay/overlayCodec.js';
import type { BitFieldAllocation, BitFieldChild, EnumEntry, TypeBaseType, TypeDef, TypeDefKind, TypeField, TypeFieldType, TypeInstance, TypeInstanceParamSource, TypeParam } from '../../../../core/types';
import { SidebarSections } from '../sidebar';
import { menuController } from '../../menuController/menuController';
import { showToast } from '../../toast';
import './overlayPanel.css';
import { hydrateTypePreviews, renderTypeCPreview } from './cPreview';
import {
    applyBitHighlightsInPlace, bitUnitUsesFullStorage, isBitFieldRow, makeBitRowKey, parseBitRowMeta,
    parseDatasetInt, scalarValKey, singleLineCopyText,
} from './binaryView';
import {
    bitChildButtonState, childFieldRowHtml, fieldRowHtml, isPointerBlocked, overrideAutoTitle,
    overrideHelpTitle, overrideSelectHtml,
} from './editorFields';
import { SAMPLE_TYPE_MENUS, TYPE_LABELS, getCopyText, implicitDisplayType } from './valueFormat';
import type { ColType, PointerFollowState, OverlayRenderCtx } from './valueFormat';
import { buildBitUnitAggregateRow, pointerTargetTypeDef, renderTypeBody, syncCompositeHeaderOffset } from './rowRenderer';


/** One discovered script as pushed by the host (roles drive the address picker). */
export type OverlayScriptInfo = ScriptInfo;

/** Instance-form address-source draft (fixed address or a `@script address` script). */
interface PinSourceDraft {
    mode: 'fixed' | 'script';
    scriptPath: string;
}

/** Per-parameter source draft in the instance form (manual value or a `@script size` script). */
interface PinParamSourceDraft {
    mode: 'manual' | 'script';
    scriptPath: string;
}

/** Per-kind slots filled into the shared bit-field / enum editor shell. */
interface KindDefEditorParts {
    placeholder: string;
    kind: TypeDefKind;
    baseSelectId: string;
    baseAria: string;
    rowsHtml: string;
    addBtnHtml: string;
}

/** List/editor kind chip labels: sentence case, hyphenated bit-field (matches the kind chooser). */
const KIND_LABEL: Record<TypeDefKind, string> = {
    struct: 'Struct',
    bitfield: 'Bit-field',
    enum: 'Enum',
};

/** Type-list grouping order: structs, then bit-fields, then enums. */
const KIND_RANK: Record<TypeDefKind, number> = { struct: 0, bitfield: 1, enum: 2 };

function typeKindLabel(kind: TypeDefKind): string {
    return KIND_LABEL[kind];
}

/** Copy sorted kind-grouped then case-insensitive name A-Z (never mutates the shared pool). */
function sortTypeDefs(defs: readonly TypeDef[]): TypeDef[] {
    return defs.slice().sort((a, b) => {
        const rank = KIND_RANK[typeDefKind(a)] - KIND_RANK[typeDefKind(b)];
        if (rank !== 0) { return rank; }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

export interface OverlayCallbacks {
    /** Required — host memory adapter for byte reads (keeps byte access host-owned, like Inspector). */
    readByte: (addr: number) => number | undefined;
    /** Any type-definition mutation (save/delete type) → host persists + syncs. */
    onTypesChange?: (types: TypeDef[]) => void;
    /** Any pin mutation (add/edit/delete/pointer-create) → host persists + syncs. */
    onPinsChange?: (pins: TypeInstance[]) => void;
    /** Both changed in one action (e.g. delete type cascades instances). */
    onStateChange?: (types: TypeDef[], pins: TypeInstance[]) => void;
    /** Instance row/range selection → host sets S.selStart/selEnd + rerender.jumpTo + rerender.inspector. */
    onSelectRange?: (start: number, count: number) => void;
    /** Hex-row highlight: apply class at address range (moved highlightAddress). */
    onHighlightHex?: (addrs: number[], cls: string) => void;
    /** Hex-row highlight: remove class everywhere (moved clearArrSep / type-h clear). */
    onClearHighlightHex?: (cls: string) => void;
    /** Global bit-field allocation toggle (MSB/LSB in bit-layout detail) → host persists. */
    onBitAllocationChange?: (bitAllocation: BitFieldAllocation) => void;
    /** Global "show hidden fields" toggle (Instances header) → host persists. */
    onShowHiddenFieldsChange?: (showHiddenFields: boolean) => void;
    /** Re-run every script-resolved instance address (card refresh or the panel action). */
    onRefreshAddresses?: (pinId?: string) => void;
    /** Open a script path in the normal editor. */
    onOpenScript?: (scriptPath: string) => void;
    /** Ask the host for the role-tagged script list (instance source picker). */
    onRequestScripts?: () => void;
    /** Empty address/size picker → host creates the role template. */
    onCreateScript?: (role: ScriptRole) => void;
    /** Empty address/size picker → host reveals `.hexscope/scripts`. */
    onOpenScriptsFolder?: () => void;
}

type ValueKeyKind = 'default' | 'bit' | 'bitunit';

type FieldValMenuOptions = {
    isPointer?: boolean;
    isArrayHeader?: boolean;
    isBitUnitHeader?: boolean;
    valKey?: string;
    keyList?: string[];
    pointerAllowCreate?: boolean;
    sourceTypeId?: string;
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

type CopySourceRows = { pin: TypeInstance; rows: DecodedField[]; typeId: string; baseAddr: number };
type PointerMenuSource = { pin: TypeInstance; row: DecodedField; sourceTypeId: string; sourceBaseAddr: number };

type PointerFollowGuard = (row: DecodedField | null) => string | null;

type PointerCreateState =
    | { ok: true; def: TypeDef; addr: number; typeId: string }
    | { ok: false; reason: string }
    | null;

export class OverlayPanel {
    private readonly cb: OverlayCallbacks;
    private _root: HTMLElement | null = null;
    private sections: SidebarSections | null = null;
    private _types: TypeDef[] = [];
    private _pins: TypeInstance[] = [];
    private _endian: 'le' | 'be' = 'le';
    private _bitFieldAllocation: BitFieldAllocation = 'msb';
    /** Global "show hidden fields" toggle for the instance view (host-owned, pushed). */
    private _showHiddenFields = false;
    private _activeTypeAddr: number | null = null;
    /** Whether the overlay tab is the active sidebar tab (host pushes; guards add/edit address input sync). */
    private _tabActive = false;

    // ── UI/transient state (component-owned) ──────────────────────

    /** Type id currently selected in the add form. */
    private _applyTypeId: string | null = null;
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
/** Byte start addresses marked with type-arr-sep in the hex view. */
private _arrSepAddrs: number[] = [];
/** Pin id of the currently selected instance card. */
private _selectedPinId: string | null = null;
/** Pins whose type-definition preview is open inside the card. */
private _previewedPins = new Set<string>();
/** Pin id currently being edited in the full-width editor (name/addr/type). */
private _editingPinId: string | null = null;
/** Type id selected in the inline instance-edit form (may differ from the saved pin). */
private _editingPinDraftTypeId: string | null = null;
/**
 * When non-null the section is in "type editor" mode.
 * `existing` is null for new types, or the original def being edited.
 * `draft` holds the working copy being modified.
 * `fromManage` is true when opened from the manage-types list.
 */
private _editingType: { draft: TypeDef; existing: TypeDef | null; fromManage: boolean } | null = null;
/** True while the Types `＋ Add` action is showing the kind picker (struct / bit-field / enum). */
private _choosingKind = false;
private _editorError: string | null = null;
/** Types-list name filter (transient view state, never persisted). */
private _typeFilter = '';
/** Types-list kind filter (transient view state, never persisted). */
private _typeKindFilter: TypeDefKind | 'all' = 'all';
/** Transient script-address resolutions, keyed by instance id. Never persisted. */
private _addressResolutions = new Map<string, AddressResolution>();
/** Transient script-size resolutions, keyed by `paramResolutionKey(pinId, param)`. Never persisted. */
private _paramResolutions = new Map<ParamResolutionKey, ParamResolution>();
/** Role-tagged scripts pushed by the host (source picker + card tooltips). */
private _scripts: OverlayScriptInfo[] = [];
private _scriptsTrusted = true;
/** Address-source draft of the open add/edit instance form. */
private _pinSourceDraft: PinSourceDraft = { mode: 'fixed', scriptPath: '' };
/** Per-parameter source drafts of the open add/edit instance form. */
private _pinParamSourceDrafts = new Map<string, PinParamSourceDraft>();

constructor(cb: OverlayCallbacks) {
    this.cb = cb;
}

/** Renders both stacked sections into the given root (#s-overlay). */
mount(root: HTMLElement): void {
    this._root = root;
    root.innerHTML = '';
    this.sections = new SidebarSections(root, 'oi', [
        { id: 'instances', label: 'Instances', mountActions: r => this.mountInstancesAction(r) },
        { id: 'types', label: 'Types', defaultCollapsed: false, mountActions: r => this.mountTypesAction(r) },
    ]);
    // Field-menu click-outside / focus-loss dismissal + keyboard nav live in the
    // shared MenuController (menuController.ts), so shell re-mounts never stack
    // document listeners.
    this.render();
}

    private addPinFormOrEmpty(): string {
        return (this._addingPin || this._editingPinId) ? this.addInstanceFormHtml(this.pinnableTypes()) : '';
    }

    /** Re-renders the whole panel from pushed state (was renderInstances). No-op until mounted. */
    render(): void {
        const sec = this._root;
        if (!sec || !this.sections) { return; }

        const all = allTypes(this._types);
        this.prepareOverlayPanelState();

        this.expandForcedSections(this.sections);

        this.sections.setLabel('types', this.typePanelTitle());
        this.sections.body('instances')!.innerHTML = this.instancesBodyHtml(
            this.addPinFormOrEmpty(),
            this.instanceCardsHtml(),
        );
        this.sections.body('types')!.innerHTML = this.typePanelBodyHtml(this.typeRowsHtml(all));
        this.updateHeaderActions();

        this.hydrateTypePreviews(sec);
        this.wireOverlayPanel(sec);

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

    /** The Instances panel stays expanded while the add/edit form is open. */
    private instancesPanelForcedOpen(): boolean {
        return this.instanceAddBusy();
    }

    /** Expand the panes whose body UI must stay visible (open editor, picker, or add/edit form). */
    private expandForcedSections(sections: SidebarSections): void {
        if (this.instancesPanelForcedOpen()) { sections.setCollapsed('instances', false); }
        if (this.typePanelForcedOpen()) { sections.setCollapsed('types', false); }
    }

    private wireEditorState(sec: HTMLElement): void {
        if (this._editingType) {
            this.wireEditorInSec(sec);
            sec.querySelector<HTMLInputElement>('#oe-name')?.focus();
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
        const add = root.querySelector<HTMLButtonElement>('#oi-add-btn');
        if (!add) { return; }
        add.disabled = this.instanceAddBusy() || this.noTypes();
        add.title = this.noTypes() ? 'No types defined' : 'Add instance';
        add.setAttribute('aria-label', add.title);
    }

    private syncTypeAddButton(root: HTMLElement): void {
        const disabled = this.isEditorOpen() || this._choosingKind;
        const addType = root.querySelector<HTMLButtonElement>('#om-add-btn');
        if (addType) { addType.disabled = disabled; }
    }

    private noTypes(): boolean {
        return this.pinnableTypes().length === 0;
    }

    /** Plain type defs eligible as Instances (bit-field/enum defs are not pinnable). */
    private pinnableTypes(): TypeDef[] {
        return this._types.filter(d => typeDefKind(d) === 'struct');
    }

    private instanceAddBusy(): boolean {
        return this._addingPin || this._editingPinId !== null;
    }

/** Instances header action: ＋ Add (primary/status control usable while collapsed). */
private mountInstancesAction(root: HTMLElement): void {
    const add = document.createElement('button');
    add.id = 'oi-add-btn';
    add.className = 'sb-btn sb-btn-add sb-section-action';
    add.textContent = '\uff0b Add';
    add.addEventListener('click', () => {
        this._addingPin = true;
        this._pinSourceDraft = { mode: 'fixed', scriptPath: '' };
        this._pinParamSourceDrafts.clear();
        this.cb.onRequestScripts?.();
        this.render();
        this._root?.querySelector<HTMLInputElement>('#oa-name')?.focus();
    });
    root.appendChild(add);
}

/** Types header action: one ＋ Add entry point that opens the kind picker (struct / bit-field / enum). */
private mountTypesAction(root: HTMLElement): void {
    const add = document.createElement('button');
    add.id = 'om-add-btn';
    add.className = 'sb-btn sb-btn-add sb-section-action';
    add.textContent = '\uff0b Add';
    add.title = 'Add type';
    add.setAttribute('aria-label', 'Add type');
    add.addEventListener('click', () => {
        this._editorError = null;
        this._editingType = null;
        this._choosingKind = true;
        this.render();
    });
    root.appendChild(add);
}

/** Push both tracks' data (after full render / external change) and re-render. */
setData(types: TypeDef[], pins: TypeInstance[]): void {
    this._types = types;
    this._pins = pins;
    this.pruneAddressResolutions();
    this.pruneParamResolutions();
    this.render();
}

/** Drop resolutions whose instance vanished or no longer uses a script source. */
private pruneAddressResolutions(): void {
    for (const id of Array.from(this._addressResolutions.keys())) {
        if (!this._pins.some(pin => pin.id === id && instanceUsesScriptAddress(pin))) {
            this._addressResolutions.delete(id);
        }
    }
}

/** Drop parameter resolutions whose instance/source vanished or is now manual. */
private pruneParamResolutions(): void {
    for (const key of Array.from(this._paramResolutions.keys())) {
        if (!this._pins.some(pin => pinParamSourceExists(pin, key))) {
            this._paramResolutions.delete(key);
        }
    }
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

/** Role-tagged script list (host pushes `scriptInfo`); drives the address picker. */
setScripts(scripts: OverlayScriptInfo[], trusted: boolean): void {
    this._scripts = scripts;
    this._scriptsTrusted = trusted;
    if (this.instanceFormOpen()) {
        // Never rebuild the form: only refresh the picker in place.
        this.refreshSourceScriptSelect();
        return;
    }
    this.refreshInstances();
}

/** Drop every transient resolution (document close / profile switch). */
clearAddressResolutions(): void {
    if (this._addressResolutions.size === 0) { return; }
    this._addressResolutions.clear();
    this.refreshInstances();
}

/** Keep the last resolved address visible but not current; no decode runs until re-resolved. */
markAddressesStale(generation: number): void {
    this.pruneVanishedAddressResolutions();
    if (this.markPinsStale(generation)) { this.refreshInstances(); }
}

/** Drop resolutions whose instance vanished from the current pin list. */
private pruneVanishedAddressResolutions(): void {
    const ids = new Set(this._pins.map(pin => pin.id));
    for (const id of Array.from(this._addressResolutions.keys())) {
        if (!ids.has(id)) { this._addressResolutions.delete(id); }
    }
}

private markPinsStale(generation: number): boolean {
    let changed = false;
    for (const pin of this._pins) {
        if (this.staleAddressOfPin(pin, generation)) { changed = true; }
    }
    return changed;
}

private staleAddressOfPin(pin: TypeInstance, generation: number): boolean {
    return instanceUsesScriptAddress(pin) && this.markAddressStale(pin.id, generation);
}

/** Rewrite one instance's resolution as stale, keeping its last address when there is one. */
private markAddressStale(pinId: string, generation: number): boolean {
    const current = this._addressResolutions.get(pinId);
    if (current?.status === 'resolving') { return false; }
    const stale: { status: 'stale'; generation: number; addr?: number } = { status: 'stale', generation };
    const addr = lastAddressValue(current);
    if (addr !== undefined) { stale.addr = addr; }
    this._addressResolutions.set(pinId, stale);
    return true;
}

/** Mark the batched request's instances as in flight. */
markAddressesResolving(pinIds: readonly string[]): void {
    if (pinIds.length === 0) { return; }
    for (const pinId of pinIds) { this._addressResolutions.set(pinId, { status: 'resolving' }); }
    this.refreshInstances();
}

/** Apply one batch of host results (partial results allowed). */
applyAddressResults(results: readonly InstanceAddressResult[], generation: number): void {
    for (const result of results) { this.applyAddressResult(result, generation); }
    this.refreshInstances();
}

private applyAddressResult(result: InstanceAddressResult, generation: number): void {
    if (result.ok) {
        this._addressResolutions.set(result.pinId, { status: 'resolved', addr: result.addr, generation });
        return;
    }
    const lastAddr = previousAddressValue(this._addressResolutions.get(result.pinId));
    this._addressResolutions.set(result.pinId, addressFailureResolution(result, generation, lastAddr));
}

/** Drop every transient parameter resolution (document close / profile switch). */
clearParamResolutions(): void {
    if (this._paramResolutions.size === 0) { return; }
    this._paramResolutions.clear();
    this.refreshInstances();
}

/** Keep the last resolved value visible but not current; no decode runs until re-resolved. */
markParamsStale(generation: number): void {
    const changed = this._pins.reduce((acc, pin) => this.markPinParamsStale(pin, generation) || acc, false);
    if (changed) { this.refreshInstances(); }
}

/** Mark every script-sourced parameter of one instance stale (manual values win). */
private markPinParamsStale(pin: TypeInstance, generation: number): boolean {
    if (!instanceUsesScriptParams(pin)) { return false; }
    let changed = false;
    for (const param of activeParamNames(pin)) {
        this.markParamStale(pin.id, param, generation);
        changed = true;
    }
    return changed;
}

private markParamStale(pinId: string, param: string, generation: number): void {
    const key = paramResolutionKey(pinId, param);
    const stale: { status: 'stale'; generation: number; value?: number } = { status: 'stale', generation };
    const value = lastParamValue(this._paramResolutions.get(key));
    if (value !== undefined) { stale.value = value; }
    this._paramResolutions.set(key, stale);
}

/** Mark the batched round's parameters as in flight. */
markParamsResolving(entries: readonly { pinId: string; param: string }[]): void {
    if (entries.length === 0) { return; }
    for (const entry of entries) {
        this._paramResolutions.set(paramResolutionKey(entry.pinId, entry.param), { status: 'resolving' });
    }
    this.refreshInstances();
}

/** Apply one batch of host size results (partial results allowed). */
applyParamResults(results: readonly InstanceParamResult[], generation: number): void {
    for (const result of results) { this.applyParamResult(result, generation); }
    this.refreshInstances();
}

private applyParamResult(result: InstanceParamResult, generation: number): void {
    const key = paramResolutionKey(result.pinId, result.param);
    if (result.ok) {
        this._paramResolutions.set(key, { status: 'resolved', value: result.value, generation });
        return;
    }
    const lastValue = previousParamValue(this._paramResolutions.get(key));
    this._paramResolutions.set(key, paramFailureResolution(result, generation, lastValue));
}

/** One parameter's transient resolution (undefined until the first request). */
paramResolution(pinId: string, param: string): ParamResolution | undefined {
    return this._paramResolutions.get(paramResolutionKey(pinId, param));
}

/** Successful resolved values for one instance in the current generation. */
resolvedParamValues(pinId: string, generation: number): ReadonlyMap<string, number> {
    const values = new Map<string, number>();
    const pin = this._pins.find(candidate => candidate.id === pinId);
    if (!pin) { return values; }
    for (const [name, value] of this.resolvedParamValuesFor(pin)) {
        if (this.resolvedInGeneration(pinId, name, generation)) { values.set(name, value); }
    }
    return values;
}

/** Whether one parameter holds a successful resolution from the requested generation. */
private resolvedInGeneration(pinId: string, name: string, generation: number): boolean {
    const resolution = this._paramResolutions.get(paramResolutionKey(pinId, name));
    return resolution?.status === 'resolved' && resolution.generation === generation;
}

/** Why an instance cannot decode yet: a pending/stale/failed source or invalid params. */
paramBlockReason(pinId: string): string | undefined {
    const pin = this._pins.find(candidate => candidate.id === pinId);
    if (!pin) { return undefined; }
    const def = this.allTypesById().find(candidate => candidate.id === pin.typeId);
    if (!def) { return undefined; }
    return this.paramResolutionError(pin, def) ?? this.effectiveParamsError(pin, def);
}

private paramResolutionError(pin: TypeInstance, def: TypeDef): string | undefined {
    return instanceParamResolutionError(def, pin, this._paramResolutions) || undefined;
}

/** Effective layout params for one instance (undefined on any parameter error). */
private pinLayoutParams(pin: TypeInstance, def: TypeDef): Record<string, number> | undefined {
    const resolved = this.resolvedParamValuesFor(pin);
    const effective = effectiveInstanceParams(def, pin, resolved);
    return effective.ok ? effective.value : undefined;
}

private effectiveParamsError(pin: TypeInstance, def: TypeDef): string | undefined {
    const effective = effectiveInstanceParams(def, pin, this.resolvedParamValuesFor(pin));
    return effective.ok ? undefined : effective.error;
}

private resolvedParamValuesFor(pin: TypeInstance): ReadonlyMap<string, number> {
    const values = new Map<string, number>();
    for (const [name, value] of resolvedInstanceParams(pin.id, this._paramResolutions)) {
        if (this.paramSourceStillActive(pin, name)) { values.set(name, value); }
    }
    return values;
}

/** A resolution only counts while its authored source is still live (manual wins). */
private paramSourceStillActive(pin: TypeInstance, name: string): boolean {
    return Boolean(pin.paramSources?.[name]?.scriptPath?.trim()) && !hasOwnParamValue(pin, name);
}

private allTypesById(): TypeDef[] {
    return allTypes(this._types);
}

/** Effective base address for one instance (null while resolving/stale/error). */
private instanceAddress(pin: TypeInstance): number | null {
    return effectiveInstanceAddress(pin, this._addressResolutions);
}

private instanceResolution(pin: TypeInstance): AddressResolution | undefined {
    return pin.addressSource ? this._addressResolutions.get(pin.id) : undefined;
}

/** A dynamic card has rows only after every script source and parameter succeeds. */
private instanceRenderable(pin: TypeInstance): boolean {
    if (this.paramBlockReason(pin.id)) { return false; }
    if (!instanceUsesScriptAddress(pin)) { return true; }
    return this._addressResolutions.get(pin.id)?.status === 'resolved';
}

private instanceFormOpen(): boolean {
    return this._addingPin || this._editingPinId !== null;
}

private hasDynamicInstances(): boolean {
    return this._pins.some(pin => instanceUsesScriptResolution(pin));
}

/** Hex-view byte selection → clear stale instance selection + sync add/edit form (was onSelectionChangeForOverlay). */
setSelection(start: number | null): void {
    if (typeof document === 'undefined') { return; }
    this.clearSelectionState();
    if (start === null) { return; }
    this._activeTypeAddr = start;
    this.updateTypeAddressInputs(start);
}

/** Host pushes the active sidebar tab (guards add/edit address input sync to the visible overlay tab). */
setTabActive(active: boolean): void {
    this._tabActive = active;
}

/** Resets all transient view state and re-renders. Call when switching away and back (was resetViewState). */
resetViewState(): void {
    this._editingType             = null;
    this._choosingKind            = false;
    this._typeFilter              = '';
    this._typeKindFilter          = 'all';
    this._addingPin               = false;
    this._editingPinId            = null;
    this._editingPinDraftTypeId = null;
    this._pinSourceDraft          = { mode: 'fixed', scriptPath: '' };
    this._pinParamSourceDrafts.clear();
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
private editorHtml(draft: TypeDef, existing: TypeDef | null): string {
    const kind = typeDefKind(draft);
    if (kind === 'bitfield') { return this.bitFieldDefEditorHtml(draft); }
    if (kind === 'enum') { return this.enumDefEditorHtml(draft); }
    return this.typeEditorHtml(draft, existing);
}

private typeEditorHtml(draft: TypeDef, existing: TypeDef | null): string {
    const fieldRows = this.fieldRowsHtml(draft);
    const errorHtml = this.editorErrorHtml();
    return (
        `<div class="oi-editor-wrap">` +
        this.editorTabsHtml() +
        `<div class="oe-view" data-oe-view="edit">` +
        `<div class="oe-form${hasParams(draft) ? ' has-params' : ''}">` +
        `<label class="oe-name-lbl" for="oe-name">Type name</label>` +
        `<input id="oe-name" class="oe-name-inp sb-input" type="text" value="${esc(draft.name)}" ` +
               `maxlength="64" placeholder="MyType" spellcheck="false" autocomplete="off">` +
        `<div class="oe-type-default-row">` +
        `<button id="oe-packed" class="oe-packed-btn${draft.packed ? ' active' : ''}" ` +
               `title="__attribute__((packed))" aria-label="Toggle packed struct">packed</button>` +
        `<span class="oe-type-default-ptr"></span>` +
        `<span class="oe-type-default-lbl">type default</span>` +
        this.overrideSelectHtml(draft.endian, 'endian', 'oe-type-default-sel', 'oe-endian', this._endian.toUpperCase()) +
        `</div>` +
        this.paramsSectionHtml(draft) +
        `<div class="oe-field-hdr"><span>Type</span><span>Ptr</span><span>Name</span><span>Endian</span><span>Alloc</span><span>Hide</span><span>[ ]</span><span></span><span></span></div>` +
        `<div id="oe-fields">${fieldRows}</div>` +
        `<button id="oe-add" class="sb-btn sb-btn-add" title="Add field" aria-label="Add field">\uff0b Add</button>` +
        errorHtml +
        `<div class="oe-btns">` +
        `<button id="oe-save" class="sb-btn sb-btn-primary">Save</button>` +
        `<button id="oe-cancel" class="sb-btn sb-btn-secondary">Cancel</button>` +
        `</div>` +
        `</div>` +
        `</div>` +
        `<div class="oe-view" data-oe-view="preview" hidden>` +
        `<div id="oe-preview" class="oe-preview"><pre class="oi-c-preview" data-preview-id="${esc(draft.id)}"></pre></div>` +
        `</div>` +
        `</div>`
    );
}

private editorErrorHtml(): string {
    return this._editorError ? `<div class="oe-error">${esc(this._editorError)}</div>` : '';
}

/**
 * Type-editor Parameters section: add/rename/reorder/delete size parameters
 * and their optional defaults. Lives above the field grid; the field row's
 * array control binds to these names through `countParam`.
 */
private paramsSectionHtml(draft: TypeDef): string {
    return (
        `<div class="oe-params">` +
        `<div class="oe-params-hdr">` +
        `<span class="oe-params-lbl">Parameters</span>` +
        `<button id="oe-param-add" class="sb-btn sb-btn-add" type="button" title="Add parameter" aria-label="Add parameter">\uff0b Add</button>` +
        `</div>` +
        `<div id="oe-params-list" class="ofe-params-list">${this.paramRowsHtml(draft)}</div>` +
        `<div id="oe-param-error" class="oe-error" hidden></div>` +
        `</div>`
    );
}

private paramRowsHtml(draft: TypeDef): string {
    const params = draft.params ?? [];
    return params.map((param, i) => this.paramRowHtml(param, i, params.length)).join('');
}

private paramRowHtml(param: TypeParam, i: number, total: number): string {
    const upDis = i === 0 ? ' disabled' : '';
    const dnDis = i === total - 1 ? ' disabled' : '';
    return (
        `<div class="ofe-param-row" data-param-idx="${i}" data-param-name="${esc(param.name)}">` +
        `<input class="ofe-param-name sb-input sb-input-sm" type="text" value="${esc(param.name)}" maxlength="64" ` +
               `aria-label="Parameter name" placeholder="COUNT" spellcheck="false" autocomplete="off">` +
        `<span class="ofe-param-eq">=</span>` +
        `<input class="ofe-param-default sb-input sb-input-sm" type="text" inputmode="numeric" ` +
               `value="${param.default !== undefined ? param.default : ''}" placeholder="N" aria-label="Parameter default value">` +
        `<div class="ofe-bf-child-move">` +
        `<button class="ofe-move-btn ofe-param-up" title="Move up" aria-label="Move up"${upDis}>&#x2191;</button>` +
        `<button class="ofe-move-btn ofe-param-dn" title="Move down" aria-label="Move down"${dnDis}>&#x2193;</button>` +
        `</div>` +
        `<button class="ofe-param-del" title="Delete parameter" aria-label="Delete parameter">\u2715</button>` +
        `</div>`
    );
}

/** Read the parameters section back into the draft (names sanitized, defaults numeric). */
private syncEditorParams(sec: HTMLElement, draft: TypeDef): void {
    const rows = sec.querySelectorAll<HTMLElement>('#oe-params-list .ofe-param-row');
    draft.params = Array.from(rows).map((row, i) => this.readEditorParam(row, i));
}

private readEditorParam(row: HTMLElement, i: number): TypeParam {
    const param: TypeParam = { name: this.paramNameFromRow(row, i), kind: 'size' };
    const defaultValue = readParamDefault(row.querySelector<HTMLInputElement>('.ofe-param-default')?.value);
    if (defaultValue !== undefined) { param.default = defaultValue; }
    return param;
}

private paramNameFromRow(row: HTMLElement, i: number): string {
    const nameInp = row.querySelector<HTMLInputElement>('.ofe-param-name');
    return this.sanitizeCIdent(nameInp?.value ?? '') || `param${i}`;
}

private paramIndex(btn: HTMLElement): number | null {
    const row = btn.closest<HTMLElement>('.ofe-param-row');
    return this.parseDatasetInt(row?.dataset.paramIdx);
}

private wireParamRows(sec: HTMLElement, draft: TypeDef): void {
    sec.querySelector('#oe-param-add')?.addEventListener('click', () => {
        this.syncEditorDraft(sec, draft);
        if (!draft.params) { draft.params = []; }
        draft.params.push({ name: this.nextParamName(draft), kind: 'size', default: 2 });
        this.clearParamError(sec);
        this.refreshParamSection(sec, draft);
    });

    const list = sec.querySelector<HTMLElement>('#oe-params-list');
    if (!list) { return; }

    list.querySelectorAll<HTMLInputElement>('.ofe-param-name').forEach(inp => {
        inp.addEventListener('blur', () => this.onParamRename(sec, draft, inp));
        inp.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') { (ev.target as HTMLInputElement).blur(); }
        });
    });
    list.querySelectorAll<HTMLInputElement>('.ofe-param-default').forEach(inp =>
        inp.addEventListener('input', () => {
            this.syncEditorDraft(sec, draft);
            this.clearParamError(sec);
            this.refreshEditorPreview(sec, draft);
        }));
    this.wireClicks(list, '.ofe-param-up', btn => this.moveParam(sec, draft, btn, -1));
    this.wireClicks(list, '.ofe-param-dn', btn => this.moveParam(sec, draft, btn, 1));
    this.wireClicks(list, '.ofe-param-del', btn => this.deleteParam(sec, draft, btn));
}

private onParamRename(sec: HTMLElement, draft: TypeDef, inp: HTMLInputElement): void {
    const row = inp.closest<HTMLElement>('.ofe-param-row');
    const oldName = row?.dataset.paramName ?? '';
    const clean = this.sanitizeCIdent(inp.value) || oldName || 'param';
    inp.value = clean;
    this.syncEditorDraft(sec, draft);
    renameParamRefs(draft, oldName, clean);
    this.clearParamError(sec);
    this.refreshParamSection(sec, draft);
}

private nextParamName(draft: TypeDef): string {
    const taken = new Set((draft.params ?? []).map(param => param.name));
    let n = 0;
    let candidate = 'COUNT';
    while (taken.has(candidate)) { candidate = `COUNT${n++}`; }
    return candidate;
}

private moveParam(sec: HTMLElement, draft: TypeDef, btn: HTMLElement, delta: number): void {
    const i = this.paramIndex(btn);
    if (i === null) { return; }
    this.syncEditorDraft(sec, draft);
    const params = this.editorParams(draft);
    const target = i + delta;
    if (!isIndexInRange(target, params.length)) { return; }
    [params[i], params[target]] = [params[target], params[i]];
    this.clearParamError(sec);
    this.refreshParamSection(sec, draft);
}

private editorParams(draft: TypeDef): TypeParam[] {
    return draft.params ?? [];
}

private deleteParam(sec: HTMLElement, draft: TypeDef, btn: HTMLElement): void {
    const i = this.paramIndex(btn);
    if (i === null) { return; }
    this.syncEditorDraft(sec, draft);
    const params = this.editorParams(draft);
    const param = params[i];
    if (!param) { return; }
    const referenceError = paramReferenceError(draft, param);
    if (referenceError) {
        this.showParamError(sec, referenceError);
        return;
    }
    params.splice(i, 1);
    this.clearParamError(sec);
    this.refreshParamSection(sec, draft);
}

private refreshParamSection(sec: HTMLElement, draft: TypeDef): void {
    sec.querySelector<HTMLElement>('.oe-form')?.classList.toggle('has-params', hasParams(draft));
    const list = sec.querySelector<HTMLElement>('#oe-params-list');
    if (list) {
        list.innerHTML = this.paramRowsHtml(draft);
        this.wireParamRows(sec, draft);
    }
    this.refreshFieldRows(sec, draft);
}

private showParamError(sec: HTMLElement, message: string): void {
    const el = sec.querySelector<HTMLElement>('#oe-param-error');
    if (!el) { return; }
    el.textContent = message;
    el.hidden = false;
}

private clearParamError(sec: HTMLElement): void {
    const el = sec.querySelector<HTMLElement>('#oe-param-error');
    if (!el) { return; }
    el.textContent = '';
    el.hidden = true;
}

/** Edit/Preview tab bar that toggles which editor view is visible (markdown raw/preview style). */
private editorTabsHtml(): string {    return (
        `<div class="oe-tabs compact-tabs" role="tablist" aria-label="Type editor views">` +
        `<button type="button" class="oe-tab active" role="tab" aria-selected="true" data-oe-view="edit">Edit</button>` +
        `<button type="button" class="oe-tab" role="tab" aria-selected="false" data-oe-view="preview">Preview</button>` +
        `</div>`
    );
}

/** Bit-field type form: name + base unsigned width + name/width child rows (no type fields/nesting). */
private bitFieldDefEditorHtml(draft: TypeDef): string {
    const { addBtnDisabled, addBtnTitle } = this.bitChildButtonState(this.availableBitFieldDefBits(draft));
    return this.kindDefEditorHtml(draft, {
        placeholder: 'MyBitField',
        kind: 'bitfield',
        baseSelectId: 'oe-base-type',
        baseAria: 'Bit-field base width',
        rowsHtml: this.bitFieldChildHeaderHtml() +
            `<div id="oe-bf-def-children" class="ofe-bf-children">${this.bitFieldDefChildRowsHtml(draft)}</div>`,
        addBtnHtml: `<button id="oe-bf-def-add" class="sb-btn sb-btn-add" title="${addBtnTitle}" aria-label="${addBtnTitle}"${addBtnDisabled}>\uff0b Add</button>`,
    });
}

/**
 * Column header for the bit-field child rows. Sits outside `#oe-bf-def-children` so the
 * incremental row rebuild (`refreshBitFieldDefRows`) leaves it in place; it aligns with the
 * rows through the shared `.ofe-bf-child-hdr` / `.ofe-bf-child-row` grid template.
 */
private bitFieldChildHeaderHtml(): string {
    return (
        `<div class="ofe-bf-child-hdr">` +
        `<span></span><span>Name</span><span>Bits</span><span></span>` +
        `<span>Enum</span><span>Hide</span><span></span><span></span>` +
        `</div>`
    );
}

/** Per-kind slots for the shared bit-field / enum editor shell. */
private kindDefEditorHtml(draft: TypeDef, parts: KindDefEditorParts): string {
    return (
        this.kindDefEditorShellHtml(draft, parts) +
        parts.rowsHtml +
        parts.addBtnHtml +
        this.kindDefEditorFooterHtml(draft)
    );
}

/** Shared editor shell: tab bar, form open, type-name input, and the base-width row. */
private kindDefEditorShellHtml(draft: TypeDef, parts: KindDefEditorParts): string {
    return (
        `<div class="oi-editor-wrap">` +
        this.editorTabsHtml() +
        `<div class="oe-view" data-oe-view="edit">` +
        `<div class="oe-form">` +
        `<label class="oe-name-lbl" for="oe-name">Type name</label>` +
        `<input id="oe-name" class="oe-name-inp sb-input" type="text" value="${esc(draft.name)}" ` +
               `maxlength="64" placeholder="${parts.placeholder}" spellcheck="false" autocomplete="off">` +
        `<div class="oe-type-default-row">` +
        `<span class="oe-kind-badge od-kind-${parts.kind}">${typeKindLabel(parts.kind)}</span>` +
        `<span class="oe-type-default-ptr"></span>` +
        `<span class="oe-type-default-lbl">base width</span>` +
        `<select id="${parts.baseSelectId}" class="oe-type-default-sel" aria-label="${parts.baseAria}">${this.baseTypeOptionsHtml(draft.baseType)}</select>` +
        `</div>`
    );
}

/** Shared editor tail: error slot, save/cancel buttons, and the C preview pane. */
private kindDefEditorFooterHtml(draft: TypeDef): string {
    return (
        this.editorErrorHtml() +
        `<div class="oe-btns">` +
        `<button id="oe-save" class="sb-btn sb-btn-primary">Save</button>` +
        `<button id="oe-cancel" class="sb-btn sb-btn-secondary">Cancel</button>` +
        `</div>` +
        `</div>` +
        `</div>` +
        `<div class="oe-view" data-oe-view="preview" hidden>` +
        `<div id="oe-preview" class="oe-preview"><pre class="oi-c-preview" data-preview-id="${esc(draft.id)}"></pre></div>` +
        `</div>` +
        `</div>`
    );
}

private baseTypeOptionsHtml(selected: TypeBaseType | undefined): string {
    const value = selected ?? 'uint8';
    return (['uint8', 'uint16', 'uint32', 'uint64'] as TypeBaseType[])
        .map(t => `<option value="${t}"${t === value ? ' selected' : ''}>${t}</option>`)
        .join('');
}

private availableBitFieldDefBits(def: TypeDef): number {
    const baseType = def.baseType ?? 'uint8';
    const usedBits = (def.bitFields ?? []).reduce((sum, child) => sum + child.bitWidth, 0);
    return fieldByteSize(baseType) * 8 - usedBits;
}

private refreshBitFieldDefRows(sec: HTMLElement, draft: TypeDef): void {
    const container = sec.querySelector<HTMLElement>('#oe-bf-def-children');
    if (!container) { return; }
    container.innerHTML = this.bitFieldDefChildRowsHtml(draft);
    this.wireBitFieldDefChildRows(sec, draft);
    this.refreshBitFieldDefAddButton(sec, draft);
    const pre = sec.querySelector<HTMLElement>('#oe-preview pre');
    if (pre) { this.renderTypeCPreview(pre, draft); }
}

private bitFieldDefChildRowsHtml(draft: TypeDef): string {
    const children = draft.bitFields ?? [];
    return children.map((child, ci) => this.childFieldRowHtml(child, ci, children.length)).join('');
}

private refreshBitFieldDefAddButton(sec: HTMLElement, draft: TypeDef): void {
    const btn = sec.querySelector<HTMLButtonElement>('#oe-bf-def-add');
    if (!btn) { return; }
    const { addBtnDisabled, addBtnTitle } = this.bitChildButtonState(this.availableBitFieldDefBits(draft));
    btn.disabled = addBtnDisabled !== '';
    btn.title = addBtnTitle;
    btn.setAttribute('aria-label', addBtnTitle);
}

private bitFieldChildIndex(btn: HTMLElement): number | null {
    const row = btn.closest<HTMLElement>('.ofe-bf-child-row');
    const idx = this.parseDatasetInt(row?.dataset.childIdx);
    return idx === null ? null : idx;
}

private wireBitFieldDefChildRows(sec: HTMLElement, draft: TypeDef): void {
    const container = sec.querySelector<HTMLElement>('#oe-bf-def-children');
    if (!container) { return; }
    container.querySelectorAll<HTMLInputElement>('.ofe-bf-child-name').forEach(inp =>
        inp.addEventListener('input', () => this.refreshEditorPreview(sec, draft)));
    container.querySelectorAll<HTMLInputElement>('.ofe-bf-child-width').forEach(inp =>
        inp.addEventListener('input', () => {
            this.syncBitFieldDefDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
            this.refreshBitFieldDefAddButton(sec, draft);
        }));
    container.querySelectorAll<HTMLSelectElement>('.ofe-bf-child-enum').forEach(sel =>
        sel.addEventListener('change', () => {
            this.syncBitFieldDefDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        }));
    container.querySelectorAll<HTMLInputElement>('.ofe-bf-child-hidden').forEach(chk =>
        chk.addEventListener('change', () => {
            this.syncBitFieldDefDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        }));
    this.wireClicks(container, '.ofe-bf-del-child', btn => {
        const ci = this.bitFieldChildIndex(btn);
        if (ci === null) { return; }
        this.syncBitFieldDefDraft(sec, draft);
        draft.bitFields!.splice(ci, 1);
        if (draft.bitFields!.length === 0) { draft.bitFields!.push({ name: 'bit0', bitWidth: 1 }); }
        this.refreshBitFieldDefRows(sec, draft);
    });
    this.wireClicks(container, '.ofe-bf-child-row .ofe-move-up', btn => {
        const ci = this.bitFieldChildIndex(btn);
        if (ci === null) { return; }
        this.syncBitFieldDefDraft(sec, draft);
        if (ci > 0) {
            [draft.bitFields![ci - 1], draft.bitFields![ci]] = [draft.bitFields![ci], draft.bitFields![ci - 1]];
            this.refreshBitFieldDefRows(sec, draft);
        }
    });
    this.wireClicks(container, '.ofe-bf-child-row .ofe-move-dn', btn => {
        const ci = this.bitFieldChildIndex(btn);
        if (ci === null) { return; }
        this.syncBitFieldDefDraft(sec, draft);
        if (ci < draft.bitFields!.length - 1) {
            [draft.bitFields![ci], draft.bitFields![ci + 1]] = [draft.bitFields![ci + 1], draft.bitFields![ci]];
            this.refreshBitFieldDefRows(sec, draft);
        }
    });
}

private syncBitFieldDefDraft(sec: HTMLElement, draft: TypeDef): void {
    draft.name = this.sanitizeCIdent(this.inputValue(sec, '#oe-name'));
    draft.baseType = this.readBaseType(this.selectValue(sec, '#oe-base-type'));
    draft.fields = [];
    const rows = sec.querySelectorAll<HTMLElement>('#oe-bf-def-children .ofe-bf-child-row');
    draft.bitFields = Array.from(rows).map(row => this.readEditorBitFieldChild(row));
}

private readBaseType(value: string | undefined): TypeBaseType {
    return value !== undefined && isUnsignedScalarType(value as TypeFieldType)
        ? value as TypeBaseType
        : 'uint8';
}

private bitFieldDraftToTypeDef(sec: HTMLElement, draft: TypeDef): TypeDef {
    return {
        id: draft.id,
        name: this.sanitizeCIdent(this.inputValue(sec, '#oe-name')) || this.nextTypeName(draft.id),
        kind: 'bitfield',
        baseType: draft.baseType ?? 'uint8',
        bitFields: (draft.bitFields ?? [{ name: 'bit0', bitWidth: 1 }]).map(child => ({ ...child })),
        fields: [],
    };
}

/** Enum type form: name + base unsigned width + name/value entry rows (no type fields). */
private enumDefEditorHtml(draft: TypeDef): string {
    return this.kindDefEditorHtml(draft, {
        placeholder: 'MyEnum',
        kind: 'enum',
        baseSelectId: 'oe-enum-base-type',
        baseAria: 'Enum base width',
        rowsHtml: this.enumEntryHeaderHtml() +
            `<div id="oe-enum-entries" class="ofe-enum-entries">${this.enumEntryRowsHtml(draft)}</div>`,
        addBtnHtml: `<button id="oe-enum-add" class="sb-btn sb-btn-add" title="Add entry" aria-label="Add entry">\uff0b Add</button>`,
    });
}

/**
 * Column header for the enum entry rows. Sits outside `#oe-enum-entries` so the incremental
 * row rebuild (`refreshEnumDefRows`) leaves it in place; it aligns with the rows through the
 * shared `.ofe-enum-entry-hdr` / `.ofe-enum-entry-row` grid template.
 */
private enumEntryHeaderHtml(): string {
    return (
        `<div class="ofe-enum-entry-hdr">` +
        `<span></span><span>Name</span><span></span><span>Value</span><span></span><span></span>` +
        `</div>`
    );
}

private enumEntryRowsHtml(draft: TypeDef): string {
    const entries = draft.entries ?? [];
    return entries.map((entry, i) => this.enumEntryRowHtml(entry, i, entries.length)).join('');
}

private enumEntryRowHtml(entry: EnumEntry, i: number, total: number): string {
    const upDis = i === 0 ? ' disabled' : '';
    const dnDis = i === total - 1 ? ' disabled' : '';
    const delCell = total <= 1
        ? `<span class="ofe-del-placeholder"></span>`
        : `<button class="ofe-enum-del-entry" title="Remove entry" aria-label="Remove entry">\u2715</button>`;
    return (
        `<div class="ofe-enum-entry-row" data-entry-idx="${i}">` +
        `<span class="ofe-bf-child-indent"></span>` +
        `<input class="ofe-enum-entry-name sb-input sb-input-sm" type="text" value="${esc(entry.name)}" maxlength="64" ` +
               `aria-label="Enum entry name" placeholder="ENTRY${i}" spellcheck="false" autocomplete="off">` +
        `<span class="ofe-bf-child-unit">=</span>` +
        `<input class="ofe-enum-entry-value sb-input sb-input-sm" type="text" inputmode="numeric" ` +
               `aria-label="Enum entry value" value="${esc(this.enumEntryValueText(entry.value))}" placeholder="0" spellcheck="false" autocomplete="off">` +
        `<div class="ofe-bf-child-move">` +
        `<button class="ofe-move-btn ofe-move-up" title="Move up" aria-label="Move up"${upDis}>&#x2191;</button>` +
        `<button class="ofe-move-btn ofe-move-dn" title="Move down" aria-label="Move down"${dnDis}>&#x2193;</button>` +
        `</div>` +
        delCell +
        `</div>`
    );
}

private enumEntryValueText(value: number): string {
    return `0x${value.toString(16).toUpperCase()}`;
}

private enumEntryIndex(btn: HTMLElement): number | null {
    const row = btn.closest<HTMLElement>('.ofe-enum-entry-row');
    const idx = this.parseDatasetInt(row?.dataset.entryIdx);
    return idx === null ? null : idx;
}

private refreshEnumDefRows(sec: HTMLElement, draft: TypeDef): void {
    const container = sec.querySelector<HTMLElement>('#oe-enum-entries');
    if (!container) { return; }
    container.innerHTML = this.enumEntryRowsHtml(draft);
    this.wireEnumDefEntryRows(sec, draft);
    const pre = sec.querySelector<HTMLElement>('#oe-preview pre');
    if (pre) { this.renderTypeCPreview(pre, draft); }
}

private wireEnumDefEntryRows(sec: HTMLElement, draft: TypeDef): void {
    const container = sec.querySelector<HTMLElement>('#oe-enum-entries');
    if (!container) { return; }
    container.querySelectorAll<HTMLInputElement>('.ofe-enum-entry-name').forEach(inp => {
        inp.addEventListener('input', () => { this.syncEnumDefDraft(sec, draft); this.refreshEditorPreview(sec, draft); });
        inp.addEventListener('blur', () => {
            const clean = this.sanitizeCIdent(inp.value);
            if (clean !== inp.value) { inp.value = clean; }
            this.syncEnumDefDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        });
    });
    container.querySelectorAll<HTMLInputElement>('.ofe-enum-entry-value').forEach(inp =>
        inp.addEventListener('input', () => { this.syncEnumDefDraft(sec, draft); this.refreshEditorPreview(sec, draft); }));
    this.wireClicks(container, '.ofe-enum-del-entry', btn => {
        const i = this.enumEntryIndex(btn);
        if (i === null) { return; }
        this.syncEnumDefDraft(sec, draft);
        draft.entries!.splice(i, 1);
        if (draft.entries!.length === 0) { draft.entries!.push({ name: 'VALUE0', value: 0 }); }
        this.refreshEnumDefRows(sec, draft);
    });
    this.wireClicks(container, '.ofe-enum-entry-row .ofe-move-up', btn => {
        const i = this.enumEntryIndex(btn);
        if (i === null) { return; }
        this.syncEnumDefDraft(sec, draft);
        if (i > 0) {
            [draft.entries![i - 1], draft.entries![i]] = [draft.entries![i], draft.entries![i - 1]];
            this.refreshEnumDefRows(sec, draft);
        }
    });
    this.wireClicks(container, '.ofe-enum-entry-row .ofe-move-dn', btn => {
        const i = this.enumEntryIndex(btn);
        if (i === null) { return; }
        this.syncEnumDefDraft(sec, draft);
        if (i < draft.entries!.length - 1) {
            [draft.entries![i], draft.entries![i + 1]] = [draft.entries![i + 1], draft.entries![i]];
            this.refreshEnumDefRows(sec, draft);
        }
    });
}

private syncEnumDefDraft(sec: HTMLElement, draft: TypeDef): void {
    draft.name = this.sanitizeCIdent(this.inputValue(sec, '#oe-name'));
    draft.baseType = this.readBaseType(this.selectValue(sec, '#oe-enum-base-type'));
    draft.fields = [];
    const rows = sec.querySelectorAll<HTMLElement>('#oe-enum-entries .ofe-enum-entry-row');
    draft.entries = Array.from(rows).map(row => this.readEditorEnumEntry(row));
}

private readEditorEnumEntry(row: HTMLElement): EnumEntry {
    const idx = row.dataset.entryIdx ?? '0';
    const name = this.sanitizeCIdent(
        (row.querySelector('.ofe-enum-entry-name') as HTMLInputElement).value
    ) || `VALUE${idx}`;
    const value = this.parseEnumEntryValue((row.querySelector('.ofe-enum-entry-value') as HTMLInputElement).value);
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

private enumDraftToTypeDef(sec: HTMLElement, draft: TypeDef): TypeDef {
    return {
        id: draft.id,
        name: this.sanitizeCIdent(this.inputValue(sec, '#oe-name')) || this.nextTypeName(draft.id),
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
 * and the incremental `#oe-fields` rebuild (so the two never diverge).
 */
private fieldRowsHtml(draft: TypeDef): string {
    return draft.fields.map((f, i) => this.fieldRowHtml(f, i, draft.fields.length === 1, draft.fields.length, draft.id)).join('');
}

/**
 * Incremental editor refresh: rebuild only the `#oe-fields` row container
 * instead of the whole editor. The scroll container (.oe-form) is never
 * replaced, so its scrollTop survives — no jump to the top on Add field /
 * Add bit / move / delete. Then re-wire row-level controls and refresh the
 * live C preview.
 */
private refreshFieldRows(sec: HTMLElement, draft: TypeDef): void {
    const fields = sec.querySelector<HTMLElement>('#oe-fields');
    if (!fields) { return; }
    fields.innerHTML = this.fieldRowsHtml(draft);
    this.wireFieldRows(fields, sec, draft);
    const pre = sec.querySelector<HTMLElement>('#oe-preview pre');
    if (pre) { this.renderTypeCPreview(pre, draft); }
}

/** Re-render the live C preview as the user edits the draft. */
private refreshEditorPreview(sec: HTMLElement, draft: TypeDef): void {
    const kind = typeDefKind(draft);
    if (kind === 'bitfield') { this.syncBitFieldDefDraft(sec, draft); }
    else if (kind === 'enum') { this.syncEnumDefDraft(sec, draft); }
    else { this.syncEditorDraft(sec, draft); }
    const pre = sec.querySelector<HTMLElement>('#oe-preview pre');
    if (pre) { this.renderTypeCPreview(pre, draft); }
}

/**
 * Row-level editor controls (type select, pointer, array, bit toggle, child
 * rows, move/delete, endian/alloc select). Called on initial mount and again
 * after every `#oe-fields` rebuild so freshly inserted rows stay live.
 */
private wireFieldRows(fieldsEl: HTMLElement, sec: HTMLElement, draft: TypeDef): void {
    const syncedFieldForButton = (btn: HTMLElement): { row: HTMLElement; idx: number; field: TypeField | undefined } => {
        const row = btn.closest<HTMLElement>('.field-row')!;
        this.syncEditorDraft(sec, draft);
        const idx = parseInt(row.dataset.idx!);
        return { row, idx, field: draft.fields[idx] };
    };

    fieldsEl.querySelectorAll<HTMLElement>('.ofe-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            this.syncEditorDraft(sec, draft);
            this._editorError = null;
            const row = btn.closest<HTMLElement>('.field-row')!;
            const idx = parseInt(row.dataset.idx!);
            draft.fields.splice(idx, 1);
            this.refreshFieldRows(sec, draft);
            this.scrollEditorRowIntoView(sec, Math.max(0, idx - 1));
        });
    });

    fieldsEl.querySelectorAll<HTMLElement>('.ofe-move-up').forEach(btn => {
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

    fieldsEl.querySelectorAll<HTMLElement>('.ofe-move-dn').forEach(btn => {
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

    fieldsEl.querySelectorAll<HTMLElement>('.ofe-arr-toggle').forEach(btn => {
        btn.addEventListener('click', () => this.toggleArrayCell(sec, draft, btn));
    });

    fieldsEl.querySelectorAll<HTMLElement>('.field-row').forEach(row => {
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

    fieldsEl.querySelectorAll<HTMLElement>('.ofe-ptr-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest<HTMLElement>('.field-row')!;
            if (!row) { return; }
            const want = !(row.dataset.ptr === '1');
            this.toggleFieldPointer(sec, draft, row, want);
        });
    });

    fieldsEl.querySelectorAll<HTMLInputElement>('.ofe-count-inp').forEach(inp => {
        inp.addEventListener('input', () => {
            inp.value = inp.value.replace(/\D/g, '');
            this.refreshEditorPreview(sec, draft);
        });
    });

    // Literal ↔ parameter count switch: no row rebuild, so the select keeps focus.
    fieldsEl.querySelectorAll<HTMLSelectElement>('.ofe-count-param').forEach(sel => {
        sel.addEventListener('change', () => {
            const cell = sel.closest<HTMLElement>('.ofe-arr-cell')!;
            const hasParam = sel.value !== '';
            cell.classList.toggle('has-param', hasParam);
            cell.classList.toggle('is-array', hasParam || cell.classList.contains('is-array'));
            const toggle = cell.querySelector<HTMLElement>('.ofe-arr-toggle');
            toggle?.classList.toggle('active', cell.classList.contains('is-array'));
            this.syncEditorDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLInputElement>('.ofe-name-inp').forEach(inp => {
        inp.addEventListener('input', () => { this.refreshEditorPreview(sec, draft); });
        inp.addEventListener('blur', () => {
            const clean = this.sanitizeCIdent(inp.value);
            if (clean !== inp.value) { inp.value = clean || 'field'; }
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLSelectElement>('.ofe-type-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            this.handleFieldTypeChange(sec, draft, sel);
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLSelectElement>('.ofe-endian-sel, .ofe-alloc-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            this.syncEditorDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        });
    });

    fieldsEl.querySelectorAll<HTMLInputElement>('.ofe-hidden-chk').forEach(chk => {
        chk.addEventListener('change', () => {
            this.syncEditorDraft(sec, draft);
            this.refreshEditorPreview(sec, draft);
        });
    });
}

/**
 * Toggle a field row's array cell in place: flips the array/param classes, seeds
 * the literal count on first activation, and refreshes the preview.
 */
private toggleArrayCell(sec: HTMLElement, draft: TypeDef, btn: HTMLElement): void {
    const cell = btn.closest<HTMLElement>('.ofe-arr-cell')!;
    const nowArr = !cell.classList.contains('is-array');
    cell.classList.toggle('is-array', nowArr);
    this.syncArrayToggleButton(btn, nowArr);
    this.syncArrayParamState(cell, nowArr);
    this.refreshEditorPreview(sec, draft);
}

private syncArrayParamState(cell: HTMLElement, isArray: boolean): void {
    const paramSel = cell.querySelector<HTMLSelectElement>('.ofe-count-param');
    this.resetArrayParamSelect(paramSel, isArray);
    const hasParam = isArray && Boolean(paramSel?.value);
    cell.classList.toggle('has-param', hasParam);
    this.seedArrayCountIfNeeded(cell, isArray && !hasParam);
}

private resetArrayParamSelect(paramSel: HTMLSelectElement | null, isArray: boolean): void {
    if (!isArray && paramSel) { paramSel.value = ''; }
}

private seedArrayCountIfNeeded(cell: HTMLElement, needsCount: boolean): void {
    if (needsCount) { seedArrayCount(cell); }
}

private syncArrayToggleButton(btn: HTMLElement, isArray: boolean): void {
    btn.classList.toggle('active', isArray);
    btn.title = isArray ? 'Remove array' : 'Make array';
    btn.setAttribute('aria-label', btn.title);
}

/**
 * Refresh the "Auto — inherits <X>" titles (select + its Auto option) on all
 * endian/alloc override selects after the type default changed — in place,
 * no editor rebuild (mirrors the tooltip text fieldRowHtml/editorHtml render
 * on mount).
 */
private updateEditorOverrideTitles(sec: HTMLElement): void {
    const endianInherit = this.editorInheritedEndian();
    const allocInherit = this.editorInheritedAlloc();
    sec.querySelectorAll<HTMLSelectElement>('.ofe-endian-sel').forEach(sel =>
        this.setOverrideSelectTitles(sel, 'endian', endianInherit));
    sec.querySelectorAll<HTMLSelectElement>('.ofe-alloc-sel').forEach(sel =>
        this.setOverrideSelectTitles(sel, 'allocation', allocInherit));
    const typeEndian = sec.querySelector<HTMLSelectElement>('#oe-endian');
    if (typeEndian) { this.setOverrideSelectTitles(typeEndian, 'endian', this._endian.toUpperCase()); }
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
    const row = sec.querySelectorAll<HTMLElement>('.field-row')[idx];
    if (row && typeof row.scrollIntoView === 'function') { row.scrollIntoView({ block: 'nearest' }); }
}

private syncEditorDraft(sec: HTMLElement, draft: TypeDef): void {
    draft.name   = this.sanitizeCIdent(this.inputValue(sec, '#oe-name'));
    draft.packed = this.inputActive(sec, '#oe-packed');
    draft.endian = this.readEndianOverride(this.selectValue(sec, '#oe-endian'));
    this.syncEditorParams(sec, draft);
    const rows = sec.querySelectorAll<HTMLElement>('.field-row');
    draft.fields = Array.from(rows).map(row => {
        return this.readEditorFieldRow(row, draft);
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

private readEditorFieldRow(row: HTMLElement, draft: TypeDef): TypeField {
    const typeInfo = this.readEditorFieldType(row);
    const countParam = this.readFieldCountParam(row);
    return {
        name: this.sanitizeCIdent(this.rowInputValue(row, '.ofe-name-inp')),
        type: typeInfo.type,
        refTypeId: typeInfo.refTypeId,
        isPointer: typeInfo.isPointer || undefined,
        count: countParam ? this.mirroredParamCount(draft, countParam) : this.readEditorArrayCount(row),
        countParam,
        endian: this.readEndianOverride(this.rowSelectValue(row, '.ofe-endian-sel')),
        // Only bit-field-reference rows render an alloc select; other rows hold
        // a placeholder, so this reads undefined and authors no allocation.
        allocation: this.readAllocationOverride(this.rowSelectValue(row, '.ofe-alloc-sel')),
        hidden: this.readHiddenFlag(row),
    };
}

/** A row's bound parameter name, or undefined for a literal/absent array. */
private readFieldCountParam(row: HTMLElement): string | undefined {
    return this.rowSelectValue(row, '.ofe-count-param') || undefined;
}

/** `count` mirrors the parameter default (or 1 when it has none) for old-build fallback. */
private mirroredParamCount(draft: TypeDef, name: string): number {
    const param = draft.params?.find(candidate => candidate.name === name);
    return param?.default ?? 1;
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
    return row.querySelector<HTMLInputElement>('.ofe-hidden-chk')?.checked || undefined;
}

private readEndianOverride(value: string | undefined): 'le' | 'be' | undefined {
    return value === 'le' || value === 'be' ? value : undefined;
}

private readAllocationOverride(value: string | undefined): 'lsb' | 'msb' | undefined {
    return value === 'lsb' || value === 'msb' ? value : undefined;
}

private readEditorFieldType(row: HTMLElement): { type: TypeFieldType; refTypeId: string | undefined; isPointer: boolean } {
    const rawType = (row.querySelector('.ofe-type-sel') as HTMLSelectElement).value;
    const parsed = this.parseEditorFieldType(rawType);
    const ptrActive = row.dataset.ptr === '1';
    return {
        ...parsed,
        isPointer: ptrActive || parsed.type === 'void',
    };
}

private parseEditorFieldType(rawType: string): { type: TypeFieldType; refTypeId: string | undefined } {
    if (rawType.startsWith('struct:')) { return { type: 'struct', refTypeId: rawType.slice('struct:'.length) }; }
    if (rawType.startsWith('bitfield:')) { return { type: 'bitfield', refTypeId: rawType.slice('bitfield:'.length) }; }
    if (rawType.startsWith('enum:')) { return { type: 'enum', refTypeId: rawType.slice('enum:'.length) }; }
    return { type: rawType as TypeFieldType, refTypeId: undefined };
}

/** Read a bit-field child row (used by the standalone bit-field def editor). */
private readEditorBitFieldChild(childRow: HTMLElement): BitFieldChild {
    const child: BitFieldChild = {
        name: this.readBitChildName(childRow),
        bitWidth: this.readBitChildWidth(childRow),
    };
    const enumRef = this.rowSelectValue(childRow, '.ofe-bf-child-enum');
    if (enumRef) { child.refTypeId = enumRef; }
    if (this.readBitChildHiddenFlag(childRow)) { child.hidden = true; }
    return child;
}

/** Whether a bit-field child row's hidden checkbox is ticked (absent = visible). */
private readBitChildHiddenFlag(childRow: HTMLElement): boolean {
    return childRow.querySelector<HTMLInputElement>('.ofe-bf-child-hidden')?.checked === true;
}

/** Child name, defaulting to the row index when blank. */
private readBitChildName(childRow: HTMLElement): string {
    const raw = this.rowInputValue(childRow, '.ofe-bf-child-name');
    return this.sanitizeCIdent(raw) || `bit${childRow.dataset.childIdx || '0'}`;
}

/** Child width, clamped to a positive value at most 64 bits. */
private readBitChildWidth(childRow: HTMLElement): number {
    const width = parseInt(this.rowInputValue(childRow, '.ofe-bf-child-width'), 10);
    return width > 0 ? Math.min(width, 64) : 1;
}

private readEditorArrayCount(row: HTMLElement): number {
    const cell = row.querySelector<HTMLElement>('.ofe-arr-cell')!;
    if (!cell.classList.contains('is-array')) { return 1; }
    const v = parseInt((row.querySelector('.ofe-count-inp') as HTMLInputElement).value);
    return isNaN(v) || v < 1 ? 1 : v;
}

private wireEditorInSec(sec: HTMLElement): void {
    if (!this._editingType) { return; }
    const { draft } = this._editingType;
    if (typeDefKind(draft) === 'bitfield') { this.wireBitFieldDefEditor(sec, draft); return; }
    if (typeDefKind(draft) === 'enum') { this.wireEnumDefEditor(sec, draft); return; }
    this.wireTypeEditor(sec, draft);
}

private wireBitFieldDefEditor(sec: HTMLElement, draft: TypeDef): void {
    this.wireEditorTabs(sec);
    this.wireBitFieldDefChildRows(sec, draft);

    sec.querySelector<HTMLSelectElement>('#oe-base-type')?.addEventListener('change', () => {
        this.syncBitFieldDefDraft(sec, draft);
        this.refreshEditorPreview(sec, draft);
        this.refreshBitFieldDefAddButton(sec, draft);
    });
    sec.querySelector('#oe-bf-def-add')?.addEventListener('click', () => {
        this.syncBitFieldDefDraft(sec, draft);
        if (!draft.bitFields) { draft.bitFields = []; }
        draft.bitFields.push({ name: `bit${draft.bitFields.length}`, bitWidth: 1 });
        this.refreshBitFieldDefRows(sec, draft);
    });
    this.wireEditorNameInput(sec, draft);
    this.wireEditorSaveCancel(sec, draft);
}

private wireEnumDefEditor(sec: HTMLElement, draft: TypeDef): void {
    this.wireEditorTabs(sec);
    this.wireEnumDefEntryRows(sec, draft);

    sec.querySelector<HTMLSelectElement>('#oe-enum-base-type')?.addEventListener('change', () => {
        this.syncEnumDefDraft(sec, draft);
        this.refreshEditorPreview(sec, draft);
    });
    sec.querySelector('#oe-enum-add')?.addEventListener('click', () => {
        this.syncEnumDefDraft(sec, draft);
        if (!draft.entries) { draft.entries = []; }
        draft.entries.push({ name: `VALUE${draft.entries.length}`, value: draft.entries.length });
        this.refreshEnumDefRows(sec, draft);
    });
    this.wireEditorNameInput(sec, draft);
    this.wireEditorSaveCancel(sec, draft);
}

private wireTypeEditor(sec: HTMLElement, draft: TypeDef): void {
    const packedBtn = sec.querySelector<HTMLButtonElement>('#oe-packed')!;
    packedBtn.addEventListener('click', () => {
        const nowPacked = !packedBtn.classList.contains('active');
        packedBtn.classList.toggle('active', nowPacked);
        draft.packed = nowPacked;
        this.refreshEditorPreview(sec, draft);
    });

    // Row-level controls are wired by wireFieldRows (also re-run after each
    // incremental #oe-fields rebuild). The type-level controls below are
    // mounted once and kept across those rebuilds.
    this.wireFieldRows(sec.querySelector<HTMLElement>('#oe-fields')!, sec, draft);
    this.wireParamRows(sec, draft);

    this.wireEditorTabs(sec);

    sec.querySelector('#oe-add')!.addEventListener('click', () => {
        this.syncEditorDraft(sec, draft);
        this._editorError = null;
        const lastIdx = draft.fields.length;
        draft.fields.push({ name: `field${lastIdx}`, type: 'uint8', count: 1 });
        this.refreshFieldRows(sec, draft);
        this.scrollEditorRowIntoView(sec, lastIdx);
        sec.querySelectorAll<HTMLInputElement>('.field-row .ofe-name-inp')[lastIdx]?.focus();
    });

    // Type-level endian change: sync the draft, refresh per-field "Auto"
    // tooltips in place (no rebuild — the pane keeps its height/scroll), and
    // re-render the preview.
    this.wireTypeLevelOverrideSelects(sec);
    this.wireEditorNameInput(sec, draft);
    this.wireEditorSaveCancel(sec, draft);
}

private wireTypeLevelOverrideSelects(sec: HTMLElement): void {
    sec.querySelector<HTMLSelectElement>('#oe-endian')?.addEventListener('change', () => {
        if (!this._editingType) { return; }
        const { draft } = this._editingType;
        this.syncEditorDraft(sec, draft);
        this.updateEditorOverrideTitles(sec);
        this.refreshEditorPreview(sec, draft);
    });
}

private wireEditorNameInput(sec: HTMLElement, draft: TypeDef): void {
    sec.querySelector<HTMLInputElement>('#oe-name')!.addEventListener('input', () => {
        this.refreshEditorPreview(sec, draft);
    });
    sec.querySelector<HTMLInputElement>('#oe-name')!.addEventListener('blur', e => {
        const inp = e.target as HTMLInputElement;
        const clean = this.sanitizeCIdent(inp.value);
        if (clean !== inp.value) { inp.value = clean; }
        this.refreshEditorPreview(sec, draft);
    });
}

private wireEditorSaveCancel(sec: HTMLElement, draft: TypeDef): void {
    sec.querySelector('#oe-save')!.addEventListener('click', () => {
        this.saveEditorDraft(sec, draft);
    });
    sec.querySelector('#oe-cancel')!.addEventListener('click', () => {
        this._editorError = null;
        this._editingType = null;
        this.render();
    });
}

/** Edit/Preview tab switch: attribute-only toggling (no re-render), so the draft and the section-body scroll keep their state when switching views. */
private wireEditorTabs(sec: HTMLElement): void {
    const tabButtons = sec.querySelectorAll<HTMLButtonElement>('.oe-tab');
    const setEditorView = (view: string): void => {
        tabButtons.forEach(btn => {
            const on = btn.dataset.oeView === view;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', String(on));
        });
        sec.querySelectorAll<HTMLElement>('.oe-view').forEach(pane => {
            pane.hidden = pane.dataset.oeView !== view;
        });
    };
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => { setEditorView(btn.dataset.oeView!); });
        btn.addEventListener('keydown', ev => {
            if (this.tabNavKey(ev.key)) {
                ev.preventDefault();
                const list = Array.from(tabButtons);
                const next = list[this.nextTabIndex(list, btn, ev.key)]!;
                next.focus();
                setEditorView(next.dataset.oeView!);
            } else if (this.tabActivateKey(ev.key)) {
                ev.preventDefault();
                setEditorView(btn.dataset.oeView!);
            }
        });
    });
}

private saveEditorDraft(sec: HTMLElement, draft: TypeDef): void {
    if (typeDefKind(draft) === 'bitfield') {
        this.syncBitFieldDefDraft(sec, draft);
        this.commitEditorDraft(this.bitFieldDraftToTypeDef(sec, draft));
        return;
    }
    if (typeDefKind(draft) === 'enum') {
        this.syncEnumDefDraft(sec, draft);
        this.commitEditorDraft(this.enumDraftToTypeDef(sec, draft));
        return;
    }
    this.syncEditorDraft(sec, draft);
    if (draft.fields.length === 0) { return; }
    this.commitEditorDraft(this.editorDraftToTypeDef(sec, draft));
}

private commitEditorDraft(def: TypeDef): void {
    const validationErrors = validateTypes(this.upsertTypeList(this._types, def), MAX_NESTED_DEPTH);
    if (validationErrors.length > 0) {
        this._editorError = validationErrors[0];
        this.render();
        return;
    }

    this._editorError = null;
    this._types = this.upsertTypeList(this._types, def);
    this.cb.onTypesChange?.(this._types);
    this.closeEditorAfterSave();
    this.render();
}

private editorDraftToTypeDef(sec: HTMLElement, draft: TypeDef): TypeDef {
    const def: TypeDef = {
        id: draft.id,
        name: this.readEditorTypeName(sec, draft.id),
        packed: draft.packed ?? false,
        endian: draft.endian,
        allocation: draft.allocation,
        fields: draft.fields.map((field, idx) => this.withSavedFieldName(field, idx, draft.fields)),
    };
    if (draft.params && draft.params.length > 0) {
        def.params = draft.params.map(param => ({ ...param }));
    }
    return def;
}

private readEditorTypeName(sec: HTMLElement, draftId: string): string {
    const nameInp = sec.querySelector<HTMLInputElement>('#oe-name')!;
    const name = this.sanitizeCIdent(nameInp.value.trim());
    return name || this.nextTypeName(draftId);
}

private nextTypeName(draftId: string): string {
    const otherNames = new Set(this._types.filter(d => d.id !== draftId).map(d => d.name));
    let candidate = 'MyType';
    let n = 1;
    while (otherNames.has(candidate)) { candidate = `MyType${n++}`; }
    return candidate;
}

private withSavedFieldName(field: TypeField, idx: number, fields: TypeField[]): TypeField {
    if (field.name) { return { ...field }; }
    const takenNames = new Set(fields.map(f => f.name).filter(Boolean));
    let candidate = `field${idx}`;
    let n = 0;
    while (takenNames.has(candidate)) { candidate = `field${idx}_${n++}`; }
    return { ...field, name: candidate };
}

private upsertTypeList(types: TypeDef[], def: TypeDef): TypeDef[] {
    const idx = types.findIndex(d => d.id === def.id);
    if (idx < 0) { return [...types, def]; }
    const clone = [...types];
    clone[idx] = def;
    return clone;
}

    private closeEditorAfterSave(): void {
        this._editingType = null;
    }

private handleFieldTypeChange(sec: HTMLElement, draft: TypeDef, sel: HTMLSelectElement): void {
    const row = sel.closest<HTMLElement>('.field-row');
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
private syncFieldAllocCell(sec: HTMLElement, draft: TypeDef, row: HTMLElement, isBitFieldRef: boolean): void {
    const sel = row.querySelector<HTMLSelectElement>('.ofe-alloc-sel');
    const placeholder = row.querySelector<HTMLElement>('.ofe-alloc-placeholder');
    if (shouldInsertAllocSelect(isBitFieldRef, sel, placeholder)) {
        this.insertAllocSelect(sec, draft, row, placeholder);
    } else if (shouldRemoveAllocSelect(isBitFieldRef, sel)) {
        sel.outerHTML = '<span class="ofe-alloc-placeholder"></span>';
    }
}

/** Insert + live-wire the alloc override select into a bit-field-reference row. */
private insertAllocSelect(sec: HTMLElement, draft: TypeDef, row: HTMLElement, placeholder: HTMLElement | null): void {
    if (!placeholder) { return; }
    placeholder.outerHTML = this.overrideSelectHtml(undefined, 'allocation', 'ofe-alloc-sel', undefined, this.editorInheritedAlloc());
    const inserted = row.querySelector<HTMLSelectElement>('.ofe-alloc-sel');
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
    return row.dataset.ptr === '1' || (row.querySelector('.ofe-type-sel') as HTMLSelectElement).value === 'void';
}

    private cannotPointTo(field: TypeField, want: boolean): boolean {
        return want && this.isPointerBlocked(field);
    }

    private setFieldPointerFlag(field: TypeField, row: HTMLElement, want: boolean): void {
        field.isPointer = want ? true : undefined;
        row.dataset.ptr = want ? '1' : '';
    }

    private toggleFieldPointer(sec: HTMLElement, draft: TypeDef, row: HTMLElement, want: boolean): void {
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

    private fieldPointerMenuItems(row: HTMLElement, field: TypeField): string {
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

    private onFieldMenuCommand(sec: HTMLElement, draft: TypeDef, row: HTMLElement, cmd: string): void {
        if (cmd === 'field-ptr-on' || cmd === 'field-ptr-off') {
            this.toggleFieldPointer(sec, draft, row, cmd === 'field-ptr-on');
        }
    }

    /** Per-field pointer context menu (right-click / Shift+F10 / focus+Enter) — secondary path alongside the * row button. */
    private showEditorFieldPointerMenu(sec: HTMLElement, draft: TypeDef, row: HTMLElement, ev: Event): void {
        this.syncEditorDraft(sec, draft);
        const field = draft.fields[parseInt(row.dataset.idx!)];
        if (!field) { return; }
        const items = this.fieldPointerMenuItems(row, field);
        this.showFieldMenu(items, this.fieldMenuX(ev, row), this.fieldMenuY(ev, row), cmd => {
            this.onFieldMenuCommand(sec, draft, row, cmd);
        });
    }

private prepareOverlayPanelState(): void {
    this._applyTypeId = this.nextApplyTypeId(this.pinnableTypes());
}

private nextApplyTypeId(all: TypeDef[]): string | null {
    const fallbackId = all.length > 0 ? all[0].id : null;
    if (!this._applyTypeId) { return fallbackId; }
    return all.some(d => d.id === this._applyTypeId) ? this._applyTypeId : fallbackId;
}

private typeRowsHtml(all: TypeDef[]): string {
    if (all.length === 0) { return `<div class="sb-empty">No types defined yet.</div>`; }
    const visible = this.visibleTypeDefs(all);
    if (visible.length === 0) { return `<div class="sb-empty">No types match.</div>`; }
    return visible.map(def => this.typeRowHtml(def, all)).join('');
}

/** Kind filter → name substring (case-insensitive, trimmed) → kind-grouped name sort. */
private visibleTypeDefs(all: readonly TypeDef[]): TypeDef[] {
    const name = this._typeFilter.trim().toLowerCase();
    const filtered = all.filter(def =>
        (this._typeKindFilter === 'all' || typeDefKind(def) === this._typeKindFilter) &&
        (name === '' || def.name.toLowerCase().includes(name)),
    );
    return sortTypeDefs(filtered);
}

private typeRowHtml(def: TypeDef, all: readonly TypeDef[]): string {
    const kind = typeDefKind(def);
    const meta = kind === 'bitfield'
        ? this.bitFieldDefMeta(def)
        : kind === 'enum'
            ? this.enumDefMeta(def)
            : this.typeDefMeta(def, all);
    const badge = `<span class="od-kind od-kind-${kind}">${typeKindLabel(kind)}</span>`;
    return (
        `<div class="od-row" title="${esc(def.name)} \u2014 ${esc(meta)}">` +
        badge +
        `<span class="od-name" title="${esc(def.name)}">${esc(def.name)}</span>` +
        `<span class="od-meta" title="${esc(meta)}">${esc(meta)}</span>` +
        actionBtnsHtml(`data-type-id="${esc(def.id)}"`, `data-type-id="${esc(def.id)}"`) +
        `</div>`
    );
}

private typeDefMeta(def: TypeDef, all: readonly TypeDef[]): string {
    const fieldCount = def.fields.length;
    return `${fieldCount} field${fieldCount !== 1 ? 's' : ''} \u00b7 ${typeByteSize(def, all)} B`;
}

private bitFieldDefMeta(def: TypeDef): string {
    const used = (def.bitFields ?? []).reduce((sum, child) => sum + child.bitWidth, 0);
    const total = fieldByteSize(def.baseType ?? 'uint8') * 8;
    return `${def.baseType ?? 'uint8'} \u00b7 ${used}/${total} bits`;
}

private enumDefMeta(def: TypeDef): string {
    const entryCount = (def.entries ?? []).length;
    return `${def.baseType ?? 'uint8'} \u00b7 ${entryCount} entr${entryCount !== 1 ? 'ies' : 'y'}`;
}

private addInstanceFormHtml(all: TypeDef[]): string {
    const pin = this.editingTypeInstance();
    return (
        `<div id="oi-add-form" class="oi-add-form">` +
        `<div class="oa-form-hdr ${pinFormClass(pin)}">${pinFormHeader(pin)}</div>` +
        `<div class="oa-row">` +
        `<input id="oa-name" class="oa-name-inp sb-input" type="text" maxlength="40" ` +
               `placeholder="instance name" spellcheck="false" autocomplete="off" value="${esc(pin?.name ?? '')}">` +
        `</div>` +
        this.addInstanceAddressSourceHtml(pin) +
        this.addInstanceTypeRowHtml(all) +
        this.addInstanceParamsHtml(this.selectedApplyDef()) +
        `<div id="oa-source-error" class="oe-error" hidden></div>` +
        `<div id="oa-param-error" class="oe-error" hidden></div>` +
        `<div class="oa-row oa-btn-row">` +
        `<button id="oa-confirm" class="sb-btn sb-btn-primary"${this.saConfirmDisabledAttr()}>${pinFormConfirmLabel(pin)}</button>` +
        `<button id="oa-cancel" class="sb-btn sb-btn-secondary">Cancel</button>` +
        `</div>` +
        `</div>`
    );
}

private editingTypeInstance(): TypeInstance | null {
    if (!this._editingPinId) { return null; }
    return this._pins.find(p => p.id === this._editingPinId) ?? null;
}

private pinFormAddress(pin: TypeInstance | null): string {
    if (pin) { return pin.addr.toString(16).toUpperCase().padStart(8, '0'); }
    return this._activeTypeAddr !== null
        ? this._activeTypeAddr.toString(16).toUpperCase().padStart(8, '0')
        : '';
}

/** Fixed-address input plus the Fixed address / From script source selector. */
private addInstanceAddressSourceHtml(pin: TypeInstance | null): string {
    const fromScript = this._pinSourceDraft.mode === 'script';
    const locked = Boolean(pin?.pointerSources?.length);
    return (
        this.addressSourceSelectHtml(fromScript, locked) +
        this.addressFixedRowHtml(pin, fromScript) +
        this.addressScriptRowHtml(fromScript) +
        this.addressEmptyActionsHtml(fromScript, this.addressScripts().length === 0) +
        this.scriptUntrustedHintHtml()
    );
}

private addressSourceSelectHtml(fromScript: boolean, locked: boolean): string {
    return (
        `<div class="oa-row oa-src-row">` +
        `<select id="oa-addr-source" class="sb-select" aria-label="Address source"${lockedTitleAttr(locked)}>` +
        sourceOptionHtml('fixed', 'Fixed address', !fromScript, false) +
        sourceOptionHtml('script', 'From script', fromScript, locked) +
        `</select>` +
        `</div>`
    );
}

private addressFixedRowHtml(pin: TypeInstance | null, fromScript: boolean): string {
    return (
        `<div class="oa-row oa-addr-row"${fromScript ? ' hidden' : ''}>` +
        `<span class="addr-pfx">0x</span>` +
        `<input id="oa-addr" class="sb-input oa-addr-inp" type="text" maxlength="8" ` +
               `placeholder="08000000" autocomplete="off" spellcheck="false" value="${esc(this.pinFormAddress(pin))}">` +
        `</div>`
    );
}

private addressScriptRowHtml(fromScript: boolean): string {
    return (
        `<div class="oa-row oa-script-row"${fromScript ? '' : ' hidden'}>` +
        `<select id="oa-script-sel" class="sb-select oa-script-sel" aria-label="Address script">` +
               `${this.addressScriptOptionsHtml(this._pinSourceDraft.scriptPath)}</select>` +
        `<button type="button" id="oa-script-open" class="sb-btn sb-btn-secondary oa-script-open"` +
               `${this._pinSourceDraft.scriptPath ? '' : ' disabled'}>Open</button>` +
        `</div>`
    );
}

private scriptUntrustedHintHtml(): string {
    return (
        `<div id="oa-script-untrusted" class="oa-hint"${this._scriptsTrusted ? ' hidden' : ''}>` +
        `Workspace not trusted \u2014 scripts cannot run.</div>`
    );
}

/** Empty address picker: a real create action and the folder reveal. */
private addressEmptyActionsHtml(fromScript: boolean, empty: boolean): string {
    if (!empty) { return ''; }
    return (
        `<div class="oa-row oa-script-empty-row"${fromScript ? '' : ' hidden'}>` +
        `<button type="button" class="sb-btn sb-btn-add oa-create-script" data-create-script="address" title="Create an instance address script" aria-label="Create an instance address script">\uff0b Add</button>` +
        `<button type="button" class="sb-btn sb-btn-secondary oa-open-scripts-folder" data-open-scripts-folder>Open scripts folder</button>` +
        `</div>`
    );
}

private addressScripts(): ScriptOption[] {
    return roleScriptOptions(this._scripts, 'address');
}

private addressScriptOptionsHtml(selected: string): string {
    return scriptOptionsHtml(this.addressScripts(), selected, 'No @script address scripts');
}

/** Form's current script selection: draft value, else the mounted select's value. */
private selectedAddressScript(): string {
    const fromDom = this._root?.querySelector<HTMLSelectElement>('#oa-script-sel')?.value ?? '';
    return (fromDom || this._pinSourceDraft.scriptPath).trim();
}

/** Refresh only the picker options after `scriptInfo` arrives (keeps form input). */
private refreshSourceScriptSelect(): void {
    const sel = this._root?.querySelector<HTMLSelectElement>('#oa-script-sel');
    if (sel) {
        sel.innerHTML = this.addressScriptOptionsHtml(this._pinSourceDraft.scriptPath);
        this.syncScriptOpenButton();
    }
    this._root?.querySelectorAll<HTMLSelectElement>('.oa-param-script').forEach(paramSel => {
        const name = paramSel.closest<HTMLElement>('.oa-param-row')?.dataset.paramName ?? '';
        const selected = this._pinParamSourceDrafts.get(name)?.scriptPath || paramSel.value;
        paramSel.innerHTML = this.sizeScriptOptionsHtml(selected);
    });
    this.syncParamOpenButtons();
    this.refreshScriptEmptyRows();
    const untrusted = this._root?.querySelector<HTMLElement>('#oa-script-untrusted');
    if (untrusted) { untrusted.hidden = this._scriptsTrusted; }
}

/** Empty-picker rows follow the pushed script list (create/open-folder affordances). */
private refreshScriptEmptyRows(): void {
    const addressRow = this._root?.querySelector<HTMLElement>('.oa-script-empty-row');
    if (addressRow) {
        addressRow.hidden = this._pinSourceDraft.mode !== 'script' || this.addressScripts().length > 0;
    }
    const paramsRow = this._root?.querySelector<HTMLElement>('.oa-params-empty-row');
    if (paramsRow) { paramsRow.hidden = this.sizeScripts().length > 0; }
}

private syncParamOpenButtons(): void {
    this._root?.querySelectorAll<HTMLButtonElement>('.oa-param-row .oa-param-open').forEach(open => {
        const name = open.closest<HTMLElement>('.oa-param-row')?.dataset.paramName ?? '';
        open.disabled = !this.selectedParamScript(name);
    });
}

private syncScriptOpenButton(): void {
    const open = this._root?.querySelector<HTMLButtonElement>('#oa-script-open');
    if (open) { open.disabled = !this.selectedAddressScript(); }
}

private instanceConfirmDisabled(): boolean {
    if (!this.selectedApplyTypeId()) { return true; }
    if (this._pinSourceDraft.mode === 'script') { return !this.selectedAddressScript(); }
    return this.paramSourcesPendingSelection() || this.addressInputEmpty();
}

private addressInputEmpty(): boolean {
    const addrInput = this.pendingAddrInput();
    if (addrInput) { return addrInput.value.trim().length === 0; }
    return this.pinFormAddress(this.editingTypeInstance()).length === 0;
}

/** True when a parameter row is in script mode without a selected script. */
private paramSourcesPendingSelection(): boolean {
    const rows = Array.from(this._root?.querySelectorAll<HTMLElement>('#oa-params .oa-param-row') ?? []);
    return rows.some(row => this.paramRowPendingSelection(row));
}

private paramRowPendingSelection(row: HTMLElement): boolean {
    if (row.querySelector<HTMLSelectElement>('.oa-param-source')?.value !== 'script') { return false; }
    return !this.selectedParamScript(row.dataset.paramName ?? '');
}

private refreshInstanceConfirmState(): void {
    const btn = this._root?.querySelector<HTMLButtonElement>('#oa-confirm');
    if (btn) { btn.disabled = this.instanceConfirmDisabled(); }
}

private saConfirmDisabledAttr(): string {
    return this.instanceConfirmDisabled() ? ' disabled' : '';
}

private addInstanceTypeRowHtml(all: TypeDef[]): string {
    const selectedId = this.selectedApplyTypeId();
    const typeOpts = all.map(d =>
        `<option value="${esc(d.id)}"${d.id === selectedId ? ' selected' : ''}>${esc(d.name)}</option>`
    ).join('');
    const applyDef = all.find(d => d.id === selectedId);
    const previewHtml = applyDef
        ? `<pre class="oi-c-preview" data-preview-id="${esc(applyDef.id)}"></pre>`
        : '';
    return (
        `<div class="oa-row">` +
        `<select id="oa-type-sel" class="sb-select">${typeOpts}</select>` +
        `</div>` +
        previewHtml
    );
}

private selectedApplyTypeId(): string | null {
    if (!this._editingPinId) { return this._applyTypeId; }
    return this._editingPinDraftTypeId ?? this.editingPinTypeId() ?? null;
}

private selectedApplyDef(): TypeDef | undefined {
    const id = this.selectedApplyTypeId();
    return id ? allTypes(this._types).find(d => d.id === id) : undefined;
}

/** One input per declared size parameter, pre-filled from the instance/defaults. */
private addInstanceParamsHtml(def: TypeDef | undefined): string {
    const params = def?.params ?? [];
    if (params.length === 0) { return ''; }
    const pin = this.editingTypeInstance();
    const rows = params.map(param => this.paramFormRowHtml(param, def, pin)).join('');
    return `<div id="oa-params" class="oa-params"><div class="oa-params-hdr">Parameters</div>${rows}${this.sizeEmptyActionsHtml()}</div>`;
}

/** One parameter row of the add/edit instance form. */
private paramFormRowHtml(param: TypeParam, def: TypeDef | undefined, pin: TypeInstance | null): string {
    const draft = this.paramSourceDraft(param.name, this.pinParamSource(pin, def, param.name));
    const fromScript = draft.mode === 'script';
    return (
        `<div class="oa-param-row" data-param-name="${esc(param.name)}">` +
        `<span class="oa-param-lbl">${esc(param.name)}</span>` +
        this.paramSourceSelectHtml(param, fromScript) +
        this.paramValueInputHtml(param, this.paramFormValue(pin, def, param), fromScript) +
        this.paramScriptSelectHtml(param, draft, fromScript) +
        `</div>`
    );
}

/** Whether the edited instance belongs to the selected type (its values seed the form). */
private pinBoundToType(pin: TypeInstance | null, def: TypeDef | undefined): boolean {
    return Boolean(pin && def && pin.typeId === def.id);
}

private pinParamSource(pin: TypeInstance | null, def: TypeDef | undefined, name: string): TypeInstanceParamSource | undefined {
    return this.pinBoundToType(pin, def) ? pin?.paramSources?.[name] : undefined;
}

private paramFormValue(pin: TypeInstance | null, def: TypeDef | undefined, param: TypeParam): number | undefined {
    const value = this.pinBoundToType(pin, def) ? pin?.paramValues?.[param.name] : undefined;
    return value !== undefined ? value : param.default;
}

private paramSourceSelectHtml(param: TypeParam, fromScript: boolean): string {
    return (
        `<select class="oa-param-source sb-select" aria-label="Parameter ${esc(param.name)} source">` +
        `<option value="manual"${fromScript ? '' : ' selected'}>Manual</option>` +
        `<option value="script"${fromScript ? ' selected' : ''}>From script</option>` +
        `</select>`
    );
}

private paramValueInputHtml(param: TypeParam, initial: number | undefined, fromScript: boolean): string {
    return (
        `<input class="oa-param-inp sb-input sb-input-sm" type="text" inputmode="numeric" ` +
               `value="${initial !== undefined ? initial : ''}" placeholder="N" ` +
               `aria-label="Parameter ${esc(param.name)} value"${fromScript ? ' hidden' : ''}>`
    );
}

private paramScriptSelectHtml(param: TypeParam, draft: PinParamSourceDraft, fromScript: boolean): string {
    return (
        `<select class="oa-param-script sb-select" aria-label="Parameter ${esc(param.name)} size script"${fromScript ? '' : ' hidden'}>` +
               `${this.sizeScriptOptionsHtml(draft.scriptPath)}</select>` +
        `<button type="button" class="oa-param-open sb-btn sb-btn-secondary"` +
               `${draft.scriptPath ? '' : ' disabled'} title="Open size script" aria-label="Open size script"${fromScript ? '' : ' hidden'}>Open</button>`
    );
}

/** Empty size picker (no `@script size` scripts): create action + folder reveal. */
private sizeEmptyActionsHtml(): string {
    if (this.sizeScripts().length > 0) { return ''; }
    return (
        `<div class="oa-row oa-params-empty-row">` +
        `<button type="button" class="sb-btn sb-btn-add oa-create-script" data-create-script="size" title="Create an array size script" aria-label="Create an array size script">\uff0b Add</button>` +
        `<button type="button" class="sb-btn sb-btn-secondary oa-open-scripts-folder" data-open-scripts-folder>Open scripts folder</button>` +
        `</div>`
    );
}

/** Form draft for one parameter: explicit draft, else the edited instance's source, else manual. */
private paramSourceDraft(name: string, source: TypeInstanceParamSource | undefined): PinParamSourceDraft {
    const draft = this._pinParamSourceDrafts.get(name);
    if (draft) { return draft; }
    return source
        ? { mode: 'script', scriptPath: source.scriptPath }
        : { mode: 'manual', scriptPath: '' };
}

/** Scripts tagged `@script size` (filtered source picker). */
private sizeScripts(): ScriptOption[] {
    return roleScriptOptions(this._scripts, 'size');
}

private sizeScriptOptionsHtml(selected: string): string {
    return scriptOptionsHtml(this.sizeScripts(), selected, 'No @script size scripts');
}

/** Current source script selection for one parameter (DOM wins over the draft). */
private selectedParamScript(name: string): string {
    const fromDom = this.paramScriptSelectValue(name);
    return (fromDom || this._pinParamSourceDrafts.get(name)?.scriptPath || '').trim();
}

private paramScriptSelectValue(name: string): string {
    return this._root?.querySelector<HTMLSelectElement>(
        `.oa-param-row[data-param-name="${cssEscapeAttr(name)}"] .oa-param-script`,
    )?.value ?? '';
}

/** Read + validate the instance form's parameter values and sources. */
private readInstanceParamConfig(def: TypeDef): {
    values: Record<string, number>;
    sources: Record<string, { scriptPath: string }>;
    errors: string[];
} {
    const values: Record<string, number> = {};
    const sources: Record<string, { scriptPath: string }> = {};
    const errors: string[] = [];
    for (const row of this.paramConfigRows()) {
        const error = this.readParamConfigRow(row, values, sources);
        if (error) { errors.push(error); }
    }
    return {
        values,
        sources,
        errors: [...new Set([...errors, ...validateInstanceParamConfig(def, values, sources)])],
    };
}

private paramConfigRows(): HTMLElement[] {
    return Array.from(this._root?.querySelectorAll<HTMLElement>('#oa-params .oa-param-row') ?? []);
}

/** Read one form row into `values`/`sources`; returns its error message when invalid. */
private readParamConfigRow(
    row: HTMLElement,
    values: Record<string, number>,
    sources: Record<string, { scriptPath: string }>,
): string | undefined {
    const name = row.dataset.paramName ?? '';
    const isScript = row.querySelector<HTMLSelectElement>('.oa-param-source')?.value === 'script';
    return isScript
        ? this.readParamScriptRow(name, sources)
        : this.readParamValueRow(row, name, values);
}

private readParamScriptRow(name: string, sources: Record<string, { scriptPath: string }>): string | undefined {
    const scriptPath = this.selectedParamScript(name);
    if (!scriptPath) { return `Parameter "${name}": select a size script.`; }
    sources[name] = { scriptPath };
    return undefined;
}

private readParamValueRow(row: HTMLElement, name: string, values: Record<string, number>): string | undefined {
    const raw = this.paramRowValue(row);
    if (raw === '') { return undefined; }
    return storeParamValue(raw, name, values);
}

private paramRowValue(row: HTMLElement): string {
    return row.querySelector<HTMLInputElement>('.oa-param-inp')?.value.trim() ?? '';
}

private showInstanceParamError(message: string | null): void {
    const el = this._root?.querySelector<HTMLElement>('#oa-param-error');
    if (!el) { return; }
    el.textContent = message ?? '';
    el.hidden = !message;
}

private showInstanceSourceError(message: string | null): void {
    const el = this._root?.querySelector<HTMLElement>('#oa-source-error');
    if (!el) { return; }
    el.textContent = message ?? '';
    el.hidden = !message;
}

private editingPinTypeId(): string | null {
    const pin = this._pins.find(p => p.id === this._editingPinId);
    return pin?.typeId ?? null;
}

private instanceCardsHtml(): string {
    if (this._pins.length > 0) {
        return this._pins.map((pin, i) => this.buildInstanceCard(pin, i)).join('');
    }
    const msg = this.pinnableTypes().length === 0
        ? 'Define a type first.'
        : 'No instances yet. Click [\uff0b Add] to create one.';
    return `<div class="sb-empty">${msg}</div>`;
}

private instancesBodyHtml(addFormHtml: string, instHtml: string): string {
    if (addFormHtml) { return addFormHtml; }
    return (
        `<div class="oi-hdr-row">` +
        this.bitLayoutToggleHtml() +
        this.showHiddenToggleHtml() +
        this.addressRefreshHtml() +
        `</div>` +
        `<div id="oi-list">${instHtml}</div>`
    );
}

/** Panel-level action: re-run every script-sourced instance address. */
private addressRefreshHtml(): string {
    const enabled = this.hasDynamicInstances();
    const title = enabled ? 'Resolve script instance addresses and sizes' : 'No script-sourced instances';
    return (
        `<div class="oi-toggle-group" title="${title}">` +
        `<div class="compact-tabs">` +
        `<button type="button" id="oi-refresh-addrs-btn" class="oi-refresh-addrs-btn" ` +
               `title="${title}" aria-label="${title}"${enabled ? '' : ' disabled'}>Refresh addresses</button>` +
        `</div>` +
        `</div>`
    );
}

private bitLayoutToggleHtml(): string {
    return (
        `<div class="oi-toggle-group" title="Bit-field allocation: which side receives the first declared bit field">` +
        `<div class="compact-tabs oa-bit-order-tabs">` +
        `<button id="oa-btn-bit-lsb" class="${this._bitFieldAllocation === 'lsb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the least significant bit">LSB</button>` +
        `<button id="oa-btn-bit-msb" class="${this._bitFieldAllocation === 'msb' ? 'active' : ''}" title="Bit-field allocation: first declared bit field starts at the most significant bit">MSB</button>` +
        `</div>` +
        `</div>`
    );
}

/** Global "show hidden fields" toggle (Instances header). Off = hidden fields omitted. */
private showHiddenToggleHtml(): string {
    const on = this._showHiddenFields;
    const title = 'Show fields marked hidden in the Types editor';
    return (
        `<div class="oi-toggle-group" title="${title}">` +
        `<div class="compact-tabs">` +
        `<button type="button" id="oi-show-hidden-btn" class="oi-show-hidden-btn${on ? ' active' : ''}" ` +
               `title="${title}" aria-label="${title}" aria-pressed="${on ? 'true' : 'false'}">Show hidden</button>` +
        `</div>` +
        `</div>`
    );
}

    private typePanelTitle(): string {
        if (this._choosingKind) { return 'New Type'; }
        if (!this._editingType) { return 'Types'; }
        return this._editingType.existing ? 'Edit Type' : 'New Type';
    }

    private typePanelBodyHtml(typeRows: string): string {
        if (this._choosingKind) { return this.kindChooserHtml(); }
        if (this._editingType) { return this.editorHtml(this._editingType.draft, this._editingType.existing); }
        return (
            this.typeListToolsHtml() +
            `<div id="om-list">${typeRows}</div>`
        );
    }

    /** Compact filter bar above the type list: name search + kind filter (transient view state). */
    private typeListToolsHtml(): string {
        const kindOptions = (['all', 'struct', 'bitfield', 'enum'] as const)
            .map(kind => {
                const label = kind === 'all' ? 'All' : typeKindLabel(kind);
                return `<option value="${kind}"${this._typeKindFilter === kind ? ' selected' : ''}>${label}</option>`;
            })
            .join('');
        return (
            `<div class="od-tools">` +
            `<input id="om-filter" class="od-filter sb-input sb-input-sm" type="search" ` +
                   `placeholder="Filter types" aria-label="Filter types by name" ` +
                   `spellcheck="false" autocomplete="off" value="${esc(this._typeFilter)}">` +
            `<select id="om-kind-filter" class="od-kind-filter sb-select sb-input-sm" aria-label="Filter types by kind">${kindOptions}</select>` +
            `</div>`
        );
    }

    /** Rebuild only the type list (keeps the filter controls mounted + focused). */
    private refreshTypeList(sec: HTMLElement): void {
        const list = sec.querySelector<HTMLElement>('#om-list');
        if (!list) { return; }
        list.innerHTML = this.typeRowsHtml(allTypes(this._types));
        this.wireTypeListActions(list);
    }

    /** Three-tile kind picker shown in the Types body after the single `＋ Add` entry point. */
    private kindChooserHtml(): string {
        return (
            `<div id="om-kind-picker" class="om-kind-picker">` +
            `<div class="om-kind-hdr">Add type</div>` +
            `<div class="om-kind-tiles">` +
            this.kindTileHtml('struct', 'Struct', 'A C-like layout of named fields') +
            this.kindTileHtml('bitfield', 'Bit-field', 'A reusable unsigned storage unit split into named bits') +
            this.kindTileHtml('enum', 'Enum', 'A named set of integer values') +
            `</div>` +
            `<div class="oe-btns"><button id="om-kind-cancel" class="sb-btn sb-btn-secondary">Cancel</button></div>` +
            `</div>`
        );
    }

    private kindTileHtml(kind: TypeDefKind, label: string, hint: string): string {
        return (
            `<button class="om-kind-tile" data-kind="${kind}" title="${esc(hint)}">` +
            `<span class="om-kind-tile-name">${esc(label)}</span>` +
            `<span class="om-kind-tile-hint">${esc(hint)}</span>` +
            `</button>`
        );
    }

    private pickKind(kind: TypeDefKind): void {
        this._choosingKind = false;
        this._editorError = null;
        const id = `user_${Date.now()}`;
        this._editingType = { draft: this.newDraftForKind(kind, id), existing: null, fromManage: true };
        this.render();
    }

    private newDraftForKind(kind: TypeDefKind, id: string): TypeDef {
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
        typesPanel.querySelectorAll<HTMLElement>('.om-kind-tile').forEach(tile => {
            tile.addEventListener('click', () => {
                const kind = tile.dataset.kind;
                if (kind === 'struct' || kind === 'bitfield' || kind === 'enum') { this.pickKind(kind); }
            });
        });
        typesPanel.querySelector('#om-kind-cancel')?.addEventListener('click', () => {
            this._choosingKind = false;
            this.render();
        });
    }

private wireOverlayPanel(sec: HTMLElement): void {
    this.wireTypesPanelControls(sec);
    this.wireAddInstanceControls(sec);
    this.wireBitLayoutTabs(sec);
    this.wireShowHiddenToggle(sec);
    this.wireAddressRefresh(sec);
}

private wireAddressRefresh(sec: HTMLElement): void {
    sec.querySelector('#oi-refresh-addrs-btn')?.addEventListener('click', () => {
        this.cb.onRefreshAddresses?.();
    });
}

    private wireTypesPanelControls(sec: HTMLElement): void {
        const typesPanel = sec.querySelector<HTMLElement>('#oi-types-body')!;
        this.wireKindChooser(typesPanel);
        this.wireTypeListFilters(typesPanel);
        this.wireTypeListActions(typesPanel);
    }

    /** Filter events rebuild only `#om-list`, so the search input keeps focus and the editor is untouched. */
    private wireTypeListFilters(typesPanel: HTMLElement): void {
        typesPanel.querySelector<HTMLInputElement>('#om-filter')?.addEventListener('input', e => {
            this._typeFilter = (e.target as HTMLInputElement).value;
            this.refreshTypeList(typesPanel);
        });
        typesPanel.querySelector<HTMLSelectElement>('#om-kind-filter')?.addEventListener('change', e => {
            const value = (e.target as HTMLSelectElement).value;
            this._typeKindFilter = value === 'struct' || value === 'bitfield' || value === 'enum' ? value : 'all';
            this.refreshTypeList(typesPanel);
        });
    }

    /** Wire type-list row actions (re-applied after each list-only refresh). */
    private wireTypeListActions(typesPanel: HTMLElement): void {
        wireActionBtns(
            typesPanel,
            '.act-btn-edit',
            '.act-btn-del',
            btn => this.startEditingType(btn.dataset.typeId),
            btn => this.deleteTypeById(btn.dataset.typeId!),
        );
    }

    /** Open the type editor for an existing definition (deep-copied draft). */
    private startEditingType(typeId: string | undefined): void {
        this._editorError = null;
        const existing = this._types.find(d => d.id === typeId) ?? null;
        if (!existing) { return; }
        this._editingType = { draft: cloneTypeDefDraft(existing), existing, fromManage: true };
        this.render();
    }

    /** Delete a type and every instance that referenced it, then re-render. */
    private deleteTypeById(id: string): void {
        const next = withoutTypeDefinition(this._types, this._pins, id);
        this._types = next.types;
        this._pins = next.pins;
        this.pruneVanishedAddressResolutions();
        this.pruneParamResolutions();
        if (this._applyTypeId === id) { this._applyTypeId = null; }
        this.cb.onStateChange?.(this._types, this._pins);
        this.render();
    }

private wireAddInstanceControls(sec: HTMLElement): void {
    if (!this._addingPin && !this._editingPinId) { return; }

    sec.querySelector('#oa-type-sel')?.addEventListener('change', e => {
        const value = (e.target as HTMLSelectElement).value || null;
        if (this._editingPinId) { this._editingPinDraftTypeId = value; }
        else { this._applyTypeId = value; }
        this.preservePendingTypeAddress();
        this.render();
    });
    sec.querySelector('#oa-addr')?.addEventListener('input', () => {
        this.refreshInstanceConfirmState();
    });
    sec.querySelector('#oa-addr-source')?.addEventListener('change', e => {
        // Attribute-only toggle: a full re-render would drop unsaved name/param input.
        const mode = (e.target as HTMLSelectElement).value === 'script' ? 'script' : 'fixed';
        this._pinSourceDraft.mode = mode;
        this.applySourceModeRows(mode);
        this.fillDefaultAddressScript();
        this.syncScriptOpenButton();
        this.refreshInstanceConfirmState();
    });
    sec.querySelector('#oa-script-sel')?.addEventListener('change', e => {
        this._pinSourceDraft.scriptPath = (e.target as HTMLSelectElement).value;
        this.syncScriptOpenButton();
        this.refreshInstanceConfirmState();
    });
    sec.querySelector('#oa-script-open')?.addEventListener('click', () => {
        const scriptPath = this.selectedAddressScript();
        if (scriptPath) { this.cb.onOpenScript?.(scriptPath); }
    });
    this.wireScriptEmptyActions(sec);
    this.wireParamSourceControls(sec);
    sec.querySelector('#oa-confirm')?.addEventListener('click', () => {
        this.confirmInstance();
    });
    sec.querySelector('#oa-cancel')?.addEventListener('click', () => {
        this.resetPinFormState();
        this.render();
    });
}

/** Empty address/size picker actions: create-from-template and folder reveal. */
private wireScriptEmptyActions(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('[data-create-script]').forEach(btn => {
        btn.addEventListener('click', () => {
            const role = btn.dataset.createScript as ScriptRole | undefined;
            if (role) { this.cb.onCreateScript?.(role); }
        });
    });
    sec.querySelectorAll<HTMLElement>('[data-open-scripts-folder]').forEach(btn => {
        btn.addEventListener('click', () => this.cb.onOpenScriptsFolder?.());
    });
}

/** Attribute-only source toggle: show the row that matches the picked mode. */
private applySourceModeRows(mode: PinSourceDraft['mode']): void {
    this.hideRow('.oa-addr-row', mode === 'script');
    this.hideRow('.oa-script-row', mode !== 'script');
    this.hideRow('.oa-script-empty-row', mode !== 'script');
}

private hideRow(selector: string, hidden: boolean): void {
    const row = this._root?.querySelector<HTMLElement>(selector);
    if (row) { row.hidden = hidden; }
}

/** First switch to script mode: seed the draft from the picker's current value. */
private fillDefaultAddressScript(): void {
    if (this._pinSourceDraft.scriptPath || this._pinSourceDraft.mode !== 'script') { return; }
    this._pinSourceDraft.scriptPath = this.pickedAddressScript();
}

/** Current picker value (`''` when the select or its value is absent). */
private pickedAddressScript(): string {
    return this._root?.querySelector<HTMLSelectElement>('#oa-script-sel')?.value ?? '';
}

private wireParamSourceControls(sec: HTMLElement): void {
    sec.querySelectorAll<HTMLElement>('#oa-params .oa-param-row').forEach(row => {
        const name = row.dataset.paramName ?? '';
        row.querySelector<HTMLSelectElement>('.oa-param-source')?.addEventListener('change', e => {
            // Attribute-only toggle: a full re-render would drop unsaved input.
            this.onParamSourceChange(row, name, (e.target as HTMLSelectElement).value);
        });
        row.querySelector<HTMLSelectElement>('.oa-param-script')?.addEventListener('change', e => {
            const draft = this._pinParamSourceDrafts.get(name) ?? { mode: 'script', scriptPath: '' };
            draft.mode = 'script';
            draft.scriptPath = (e.target as HTMLSelectElement).value;
            this._pinParamSourceDrafts.set(name, draft);
            this.syncParamOpenButtons();
            this.refreshInstanceConfirmState();
        });
        row.querySelector<HTMLInputElement>('.oa-param-inp')?.addEventListener('input', () => {
            this.refreshInstanceConfirmState();
        });
        row.querySelector<HTMLButtonElement>('.oa-param-open')?.addEventListener('click', () => {
            const scriptPath = this.selectedParamScript(name);
            if (scriptPath) { this.cb.onOpenScript?.(scriptPath); }
        });
    });
}

/** Manual/script toggle for one parameter row (attribute-only, never a re-render). */
private onParamSourceChange(row: HTMLElement, name: string, rawMode: string): void {
    const mode = rawMode === 'script' ? 'script' : 'manual';
    const draft = this._pinParamSourceDrafts.get(name) ?? { mode: 'manual', scriptPath: '' };
    draft.mode = mode;
    this.seedParamScriptPath(draft, mode, row);
    this._pinParamSourceDrafts.set(name, draft);
    this.toggleParamRowMode(row, mode);
    this.syncParamOpenButtons();
    this.refreshInstanceConfirmState();
}

private seedParamScriptPath(draft: PinParamSourceDraft, mode: PinParamSourceDraft['mode'], row: HTMLElement): void {
    if (mode !== 'script' || draft.scriptPath) { return; }
    draft.scriptPath = this.paramScriptPickerValue(row);
}

private paramScriptPickerValue(row: HTMLElement): string {
    return row.querySelector<HTMLSelectElement>('.oa-param-script')?.value ?? '';
}

private toggleParamRowMode(row: HTMLElement, mode: PinParamSourceDraft['mode']): void {
    const valueInp = row.querySelector<HTMLInputElement>('.oa-param-inp');
    const scriptSel = row.querySelector<HTMLSelectElement>('.oa-param-script');
    const openBtn = row.querySelector<HTMLButtonElement>('.oa-param-open');
    if (valueInp) { valueInp.hidden = mode === 'script'; }
    if (scriptSel) { scriptSel.hidden = mode !== 'script'; }
    if (openBtn) { openBtn.hidden = mode !== 'script'; }
}

private wireBitLayoutTabs(sec: HTMLElement): void {
    sec.querySelector('#oa-btn-bit-lsb')?.addEventListener('click', () => {
        this._bitFieldAllocation = 'lsb';
        sec.querySelector('#oa-btn-bit-lsb')?.classList.add('active');
        sec.querySelector('#oa-btn-bit-msb')?.classList.remove('active');
        if (this._expanded.size > 0) { this.render(); }
        this.cb.onBitAllocationChange?.(this._bitFieldAllocation);
    });
    sec.querySelector('#oa-btn-bit-msb')?.addEventListener('click', () => {
        this._bitFieldAllocation = 'msb';
        sec.querySelector('#oa-btn-bit-msb')?.classList.add('active');
        sec.querySelector('#oa-btn-bit-lsb')?.classList.remove('active');
        if (this._expanded.size > 0) { this.render(); }
        this.cb.onBitAllocationChange?.(this._bitFieldAllocation);
    });
}

/**
 * Global "show hidden fields" toggle button. Flips the local view flag, reflects
 * the new state on the button (active + aria-pressed), reports the change so the
 * host persists it per profile, and refreshes only the instances body in place —
 * an open Types editor draft is left untouched (never reloaded).
 */
private wireShowHiddenToggle(sec: HTMLElement): void {
    const btn = sec.querySelector('#oi-show-hidden-btn');
    btn?.addEventListener('click', () => {
        const show = !this._showHiddenFields;
        this._showHiddenFields = show;
        applyShowHiddenButtonState(btn, show);
        this.cb.onShowHiddenFieldsChange?.(show);
        this.refreshInstances();
    });
}

/**
 * Re-render just the Instances *list* in place after the hidden-field
 * filter changed. The header (bit-layout tabs + `#oi-show-hidden-btn`) is left
 * untouched, so the toggle keeps focus and the section body keeps its scroll
 * position — no whole-body `innerHTML` rebuild (Types editor also untouched).
 */
private refreshInstances(): void {
    const sec = this._root;
    if (!sec || !this.sections) { return; }
    const list = sec.querySelector<HTMLElement>('#oi-list');
    if (!list) { return; }
    this.prepareOverlayPanelState();
    list.innerHTML = this.instanceCardsHtml();
    this.updateHeaderActions();
    this.hydrateTypePreviews(sec);
    this.wireInstanceCards(sec);
}

private confirmInstance(): void {
    const source = this.addressSourceDraft();
    if (!this.validateInstanceSource(source)) { return; }
    const addr = this.confirmAddress(source);
    if (addr === null) { return; }
    const params = this.readFormParams();
    if (params.errors.length > 0) {
        this.showInstanceParamError(params.errors[0]);
        return;
    }
    this.showInstanceParamError(null);
    this.commitInstance(addr, params.values, params.sources, source);
    this.resetPinFormState();
    this.render();
}

/** Address to store: the fixed input, or the last authored fallback while a script is the source. */
private confirmAddress(source: { scriptPath: string } | null): number | null {
    return source ? this.fallbackAddress(this.editingTypeInstance()) : this.applyAddress();
}

/** Address-source draft of the open form (null = fixed address). */
private addressSourceDraft(): { scriptPath: string } | null {
    return this._pinSourceDraft.mode === 'script' ? { scriptPath: this.selectedAddressScript() } : null;
}

/** Validate the form's address source; shows the source error and returns false when invalid. */
private validateInstanceSource(source: { scriptPath: string } | null): boolean {
    if (missingScriptPath(source)) {
        this.showInstanceSourceError('Select an address script.');
        return false;
    }
    const sourceError = this.sourceErrorFor(source);
    if (sourceError) {
        this.showInstanceSourceError(sourceError);
        return false;
    }
    this.showInstanceSourceError(null);
    return true;
}

private sourceErrorFor(source: { scriptPath: string } | null): string | null {
    if (!source) { return null; }
    const pointerSources = this.editingTypeInstance()?.pointerSources;
    return addressSourceError({ addressSource: source, pointerSources });
}

private readFormParams(): { values: Record<string, number>; sources: Record<string, { scriptPath: string }>; errors: string[] } {
    const def = this.selectedApplyDef();
    return def ? this.readInstanceParamConfig(def) : emptyParamConfig();
}

private commitInstance(
    addr: number,
    paramValues: Record<string, number>,
    paramSources: Record<string, { scriptPath: string }>,
    addressSource: TypeInstance['addressSource'] | null,
): void {
    if (this._editingPinId) { this.applyEditedPin(addr, paramValues, paramSources, addressSource); }
    else { this.applyNewPin(addr, paramValues, paramSources, addressSource); }
}

/** Fallback `addr` while a script is the source: keep the input when valid, else the last authored value. */
private fallbackAddress(pin: TypeInstance | null): number {
    const parsed = this.pendingAddrValue();
    if (parsed !== null) { return parsed; }
    return pin ? pin.addr : (this._activeTypeAddr ?? 0);
}

private pendingAddrValue(): number | null {
    const addrInp = this.pendingAddrInput();
    if (!addrInp) { return null; }
    const parsed = parseInt(addrInp.value.replace(/^0x/i, ''), 16);
    return isNaN(parsed) ? null : parsed;
}

private applyAddress(): number | null {
    const addrInp = this._root?.querySelector<HTMLInputElement>('#oa-addr');
    const nameInp = this._root?.querySelector<HTMLInputElement>('#oa-name');
    if (!addrInp || !nameInp || !this.selectedApplyTypeId()) { return null; }
    return this.parseApplyAddress(addrInp);
}

private applyEditedPin(
    addr: number,
    paramValues: Record<string, number>,
    paramSources: Record<string, { scriptPath: string }>,
    addressSource: TypeInstance['addressSource'] | null,
): void {
    const idx = this._pins.findIndex(p => p.id === this._editingPinId);
    const pin = this._pins[idx];
    const name = this.editedPinName(pin);
    if (idx >= 0) {
        this._pins = withEditedTypeInstance(this._pins, idx, {
            name, addr, typeId: this.selectedApplyTypeId()!, paramValues, paramSources, addressSource,
        });
        this._activeTypeAddr = addr;
        this._addressResolutions.delete(this._pins[idx].id);
        this.clearPinParamResolutions(this._pins[idx].id);
        this.cb.onPinsChange?.(this._pins);
    }
    this._editingPinId = null;
    this._editingPinDraftTypeId = null;
}

/** Drop every transient parameter resolution for one instance. */
private clearPinParamResolutions(pinId: string): void {
    for (const key of Array.from(this._paramResolutions.keys())) {
        if (parseParamResolutionKey(key)?.pinId === pinId) { this._paramResolutions.delete(key); }
    }
}

/** Reset the transient instance-form state after save/cancel. */
private resetPinFormState(): void {
    this._addingPin = false;
    this._editingPinId = null;
    this._editingPinDraftTypeId = null;
    this._pinSourceDraft = { mode: 'fixed', scriptPath: '' };
    this._pinParamSourceDrafts.clear();
}

private editedPinName(pin: TypeInstance | undefined): string {
    const raw = this.rawPinName();
    if (raw) { return raw; }
    return pin?.name || 'inst';
}

private rawPinName(): string {
    return this._root?.querySelector<HTMLInputElement>('#oa-name')?.value.trim() ?? '';
}

private applyNewPin(
    addr: number,
    paramValues: Record<string, number>,
    paramSources: Record<string, { scriptPath: string }>,
    addressSource: TypeInstance['addressSource'] | null,
): void {
    const name = this.applyName(this._root!.querySelector<HTMLInputElement>('#oa-name')!);
    const pin = makeTypeInstance({
        typeId: this.selectedApplyTypeId()!, addr, name, paramValues, paramSources,
        ...(addressSource ? { addressSource } : {}),
    }, this.makePinId);
    this._pins = [...this._pins, pin];
    this._activeTypeAddr = addr;
    this._expanded.add(pin.id);
    this._addingPin = false;
    this.cb.onPinsChange?.(this._pins);
}

private parseApplyAddress(addrInp: HTMLInputElement): number | null {
    const addr = parseInt(addrInp.value.replace(/^0x/i, ''), 16);
    if (!isNaN(addr)) {
        addrInp.style.borderColor = '';
        return addr;
    }
    addrInp.style.borderColor = 'var(--err)';
    return null;
}

private applyName(nameInp: HTMLInputElement): string {
    const name = nameInp.value.trim();
    return name || this.nextApplyName();
}

private nextApplyName(): string {
    const applyDef = this._types.find(d => d.id === this._applyTypeId);
    const base = applyDef ? applyDef.name : 'inst';
    return this.uniqueTypeInstanceName(`${base}_0`, n => `${base}_${n}`);
}

private uniqueTypeInstanceName(initialName: string, nextName: (n: number) => string): string {
    return uniquePinName(this._pins, initialName, nextName);
}

private makePinId(): string {
    return `pin_${Date.now()}`;
}

private preservePendingTypeAddress(): void {
    const value = this.pendingTypeAddressValue();
    if (value !== null) { this._activeTypeAddr = value; }
}

private pendingTypeAddressValue(): number | null {
    const curAddrInp = this.pendingAddrInput();
    if (!curAddrInp) { return null; }
    const value = parseInt(curAddrInp.value, 16);
    if (isNaN(value)) { return null; }
    return value;
}

private pendingAddrInput(): HTMLInputElement | null {
    return this._root?.querySelector<HTMLInputElement>('#oa-addr') ?? null;
}

private instanceTypePreviewHtml(def: TypeDef | undefined, pin: TypeInstance): string {
    if (!def) { return ''; }
    return `<div class="oi-type-preview"${this._previewedPins.has(pin.id) ? '' : ' style="display:none"'}>` +
                `<pre class="oi-c-preview" data-preview-id="${esc(def.id)}"${this.previewParamsAttr(pin, def)}></pre>` +
          `</div>`;
}

private previewParamsAttr(pin: TypeInstance, def: TypeDef): string {
    const params = def.params && def.params.length > 0 ? this.pinLayoutParams(pin, def) : undefined;
    return params ? ` data-preview-params="${esc(JSON.stringify(params))}"` : '';
}

private instanceBodyHtml(def: TypeDef | undefined, pin: TypeInstance, expanded: boolean): string {
    if (!expanded || !def || !this.instanceRenderable(pin)) { return ''; }
    return this.renderTypeBody(def, pin, this.instanceBaseAddr(pin), this.pinLayoutParams(pin, def));
}

private instanceBaseAddr(pin: TypeInstance): number | undefined {
    return this.instanceAddress(pin) ?? undefined;
}

/** Always-visible card actions: Edit | View type | Delete. */
private instanceActionsHtml(pin: TypeInstance, index: number): string {
    const previewActive = this._previewedPins.has(pin.id) ? ' active' : '';
    const refresh = instanceUsesScriptResolution(pin)
        ? `<button type="button" class="act-btn act-btn-addr-refresh" data-pin-id="${esc(pin.id)}" ` +
          `title="Refresh script values" aria-label="Refresh script values">&#8635;</button>`
        : '';
    return (
        refresh +
        `<button type="button" class="act-btn act-btn-edit" data-pin-id="${esc(pin.id)}" title="Edit" aria-label="Edit">&#9998;</button>` +
        `<button type="button" class="act-btn act-btn-view-type${previewActive}" data-pin-id="${esc(pin.id)}" title="View type definition" aria-label="View type definition">{ }</button>` +
        `<button type="button" class="act-btn act-btn-del" data-idx="${index}" title="Delete" aria-label="Delete">&#128465;&#xFE0E;</button>`
    );
}

private instanceHeaderHtml(
    pin: TypeInstance,
    index: number,
    defName: string,
    totalBytes: number,
    addrHex: string,
    expanded: boolean,
    resolution: AddressResolution | undefined,
    renderable: boolean,
    paramError?: string,
    paramDetailHtml?: string,
): string {
    return (
        `<div class="sb-card-hdr">` +
        this.instanceExpandButtonHtml(pin, expanded, renderable) +
        `<div class="sb-card-info">` +
        `<span class="oi-cname">${esc(pin.name)}</span>` +
        `<div class="oi-cmeta-row">` +
        `<span class="oi-ctype">${esc(defName)}</span>` +
        this.instanceAddressHtml(pin, resolution, addrHex, totalBytes) +
        this.paramWarningHtml(paramError) +
        `</div>` +
        (paramDetailHtml ?? '') +
        this.pointerSourceSubtitleHtml(pin) +
        `</div>` +
        `<div class="oi-card-actions">` +
        this.instanceActionsHtml(pin, index) +
        `</div>` +
        `</div>`
    );
}

private instanceExpandButtonHtml(pin: TypeInstance, expanded: boolean, renderable: boolean): string {
    const label = expanded ? 'Collapse instance' : 'Expand instance';
    return `<button class="oi-expand-btn" data-pin-id="${esc(pin.id)}" title="${label}" aria-label="${label}"${renderable ? '' : ' disabled'}>\u203a</button>`;
}

/** Card address cell: fixed address, or the script-derived resolving/stale/error state. */
private instanceAddressHtml(
    pin: TypeInstance,
    resolution: AddressResolution | undefined,
    addrHex: string,
    totalBytes: number,
): string {
    if (!instanceUsesScriptAddress(pin)) { return this.fixedAddressHtml(addrHex, totalBytes); }
    return this.scriptAddressHtml(pin, resolution, addrHex, totalBytes);
}

private scriptAddressHtml(
    pin: TypeInstance,
    resolution: AddressResolution | undefined,
    addrHex: string,
    totalBytes: number,
): string {
    const chip = this.scriptChipHtml(pin);
    if (!resolution) { return `${this.resolvingAddressHtml()}${chip}`; }
    return `${this.addressCellForResolution(resolution, addrHex, totalBytes)}${chip}`;
}

private addressCellForResolution(resolution: AddressResolution, addrHex: string, totalBytes: number): string {
    if (resolution.status === 'resolved') { return this.fixedAddressHtml(addrHex, totalBytes); }
    if (resolution.status === 'stale') { return this.staleAddressHtml(resolution); }
    if (resolution.status === 'error') { return this.errorAddressHtml(resolution); }
    return this.resolvingAddressHtml();
}

private resolvingAddressHtml(): string {
    return `<span class="oi-caddr oi-addr-resolving">resolving\u2026</span>`;
}

private fixedAddressHtml(addrHex: string, totalBytes: number): string {
    return `<span class="oi-caddr">0x${addrHex}\u202f\u00b7\u202f${totalBytes}B</span>`;
}

private staleAddressHtml(resolution: Extract<AddressResolution, { status: 'stale' }>): string {
    const lastAddr = resolution.addr !== undefined ? `0x${formatHexAddr(resolution.addr)}` : '';
    return `<span class="oi-caddr oi-addr-stale" title="Re-resolving after a document change">` +
        `${lastAddr ? `${lastAddr}\u202f\u00b7\u202f` : ''}stale</span>`;
}

private errorAddressHtml(resolution: Extract<AddressResolution, { status: 'error' }>): string {
    const last = resolution.lastAddr !== undefined
        ? `<span class="oi-caddr oi-addr-stale" title="Last successful address (not current)">` +
          `0x${formatHexAddr(resolution.lastAddr)}</span>`
        : '';
    return `<span class="oi-caddr oi-addr-error" title="${esc(resolution.message)}">${esc(resolution.message)}</span>${last}`;
}

private scriptChipHtml(pin: TypeInstance): string {
    return scriptChipHtml(pin.addressSource?.scriptPath ?? '');
}

/** Instance-level parameter warning chip (surfaces a templated type with missing values). */
private paramWarningHtml(paramError: string | undefined): string {
    if (!paramError) { return ''; }
    return `<span class="oi-cwarn" title="${esc(paramError)}">\u26a0 params</span>`;
}

private instanceContentHtml(pin: TypeInstance, typePreviewHtml: string, bodyHtml: string): string {
    return typePreviewHtml + bodyHtml;
}

private buildInstanceCard(pin: TypeInstance, i: number): string {
    const def = this.typeDefById(pin.typeId);
    const renderable = this.instanceRenderable(pin);
    const expanded = renderable && this._expanded.has(pin.id);
    return (
        `<div class="sb-card${expanded ? ' oi-expanded' : ''}" data-pin-id="${esc(pin.id)}" data-idx="${i}">` +
        this.instanceHeaderHtml(
            pin, i, typeNameOf(def), this.instanceCardBytes(pin, def), this.instanceAddrHex(pin),
            expanded, this.instanceResolution(pin), renderable, this.paramBlockReason(pin.id),
            this.instanceParamDetailHtml(pin, def),
        ) +
        this.instanceContentHtml(pin, this.instanceTypePreviewHtml(def, pin), this.instanceBodyHtml(def, pin, expanded)) +
        `</div>`
    );
}

private instanceCardBytes(pin: TypeInstance, def: TypeDef | undefined): number {
    return def ? typeByteSize(def, this._types, this.pinLayoutParams(pin, def) ?? {}) : 0;
}

private instanceAddrHex(pin: TypeInstance): string {
    return formatHexAddr(this.instanceAddress(pin) ?? pin.addr);
}

private instanceParamDetailHtml(pin: TypeInstance, def: TypeDef | undefined): string {
    return def ? this.instanceParamsHtml(pin, def) : '';
}

/** Compact per-parameter state row on a templated instance card. */
private instanceParamsHtml(pin: TypeInstance, def: TypeDef): string {
    const params = def.params ?? [];
    if (params.length === 0) { return ''; }
    const cells = params.map(param => this.instanceParamCellHtml(pin, param));
    return `<div class="oi-cparams">${cells.join('')}</div>`;
}

private instanceParamCellHtml(pin: TypeInstance, param: TypeParam): string {
    const manual = manualParamValue(pin, param.name);
    if (manual !== undefined) { return this.paramCellHtml(param.name, String(manual), 'Manual value'); }
    const source = pin.paramSources?.[param.name];
    if (!source) { return this.defaultParamCellHtml(param); }
    return this.scriptParamCellHtml(pin, param, source.scriptPath);
}

private defaultParamCellHtml(param: TypeParam): string {
    if (param.default === undefined) {
        return this.paramCellHtml(param.name, '??', 'Type default', ' oi-cparam-error');
    }
    return this.paramCellHtml(param.name, String(param.default), 'Type default');
}

private scriptParamCellHtml(pin: TypeInstance, param: TypeParam, scriptPath: string): string {
    const chip = scriptChipHtml(scriptPath);
    const resolution = this.paramResolution(pin.id, param.name);
    if (!resolution) { return this.resolvingParamCellHtml(param, chip); }
    return this.paramCellForResolution(param, resolution, chip);
}

private paramCellForResolution(param: TypeParam, resolution: ParamResolution, chip: string): string {
    if (resolution.status === 'resolved') {
        return this.paramCellHtml(param.name, String(resolution.value), undefined, '', chip);
    }
    if (resolution.status === 'stale') { return this.staleParamCellHtml(param, resolution, chip); }
    if (resolution.status === 'error') { return this.errorParamCellHtml(param.name, resolution, chip); }
    return this.resolvingParamCellHtml(param, chip);
}

private staleParamCellHtml(param: TypeParam, resolution: Extract<ParamResolution, { status: 'stale' }>, chip: string): string {
    return this.paramCellHtml(
        param.name, resolvedParamText(resolution.value),
        'Re-resolving after a document change', ' oi-cparam-stale', chip,
    );
}

private resolvingParamCellHtml(param: TypeParam, chip: string): string {
    return this.paramCellHtml(param.name, 'resolving\u2026', undefined, ' oi-cparam-resolving', chip);
}

private errorParamCellHtml(name: string, resolution: Extract<ParamResolution, { status: 'error' }>, chip: string): string {
    const last = resolution.lastValue !== undefined
        ? `<span class="oi-cparam-val oi-cparam-stale">${resolution.lastValue}</span>`
        : '';
    return this.paramCellHtml(name, esc(resolution.message), resolution.message, ' oi-cparam-error', `${last}${chip}`);
}

private paramCellHtml(name: string, valueHtml: string, title?: string, cls = '', suffix = ''): string {
    const titleAttr = title ? ` title="${esc(title)}"` : '';
    return `<span class="oi-cparam${cls}" data-param-name="${esc(name)}"${titleAttr}>` +
        `<span class="oi-cparam-name">${esc(name)}</span>=<span class="oi-cparam-val">${valueHtml}</span>${suffix}</span>`;
}

private clearArrSep(): void {
    this.cb.onClearHighlightHex?.('type-arr-sep');
    this._arrSepAddrs.length = 0;
}

private clearSelRow(): void {
    this._root?.querySelectorAll<HTMLElement>('.oi-selected')
        .forEach(el => el.classList.remove('oi-selected'));
}

private setTreeLevel(el: HTMLElement, level: number): void {
    el.style.setProperty('--oi-level', String(level));
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
    sec.querySelectorAll<HTMLElement>('.oi-fields').forEach(fields => {
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
    if (child.classList.contains('oi-field')) {
        this.setTreeLevel(child, level);
        return;
    }
    if (child.classList.contains('oi-arr-grp')) {
        this.annotateCompositeTreeChild(child, level, 'oi-arr-grp-hdr', 'oi-arr-grp-body');
        return;
    }
    if (child.classList.contains('oi-arr-el-grp')) {
        this.annotateCompositeTreeChild(child, level, 'oi-arr-el-hdr', 'oi-arr-el-body');
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

    sec.querySelectorAll<HTMLElement>('.oi-expand-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if ((btn as HTMLButtonElement).disabled) { return; }
            const id = btn.dataset.pinId!;
            if (this._expanded.has(id)) { this._expanded.delete(id); } else { this._expanded.add(id); }
            this.render();
        });
    });

    // Array group: arrow button toggles expand; rest of row selects in hex view
    sec.querySelectorAll<HTMLElement>('.oi-arr-grp-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.oi-arr-exp-btn');
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);
        const isBitUnitHdr = hdr.classList.contains('oi-bitunit-hdr');
        const isPointerHdr = hdr.classList.contains('oi-ptr-hdr') || hdr.classList.contains('oi-ptr-child-hdr');

        if (expBtn) {
            expBtn.addEventListener('click', e => {
                e.stopPropagation();
                if ((expBtn as HTMLButtonElement).disabled) { return; }
                this.toggleCompositeGroup(hdr, '.oi-arr-grp', '.oi-arr-grp-body', 'arrKey', this._expandedArrayFields);
            });
        }

        hdr.querySelector<HTMLElement>('.oi-f-ptr')?.addEventListener('click', e => {
            e.stopPropagation();
            this.followPointerHeaderValue(hdr);
        });

        this.wireHoverRange(hdr, start, cnt);

        hdr.addEventListener('click', e => {
            if (isPointerHdr) {
                this.selectPointerHeaderRange(e, hdr, start, cnt);
                return;
            }
            this.selectArrayGroupHeader(e, hdr, start, cnt, isBitUnitHdr);
        });
    });

    // Nested element: arrow toggles expand; row selects that element range.
    sec.querySelectorAll<HTMLElement>('.oi-arr-el-hdr').forEach(hdr => {
        const expBtn = hdr.querySelector<HTMLElement>('.oi-arr-el-exp-btn')!;
        const start  = parseInt(hdr.dataset.byteStart!);
        const cnt    = parseInt(hdr.dataset.byteCnt!);

        expBtn.addEventListener('click', e => {
            e.stopPropagation();
            this.toggleCompositeGroup(hdr, '.oi-arr-el-grp', '.oi-arr-el-body', 'arrElKey', this._expandedArrayElements);
        });

        this.wireHoverRange(hdr, start, cnt);

        hdr.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('.oi-arr-el-exp-btn')) { return; }
            this.clearSelectionVisuals();
            if (isNaN(start) || isNaN(cnt)) { return; }
            this._selectedArrElemKey = hdr.dataset.arrElKey!;
            this._selectedArrKey = null;
            this._selectedFieldAddr = null;
            this.selectRange(hdr, start, cnt);
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
            btn => this.startEditingPin(btn.dataset.pinId!),
            btn => this.deletePinAt(btn.dataset.idx!),
        );
        card.querySelectorAll<HTMLElement>('.act-btn-view-type').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this.toggleTypePreview(btn);
            });
        });
        card.querySelectorAll<HTMLElement>('.act-btn-addr-refresh').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this.cb.onRefreshAddresses?.(btn.dataset.pinId);
            });
        });
    });

    sec.querySelectorAll<HTMLElement>('.oi-field').forEach(row => {
        const start = parseInt(row.dataset.byteStart!);
        const cnt   = parseInt(row.dataset.byteCnt!);
        const bitStartRaw = row.dataset.bitStart;
        const bitWidthRaw = row.dataset.bitWidth;
        const isBitRow = bitStartRaw !== undefined && bitWidthRaw !== undefined;

        row.addEventListener('mouseenter', () => {
            if (isBitRow) { return; }
            const addrs: number[] = [];
            for (let i = 0; i < cnt; i++) { addrs.push(start + i); }
            this.cb.onHighlightHex?.(addrs, 'type-h');
        });

        row.addEventListener('mouseleave', () => {
            if (isBitRow) { return; }
            this.cb.onClearHighlightHex?.('type-h');
        });

        row.addEventListener('click', () => {
            if (isNaN(start) || isNaN(cnt)) { return; }
            if (isBitRow) {
                this.selectBitRow(row, sec);
                return;
            }
            this.selectTypeFieldRow(row, start, cnt);
        });

        row.querySelector<HTMLElement>('.oi-f-ptr')?.addEventListener('click', ev => {
            ev.stopPropagation();
            const card = row.closest<HTMLElement>('.sb-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            const valKey = row.dataset.valKey ?? this.scalarValKey(start);
            this.followPointerAt(start, pinIdx, valKey, this.sourceContextOptions(row));
        });
    });

    // Right-click on a field row to open the value menu. Pass the pin index
    // so the menu can decode values when performing copy actions.
    sec.querySelectorAll<HTMLElement>('.oi-field').forEach(row => {
        row.addEventListener('contextmenu', ev => {
            ev.preventDefault(); ev.stopPropagation();
            const start = parseInt(row.dataset.byteStart!);
            const card = row.closest<HTMLElement>('.sb-card');
            const pinIdx = card ? parseInt(card.dataset.idx!) : -1;
            // Determine if this is a pointer field
            const valCell = row.querySelector<HTMLElement>('.oi-f-val');
            const isPointer = valCell?.classList.contains('oi-f-ptr');
            const isBitUnitHeader = row.classList.contains('oi-bitunit-hdr');
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
    sec.querySelectorAll<HTMLElement>('.oi-arr-grp-hdr').forEach(hdr => {
        hdr.addEventListener('contextmenu', ev => {
            if (hdr.classList.contains('oi-ptr-hdr') || hdr.classList.contains('oi-ptr-child-hdr')) {
                this.openPointerHeaderValueMenu(ev, hdr);
                return;
            }
            this.openArrayHeaderValueMenu(ev, hdr);
        });
    });

    this.applyBitHighlightsInPlace(sec);
    this.restoreSelection(sec);
}


    private onCardHeaderClick(_sec: HTMLElement, hdr: HTMLElement, e: Event): void {
        if ((e.target as HTMLElement).closest('.oi-expand-btn, .oi-card-actions')) { return; }
        const card = hdr.closest<HTMLElement>('.sb-card');
        if (card) { this.selectPinCard(card); }
    }

    /**
     * Host used-by link: expand one instance card, select its byte range, and
     * reveal it in the Instances list (no-op when the id vanished). Undecodable
     * dynamic instances keep the expanded state; rows appear once resolved.
     */
    selectInstance(pinId: string): void {
        if (!this._pins.some(pin => pin.id === pinId)) { return; }
        this._expanded.add(pinId);
        this.render();
        const card = this.instanceCardOf(pinId);
        if (!card) { return; }
        this.selectPinCard(card);
        this.scrollPinCardIntoView(card);
    }

    private instanceCardOf(pinId: string): HTMLElement | null {
        for (const card of this._root?.querySelectorAll<HTMLElement>('.sb-card') ?? []) {
            if (card.dataset.pinId === pinId) { return card; }
        }
        return null;
    }

    private scrollPinCardIntoView(card: HTMLElement): void {
        if (typeof card.scrollIntoView === 'function') { card.scrollIntoView({ block: 'nearest' }); }
    }

    /** Card header click + used-by link share the same range selection. */
    private selectPinCard(card: HTMLElement): void {
        this.clearPinSelection();
        const pin = this._pins[parseInt(card.dataset.idx!)];
        if (!pin) { return; }
        const def = allTypes(this._types).find(d => d.id === pin.typeId);
        if (!def) { return; }
        const addr = this.instanceAddress(pin);
        if (addr === null) { return; }
        this.markPinSelected(card, pin, def, addr);
    }

    /** Drop every transient selection marker before a pin selection is applied. */
    private clearPinSelection(): void {
        this.clearArrSep();
        this.clearSelRow();
        this._selectedBitRange = null;
        this._hoveredBitRange = null;
        this._selectedBitRowKey = null;
        this._hoveredBitRowKey = null;
        this._selectedFieldAddr = null;
        this._selectedArrKey    = null;
        this._selectedArrElemKey = null;
    }

    /** Apply the range + card selection for one pin (shared by header click and used-by link). */
    private markPinSelected(card: HTMLElement, pin: TypeInstance, def: TypeDef, addr: number): void {
        const size = typeByteSize(def, this._types, this.pinLayoutParams(pin, def) ?? {});
        this._activeTypeAddr = addr;
        this._selectedPinId = pin.id;
        this._root?.querySelectorAll<HTMLElement>('.sb-card').forEach(c => c.classList.remove('oi-card-selected'));
        card.classList.add('oi-card-selected');
        this.cb.onSelectRange?.(addr, size);
    }

    /** Open the full-width instance editor seeded from the saved pin. */
    private startEditingPin(pinId: string): void {
        this._editingPinId = pinId;
        const editedPin = this._pins.find(p => p.id === pinId);
        this._editingPinDraftTypeId = editedPin ? editedPin.typeId : null;
        this._pinSourceDraft = addressSourceDraftOf(editedPin);
        this._pinParamSourceDrafts.clear();
        this.loadParamSourceDrafts(editedPin);
        this._expanded.delete(pinId);
        this.cb.onRequestScripts?.();
        this.render();
    }

    private loadParamSourceDrafts(pin: TypeInstance | undefined): void {
        const sources = pin ? pin.paramSources : undefined;
        for (const [name, source] of Object.entries(sources ?? {})) {
            this._pinParamSourceDrafts.set(name, { mode: 'script', scriptPath: source.scriptPath });
        }
    }

    /** Delete one instance card by list index, dropping its transient state first. */
    private deletePinAt(rawIdx: string): void {
        const idx = parseInt(rawIdx);
        const pin = this._pins[idx];
        if (pin) {
            this._expanded.delete(pin.id);
            this._addressResolutions.delete(pin.id);
            this.clearPinParamResolutions(pin.id);
        }
        this._pins = withoutTypeInstance(this._pins, idx);
        this.cb.onPinsChange?.(this._pins);
        this.render();
    }


/** View-type preview toggle — always-visible card action button (`.act-btn-view-type`). */
private toggleTypePreview(btn: HTMLElement): void {
    const id = btn.dataset.pinId!;
    const card = btn.closest<HTMLElement>('.sb-card')!;
    const preview = card.querySelector<HTMLElement>('.oi-type-preview');
    const isOpen = this._previewedPins.has(id);
    this.setTypePreviewOpen(id, btn, preview, !isOpen);
}

private setTypePreviewOpen(id: string, btn: HTMLElement, preview: HTMLElement | null, isOpen: boolean): void {
    if (isOpen) { this._previewedPins.add(id); }
    else { this._previewedPins.delete(id); }
    btn.classList.toggle('active', isOpen);
    if (preview) { preview.style.display = isOpen ? '' : 'none'; }
}

private restoreSelection(sec: HTMLElement): void {
    this.restoreSelectedPin(sec);
    this.restoreSelectedValueRow(sec);
}

private restoreSelectedPin(sec: HTMLElement): void {
    if (this._selectedPinId === null) { return; }
    sec.querySelectorAll<HTMLElement>('.sb-card').forEach(card => {
        if (card.dataset.pinId === this._selectedPinId) {
            card.classList.add('oi-card-selected');
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
    sec.querySelectorAll<HTMLElement>('.oi-field[data-bit-start][data-bit-width]').forEach(row => {
        const meta = this.parseBitRowMeta(row);
        if (!meta) { return; }
        const key = this.makeBitRowKey(meta.byteStart, meta.bitStart, meta.bitWidth);
        if (key === this._selectedBitRowKey) {
            row.classList.add('oi-selected');
        }
    });
    return true;
}

private restoreSelectedFieldRow(sec: HTMLElement): boolean {
    if (this._selectedFieldAddr === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.oi-field').forEach(row => {
        if (parseInt(row.dataset.byteStart!) === this._selectedFieldAddr) {
            row.classList.add('oi-selected');
        }
    });
    return true;
}

private restoreSelectedArrayElement(sec: HTMLElement): boolean {
    if (this._selectedArrElemKey === null) { return false; }
    sec.querySelectorAll<HTMLElement>('.oi-arr-el-hdr').forEach(hdr => {
        if (hdr.dataset.arrElKey === this._selectedArrElemKey) {
            hdr.classList.add('oi-selected');
        }
    });
    return true;
}

private restoreSelectedArrayGroup(sec: HTMLElement): void {
    if (this._selectedArrKey === null) { return; }
    sec.querySelectorAll<HTMLElement>('.oi-arr-grp-hdr').forEach(hdr => {
        const grp = hdr.closest<HTMLElement>('.oi-arr-grp');
        if (grp?.dataset.arrKey === this._selectedArrKey) {
            hdr.classList.add('oi-selected');
        }
    });
}
// Floating per-field value-type menu (rendered into the shared MenuController container)

/** Show an overlay field menu in the shared controller container; commands route through `onCommand`. */
private showFieldMenu(innerHtml: string, x: number, y: number, onCommand: (cmd: string) => void): void {
    menuController.show(x, y, { innerHTML: innerHtml, emit: onCommand });
    // The controller owns #menu; tag it with the overlay modifier so the
    // .oi-field-menu CSS (min/max width, wrapped hints) applies.
    menuController.openMenu()?.classList.add('oi-field-menu');
}

private instanceAtAddress(addr: number, pinIdx: number | undefined, allDefs: TypeDef[]): TypeInstance | undefined {
    return this.pinCoveringAddress(addr, pinIdx, allDefs);
}

/** Pin whose decoded byte range covers `addr` (explicit list index wins when given). */
private pinCoveringAddress(addr: number, pinIdx: number | undefined, defs: TypeDef[]): TypeInstance | undefined {
    if (typeof pinIdx === 'number' && pinIdx >= 0) { return this._pins[pinIdx]; }
    return this._pins.find(pin => this.pinCoversAddress(pin, addr, defs));
}

private pinCoversAddress(pin: TypeInstance, addr: number, defs: TypeDef[]): boolean {
    const def = this.typeDefIn(defs, pin.typeId);
    const baseAddr = this.instanceAddress(pin);
    if (!def || baseAddr === null) { return false; }
    return addressInRange(addr, baseAddr, this.instanceByteSize(def, pin));
}

private instanceByteSize(def: TypeDef, pin: TypeInstance): number {
    return typeByteSize(def, this._types, this.pinLayoutParams(pin, def) ?? {});
}

private typeDefIn(defs: readonly TypeDef[], typeId: string): TypeDef | undefined {
    return defs.find(candidate => candidate.id === typeId);
}

private instanceRowsAtAddress(addr: number, pinIdx: number | undefined, allDefs: TypeDef[]): DecodedField[] {
    const pin = this.instanceAtAddress(addr, pinIdx, allDefs);
    if (!pin) { return []; }
    const def = this.typeDefIn(allDefs, pin.typeId);
    const baseAddr = this.instanceAddress(pin);
    if (!def || baseAddr === null) { return []; }
    return this.decodeInstanceRows(def, pin, baseAddr).filter(row => baseAddr + row.byteOffset === addr);
}

private decodeInstanceRows(def: TypeDef, pin: TypeInstance, baseAddr: number): DecodedField[] {
    return decodeType(
        def, baseAddr, this.cb.readByte, this._endian, this._bitFieldAllocation, this._types,
        this.pinLayoutParams(pin, def) ?? {},
    );
}

private sourceRowsAtAddress(
    addr: number,
    pinIdx: number | undefined,
    opts: FieldValMenuOptions,
    allDefs: TypeDef[],
): DecodedField[] {
    const source = this.findCopySourceRows(addr, pinIdx, opts);
    return source
        ? source.rows.filter(row => source.baseAddr + row.byteOffset === addr)
        : this.instanceRowsAtAddress(addr, pinIdx, allDefs);
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
    const bitRow = target?.closest<HTMLElement>('.oi-field[data-bit-start][data-bit-width]') ?? null;
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
    row.classList.add('oi-selected');
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

private selectTypeFieldRow(row: HTMLElement, start: number, cnt: number): void {
    this.clearArrSep();
    this.clearSelRow();
    this.clearBitSelectionState();
    row.classList.add('oi-selected');
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
    this.clearSelectionVisuals();
    if (this.hasInvalidRange(start, cnt)) { return; }
    const grp = hdr.closest<HTMLElement>('.oi-arr-grp')!;
    this._selectedArrKey = grp.dataset.arrKey!;
    this._selectedArrElemKey = null;
    this._selectedFieldAddr = null;
    this.markArraySeparators(this.arrayGroupSeparatorRows(grp));
    this.selectRange(hdr, start, cnt);
}

private shouldSkipArrayGroupClick(e: MouseEvent, isBitUnitHdr: boolean): boolean {
    return isBitUnitHdr || Boolean((e.target as HTMLElement).closest('.oi-arr-exp-btn'));
}

private hasInvalidRange(start: number, cnt: number): boolean {
    return isNaN(start) || isNaN(cnt);
}

private selectPointerHeaderRange(e: MouseEvent, hdr: HTMLElement, start: number, cnt: number): void {
    if ((e.target as HTMLElement).closest('.oi-arr-exp-btn')) { return; }
    this.clearSelectionVisuals();
    if (this.hasInvalidRange(start, cnt)) { return; }
    this.selectRange(hdr, start, cnt);
}

private followPointerHeaderValue(hdr: HTMLElement): void {
    const storageStart = parseInt(hdr.dataset.pointerStorageStart ?? '');
    const pinIdx = this.pinIndexFromHeader(hdr);
    const valKey = hdr.dataset.valKey ?? this.scalarValKey(storageStart);
    this.followPointerAt(storageStart, pinIdx, valKey, this.sourceContextOptions(hdr));
}

private arrayGroupSeparatorRows(grp: HTMLElement): HTMLElement[] {
    const elementHeaders = Array.from(grp.querySelectorAll<HTMLElement>('.oi-arr-el-hdr'));
    return elementHeaders.length > 0 ? elementHeaders : Array.from(grp.querySelectorAll<HTMLElement>('.oi-field'));
}

private openArrayHeaderValueMenu(ev: MouseEvent, hdr: HTMLElement): void {
    if (hdr.classList.contains('oi-bitunit-hdr')) { return; }
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
    const grp = hdr.closest<HTMLElement>('.oi-arr-grp')!;
    return Array.from(grp.children).find(c => this.isArrayGroupBody(c)) as HTMLElement | undefined;
}

private isArrayGroupBody(child: Element): boolean {
    return child.classList.contains('oi-arr-grp-body');
}

private directValueRowsFromChild(child: Element): HTMLElement[] {
    const childEl = child as HTMLElement;
    if (childEl.classList.contains('oi-field')) { return [childEl]; }
    if (childEl.classList.contains('oi-arr-el-grp')) { return this.nestedValueHeaderRows(childEl); }
    return [];
}

private nestedValueHeaderRows(child: HTMLElement): HTMLElement[] {
    const hdr = Array.from(child.children).find(c => this.isNestedValueHeader(c)) as HTMLElement | undefined;
    return hdr ? [hdr] : [];
}

private isNestedValueHeader(child: Element): boolean {
    return child.classList.contains('oi-arr-el-hdr') && child.classList.contains('oi-field');
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

private sourceContextOptions(el: HTMLElement): Pick<FieldValMenuOptions, 'sourceTypeId' | 'sourceBaseAddr'> {
    const sourceTypeId = el.dataset.sourceTypeId;
    const sourceBaseAddr = this.parseOptionalInt(el.dataset.sourceBaseAddr);
    return sourceTypeId && sourceBaseAddr !== undefined ? { sourceTypeId, sourceBaseAddr } : {};
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
    const allDefs = allTypes(this._types);
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

private pointerSourceSubtitleHtml(pin: TypeInstance): string {
    const source = pin.pointerSources?.[0];
    if (!source) { return ''; }
    const addr = formatHex(source.pointerStorageAddress, 8);
    return `<div class="oi-csource">from ${esc(source.sourcePinName)}.${esc(source.sourceFieldPath)} @${esc(addr)}</div>`;
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
    const create = this.pointerCreateState(source);
    if (create === null) { return ''; }
    return create.ok
        ? this.menuItemHtml('create-type-ptr', 'Create Instance')
        : this.disabledMenuItemHtml('Create Instance', create.reason);
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
    if (cmd === 'create-type-ptr') {
        this.createTypeInstanceFromPointer(source);
        return;
    }
    this.copyPointerFieldValue(ctx);
}



private pointerMenuSource(ctx: FieldValMenuContext): PointerMenuSource | null {
    const source = this.findCopySourceRows(ctx.bs, ctx.pinIdx, ctx.opts);
    if (!source) { return null; }
    const row = this.findFieldForValueKey(source.rows, ctx.bs - source.baseAddr, ctx.opts.valKey);
    return row ? { pin: source.pin, row, sourceTypeId: source.typeId, sourceBaseAddr: source.baseAddr } : null;
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

private pointerFollowTarget(row: DecodedField | null): { addr: number; byteCount: number; typeId?: string } | null {
    if (!this.pointerFollowState(row).ok) { return null; }
    return this.buildPointerFollowTarget(row as DecodedField & { pointerValue: number });
}

private buildPointerFollowTarget(row: DecodedField & { pointerValue: number }): { addr: number; byteCount: number; typeId?: string } {
    const addr = row.pointerValue;
    return this.pointerTargetFromType(row, addr) ?? this.scalarPointerFollowTarget(row, addr);
}

private pointerTargetFromType(row: DecodedField, addr: number): { addr: number; byteCount: number; typeId: string } | null {
    const def = this.pointerTargetTypeDef(row);
    if (!def || !row.pointerTargetTypeId) { return null; }
    return { addr, byteCount: typeByteSize(def, this._types), typeId: row.pointerTargetTypeId };
}

private scalarPointerFollowTarget(row: DecodedField, addr: number): { addr: number; byteCount: number } {
    return { addr, byteCount: Math.max(1, row.pointerTargetByteSize ?? 1) };
}



private pointerCreateState(source: PointerMenuSource | null): PointerCreateState {
    const row = source?.row;
    if (!this.isPointerMenuRow(row)) { return null; }
    return this.validPointerCreateState(row);
}

private isPointerMenuRow(row: DecodedField | undefined): row is DecodedField {
    return !!row && row.pointerTargetType === 'struct';
}

private validPointerCreateState(row: DecodedField): Exclude<PointerCreateState, null> {
    const follow = this.pointerFollowState(row);
    if (!follow.ok) { return { ok: false, reason: follow.reason }; }
    return this.resolvedPointerCreateState(row);
}

private resolvedPointerCreateState(row: DecodedField): Exclude<PointerCreateState, null> {
    const typeId = row.pointerTargetTypeId;
    const def = this.pointerTargetTypeDef(row);
    if (!typeId || !def || row.pointerValue === undefined) { return { ok: false, reason: 'unknown target' }; }
    return { ok: true, def, addr: row.pointerValue, typeId };
}

private createTypeInstanceFromPointer(source: PointerMenuSource | null): void {
    const state = this.pointerCreateState(source);
    if (!source || !state?.ok) { return; }
    this.applyPointerInstance(source, state);
}

private applyPointerInstance(source: PointerMenuSource, state: Extract<PointerCreateState, { ok: true }>): void {
    const result = upsertPointerTypeInstance(this._pins, {
        sourcePin: source.pin,
        sourceTypeId: source.sourceTypeId,
        sourceFieldPath: source.row.fieldName,
        sourceFieldByteOffset: source.row.byteOffset,
        sourceBaseAddr: source.sourceBaseAddr,
        targetAddress: state.addr,
        targetTypeId: state.typeId,
    }, this.makePinId);
    this._pins = result.pins;
    const pin = result.pin;
    this.selectCreatedPointerPin(pin, state);
    this.cb.onPinsChange?.(this._pins);
    this.render();
}

private selectCreatedPointerPin(pin: TypeInstance, state: Extract<PointerCreateState, { ok: true }>): void {
    this._expanded.add(pin.id);
    this._selectedPinId = pin.id;
    this._activeTypeAddr = state.addr;
    this.selectPointerTarget(state.addr, typeByteSize(state.def, this._types));
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

private findCopySourcePin(bs: number, pinIdx: number | undefined, defs: TypeDef[]): TypeInstance | undefined {
    return this.pinCoveringAddress(bs, pinIdx, defs);
}

private findCopySourceRows(bs: number, pinIdx: number | undefined, opts: FieldValMenuOptions = {}): CopySourceRows | undefined {
    const explicit = this.findExplicitCopySourceRows(pinIdx, opts);
    if (explicit) { return explicit; }
    const pin = this.findCopySourcePin(bs, pinIdx, allTypes(this._types));
    return pin ? this.copySourceRowsForPin(pin) : undefined;
}

private copySourceRowsForPin(pin: TypeInstance): CopySourceRows | undefined {
    const def = this.typeDefById(pin.typeId);
    const baseAddr = this.instanceAddress(pin);
    if (!def || baseAddr === null) { return undefined; }
    return { pin, rows: this.decodeInstanceRows(def, pin, baseAddr), typeId: def.id, baseAddr };
}

private findExplicitCopySourceRows(pinIdx: number | undefined, opts: FieldValMenuOptions): CopySourceRows | undefined {
    const context = this.explicitSourceContext(opts);
    if (!context) { return undefined; }
    const pin = this.copySourcePinFromIndex(pinIdx);
    const def = this.typeDefById(context.typeId);
    if (!pin || !def) { return undefined; }
    return {
        pin,
        rows: decodeType(
            def, context.baseAddr, this.cb.readByte, this._endian, this._bitFieldAllocation,
            this._types, this.explicitLayoutParams(pin, def),
        ),
        typeId: def.id,
        baseAddr: context.baseAddr,
    };
}

/** Layout params only when the source pin actually uses the decoded type. */
private explicitLayoutParams(pin: TypeInstance, def: TypeDef): Readonly<Record<string, number>> | undefined {
    return pin.typeId === def.id ? (this.pinLayoutParams(pin, def) ?? {}) : undefined;
}

private explicitSourceContext(opts: FieldValMenuOptions): { typeId: string; baseAddr: number } | undefined {
    return opts.sourceTypeId && typeof opts.sourceBaseAddr === 'number'
        ? { typeId: opts.sourceTypeId, baseAddr: opts.sourceBaseAddr }
        : undefined;
}

private copySourcePinFromIndex(pinIdx: number | undefined): TypeInstance | undefined {
    return typeof pinIdx === 'number' && pinIdx >= 0 ? this._pins[pinIdx] : undefined;
}

private typeDefById(typeId: string): TypeDef | undefined {
    return allTypes(this._types).find(d => d.id === typeId);
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

private wireHoverRange(el: HTMLElement, start: number, count: number): void {
    el.addEventListener('mouseenter', () => {
        const addrs: number[] = [];
        for (let i = 0; i < count; i++) { addrs.push(start + i); }
        this.cb.onHighlightHex?.(addrs, 'type-h');
    });
    el.addEventListener('mouseleave', () => {
        this.cb.onClearHighlightHex?.('type-h');
    });
}

private highlightAddress(addr: number, className: string): void {
    this.cb.onHighlightHex?.([addr], className);
}

private clearSelectionVisuals(): void {
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
    this.cb.onHighlightHex?.(addrs, 'type-arr-sep');
}

private selectRange(el: HTMLElement, start: number, count: number): void {
    el.classList.add('oi-selected');
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

private clearSelectionState(): void {
    this.clearArrSep();
    this.clearSelRow();
    this._selectedFieldAddr = null;
    this._selectedArrKey    = null;
    this._selectedArrElemKey = null;
    this._selectedPinId     = null;
}

    private updateTypeAddressInputs(addr: number): void {
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
        if (confirmBtn) { confirmBtn.disabled = !this.selectedApplyTypeId(); }
    }

    private addPinAddressInput(): HTMLInputElement | null {
        return this._root?.querySelector<HTMLInputElement>('#oa-addr') ?? null;
    }

    private addPinConfirmButton(): HTMLButtonElement | null {
        return this._root?.querySelector<HTMLButtonElement>('#oa-confirm') ?? null;
    }

    // ── Extracted-module delegation (thin wrappers keep internal call sites stable) ──

    /** Narrow render context for the extracted row/value/binary render modules. */
    private renderCtx(): OverlayRenderCtx {
        return {
            types: this._types,
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

    // C preview (cPreview.ts)
    private renderTypeCPreview(pre: HTMLElement, def: TypeDef): void {
        renderTypeCPreview(pre, def, this._types);
    }
    private hydrateTypePreviews(root: HTMLElement): void {
        hydrateTypePreviews(root, this._types, this._editingType?.draft ?? null);
    }

    // Binary view (binaryView.ts)
    private isBitFieldRow(r: DecodedField): boolean { return isBitFieldRow(r); }
    private makeBitRowKey(byteStart: number, bitStart: number, bitWidth: number): string { return makeBitRowKey(byteStart, bitStart, bitWidth); }
    private scalarValKey(byteStart: number): string { return scalarValKey(byteStart); }
    private bitUnitUsesFullStorage(rows: DecodedField[]): boolean { return bitUnitUsesFullStorage(rows); }
    private singleLineCopyText(text: string): string { return singleLineCopyText(text); }
    private parseDatasetInt(value: string | undefined): number | null { return parseDatasetInt(value); }
    private parseBitRowMeta(row: HTMLElement): { byteStart: number; bitStart: number; bitWidth: number } | null { return parseBitRowMeta(row); }
    private applyBitHighlightsInPlace(sec: HTMLElement): void { applyBitHighlightsInPlace(sec, this._selectedBitRange, this._hoveredBitRange); }

    // Editor fields (editorFields.ts)
    private fieldRowHtml(f: TypeField, i: number, isOnly: boolean, total: number, draftId: string): string {
        return fieldRowHtml(
            f, i, isOnly, total, draftId, this._types, this.editorInheritedEndian(),
            this.editorInheritedAlloc(), this._editingType?.draft.params ?? [],
        );
    }
    private childFieldRowHtml(child: BitFieldChild, ci: number, total: number): string { return childFieldRowHtml(child, ci, total, this._types); }
    private overrideSelectHtml(value: 'le' | 'be' | 'lsb' | 'msb' | undefined, kind: 'endian' | 'allocation', cls: string, id?: string, inherited?: string): string { return overrideSelectHtml(value, kind, cls, id, inherited); }
    private overrideAutoTitle(value: 'le' | 'be' | 'lsb' | 'msb' | undefined, inherited?: string): string | undefined { return overrideAutoTitle(value, inherited); }
    private overrideHelpTitle(kind: 'endian' | 'allocation'): string { return overrideHelpTitle(kind); }
    private isPointerBlocked(field: TypeField): boolean { return isPointerBlocked(field); }
    private bitChildButtonState(remainingBits: number): { addBtnDisabled: string; addBtnTitle: string } { return bitChildButtonState(remainingBits); }

    // Value format (valueFormat.ts)
    private getCopyText(r: DecodedField, valType: ColType): string { return getCopyText(this.renderCtx(), r, valType); }
    private implicitDisplayType(field: DecodedField | null | undefined, forceBinary = false): ColType { return implicitDisplayType(this.renderCtx(), field, forceBinary); }

    // Row renderer (rowRenderer.ts)
    private renderTypeBody(def: TypeDef, pin: TypeInstance, addr?: number, params?: Readonly<Record<string, number>>): string { return renderTypeBody(this.renderCtx(), def, pin, addr, params); }
    private buildBitUnitAggregateRow(rows: DecodedField[]): DecodedField | null { return buildBitUnitAggregateRow(this.renderCtx(), rows); }
    private syncCompositeHeaderOffset(hdr: HTMLElement, isOpen: boolean): void { syncCompositeHeaderOffset(hdr, isOpen); }
    private pointerTargetTypeDef(row: DecodedField): TypeDef | undefined { return pointerTargetTypeDef(this.renderCtx(), row); }
}

/** Last successful address carried by a resolution (dimmed after a failed/stale refresh). */
function lastAddressValue(resolution: AddressResolution | undefined): number | undefined {
    if (!resolution) { return undefined; }
    return carriedAddress(resolution);
}

function carriedAddress(resolution: AddressResolution): number | undefined {
    if (resolution.status === 'resolved' || resolution.status === 'stale') { return resolution.addr; }
    return resolution.status === 'error' ? resolution.lastAddr : undefined;
}

/** Last successful size carried by a resolution (dimmed after a failed/stale refresh). */
function lastParamValue(resolution: ParamResolution | undefined): number | undefined {
    if (!resolution) { return undefined; }
    return carriedParamValue(resolution);
}

function carriedParamValue(resolution: ParamResolution): number | undefined {
    if (resolution.status === 'resolved' || resolution.status === 'stale') { return resolution.value; }
    return resolution.status === 'error' ? resolution.lastValue : undefined;
}

/** Previous-run address only: a failed batch entry never re-carries an earlier failure. */
function previousAddressValue(resolution: AddressResolution | undefined): number | undefined {
    if (!resolution) { return undefined; }
    return resolution.status === 'resolved' || resolution.status === 'stale' ? resolution.addr : undefined;
}

/** Previous-run size only: a failed batch entry never re-carries an earlier failure. */
function previousParamValue(resolution: ParamResolution | undefined): number | undefined {
    if (!resolution) { return undefined; }
    return resolution.status === 'resolved' || resolution.status === 'stale' ? resolution.value : undefined;
}

/** Error resolution for a failed address batch entry (keeps the previous address when known). */
function addressFailureResolution(
    result: Extract<InstanceAddressResult, { ok: false }>,
    generation: number,
    lastAddr: number | undefined,
): AddressResolution {
    const failed: { status: 'error'; message: string; generation: number; errorType?: string; lastAddr?: number } = {
        status: 'error',
        message: result.error || 'Invalid address from script',
        generation,
    };
    if (result.errorType) { failed.errorType = result.errorType; }
    if (lastAddr !== undefined) { failed.lastAddr = lastAddr; }
    return failed;
}

/** Error resolution for a failed size batch entry (keeps the previous value when known). */
function paramFailureResolution(
    result: Extract<InstanceParamResult, { ok: false }>,
    generation: number,
    lastValue: number | undefined,
): ParamResolution {
    const failed: { status: 'error'; message: string; generation: number; errorType?: string; lastValue?: number } = {
        status: 'error',
        message: result.error || 'Invalid size from script',
        generation,
    };
    if (result.errorType) { failed.errorType = result.errorType; }
    if (lastValue !== undefined) { failed.lastValue = lastValue; }
    return failed;
}

/** Parameter names with an authored script source that are not overridden by a manual value. */
function activeParamNames(pin: TypeInstance): string[] {
    return Object.keys(pin.paramSources ?? {}).filter(param => !hasOwnParamValue(pin, param));
}

function hasOwnParamValue(pin: TypeInstance, param: string): boolean {
    return Object.prototype.hasOwnProperty.call(pin.paramValues ?? {}, param);
}

/** 8-digit uppercase hex without the `0x` prefix. */
function formatHexAddr(addr: number): string {
    return addr.toString(16).toUpperCase().padStart(8, '0');
}

/** Role chip shared by the address cell and the parameter cells. */
function scriptChipHtml(scriptPath: string): string {
    return `<span class="oi-script-chip" title="${esc(scriptPath)}">Script</span>`;
}

/** Stale parameter text: the last value, or an ellipsis before the first success. */
function resolvedParamText(value: number | undefined): string {
    return value !== undefined ? String(value) : '\u2026';
}

function lockedTitleAttr(locked: boolean): string {
    return locked ? ' title="Pointer-created instances must use a fixed address"' : '';
}

/** One address-source `<option>` with its selected/disabled attributes. */
function sourceOptionHtml(value: string, label: string, selected: boolean, disabled: boolean): string {
    return `<option value="${value}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${label}</option>`;
}

function hasParams(def: TypeDef): boolean {
    return (def.params?.length ?? 0) > 0;
}

/** Whether a script address source is present but has no script picked yet. */
function missingScriptPath(source: { scriptPath: string } | null): boolean {
    return Boolean(source && !source.scriptPath);
}

/** Address-source draft for the instance form, seeded from the saved pin. */
function addressSourceDraftOf(pin: TypeInstance | undefined): PinSourceDraft {
    if (!pin || !pin.addressSource) { return { mode: 'fixed', scriptPath: '' }; }
    return { mode: 'script', scriptPath: pin.addressSource.scriptPath };
}

/** Instance-form name for a card header (missing defs render as `?`). */
function typeNameOf(def: TypeDef | undefined): string {
    return def ? def.name : '?';
}

function addressInRange(addr: number, baseAddr: number, size: number): boolean {
    return addr >= baseAddr && addr < baseAddr + size;
}

/** Store a validated form parameter value; returns the row error when invalid. */
function storeParamValue(raw: string, name: string, values: Record<string, number>): string | undefined {
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return `Parameter "${name}" must be a positive integer.`;
    }
    values[name] = value;
    return undefined;
}

/** Optional numeric default read from a parameter row (`undefined` when blank/invalid). */
function readParamDefault(raw: string | undefined): number | undefined {
    const text = raw?.trim() ?? '';
    if (text === '') { return undefined; }
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
}

/** Rewrite field `countParam` references after a parameter rename. */
function renameParamRefs(draft: TypeDef, oldName: string, newName: string): void {
    if (!oldName || oldName === newName) { return; }
    for (const field of draft.fields.filter(candidate => candidate.countParam === oldName)) {
        field.countParam = newName;
    }
}

/** Seed the literal array count on first activation of an array cell. */
function seedArrayCount(cell: HTMLElement): void {
    const inp = cell.querySelector<HTMLInputElement>('.ofe-count-inp')!;
    if (!inp.value) { inp.value = '2'; }
    inp.focus();
    inp.select();
}

/** Manual parameter value when the instance carries its own (never a default/script value). */
function manualParamValue(pin: TypeInstance, name: string): number | undefined {
    return hasOwnParamValue(pin, name) ? pin.paramValues?.[name] : undefined;
}

/** Deep-copy a type definition into an editable draft (arrays and nested children cloned). */
function cloneTypeDefDraft(existing: TypeDef): TypeDef {
    return {
        id: existing.id, name: existing.name, packed: existing.packed ?? false,
        kind: typeDefKind(existing),
        baseType: existing.baseType,
        endian: existing.endian, allocation: existing.allocation,
        fields: existing.fields.map(f => ({ ...f })),
        bitFields: existing.bitFields?.map(c => ({ ...c })),
        entries: existing.entries?.map(e => ({ ...e })),
        params: existing.params?.map(p => ({ ...p })),
    };
}

function isIndexInRange(index: number, length: number): boolean {
    return index >= 0 && index < length;
}

/** Error text for deleting a parameter a field still binds to, or null when unreferenced. */
function paramReferenceError(draft: TypeDef, param: TypeParam): string | null {
    const field = draft.fields.find(candidate => candidate.countParam === param.name);
    return field
        ? `Parameter "${param.name}" is used by field "${field.name}" \u2014 change its count first.`
        : null;
}

function emptyParamConfig(): { values: Record<string, number>; sources: Record<string, { scriptPath: string }>; errors: string[] } {
    return { values: {}, sources: {}, errors: [] };
}

/** One deduped picker option for a role-tagged script. */
type ScriptOption = { path: string; label: string };

/** Role-tagged scripts as picker options (deduped by path, first wins). */
function roleScriptOptions(scripts: readonly OverlayScriptInfo[], role: ScriptRole): ScriptOption[] {
    const seen = new Set<string>();
    const options: ScriptOption[] = [];
    for (const script of scripts) {
        if (script.roles.includes(role)) { addScriptOption(options, seen, scriptPickerPath(script)); }
    }
    return options;
}

function addScriptOption(options: ScriptOption[], seen: Set<string>, path: string): void {
    if (!path || seen.has(path)) { return; }
    seen.add(path);
    options.push({ path, label: path });
}

function scriptPickerPath(script: OverlayScriptInfo): string {
    return script.relativePath || script.filePath;
}

/** Options markup for a role picker; an unknown current selection stays visible as "(not found)". */
function scriptOptionsHtml(options: ScriptOption[], selected: string, emptyLabel: string): string {
    const list = withSelectedOption(options, selected);
    if (list.length === 0) { return `<option value="">${emptyLabel}</option>`; }
    return list.map(option =>
        `<option value="${esc(option.path)}"${option.path === selected ? ' selected' : ''}>${esc(option.label)}</option>`,
    ).join('');
}

function withSelectedOption(options: ScriptOption[], selected: string): ScriptOption[] {
    if (!selected || options.some(option => option.path === selected)) { return options; }
    return [{ path: selected, label: `${selected} (not found)` }, ...options];
}

/** Whether a transient parameter-resolution key still has a live authored source. */
function pinParamSourceExists(pin: TypeInstance, key: string): boolean {
    const param = paramFromResolutionKey(pin, key);
    if (param === null) { return false; }
    if (!pin.paramSources?.[param]?.scriptPath?.trim()) { return false; }
    return !hasOwnParamValue(pin, param);
}

/** Parameter half of a resolution key, or null when the key belongs to another instance. */
function paramFromResolutionKey(pin: TypeInstance, key: string): string | null {
    const sep = key.indexOf('\u0000');
    return sep >= 0 && key.slice(0, sep) === pin.id ? key.slice(sep + 1) : null;
}

/** Escape a parameter name for use inside a quoted attribute selector. */
function cssEscapeAttr(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Pointer dataset flag a type change implies, or undefined to leave the row's flag untouched. */
function fieldRowPtrFlag(value: string, isBitFieldRef: boolean): string | undefined {    if (isBitFieldRef || value.startsWith('enum:')) { return ''; }
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

/** Reflect the show-hidden flag on the header toggle button (active + aria-pressed). */
function applyShowHiddenButtonState(btn: Element | null, show: boolean): void {
    if (!btn) { return; }
    btn.classList.toggle('active', show);
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
}

function pinFormHeader(pin: TypeInstance | null): string {
    return pin ? '\u270E Edit Instance' : '\uff0b Add instance';
}

function pinFormClass(pin: TypeInstance | null): string {
    return pin ? 'oa-form-hdr-edit' : 'oa-form-hdr-new';
}

function pinFormConfirmLabel(pin: TypeInstance | null): string {
    return pin ? 'Save' : 'Add';
}
