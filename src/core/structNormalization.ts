/**
 * Struct-definition normalization. Runtime-neutral, so both the extension
 * host (session + migration) and tests share it.
 */

import type { BitFieldChild, EnumEntry, StructDef, StructField } from './types';
import { enumValueBound } from './structCodec';
import { hasSeenStructDefIdentity, rememberStructDefIdentity, structDefIdentity } from './structIdentities';

export type StructDefsNormalization = { defs: StructDef[]; changed: boolean };

export function normalizeStructDefsValue(value: unknown): StructDefsNormalization {
    if (!Array.isArray(value)) { return { defs: [], changed: false }; }
    const out: StructDef[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    let changed = false;

    for (const item of value) {
        changed = !appendUniqueStructDef(item, out, seenIds, seenNames) || changed;
    }
    const sanitized = sanitizeEnumDefs(out);
    return { defs: sanitized.defs, changed: changed || sanitized.changed };
}

function appendUniqueStructDef(item: unknown, out: StructDef[], seenIds: Set<string>, seenNames: Set<string>): boolean {
    const identity = structDefIdentity(item);
    if (!identity || hasSeenStructDefIdentity(identity, seenIds, seenNames)) { return false; }
    rememberStructDefIdentity(identity, seenIds, seenNames);
    out.push(item as StructDef);
    return true;
}

/**
 * Enum sanitization seam: drop enum entries that do not fit the base width and
 * strip references to enum defs that are missing or not enums, without breaking
 * load. Returns the original defs untouched (same references) when clean.
 */
function sanitizeEnumDefs(defs: StructDef[]): StructDefsNormalization {
    const enumIds = new Set(defs.filter(isEnumDefLike).map(def => def.id));
    let changed = false;
    const next = defs.map(def => {
        const cleaned = sanitizeStructDef(def, enumIds);
        if (cleaned !== def) { changed = true; }
        return cleaned;
    });
    return { defs: next, changed };
}

function isEnumDefLike(def: StructDef): boolean {
    return def.kind === 'enum';
}

function sanitizeStructDef(def: StructDef, enumIds: Set<string>): StructDef {
    let next = def;

    if (isEnumDefLike(def) && Array.isArray(def.entries)) {
        const entries = sanitizeEnumEntries(def.entries, def.baseType);
        if (entries !== def.entries) { next = { ...next, entries }; }
    }

    const fields = Array.isArray(next.fields) ? next.fields : [];
    const cleanedFields = fields
        .filter(field => !isDanglingEnumField(field, enumIds))
        .map(field => sanitizeStructField(field, enumIds));
    if (cleanedFields.length !== fields.length || cleanedFields.some((f, i) => f !== fields[i])) {
        next = { ...next, fields: cleanedFields };
    }

    if (Array.isArray(next.bitFields)) {
        const children = next.bitFields;
        const cleaned = children.map(child => sanitizeBitChild(child, enumIds));
        if (cleaned.some((c, i) => c !== children[i])) { next = { ...next, bitFields: cleaned }; }
    }

    return next;
}

/** A `type: 'enum'` field whose reference does not resolve to an enum def is unusable. */
function isDanglingEnumField(field: StructField, enumIds: Set<string>): boolean {
    if (field.type !== 'enum') { return false; }
    return field.isPointer === true || !field.refStructId || !enumIds.has(field.refStructId);
}

function sanitizeStructField(field: StructField, enumIds: Set<string>): StructField {
    const children = field.bitFields;
    if (!Array.isArray(children) || children.length === 0) { return field; }
    const cleaned = children.map(child => sanitizeBitChild(child, enumIds));
    return cleaned.some((c, i) => c !== children[i]) ? { ...field, bitFields: cleaned } : field;
}

function sanitizeBitChild(child: BitFieldChild, enumIds: Set<string>): BitFieldChild {
    if (child.refStructId === undefined || enumIds.has(child.refStructId)) { return child; }
    const { refStructId: _ref, ...rest } = child;
    return rest;
}

function sanitizeEnumEntries(entries: readonly EnumEntry[], baseType: string | undefined): EnumEntry[] {
    const bound = enumValueBound(baseType);
    const valid = entries.filter(entry => isValidEnumEntry(entry, bound));
    if (valid.length === entries.length) { return entries as EnumEntry[]; }
    return valid.map(entry => ({ ...entry }));
}

function isValidEnumEntry(entry: EnumEntry, bound: number): boolean {
    return typeof entry?.name === 'string' &&
        Number.isInteger(entry.value) &&
        entry.value >= 0 &&
        entry.value < bound;
}
