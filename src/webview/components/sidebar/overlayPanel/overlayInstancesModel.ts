import type { BitFieldChild, TypeDef, TypeField, TypeInstance, TypePointerSource } from '../../../../core/types';
import { withCleanedBitChildren } from '../../../../core/overlay/bitChildren';

export type PinIdFactory = () => string;

export type TypeInstanceDraft = {
    typeId: string;
    addr: number;
    name: string;
};

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
    return {
        id: makeId(),
        typeId: draft.typeId,
        addr: draft.addr,
        name: draft.name,
    };
}

export function withEditedTypeInstance(
    pins: TypeInstance[],
    index: number,
    edit: { name: string; addr: number; typeId: string },
): TypeInstance[] {
    const pin = pins[index];
    if (!pin) { return pins; }
    const next = [...pins];
    next[index] = {
        ...pin,
        name: edit.name || pin.name,
        addr: edit.addr,
        typeId: edit.typeId,
    };
    return next;
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
