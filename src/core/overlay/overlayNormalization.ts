/**
 * Type-definition normalization. Runtime-neutral, so both the extension
 * host (session + migration) and tests share it.
 */

import type { BitFieldChild, EnumEntry, TypeDef, TypeField } from '../types';
import { enumValueBound, migrateInlineBitFields } from './overlayCodec';
import { withCleanedBitChildren } from './bitChildren';
import { hasSeenTypeDefIdentity, rememberTypeDefIdentity, typeDefIdentity } from './overlayIdentities';

export type TypeDefsNormalization = { defs: TypeDef[]; changed: boolean };

export function normalizeTypeDefsValue(value: unknown): TypeDefsNormalization {
    if (!Array.isArray(value)) { return { defs: [], changed: false }; }
    // General read path: the pre-rename aliases are retired (migration-internal),
    // so only the canonical v2 keys are read here.
    const collected = collectUniqueTypeDefs(value);
    // Legacy inline bit-field containers migrate before enum sanitization so the
    // generated `kind: 'bitfield'` defs' child enum refs are cleaned too.
    const migrated = migrateInlineBitFields(collected.defs);
    const sanitized = sanitizeEnumDefs(migrated.defs);
    return { defs: sanitized.defs, changed: anyPassChanged([collected, migrated, sanitized]) };
}

/** Any normalization pass reporting a change (keeps the orchestrator branch-light). */
function anyPassChanged(passes: ReadonlyArray<{ changed: boolean }>): boolean {
    return passes.some(pass => pass.changed);
}

/** Keep the first occurrence of each def identity; report whether any item was dropped. */
function collectUniqueTypeDefs(value: unknown[]): { defs: TypeDef[]; changed: boolean } {
    const out: TypeDef[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    let changed = false;
    for (const item of value) {
        if (!appendUniqueTypeDef(item, out, seenIds, seenNames)) { changed = true; }
    }
    return { defs: out, changed };
}

function appendUniqueTypeDef(item: unknown, out: TypeDef[], seenIds: Set<string>, seenNames: Set<string>): boolean {
    const identity = typeDefIdentity(item);
    if (!identity || hasSeenTypeDefIdentity(identity, seenIds, seenNames)) { return false; }
    rememberTypeDefIdentity(identity, seenIds, seenNames);
    out.push(item as TypeDef);
    return true;
}

/**
 * Enum sanitization seam: drop enum entries that do not fit the base width and
 * strip references to enum defs that are missing or not enums, without breaking
 * load. Returns the original defs untouched (same references) when clean.
 */
function sanitizeEnumDefs(defs: TypeDef[]): TypeDefsNormalization {
    const enumIds = new Set(defs.filter(isEnumDefLike).map(def => def.id));
    let changed = false;
    const next = defs.map(def => {
        const cleaned = sanitizeTypeDef(def, enumIds);
        if (cleaned !== def) { changed = true; }
        return cleaned;
    });
    return { defs: next, changed };
}

function isEnumDefLike(def: TypeDef): boolean {
    return def.kind === 'enum';
}

function sanitizeTypeDef(def: TypeDef, enumIds: Set<string>): TypeDef {
    let next = sanitizeEnumEntriesForDef(def);
    next = sanitizeTypeDefFields(next, enumIds);
    return withCleanedBitChildren(next, child => sanitizeBitChild(child, enumIds));
}

/** Drop enum entries that do not fit the base width (same ref when clean). */
function sanitizeEnumEntriesForDef(def: TypeDef): TypeDef {
    if (!isEnumDefLike(def) || !Array.isArray(def.entries)) { return def; }
    const entries = sanitizeEnumEntries(def.entries, def.baseType);
    return entries === def.entries ? def : { ...def, entries };
}

/** Strip dangling enum fields and clean each remaining field's inline children. */
function sanitizeTypeDefFields(def: TypeDef, enumIds: Set<string>): TypeDef {
    const fields = Array.isArray(def.fields) ? def.fields : [];
    const cleanedFields = fields
        .filter(field => !isDanglingEnumField(field, enumIds))
        .map(field => withCleanedBitChildren(field, child => sanitizeBitChild(child, enumIds)));
    return fieldListChanged(fields, cleanedFields) ? { ...def, fields: cleanedFields } : def;
}

function fieldListChanged(before: readonly TypeField[], after: readonly TypeField[]): boolean {
    return before.length !== after.length || before.some((f, i) => f !== after[i]);
}

/** A `type: 'enum'` field whose reference does not resolve to an enum def is unusable. */
function isDanglingEnumField(field: TypeField, enumIds: Set<string>): boolean {
    if (field.type !== 'enum') { return false; }
    return field.isPointer === true || !field.refTypeId || !enumIds.has(field.refTypeId);
}

function sanitizeBitChild(child: BitFieldChild, enumIds: Set<string>): BitFieldChild {
    return normalizeBitChildFlags(dropDanglingBitChildEnumRef(child, enumIds));
}

/** Strip a bit child's enum ref when it does not resolve to an enum def (same ref when clean). */
function dropDanglingBitChildEnumRef(child: BitFieldChild, enumIds: Set<string>): BitFieldChild {
    if (child.refTypeId === undefined || enumIds.has(child.refTypeId)) { return child; }
    const { refTypeId: _ref, ...rest } = child;
    return rest;
}

/**
 * A bit child's optional display flags are preserved as authored; an explicit
 * `false` is dropped so saved pools stay minimal (absent = visible). Mirrors the
 * field-level `normalizeOptionalFieldFlags`.
 */
function normalizeBitChildFlags(child: BitFieldChild): BitFieldChild {
    if (child.hidden !== false) { return child; }
    const { hidden: _hidden, ...rest } = child;
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
