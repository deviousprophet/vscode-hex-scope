/**
 * Type-definition normalization. Runtime-neutral, so both the extension
 * host (session + migration) and tests share it.
 */

import type { BitFieldChild, EnumEntry, TypeDef, TypeField, TypeInstance, TypeParam } from '../types';
import { enumValueBound, migrateInlineBitFields } from './overlayCodec';
import { withCleanedBitChildren } from './bitChildren';
import { hasSeenTypeDefIdentity, rememberTypeDefIdentity, typeDefIdentity } from './overlayIdentities';

export type TypeDefsNormalization = { defs: TypeDef[]; changed: boolean };
export type TypeInstancesNormalization = { instances: TypeInstance[]; changed: boolean };

export function normalizeTypeDefsValue(value: unknown): TypeDefsNormalization {
    if (!Array.isArray(value)) { return { defs: [], changed: false }; }
    // General read path: the pre-rename aliases are retired (migration-internal),
    // so only the canonical v2 keys are read here.
    const collected = collectUniqueTypeDefs(value);
    // Legacy inline bit-field containers migrate before enum sanitization so the
    // generated `kind: 'bitfield'` defs' child enum refs are cleaned too.
    const migrated = migrateInlineBitFields(collected.defs);
    const sanitized = sanitizeEnumDefs(migrated.defs);
    const parametrized = sanitizeTypeParamDefs(sanitized.defs);
    return { defs: parametrized.defs, changed: anyPassChanged([collected, migrated, sanitized, parametrized]) };
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

// ── Template parameters / instance values ─────────────────────────

const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isValidParamValue(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Sanitize declared `params` and any dangling `countParam` references so an
 * old/hand-edited pool still loads. Malformed entries are dropped, surviving
 * siblings are preserved, and a clean def is returned by reference (no rewrite).
 */
function sanitizeTypeParamDefs(defs: TypeDef[]): TypeDefsNormalization {
    let changed = false;
    const next = defs.map(def => {
        const cleaned = sanitizeTypeParamDef(def);
        if (cleaned !== def) { changed = true; }
        return cleaned;
    });
    return { defs: next, changed };
}

function sanitizeTypeParamDef(def: TypeDef): TypeDef {
    const namedKind = def.kind === 'bitfield' || def.kind === 'enum';
    const params = namedKind ? [] : sanitizeParamList(def.params);
    const paramsDiffer = namedKind ? def.params !== undefined : paramsChanged(def.params, params);
    const names = new Set(params.map(param => param.name));
    const fields = Array.isArray(def.fields)
        ? def.fields.map(field => danglingCountParamField(field, names))
        : def.fields;
    const fieldsChanged = Array.isArray(def.fields) && fields.some((field, i) => field !== def.fields[i]);
    if (!paramsDiffer && !fieldsChanged) { return def; }

    const next: TypeDef = { ...def, fields };
    if (params.length > 0) { next.params = params; }
    else { delete next.params; }
    return next;
}

/** Parameters are only meaningful on a plain struct; drop them elsewhere. */
function sanitizeParamList(raw: TypeParam[] | undefined): TypeParam[] {
    if (!Array.isArray(raw)) { return []; }
    const seen = new Set<string>();
    const out: TypeParam[] = [];
    for (const entry of raw) {
        const param = sanitizeParamEntry(entry);
        if (!param || seen.has(param.name)) { continue; }
        seen.add(param.name);
        out.push(param);
    }
    return out;
}

function sanitizeParamEntry(raw: unknown): TypeParam | null {
    if (!raw || typeof raw !== 'object') { return null; }
    const candidate = raw as Partial<TypeParam>;
    if (typeof candidate.name !== 'string' || !PARAM_NAME_RE.test(candidate.name)) { return null; }
    if (candidate.kind !== 'size') { return null; }
    if (candidate.default !== undefined && !isValidParamValue(candidate.default)) { return null; }
    const param: TypeParam = { name: candidate.name, kind: 'size' };
    if (candidate.default !== undefined) { param.default = candidate.default; }
    return param;
}

function paramsChanged(raw: TypeParam[] | undefined, cleaned: TypeParam[]): boolean {
    if (raw === undefined) { return cleaned.length > 0; }
    if (!Array.isArray(raw) || raw.length !== cleaned.length) { return true; }
    return raw.some((entry, i) => !sameParam(entry, cleaned[i]));
}

function sameParam(a: TypeParam | undefined, b: TypeParam | undefined): boolean {
    return a?.name === b?.name && a?.kind === b?.kind && a?.default === b?.default;
}

/** A `countParam` whose name was dropped on load falls back to the literal `count`. */
function danglingCountParamField(field: TypeField, names: Set<string>): TypeField {
    if (field.countParam === undefined || names.has(field.countParam)) { return field; }
    const { countParam: _countParam, ...rest } = field;
    return rest;
}

/**
 * Instance normalization seam: drop malformed/non-integer `paramValues`
 * entries, keep valid siblings, and return clean data by reference. Unknown
 * parameter names are pruned by the editor when the instance is applied to
 * its type (load has no defs pool at this boundary).
 */
export function normalizeTypeInstances(value: unknown): TypeInstancesNormalization {
    if (!Array.isArray(value)) { return { instances: [], changed: false }; }
    let changed = false;
    const instances = value.map(item => {
        const withParams = sanitizeInstanceParamValues(item);
        const withSources = sanitizeInstanceParamSources(withParams);
        const cleaned = sanitizeInstanceAddressSource(withSources);
        if (cleaned !== item) { changed = true; }
        return cleaned;
    });
    return { instances, changed };
}

/**
 * Parameter-source seam: keep a non-empty workspace path for an identifier-like
 * parameter name, drop malformed/empty entries, and drop a source shadowed by a
 * manual `paramValues` entry (manual wins; the editor rejects authoring both).
 * Clean data is returned by reference.
 */
function sanitizeInstanceParamSources(item: TypeInstance): TypeInstance {
    if (!item || typeof item !== 'object') { return item; }
    const record = item as unknown as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, 'paramSources')) { return item; }
    const raw = record.paramSources;
    const manual = record.paramValues && typeof record.paramValues === 'object' && !Array.isArray(record.paramValues)
        ? record.paramValues as Record<string, unknown>
        : {};
    const cleaned: Record<string, { scriptPath: string }> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, val] of Object.entries(raw)) {
            if (!PARAM_NAME_RE.test(key) || Object.prototype.hasOwnProperty.call(manual, key)) { continue; }
            const source = val && typeof val === 'object' && !Array.isArray(val)
                ? val as Record<string, unknown>
                : null;
            const scriptPath = typeof source?.scriptPath === 'string' ? source.scriptPath.trim() : '';
            if (scriptPath) { cleaned[key] = { scriptPath }; }
        }
    }
    const rawKeyCount = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).length : -1;
    if (rawKeyCount >= 0 && rawKeyCount === Object.keys(cleaned).length) {
        const same = Object.entries(cleaned).every(([key, source]) => {
            const existing = (raw as Record<string, unknown>)[key];
            const candidate = existing && typeof existing === 'object' && !Array.isArray(existing)
                ? existing as Record<string, unknown>
                : null;
            return candidate?.scriptPath === source.scriptPath;
        });
        if (same) { return item; }
    }
    const { paramSources: _sources, ...rest } = record;
    return Object.keys(cleaned).length > 0
        ? { ...(rest as unknown as TypeInstance), paramSources: cleaned }
        : rest as unknown as TypeInstance;
}

/**
 * Address-source seam: keep a non-empty `addressSource.scriptPath` by identity,
 * drop an empty/malformed source, and drop a source that conflicts with
 * pointer-created metadata (load stays lenient; save-side validation rejects it).
 */
function sanitizeInstanceAddressSource(item: TypeInstance): TypeInstance {
    if (!item || typeof item !== 'object') { return item; }
    const record = item as unknown as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, 'addressSource')) { return item; }
    const raw = record.addressSource;
    const candidate = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null;
    const scriptPath = typeof candidate?.scriptPath === 'string' ? candidate.scriptPath.trim() : '';
    const pointerSources = Array.isArray(record.pointerSources) ? record.pointerSources : [];
    if (scriptPath && pointerSources.length === 0) { return item; }
    const { addressSource: _source, ...rest } = record;
    return rest as unknown as TypeInstance;
}

function sanitizeInstanceParamValues(item: unknown): TypeInstance {
    if (!item || typeof item !== 'object') { return item as TypeInstance; }
    const record = item as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, 'paramValues')) { return item as TypeInstance; }
    const raw = record.paramValues;
    const cleaned: Record<string, number> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, val] of Object.entries(raw)) {
            if (PARAM_NAME_RE.test(key) && isValidParamValue(val)) { cleaned[key] = val; }
        }
    }
    const rawKeyCount = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).length : -1;
    if (rawKeyCount >= 0 && rawKeyCount === Object.keys(cleaned).length) { return item as TypeInstance; }
    const { paramValues: _values, ...rest } = record;
    return Object.keys(cleaned).length > 0
        ? { ...(rest as unknown as TypeInstance), paramValues: cleaned }
        : rest as unknown as TypeInstance;
}
