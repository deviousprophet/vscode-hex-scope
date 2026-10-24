import type {
    BitFieldChild, TypeDef, TypeField, TypeInstance, TypeInstanceAddressSource, TypeInstanceParamSource,
    TypeParam, TypePointerSource,
} from '../../../../core/types';
import { withCleanedBitChildren } from '../../../../core/overlay/bitChildren';
import {
    appendUnknownParamErrors, declaredParamNames, resolveTypeParams,
} from '../../../../core/overlay/overlayCodec';
import type { LayoutParams, LayoutValidation } from '../../../../core/overlay/overlayCodec';

export type PinIdFactory = () => string;

export type TypeInstanceDraft = {
    typeId: string;
    addr: number;
    name: string;
    /** Declared parameter values (only keys declared by the selected type are kept). */
    paramValues?: Record<string, number>;
    /** Authored script sources for size parameters (declared keys only). */
    paramSources?: Record<string, TypeInstanceParamSource>;
    /** Authored script address source; absent = fixed address. */
    addressSource?: TypeInstanceAddressSource;
};

/**
 * Transient (never persisted) script-address resolution for one instance.
 * `generation` is the document generation the result belongs to.
 */
export type AddressResolution =
    | { status: 'resolving' }
    | { status: 'resolved'; addr: number; generation: number }
    | { status: 'stale'; addr?: number; generation: number }
    /** `lastAddr` keeps the previous successful address visible (dimmed) after a failed refresh. */
    | { status: 'error'; message: string; generation: number; errorType?: string; lastAddr?: number };

/** True when the instance takes its base address from a script. */
export function instanceUsesScriptAddress(pin: Pick<TypeInstance, 'addressSource'>): boolean {
    return Boolean(pin.addressSource?.scriptPath?.trim());
}

/**
 * Transient (never persisted) script-size resolution for one instance parameter.
 * `generation` is the document generation the result belongs to.
 */
export type ParamResolution =
    | { status: 'resolving' }
    | { status: 'resolved'; value: number; generation: number }
    | { status: 'stale'; value?: number; generation: number }
    /** `lastValue` keeps the previous successful value visible (dimmed) after a failed refresh. */
    | { status: 'error'; message: string; generation: number; errorType?: string; lastValue?: number };

/** Stable transient-map key for one instance parameter. */
export type ParamResolutionKey = `${string}\u0000${string}`;

export function paramResolutionKey(pinId: string, param: string): ParamResolutionKey {
    return `${pinId}\u0000${param}`;
}

/** Split a resolution key back into its instance and parameter halves. */
export function parseParamResolutionKey(key: string): { pinId: string; param: string } | null {
    const separator = key.indexOf('\u0000');
    if (separator < 0) { return null; }
    const pinId = key.slice(0, separator);
    const param = key.slice(separator + 1);
    return pinId && param ? { pinId, param } : null;
}

/** True when at least one declared parameter takes its value from a script. */
export function instanceUsesScriptParams(pin: Pick<TypeInstance, 'paramSources'>): boolean {
    return Object.keys(pin.paramSources ?? {}).some(name => Boolean(pin.paramSources?.[name]?.scriptPath?.trim()));
}

/** True when the instance is resolved (address and/or parameter values) by scripts. */
export function instanceUsesScriptResolution(
    pin: Pick<TypeInstance, 'addressSource' | 'paramSources'>,
): boolean {
    return instanceUsesScriptAddress(pin) || instanceUsesScriptParams(pin);
}

/**
 * Effective layout parameters: authored `paramValues` win over transient
 * script-resolved values, which win over the type parameter defaults.
 * Returns the first missing/invalid parameter as an error (never a silent 0/1).
 */
export function effectiveInstanceParams(
    def: TypeDef,
    pin: Pick<TypeInstance, 'paramValues'>,
    resolved: ReadonlyMap<string, number>,
): LayoutValidation<Record<string, number>> {
    const merged: Record<string, number> = {};
    for (const [name, value] of resolved) { merged[name] = value; }
    for (const [name, value] of Object.entries(pin.paramValues ?? {})) { merged[name] = value; }
    return resolveTypeParams(def, merged);
}

/** Resolved (successful) transient values for one instance, keyed by parameter name. */
export function resolvedInstanceParams(
    pinId: string,
    resolutions: ReadonlyMap<ParamResolutionKey, ParamResolution>,
): Map<string, number> {
    const values = new Map<string, number>();
    for (const [key, resolution] of resolutions) {
        appendResolvedParam(values, pinId, key, resolution);
    }
    return values;
}

function appendResolvedParam(
    values: Map<string, number>,
    pinId: string,
    key: string,
    resolution: ParamResolution,
): void {
    const parsed = parseParamResolutionKey(key);
    if (!parsed || parsed.pinId !== pinId) { return; }
    if (resolution.status !== 'resolved') { return; }
    values.set(parsed.param, resolution.value);
}

/**
 * Editor/save-time validation for script parameter sources: undeclared names,
 * empty paths, a manual value plus a source for the same parameter, and a
 * declared parameter with no value, source, or default.
 */
export function validateInstanceParamConfig(
    def: TypeDef,
    values: LayoutParams | undefined,
    sources: Readonly<Record<string, TypeInstanceParamSource>> | undefined,
): string[] {
    const declared = declaredParamNames(def);
    const errors = [
        ...sourceConfigErrors(def, values, sources, declared),
        ...unknownValueParamErrors(def, values, declared),
        ...declaredParamConfigErrors(def, values, sources),
    ];
    return [...new Set(errors)];
}

function sourceConfigErrors(
    def: TypeDef,
    values: LayoutParams | undefined,
    sources: Readonly<Record<string, TypeInstanceParamSource>> | undefined,
    declared: ReadonlySet<string>,
): string[] {
    const errors: string[] = [];
    for (const key of Object.keys(sources ?? {})) {
        appendSourceConfigErrors(def, key, values, sources, declared, errors);
    }
    return errors;
}

function appendSourceConfigErrors(
    def: TypeDef,
    key: string,
    values: LayoutParams | undefined,
    sources: Readonly<Record<string, TypeInstanceParamSource>> | undefined,
    declared: ReadonlySet<string>,
    errors: string[],
): void {
    if (!declared.has(key)) { errors.push(`Type "${def.name}": unknown parameter "${key}".`); }
    if (hasParam(values, key)) {
        errors.push(`Parameter "${key}" cannot have both a manual value and a script source.`);
    }
    if (!sourcePath(sources, key)) { errors.push(`Parameter "${key}": select a size script.`); }
}

function sourcePath(
    sources: Readonly<Record<string, TypeInstanceParamSource>> | undefined,
    key: string,
): string {
    return trimmedSourcePath(sources?.[key]);
}

function unknownValueParamErrors(
    def: TypeDef,
    values: LayoutParams | undefined,
    declared: ReadonlySet<string>,
): string[] {
    const errors: string[] = [];
    appendUnknownParamErrors(def, Object.keys(values ?? {}), declared, errors);
    return errors;
}

function declaredParamConfigErrors(
    def: TypeDef,
    values: LayoutParams | undefined,
    sources: Readonly<Record<string, TypeInstanceParamSource>> | undefined,
): string[] {
    const errors: string[] = [];
    for (const param of def.params ?? []) {
        const error = declaredParamError(def, param, values, sources);
        if (error) { errors.push(error); }
    }
    return errors;
}

function declaredParamError(
    def: TypeDef,
    param: TypeParam,
    values: LayoutParams | undefined,
    sources: Readonly<Record<string, TypeInstanceParamSource>> | undefined,
): string | null {
    if (hasParam(values, param.name)) { return manualParamError(def, param, values); }
    if (hasOwnParamSource(sources, param.name)) { return null; }
    return missingParamError(def, param);
}

function manualParamError(def: TypeDef, param: TypeParam, values: LayoutParams | undefined): string | null {
    return isPositiveParamValue(values?.[param.name])
        ? null
        : `Type "${def.name}": parameter "${param.name}" must be a positive integer.`;
}

function hasOwnParamSource(
    sources: Readonly<Record<string, TypeInstanceParamSource>> | undefined,
    name: string,
): boolean {
    return Boolean(sources) && Object.prototype.hasOwnProperty.call(sources, name);
}

function missingParamError(def: TypeDef, param: TypeParam): string | null {
    return param.default === undefined ? `Type "${def.name}": parameter "${param.name}" has no value.` : null;
}

/**
 * Row-level blocking reason for an instance's script parameters. Authored
 * values win, so only sourced parameters without a manual value are checked.
 * A pending/stale/failed parameter blocks decode; a resolved one does not.
 */
export function instanceParamResolutionError(
    def: TypeDef,
    pin: Pick<TypeInstance, 'id' | 'paramValues' | 'paramSources'>,
    resolutions: ReadonlyMap<ParamResolutionKey, ParamResolution>,
): string | undefined {
    for (const param of def.params ?? []) {
        const error = sourcedParamError(pin, param.name, resolutions);
        if (error) { return error; }
    }
    return undefined;
}

/** Resolution error for one script-sourced parameter (manual values are never sourced). */
function sourcedParamError(
    pin: Pick<TypeInstance, 'id' | 'paramValues' | 'paramSources'>,
    name: string,
    resolutions: ReadonlyMap<ParamResolutionKey, ParamResolution>,
): string | undefined {
    if (!isSourcedParam(pin, name)) { return undefined; }
    return paramResolutionError(name, resolutions.get(paramResolutionKey(pin.id, name)));
}

/** A parameter whose value comes from a script (manual values win, so they are not sourced). */
function isSourcedParam(
    pin: Pick<TypeInstance, 'paramValues' | 'paramSources'>,
    name: string,
): boolean {
    if (hasParam(pin.paramValues, name)) { return false; }
    return Boolean(pin.paramSources?.[name]);
}

function paramResolutionError(name: string, resolution: ParamResolution | undefined): string | undefined {
    if (!resolution) { return `Resolving parameter "${name}"…`; }
    return statusResolutionError(name, resolution);
}

function statusResolutionError(name: string, resolution: ParamResolution): string | undefined {
    if (resolution.status === 'resolving') { return `Resolving parameter "${name}"…`; }
    if (resolution.status === 'stale') { return `Parameter "${name}" is stale.`; }
    if (resolution.status === 'error') { return resolution.message; }
    return undefined;
}

function hasParam(values: LayoutParams | undefined, name: string): boolean {
    return Boolean(values) && Object.prototype.hasOwnProperty.call(values, name);
}

function isPositiveParamValue(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Effective base address for decoding. A script source always wins over `addr`;
 * while resolving, stale, or failed there is no safe address (never fall back
 * silently to the authored `addr`). Instances without a source keep `addr`.
 */
export function effectiveInstanceAddress(
    pin: Pick<TypeInstance, 'id' | 'addr' | 'addressSource'>,
    resolutions: ReadonlyMap<string, AddressResolution>,
): number | null {
    if (!instanceUsesScriptAddress(pin)) { return pin.addr; }
    const resolution = resolutions.get(pin.id);
    return resolution?.status === 'resolved' ? resolution.addr : null;
}

/** Save-time validation for an authored address source (empty path, pointer conflict). */
export function addressSourceError(pin: Pick<TypeInstance, 'addressSource' | 'pointerSources'>): string | null {
    const source = pin.addressSource;
    if (!source) { return null; }
    if (!source.scriptPath.trim()) { return 'Select an address script.'; }
    return hasPointerSources(pin)
        ? 'An instance created by a pointer cannot take its address from a script.'
        : null;
}

function hasPointerSources(pin: Pick<TypeInstance, 'pointerSources'>): boolean {
    return Boolean(pin.pointerSources && pin.pointerSources.length > 0);
}

export type PointerTypeInstanceInput = {
    sourcePin: Pick<TypeInstance, 'id' | 'name'>;
    sourceTypeId: string;
    sourceFieldPath: string;
    sourceFieldByteOffset: number;
    sourceBaseAddr: number;
    targetAddress: number;
    targetTypeId: string;
};

export type PointerTypeInstanceResult = {
    pins: TypeInstance[];
    pin: TypeInstance;
};

export function parseTypeInstanceAddressInput(raw: string): number | null {
    const text = raw.trim();
    const hex = text.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]+$/.test(hex)) { return null; }
    const addr = Number.parseInt(hex, 16);
    return Number.isSafeInteger(addr) && addr <= 0xFFFFFFFF ? addr : null;
}

export function makeTypeInstance(draft: TypeInstanceDraft, makeId: PinIdFactory): TypeInstance {
    const instance: TypeInstance = {
        id: makeId(),
        typeId: draft.typeId,
        addr: draft.addr,
        name: draft.name,
    };
    assignOptionalParamValues(instance, draft.paramValues);
    assignOptionalParamSources(instance, draft.paramSources);
    assignOptionalAddressSource(instance, draft.addressSource);
    return instance;
}

/** Author edits applied to an existing instance. */
export type TypeInstanceEdit = {
    name: string;
    addr: number;
    typeId: string;
    paramValues?: Record<string, number>;
    paramSources?: Record<string, TypeInstanceParamSource> | null;
    addressSource?: TypeInstanceAddressSource | null;
};

export function withEditedTypeInstance(
    pins: TypeInstance[],
    index: number,
    edit: TypeInstanceEdit,
): TypeInstance[] {
    const pin = pins[index];
    if (!pin) { return pins; }
    const next = [...pins];
    next[index] = editedTypeInstance(pin, edit);
    return next;
}

function editedTypeInstance(pin: TypeInstance, edit: TypeInstanceEdit): TypeInstance {
    const updated: TypeInstance = {
        ...pin,
        name: edit.name || pin.name,
        addr: edit.addr,
        typeId: edit.typeId,
    };
    assignOptionalParamValues(updated, edit.paramValues);
    assignOptionalParamSources(updated, edit.paramSources);
    assignOptionalAddressSource(updated, edit.addressSource);
    return updated;
}

function assignOptionalParamValues(instance: TypeInstance, values: Record<string, number> | undefined): void {
    if (values && Object.keys(values).length > 0) { instance.paramValues = { ...values }; return; }
    delete instance.paramValues;
}

function assignOptionalParamSources(
    instance: TypeInstance,
    sources: Record<string, TypeInstanceParamSource> | null | undefined,
): void {
    const cleaned = cleanParamSources(sources ?? undefined);
    if (cleaned) { instance.paramSources = cleaned; return; }
    delete instance.paramSources;
}

function assignOptionalAddressSource(
    instance: TypeInstance,
    source: TypeInstanceAddressSource | null | undefined,
): void {
    const cleaned = cleanAddressSource(source ?? undefined);
    if (cleaned) { instance.addressSource = cleaned; return; }
    delete instance.addressSource;
}

/** Trim parameter-source paths; empty paths author no source. */
function cleanParamSources(
    sources: Record<string, TypeInstanceParamSource> | undefined,
): Record<string, TypeInstanceParamSource> | undefined {
    if (!sources) { return undefined; }
    const cleaned = cleanedParamSourceEntries(sources);
    return hasEntries(cleaned) ? cleaned : undefined;
}

function cleanedParamSourceEntries(
    sources: Record<string, TypeInstanceParamSource>,
): Record<string, TypeInstanceParamSource> {
    const cleaned: Record<string, TypeInstanceParamSource> = {};
    for (const [name, source] of Object.entries(sources)) {
        const scriptPath = trimmedSourcePath(source);
        if (name && scriptPath) { cleaned[name] = { scriptPath }; }
    }
    return cleaned;
}

function trimmedSourcePath(source: { scriptPath?: string } | undefined): string {
    const scriptPath = source?.scriptPath;
    return typeof scriptPath === 'string' ? scriptPath.trim() : '';
}

function hasEntries(record: Record<string, unknown>): boolean {
    return Object.keys(record).length > 0;
}

/** Trim a source path; an empty path authors no source. */
function cleanAddressSource(source: TypeInstanceAddressSource | undefined): TypeInstanceAddressSource | undefined {
    const scriptPath = source?.scriptPath.trim() ?? '';
    return scriptPath ? { scriptPath } : undefined;
}

export function withoutTypeInstance(pins: TypeInstance[], index: number): TypeInstance[] {
    return pins.filter((_, i) => i !== index);
}

export function withoutTypeDefinition(
    types: TypeDef[],
    pins: TypeInstance[],
    typeId: string,
): { types: TypeDef[]; pins: TypeInstance[] } {
    return {
        types: types
            .filter(d => d.id !== typeId)
            .map(d => withoutTypeFieldRefs(d, typeId)),
        pins: pins.filter(p => p.typeId !== typeId),
    };
}

/** Strip references to a deleted type so no orphan reference survives. */
function withoutTypeFieldRefs(def: TypeDef, typeId: string): TypeDef {
    let next = removeTypeFieldRefs(def, typeId);
    next = removeTypeChildRefs(next, typeId);
    return removeTypeDefChildRefs(next, typeId);
}

/** Drop fields whose `refTypeId` is the deleted type. */
function removeTypeFieldRefs(def: TypeDef, typeId: string): TypeDef {
    const fields = def.fields.filter(f => f.refTypeId !== typeId);
    return fields.length === def.fields.length ? def : { ...def, fields };
}

/** Clear each remaining field's inline bit-child references. */
function removeTypeChildRefs(def: TypeDef, typeId: string): TypeDef {
    const cleanedFields = def.fields.map(f => withCleanedBitChildren(f, child => withoutBitChildRef(child, typeId)));
    return fieldListChanged(def.fields, cleanedFields) ? { ...def, fields: cleanedFields } : def;
}

/** Clear a standalone `kind: 'bitfield'` def's own child references. */
function removeTypeDefChildRefs(def: TypeDef, typeId: string): TypeDef {
    return withCleanedBitChildren(def, child => withoutBitChildRef(child, typeId));
}

function fieldListChanged(before: readonly TypeField[], after: readonly TypeField[]): boolean {
    return before.some((f, i) => f !== after[i]);
}

function withoutBitChildRef(child: BitFieldChild, typeId: string): BitFieldChild {
    if (child.refTypeId !== typeId) { return child; }
    const { refTypeId: _ref, ...rest } = child;
    return rest;
}

export function uniqueTypeInstanceName(
    pins: readonly TypeInstance[],
    initialName: string,
    nextName: (n: number) => string,
): string {
    const takenPinNames = new Set(pins.map(p => p.name));
    let candidate = initialName;
    let n = 1;
    while (takenPinNames.has(candidate)) { candidate = nextName(n++); }
    return candidate;
}

export function upsertPointerTypeInstance(
    pins: readonly TypeInstance[],
    input: PointerTypeInstanceInput,
    makeId: PinIdFactory,
): PointerTypeInstanceResult {
    const pointerSource = makePointerSource(input);
    const existingIndex = pins.findIndex(candidate =>
        candidate.addr === input.targetAddress && candidate.typeId === input.targetTypeId,
    );
    if (existingIndex >= 0) {
        const nextPins = [...pins];
        nextPins[existingIndex] = withPointerSource(nextPins[existingIndex], pointerSource);
        return { pins: nextPins, pin: nextPins[existingIndex] };
    }

    const pin = createPointerTypeInstance(pins, input, pointerSource, makeId);
    return { pins: [...pins, pin], pin };
}

function makePointerSource(input: PointerTypeInstanceInput): TypePointerSource {
    return {
        sourcePinId: input.sourcePin.id,
        sourcePinName: input.sourcePin.name,
        sourceTypeId: input.sourceTypeId,
        sourceFieldPath: input.sourceFieldPath,
        pointerStorageAddress: input.sourceBaseAddr + input.sourceFieldByteOffset,
        targetAddress: input.targetAddress,
    };
}

export function samePointerSource(a: TypePointerSource, b: TypePointerSource): boolean {
    return pointerSourceIdentity(a).every((value, idx) => value === pointerSourceIdentity(b)[idx]);
}

function createPointerTypeInstance(
    pins: readonly TypeInstance[],
    input: PointerTypeInstanceInput,
    pointerSource: TypePointerSource,
    makeId: PinIdFactory,
): TypeInstance {
    return {
        id: makeId(),
        typeId: input.targetTypeId,
        addr: input.targetAddress,
        name: nextPointerTypeInstanceName(pins, input.sourcePin.name, input.sourceFieldPath, input.targetAddress),
        pointerSources: [pointerSource],
    };
}

function withPointerSource(pin: TypeInstance, source: TypePointerSource): TypeInstance {
    if (pin.pointerSources?.some(existing => samePointerSource(existing, source))) { return pin; }
    return {
        ...pin,
        pointerSources: [...(pin.pointerSources ?? []), source],
    };
}

function nextPointerTypeInstanceName(
    pins: readonly TypeInstance[],
    sourceName: string,
    fieldPath: string,
    targetAddr: number,
): string {
    const base = `${sourceName}.${fieldPath} @${targetAddr.toString(16).toUpperCase().padStart(8, '0')}`;
    return uniqueTypeInstanceName(pins, base, n => `${base}_${n}`);
}

function pointerSourceIdentity(source: TypePointerSource): Array<string | number> {
    return [
        source.sourcePinId,
        source.sourceTypeId,
        source.sourceFieldPath,
        source.pointerStorageAddress,
        source.targetAddress,
    ];
}
