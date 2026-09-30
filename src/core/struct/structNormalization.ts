/**
 * Struct-definition normalization. Runtime-neutral, so both the extension
 * host (session + migration) and tests share it.
 */

import type { BitFieldChild, EnumEntry, StructDef, StructField } from '../types';
import { enumValueBound, migrateInlineBitFields } from './structCodec';
import { withCleanedBitChildren } from './structBitChildren';
import { hasSeenStructDefIdentity, rememberStructDefIdentity, structDefIdentity } from './structIdentities';

export type StructDefsNormalization = { defs: StructDef[]; changed: boolean };

export function normalizeStructDefsValue(value: unknown): StructDefsNormalization {
    if (!Array.isArray(value)) { return { defs: [], changed: false }; }
    const collected = collectUniqueStructDefs(value);
    // Legacy inline bit-field containers migrate before enum sanitization so the
    // generated `kind: 'bitfield'` defs' child enum refs are cleaned too.
    const migrated = migrateInlineBitFields(collected.defs);
    const sanitized = sanitizeEnumDefs(migrated.defs);
    return { defs: sanitized.defs, changed: collected.changed || migrated.changed || sanitized.changed };
}

/** Keep the first occurrence of each def identity; report whether any item was dropped. */
function collectUniqueStructDefs(value: unknown[]): { defs: StructDef[]; changed: boolean } {
    const out: StructDef[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    let changed = false;
    for (const item of value) {
        if (!appendUniqueStructDef(item, out, seenIds, seenNames)) { changed = true; }
    }
    return { defs: out, changed };
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
    let next = sanitizeEnumEntriesForDef(def);
    next = sanitizeStructDefFields(next, enumIds);
    return withCleanedBitChildren(next, child => sanitizeBitChild(child, enumIds));
}

/** Drop enum entries that do not fit the base width (same ref when clean). */
function sanitizeEnumEntriesForDef(def: StructDef): StructDef {
    if (!isEnumDefLike(def) || !Array.isArray(def.entries)) { return def; }
    const entries = sanitizeEnumEntries(def.entries, def.baseType);
    return entries === def.entries ? def : { ...def, entries };
}

/** Strip dangling enum fields and clean each remaining field's inline children. */
function sanitizeStructDefFields(def: StructDef, enumIds: Set<string>): StructDef {
    const fields = Array.isArray(def.fields) ? def.fields : [];
    const cleanedFields = fields
        .filter(field => !isDanglingEnumField(field, enumIds))
        .map(field => withCleanedBitChildren(field, child => sanitizeBitChild(child, enumIds)));
    return structFieldListChanged(fields, cleanedFields) ? { ...def, fields: cleanedFields } : def;
}

function structFieldListChanged(before: readonly StructField[], after: readonly StructField[]): boolean {
    return before.length !== after.length || before.some((f, i) => f !== after[i]);
}

/** A `type: 'enum'` field whose reference does not resolve to an enum def is unusable. */
function isDanglingEnumField(field: StructField, enumIds: Set<string>): boolean {
    if (field.type !== 'enum') { return false; }
    return field.isPointer === true || !field.refStructId || !enumIds.has(field.refStructId);
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
    return isNamedEnumEntry(entry) && isEnumValueInRange(entry.value, bound);
}

function isNamedEnumEntry(entry: EnumEntry | undefined | null): boolean {
    return typeof entry?.name === 'string';
}

function isEnumValueInRange(value: number, bound: number): boolean {
    return Number.isInteger(value) && value >= 0 && value < bound;
}
