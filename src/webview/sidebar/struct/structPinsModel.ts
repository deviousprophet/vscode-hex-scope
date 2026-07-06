import type { StructDef, StructPin, StructPointerSource } from '../../../core/types';

export type PinIdFactory = () => string;

export type StructPinDraft = {
    structId: string;
    addr: number;
    name: string;
};

export type PointerStructPinInput = {
    sourcePin: Pick<StructPin, 'id' | 'name'>;
    sourceStructId: string;
    sourceFieldPath: string;
    sourceFieldByteOffset: number;
    sourceBaseAddr: number;
    targetAddress: number;
    targetStructId: string;
};

export type PointerStructPinResult = {
    pins: StructPin[];
    pin: StructPin;
};

export function parseStructPinAddressInput(raw: string): number | null {
    const text = raw.trim();
    const hex = text.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]+$/.test(hex)) { return null; }
    const addr = Number.parseInt(hex, 16);
    return Number.isSafeInteger(addr) && addr <= 0xFFFFFFFF ? addr : null;
}

export function makeStructPin(draft: StructPinDraft, makeId: PinIdFactory): StructPin {
    return {
        id: makeId(),
        structId: draft.structId,
        addr: draft.addr,
        name: draft.name,
    };
}

export function withEditedStructPin(
    pins: StructPin[],
    index: number,
    edit: { name: string; addr: number; structId: string },
): StructPin[] {
    const pin = pins[index];
    if (!pin) { return pins; }
    const next = [...pins];
    next[index] = {
        ...pin,
        name: edit.name || pin.name,
        addr: edit.addr,
        structId: edit.structId,
    };
    return next;
}

export function withoutStructPin(pins: StructPin[], index: number): StructPin[] {
    return pins.filter((_, i) => i !== index);
}

export function withoutStructDefinition(
    structs: StructDef[],
    pins: StructPin[],
    structId: string,
): { structs: StructDef[]; pins: StructPin[] } {
    return {
        structs: structs.filter(d => d.id !== structId),
        pins: pins.filter(p => p.structId !== structId),
    };
}

export function uniqueStructPinName(
    pins: readonly StructPin[],
    initialName: string,
    nextName: (n: number) => string,
): string {
    const takenPinNames = new Set(pins.map(p => p.name));
    let candidate = initialName;
    let n = 1;
    while (takenPinNames.has(candidate)) { candidate = nextName(n++); }
    return candidate;
}

export function upsertPointerStructPin(
    pins: readonly StructPin[],
    input: PointerStructPinInput,
    makeId: PinIdFactory,
): PointerStructPinResult {
    const pointerSource = makeStructPointerSource(input);
    const existingIndex = pins.findIndex(candidate =>
        candidate.addr === input.targetAddress && candidate.structId === input.targetStructId,
    );
    if (existingIndex >= 0) {
        const nextPins = [...pins];
        nextPins[existingIndex] = withPointerSource(nextPins[existingIndex], pointerSource);
        return { pins: nextPins, pin: nextPins[existingIndex] };
    }

    const pin = createPointerStructPin(pins, input, pointerSource, makeId);
    return { pins: [...pins, pin], pin };
}

function makeStructPointerSource(input: PointerStructPinInput): StructPointerSource {
    return {
        sourcePinId: input.sourcePin.id,
        sourcePinName: input.sourcePin.name,
        sourceStructId: input.sourceStructId,
        sourceFieldPath: input.sourceFieldPath,
        pointerStorageAddress: input.sourceBaseAddr + input.sourceFieldByteOffset,
        targetAddress: input.targetAddress,
    };
}

export function samePointerSource(a: StructPointerSource, b: StructPointerSource): boolean {
    return pointerSourceIdentity(a).every((value, idx) => value === pointerSourceIdentity(b)[idx]);
}

function createPointerStructPin(
    pins: readonly StructPin[],
    input: PointerStructPinInput,
    pointerSource: StructPointerSource,
    makeId: PinIdFactory,
): StructPin {
    return {
        id: makeId(),
        structId: input.targetStructId,
        addr: input.targetAddress,
        name: nextPointerStructPinName(pins, input.sourcePin.name, input.sourceFieldPath, input.targetAddress),
        pointerSources: [pointerSource],
    };
}

function withPointerSource(pin: StructPin, source: StructPointerSource): StructPin {
    if (pin.pointerSources?.some(existing => samePointerSource(existing, source))) { return pin; }
    return {
        ...pin,
        pointerSources: [...(pin.pointerSources ?? []), source],
    };
}

function nextPointerStructPinName(
    pins: readonly StructPin[],
    sourceName: string,
    fieldPath: string,
    targetAddr: number,
): string {
    const base = `${sourceName}.${fieldPath} @${targetAddr.toString(16).toUpperCase().padStart(8, '0')}`;
    return uniqueStructPinName(pins, base, n => `${base}_${n}`);
}

function pointerSourceIdentity(source: StructPointerSource): Array<string | number> {
    return [
        source.sourcePinId,
        source.sourceStructId,
        source.sourceFieldPath,
        source.pointerStorageAddress,
        source.targetAddress,
    ];
}
