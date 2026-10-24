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

/** Non-null object as a record (arrays included, matching the item guard). */
function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** Non-null, non-array object as a record (the shape every optional entry must have). */
function asPlainRecord(value: unknown): Record<string, unknown> | null {
    const record = asRecord(value);
    return record && !Array.isArray(record) ? record : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function trimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** True when `raw` is a plain object with exactly `count` own keys. */
function hasPlainKeyCount(raw: unknown, count: number): boolean {
    const record = asPlainRecord(raw);
    return record !== null && Object.keys(record).length === count;
}

/** Copy `record` without `key` (the drop path for every optional entry). */
function copyWithoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
    const next: Record<string, unknown> = { ...record };
    delete next[key];
    return next;
}

function dropRecordKey(record: Record<string, unknown>, key: string): TypeInstance {
    return copyWithoutKey(record, key) as unknown as TypeInstance;
}

/** Copy `record` without `key`, re-adding it only when the cleaned value is non-empty. */
function withCleanedEntry(record: Record<string, unknown>, key: string, cleaned: Record<string, unknown>): TypeInstance {
    const next = copyWithoutKey(record, key);
    if (Object.keys(cleaned).length > 0) { next[key] = cleaned; }
    return next as unknown as TypeInstance;
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
    const params = isNamedKind(def) ? [] : sanitizeParamList(def.params);
    const fields = cleanCountParamFields(def, params);
    if (!paramsChangedForDef(def, params) && !fieldsChangedForDef(def, fields)) { return def; }
    return withCleanedParams(def, fields, params);
}

/** Named kinds (`bitfield` / `enum`) never declare size parameters. */
function isNamedKind(def: TypeDef): boolean {
    return def.kind === 'bitfield' || def.kind === 'enum';
}

function paramsChangedForDef(def: TypeDef, params: TypeParam[]): boolean {
    return isNamedKind(def) ? def.params !== undefined : paramsChanged(def.params, params);
}

function cleanCountParamFields(def: TypeDef, params: TypeParam[]): TypeField[] {
    if (!Array.isArray(def.fields)) { return def.fields; }
    const names = new Set(params.map(param => param.name));
    return def.fields.map(field => danglingCountParamField(field, names));
}

function fieldsChangedForDef(def: TypeDef, fields: TypeField[]): boolean {
    if (!Array.isArray(def.fields)) { return false; }
    return def.fields.some((field, i) => field !== fields[i]);
}

function withCleanedParams(def: TypeDef, fields: TypeField[], params: TypeParam[]): TypeDef {
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
    for (const param of raw.map(entry => sanitizeParamEntry(entry))) {
        appendUniqueParam(out, seen, param);
    }
    return out;
}

function appendUniqueParam(out: TypeParam[], seen: Set<string>, param: TypeParam | null): void {
    if (!param || seen.has(param.name)) { return; }
    seen.add(param.name);
    out.push(param);
}

function sanitizeParamEntry(raw: unknown): TypeParam | null {
    const candidate = asParamCandidate(raw);
    return candidate ? buildSanitizedParam(candidate) : null;
}

function asParamCandidate(raw: unknown): Partial<TypeParam> | null {
    if (!raw || typeof raw !== 'object') { return null; }
    return raw as Partial<TypeParam>;
}

type ValidParamDeclaration = Partial<TypeParam> & { name: string; kind: 'size' };

function buildSanitizedParam(candidate: Partial<TypeParam>): TypeParam | null {
    if (!isValidParamDeclaration(candidate)) { return null; }
    const param: TypeParam = { name: candidate.name, kind: 'size' };
    if (candidate.default !== undefined) { param.default = candidate.default; }
    return param;
}

function isValidParamDeclaration(candidate: Partial<TypeParam>): candidate is ValidParamDeclaration {
    if (!isParamNameValid(candidate)) { return false; }
    if (candidate.kind !== 'size') { return false; }
    return isValidParamDefault(candidate.default);
}

function isParamNameValid(candidate: Partial<TypeParam>): candidate is Partial<TypeParam> & { name: string } {
    return typeof candidate.name === 'string' && PARAM_NAME_RE.test(candidate.name);
}

function isValidParamDefault(value: unknown): boolean {
    return value === undefined || isValidParamValue(value);
}

function paramsChanged(raw: TypeParam[] | undefined, cleaned: TypeParam[]): boolean {
    if (raw === undefined) { return cleaned.length > 0; }
    if (!Array.isArray(raw) || raw.length !== cleaned.length) { return true; }
    return raw.some((entry, i) => !sameParam(entry, cleaned[i]));
}

function sameParam(a: TypeParam | undefined, b: TypeParam | undefined): boolean {
    if (!a || !b) { return a === b; }
    return sameParamValue(a, b);
}

function sameParamValue(a: TypeParam, b: TypeParam): boolean {
    return a.name === b.name && a.kind === b.kind && a.default === b.default;
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
    const record = asRecord(item);
    if (!record || !hasOwn(record, 'paramSources')) { return item; }
    const cleaned = cleanParamSourceEntries(record);
    if (paramSourcesUnchanged(record.paramSources, cleaned)) { return item; }
    return withCleanedEntry(record, 'paramSources', cleaned);
}

function cleanParamSourceEntries(record: Record<string, unknown>): Record<string, { scriptPath: string }> {
    const manual = manualParamValues(record);
    const cleaned: Record<string, { scriptPath: string }> = {};
    for (const [key, value] of Object.entries(asPlainRecord(record.paramSources) ?? {})) {
        const entry = sanitizedParamSource(key, value, manual);
        if (entry) { cleaned[entry.key] = entry.source; }
    }
    return cleaned;
}

function manualParamValues(record: Record<string, unknown>): Record<string, unknown> {
    return asPlainRecord(record.paramValues) ?? {};
}

/** One parameter-source entry; null when the name/path is unusable or a manual value wins. */
function sanitizedParamSource(
    key: string,
    value: unknown,
    manual: Record<string, unknown>,
): { key: string; source: { scriptPath: string } } | null {
    if (!isUsableParamSource(key, manual)) { return null; }
    const scriptPath = trimmedString(asPlainRecord(value)?.scriptPath);
    if (!scriptPath) { return null; }
    return { key, source: { scriptPath } };
}

function isUsableParamSource(key: string, manual: Record<string, unknown>): boolean {
    return PARAM_NAME_RE.test(key) && !hasOwn(manual, key);
}

/** True when every surviving source matches the raw entry with the same key count. */
function paramSourcesUnchanged(raw: unknown, cleaned: Record<string, { scriptPath: string }>): boolean {
    if (!hasPlainKeyCount(raw, Object.keys(cleaned).length)) { return false; }
    const record = asPlainRecord(raw) ?? {};
    return Object.entries(cleaned).every(([key, source]) => sourcePathMatches(record[key], source.scriptPath));
}

function sourcePathMatches(raw: unknown, scriptPath: string): boolean {
    const candidate = asPlainRecord(raw);
    return typeof candidate?.scriptPath === 'string' && candidate.scriptPath === scriptPath;
}

/**
 * Address-source seam: keep a non-empty `addressSource.scriptPath` by identity,
 * drop an empty/malformed source, and drop a source that conflicts with
 * pointer-created metadata (load stays lenient; save-side validation rejects it).
 */
function sanitizeInstanceAddressSource(item: TypeInstance): TypeInstance {
    const record = asRecord(item);
    if (!record || !hasOwn(record, 'addressSource')) { return item; }
    if (isKeptAddressSource(record)) { return item; }
    return dropRecordKey(record, 'addressSource');
}

/** A non-empty path with no pointer-created metadata keeps the source by identity. */
function isKeptAddressSource(record: Record<string, unknown>): boolean {
    const scriptPath = trimmedString(asPlainRecord(record.addressSource)?.scriptPath);
    return Boolean(scriptPath) && pointerSourceCount(record) === 0;
}

function pointerSourceCount(record: Record<string, unknown>): number {
    return Array.isArray(record.pointerSources) ? record.pointerSources.length : 0;
}

function sanitizeInstanceParamValues(item: unknown): TypeInstance {
    const record = asRecord(item);
    if (!record || !hasOwn(record, 'paramValues')) { return item as TypeInstance; }
    const cleaned = cleanParamValues(record.paramValues);
    if (hasPlainKeyCount(record.paramValues, Object.keys(cleaned).length)) { return item as TypeInstance; }
    return withCleanedEntry(record, 'paramValues', cleaned);
}

function cleanParamValues(raw: unknown): Record<string, number> {
    const cleaned: Record<string, number> = {};
    for (const [key, value] of Object.entries(asPlainRecord(raw) ?? {})) {
        if (isUsableParamValue(key, value)) { cleaned[key] = value; }
    }
    return cleaned;
}

function isUsableParamValue(key: string, value: unknown): value is number {
    return PARAM_NAME_RE.test(key) && isValidParamValue(value);
}
