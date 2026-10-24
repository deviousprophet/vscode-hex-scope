// -- Type Overlay - pure codec (no DOM / VS Code API dependencies) --
// Contains field size helpers, decode logic, parser/serializer helpers, and type validation.

import type {
    BitFieldAllocation,
    BitFieldChild,
    EnumEntry,
    TypeBaseType,
    TypeDef,
    TypeDefKind,
    TypeField,
    TypeFieldType,
    TypeParam,
    TypeScalarFieldType,
} from '../types';

export type { TypeDef, TypeField };

export const MAX_NESTED_DEPTH = 32;
const POINTER_BYTE_SIZE = 4;

// -- Constants -----------------------------------------------------

export const FIELD_TYPES: TypeScalarFieldType[] = [
    'void', 'ascii',
    'uint8', 'uint16', 'uint32', 'uint64',
    'int8', 'int16', 'int32', 'int64',
    'float32', 'float64',
];

const FIELD_BYTE_SIZE: Record<TypeScalarFieldType, number> = {
    void: 0,
    ascii: 1,
    uint8: 1,
    int8: 1,
    uint16: 2,
    int16: 2,
    uint32: 4,
    int32: 4,
    float32: 4,
    pointer: POINTER_BYTE_SIZE,
    uint64: 8,
    int64: 8,
    float64: 8,
};

export type UnsignedScalarType = 'uint8' | 'uint16' | 'uint32' | 'uint64';

/**
 * One unsigned-width predicate shared by the codec and the editor: a scalar
 * type eligible as a bit-field storage base / enum width. `isUnsignedBaseType`
 * reads a raw authored string; the editor widens this one for select values.
 */
export function isUnsignedScalarType(type: TypeFieldType): type is UnsignedScalarType {
    return type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64';
}

function isUnsignedBaseType(type: string | undefined): type is TypeBaseType {
    return type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64';
}

/** Named-type discriminator; absent = plain struct. */
export function typeDefKind(def: TypeDef): TypeDefKind {
    return def.kind === 'bitfield' || def.kind === 'enum' ? def.kind : 'struct';
}

// -- Template parameters (size only) -------------------------------

/** Resolved size-parameter values for one type usage. */
export type LayoutParams = Readonly<Record<string, number>>;

/** Discriminated result for expected parameter-resolution failures. */
export type LayoutValidation<T> = { ok: true; value: T } | { ok: false; error: string };

/** A valid resolved count/parameter value: positive safe integer (never 0/negative/fractional). */
function isValidLayoutValue(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Resolve a type's parameter values: explicit instance values win, then the
 * declared default. The first missing/invalid parameter is reported by name.
 * Unknown keys in `instanceValues` are ignored here (validation reports them).
 */
export function resolveTypeParams(def: TypeDef, instanceValues?: LayoutParams): LayoutValidation<LayoutParams> {
    const values: Record<string, number> = {};
    for (const param of paramsOf(def)) {
        const error = resolvedParamError(def, param, instanceValues, values);
        if (error) { return { ok: false, error }; }
    }
    return { ok: true, value: values };
}

function resolvedParamError(
    def: TypeDef,
    param: TypeParam,
    instanceValues: LayoutParams | undefined,
    values: Record<string, number>,
): string | null {
    const raw = paramValueOrDefault(param, instanceValues);
    if (raw === undefined) { return `Type "${def.name}": parameter "${param.name}" has no value.`; }
    if (!isValidLayoutValue(raw)) {
        return `Type "${def.name}": parameter "${param.name}" must be a positive integer.`;
    }
    values[param.name] = raw;
    return null;
}

function paramsOf(def: TypeDef): TypeParam[] {
    return def.params ?? [];
}

/** Explicit instance value when present, otherwise the declared default. */
function paramValueOrDefault(param: TypeParam, values: LayoutParams | undefined): unknown {
    if (values && Object.prototype.hasOwnProperty.call(values, param.name)) { return values[param.name]; }
    return param.default;
}

/** Declared parameter names for a type (the one membership set validation uses). */
export function declaredParamNames(def: TypeDef): Set<string> {
    return new Set(paramsOf(def).map(param => param.name));
}

/** Push one unknown-parameter error per key the type does not declare. */
export function appendUnknownParamErrors(
    def: TypeDef,
    keys: readonly string[],
    declared: ReadonlySet<string>,
    errors: string[],
): void {
    for (const key of keys) {
        if (!declared.has(key)) { errors.push(unknownParamError(def, key)); }
    }
}

function unknownParamError(def: TypeDef, key: string): string {
    return `Type "${def.name}": unknown parameter "${key}".`;
}

/** Resolve to a plain map, falling back to `{}` when a required value is missing. */
function layoutParams(def: TypeDef, instanceValues?: LayoutParams): LayoutParams {
    const resolved = resolveTypeParams(def, instanceValues);
    return resolved.ok ? resolved.value : {};
}

/**
 * The element count a field contributes to layout: its resolved parameter when
 * `countParam` is set, otherwise the literal `count`. A missing/invalid parameter
 * yields `0` (no decode), never a silent 1 — validation reports it first.
 */
export function resolvedFieldCount(field: TypeField, params: LayoutParams): number {
    if (field.countParam === undefined) { return field.count; }
    const value = params[field.countParam];
    return isValidLayoutValue(value) ? value : 0;
}

/**
 * Validate an instance's explicit parameter values against a type: unknown
 * names, missing values without a default, and non-positive/invalid values.
 */
export function validateInstanceParamValues(def: TypeDef, values: LayoutParams | undefined): string[] {
    const errors: string[] = [];
    appendUnknownParamErrors(def, paramValueKeys(values), declaredParamNames(def), errors);
    for (const param of paramsOf(def)) {
        const error = instanceParamValueError(def, param, values);
        if (error) { errors.push(error); }
    }
    return errors;
}

function paramValueKeys(values: LayoutParams | undefined): string[] {
    return Object.keys(values ?? {});
}

function instanceParamValueError(def: TypeDef, param: TypeParam, values: LayoutParams | undefined): string | null {
    const value = paramValueOrDefault(param, values);
    if (value === undefined) { return `Type "${def.name}": parameter "${param.name}" has no value.`; }
    if (!isValidLayoutValue(value)) { return `Type "${def.name}": parameter "${param.name}" must be a positive integer.`; }
    return null;
}


/**
 * Resolve a `kind: 'enum'` target from a reference id. Returns null when the
 * reference is absent or does not point at an enum def.
 */
function enumDefById(refTypeId: string | undefined, byId: Map<string, TypeDef>): TypeDef | null {
    if (!refTypeId) { return null; }
    const target = byId.get(refTypeId);
    return target && typeDefKind(target) === 'enum' ? target : null;
}

/** Resolve the enum def referenced by a scalar `type: 'enum'` field (non-pointer only). */
function referencedEnumDef(field: TypeField, map: Map<string, TypeDef>): TypeDef | null {
    if (field.type !== 'enum' || field.isPointer) { return null; }
    return enumDefById(field.refTypeId, map);
}

/** Unsigned base width of an enum def (defaults to uint8 when unspecified/invalid). */
function enumBaseType(def: TypeDef): UnsignedScalarType {
    return isUnsignedBaseType(def.baseType) ? def.baseType : 'uint8';
}

/** First entry whose value matches, or undefined when the value is unmatched. */
export function matchEnumEntry(def: TypeDef, value: bigint): EnumEntry | undefined {
    return (def.entries ?? []).find(entry => isEnumEntryMatch(entry, value));
}

/** Whether an entry's value is a valid non-negative integer equal to `value`. */
function isEnumEntryMatch(entry: EnumEntry, value: bigint): boolean {
    return Number.isInteger(entry.value) && entry.value >= 0 && BigInt(entry.value) === value;
}

/** Canonical enum value label: `NAME (0xNN)`; `hexDigits` sizes the numeric part. */
export function formatEnumLabel(label: string, value: bigint, hexDigits: number): string {
    return `${label} (0x${value.toString(16).toUpperCase().padStart(hexDigits, '0')})`;
}

/** Hexadecimal digit count for an enum/bit value of `width` bits. */
export function enumHexDigits(width: number): number {
    return Math.max(1, Math.ceil(width / 4));
}


export function normalizeTypeField(field: TypeField): TypeField {
    const normalized = LEGACY_POINTER_NORMALIZERS[field.type]?.(field) ?? normalizePointerModifierField(field);
    return normalizeOptionalFieldFlags(normalized);
}

/**
 * Optional display flags are preserved as authored; an explicit `false` is
 * dropped so saved pools stay minimal (absent = default). Mirrors the
 * pointer-cleared `bitFieldsCollapsed` handling above.
 */
function normalizeOptionalFieldFlags(field: TypeField): TypeField {
    if (field.hidden !== false) { return field; }
    const { hidden: _hidden, ...rest } = field;
    return rest;
}

const LEGACY_POINTER_NORMALIZERS: Partial<Record<TypeFieldType, (field: TypeField) => TypeField>> = {
    pointer: field => ({ ...field, type: 'void', isPointer: true, refTypeId: undefined, bitFields: undefined, bitFieldsCollapsed: undefined }),
    void: field => ({ ...field, isPointer: true, refTypeId: undefined, bitFields: undefined, bitFieldsCollapsed: undefined }),
};

function normalizePointerModifierField(field: TypeField): TypeField {
    return field.isPointer ? { ...field, bitFields: undefined, bitFieldsCollapsed: undefined } : field;
}

function isPointerField(field: TypeField): boolean {
    return normalizeTypeField(field).isPointer === true;
}

function isBitFieldContainer(field: TypeField): boolean {
    if (isPointerField(field)) { return false; }
    return Array.isArray(field.bitFields) && field.bitFields.length > 0 &&
        isUnsignedScalarType(field.type);
}

function bitMask(width: number): bigint {
    return (1n << BigInt(width)) - 1n;
}

/** Fold raw bytes into an unsigned bigint with the given byte order. */
export function bytesToBigUint(raw: number[], endian: 'le' | 'be'): bigint {
    if (endian === 'le') {
        let v = 0n;
        for (let i = 0; i < raw.length; i++) {
            v |= BigInt(raw[i]) << BigInt(i * 8);
        }
        return v;
    }
    let v = 0n;
    for (const b of raw) {
        v = (v << 8n) | BigInt(b);
    }
    return v;
}

export function fieldByteSize(type: TypeScalarFieldType): number {
    return FIELD_BYTE_SIZE[type];
}

/** Natural alignment for a scalar field type. */
function fieldAlignment(type: TypeScalarFieldType): number {
    return fieldByteSize(type);
}

function alignUp(offset: number, align: number): number {
    return align <= 1 ? offset : (offset + align - 1) & ~(align - 1);
}

function defsMap(defs: readonly TypeDef[] = [], extra?: TypeDef): Map<string, TypeDef> {
    const map = new Map<string, TypeDef>();
    defs.forEach(d => map.set(d.id, d));
    if (extra) { map.set(extra.id, extra); }
    return map;
}

/**
 * Rewrite a referenced bit-field field into its inline container form: the
 * referenced def's base type + children are copied onto the field and
 * `refTypeId` is cleared. Fields that are not `type: 'bitfield'` (or whose
 * target is missing/not a bit-field) pass through untouched.
 */
function materializeTypeField(field: TypeField, byId: Map<string, TypeDef>): TypeField {
    const normalized = normalizeTypeField(field);
    const target = materializedBitFieldTarget(normalized, byId);
    if (!target) { return normalized; }
    return {
        ...normalized,
        type: target.baseType ?? 'uint8',
        refTypeId: undefined,
        // A rewritten container is never pointer-typed: an authored
        // `type:'bitfield' + isPointer` is invalid (validation rejects it), so
        // materialization drops the flag rather than yielding a pointer-typed
        // inline container the layout/decode paths would size as a pointer.
        isPointer: undefined,
        bitFields: (target.bitFields ?? []).map(child => ({ ...child })),
    };
}

/** The `kind: 'bitfield'` def a referenced field points at, or null when it does not. */
function materializedBitFieldTarget(field: TypeField, byId: Map<string, TypeDef>): TypeDef | null {
    if (!isBitFieldReferenceField(field)) { return null; }
    return bitFieldDefTarget(field.refTypeId, byId);
}

/** Whether a field carries a `type: 'bitfield'` reference id. */
function isBitFieldReferenceField(field: TypeField): boolean {
    return field.type === 'bitfield' && field.refTypeId !== undefined;
}

/** Look up a bit-field def by id; only a `kind: 'bitfield'` target qualifies. */
function bitFieldDefTarget(refTypeId: string | undefined, byId: Map<string, TypeDef>): TypeDef | null {
    const target = refTypeId ? byId.get(refTypeId) : undefined;
    return target && typeDefKind(target) === 'bitfield' ? target : null;
}

function materializeTypeDef(def: TypeDef, byId: Map<string, TypeDef>): TypeDef {
    if (typeDefKind(def) === 'bitfield') { return def; }
    if (!def.fields.some(f => f.type === 'bitfield')) { return def; }
    return { ...def, fields: def.fields.map(f => materializeTypeField(f, byId)) };
}

/**
 * Single "materialize" seam: the authored (referenced) form is what validation,
 * persistence, and editing see; decode/size/C resolve references to the inline
 * container form here so the intricate inline code paths stay the only ones.
 */
function materializedDefsMap(def: TypeDef, defs: readonly TypeDef[] = []): { def: TypeDef; map: Map<string, TypeDef> } {
    const authored = defsMap(defs, def);
    const map = new Map<string, TypeDef>();
    authored.forEach((d, id) => map.set(id, materializeTypeDef(d, authored)));
    return { def: map.get(def.id) ?? def, map };
}

/** Materialize a def's bit-field references (see `materializedDefsMap`). */
export function materializeBitFieldRefs(def: TypeDef, defs: readonly TypeDef[] = []): TypeDef {
    return materializedDefsMap(def, defs).def;
}

/**
 * Count references to any id in `deletedIds` across the surviving pool — the
 * number of fields/bit-children whose `refTypeId` the deletion would strip.
 * Mirrors `withoutTypeDefinition` (webview pin model) so the delete
 * confirmation can warn that referencing layouts change, not just pins.
 */
export function countTypeFieldRefs(defs: readonly TypeDef[], deletedIds: readonly string[]): number {
    const deleted = new Set(deletedIds);
    if (deleted.size === 0) { return 0; }
    return defs
        .filter(def => def && !deleted.has(def.id))
        .reduce((sum, def) => sum + countDefFieldRefs(def, deleted), 0);
}

/** Referencing fields/bit-children inside one surviving def. */
function countDefFieldRefs(def: TypeDef, deleted: Set<string>): number {
    const fieldRefs = (def.fields ?? []).reduce((sum, field) => sum + countFieldRefs(field, deleted), 0);
    return fieldRefs + countBitChildRefs(def.bitFields, deleted);
}

/** A field's own `refTypeId` plus any inline bit-child references. */
function countFieldRefs(field: TypeField, deleted: Set<string>): number {
    const selfRef = isDeletedRef(field.refTypeId, deleted) ? 1 : 0;
    return selfRef + countBitChildRefs(field.bitFields, deleted);
}

function countBitChildRefs(children: readonly BitFieldChild[] | undefined, deleted: Set<string>): number {
    return (children ?? []).filter(child => isDeletedRef(child.refTypeId, deleted)).length;
}

/** Whether a reference id points at one of the deleted ids. */
function isDeletedRef(refTypeId: string | undefined, deleted: Set<string>): boolean {
    return refTypeId !== undefined && deleted.has(refTypeId);
}

/**
 * Legacy migration: rewrite every inline bit-field container (`unsigned type` +
 * `bitFields[]`) into a reference to a standalone `kind: 'bitfield'` def.
 *
 * Pool-wide dedupe collapses identical containers (same base width + ordered
 * child name/width list) onto one shared type. Generated defs get the lowest
 * unused `migrated_bitfield_<n>` id and a unique name derived from the first
 * matching field. Usage-scoped overrides (`count`/`endian`/`allocation`/`name`,
 * plus any extra keys a legacy pool carries) stay on the referencing field;
 * `bitFields`/`bitFieldsCollapsed` are cleared. Idempotent: a second run over
 * migrated defs returns `changed: false` and the same def array reference.
 */
interface MigrateBitFieldContext {
    bySignature: Map<string, TypeDef>;
    generated: TypeDef[];
    usedIds: Set<string>;
    usedNames: Set<string>;
}

export function migrateInlineBitFields(defs: TypeDef[]): { defs: TypeDef[]; changed: boolean } {
    const ctx: MigrateBitFieldContext = {
        bySignature: new Map<string, TypeDef>(),
        generated: [],
        usedIds: new Set<string>(),
        usedNames: new Set<string>(),
    };
    defs.forEach(def => rememberBitFieldPoolDef(def, ctx));

    let changed = false;
    const next = defs.map(def => {
        const migrated = migrateTypeDefFields(def, ctx);
        if (migrated !== def) { changed = true; }
        return migrated;
    });

    if (!changed) { return { defs, changed: false }; }
    return { defs: [...next, ...ctx.generated], changed: true };
}

/** Seed the id/name pools and the signature index from one authored def. */
function rememberBitFieldPoolDef(def: TypeDef | undefined, ctx: MigrateBitFieldContext): void {
    if (!def) { return; }
    if (typeof def.id === 'string') { ctx.usedIds.add(def.id); }
    if (typeof def.name === 'string') { ctx.usedNames.add(def.name); }
    rememberBitFieldSignature(def, ctx);
}

/** Index a standalone `kind: 'bitfield'` def by its container signature (first wins). */
function rememberBitFieldSignature(def: TypeDef, ctx: MigrateBitFieldContext): void {
    if (typeDefKind(def) !== 'bitfield') { return; }
    const signature = bitFieldContainerSignature(def.baseType, def.bitFields ?? []);
    if (!ctx.bySignature.has(signature)) { ctx.bySignature.set(signature, def); }
}

/** Rewrite one def's inline bit-field containers to references; same ref when clean. */
function migrateTypeDefFields(def: TypeDef, ctx: MigrateBitFieldContext): TypeDef {
    if (!def || typeDefKind(def) === 'bitfield') { return def; }
    const fields = typeDefFields(def);
    const migratedFields = fields.map(field => migrateTypeFieldRef(field, ctx));
    if (!fieldListChanged(fields, migratedFields)) { return def; }
    return { ...def, fields: migratedFields };
}

function typeDefFields(def: TypeDef): TypeField[] {
    return Array.isArray(def.fields) ? def.fields : [];
}

function fieldListChanged(before: readonly TypeField[], after: readonly TypeField[]): boolean {
    return before.some((f, i) => f !== after[i]);
}

/** Rewrite a single inline container field to its referenced form, or return it unchanged. */
function migrateTypeFieldRef(field: TypeField, ctx: MigrateBitFieldContext): TypeField {
    if (!isBitFieldContainer(field)) { return field; }
    return referencingBitField(field, resolveMigratedBitFieldTarget(field, ctx).id);
}

/** Shared target def for a container signature, generating + registering one on first use. */
function resolveMigratedBitFieldTarget(field: TypeField, ctx: MigrateBitFieldContext): TypeDef {
    const signature = bitFieldContainerSignature(field.type, field.bitFields ?? []);
    const existing = ctx.bySignature.get(signature);
    if (existing) { return existing; }
    const created = createMigratedBitFieldDef(field, ctx.usedIds, ctx.usedNames);
    ctx.bySignature.set(signature, created);
    ctx.generated.push(created);
    return created;
}

/**
 * Signature of an inline bit-field container: unsigned base + ordered child
 * name/width list + each child's optional enum ref + each child's hidden flag.
 * Two containers that differ only by a child enum label or a hidden bit are not
 * identical, so they must not collapse onto one def (that would drop the other
 * container's labels / hidden state).
 */
function bitFieldContainerSignature(baseType: string | undefined, children: readonly BitFieldChild[]): string {
    return JSON.stringify([baseType ?? 'uint8', children.map(child => [child.name, child.bitWidth, child.refTypeId ?? null, child.hidden === true])]);
}

/** Copy a container field into the referenced form, keeping every usage-scoped override. */
function referencingBitField(field: TypeField, refTypeId: string): TypeField {
    const { bitFields: _children, bitFieldsCollapsed: _collapsed, ...rest } = field;
    return { ...rest, type: 'bitfield', refTypeId };
}

function createMigratedBitFieldDef(field: TypeField, usedIds: Set<string>, usedNames: Set<string>): TypeDef {
    const id = nextMigratedBitFieldId(usedIds);
    usedIds.add(id);
    const name = uniqueMigratedBitFieldName(field.name, usedNames);
    usedNames.add(name);
    return {
        id,
        name,
        kind: 'bitfield',
        baseType: isUnsignedBaseType(field.type) ? field.type : 'uint8',
        bitFields: (field.bitFields ?? []).map(child => ({ ...child })),
        fields: [],
    };
}

/**
 * Lowest unused `migrated_bitfield_<n>` id. The scan runs against `usedIds`,
 * which the caller seeds from **every** def in the pool (existing + already
 * generated this run), so a generated id can never collide with a pre-existing
 * def id — the whole pool is the collision domain, not just the generated set.
 */
function nextMigratedBitFieldId(usedIds: Set<string>): string {
    let n = 1;
    while (usedIds.has(`migrated_bitfield_${n}`)) { n++; }
    return `migrated_bitfield_${n}`;
}

function uniqueMigratedBitFieldName(rawName: string, usedNames: Set<string>): string {
    const base = sanitizeTypeIdentifier(rawName) || 'bitfield';
    if (!usedNames.has(base)) { return base; }
    let n = 1;
    while (usedNames.has(`${base}_${n}`)) { n++; }
    return `${base}_${n}`;
}

function sanitizeTypeIdentifier(raw: string): string {
    return (raw ?? '').replace(/[^A-Za-z0-9_]/g, '').replace(/^(\d)/, '_$1');
}

function referencedType(field: TypeField, map: Map<string, TypeDef>): TypeDef | null {
    field = normalizeTypeField(field);
    if (field.type !== 'struct' || !field.refTypeId) { return null; }
    return map.get(field.refTypeId) ?? null;
}

function fieldSizeWithDefs(field: TypeField, map: Map<string, TypeDef>, depth: number): number {
    field = normalizeTypeField(field);
    const enumTarget = referencedEnumDef(field, map);
    if (enumTarget) { return fieldByteSize(enumBaseType(enumTarget)); }
    const scalarSize = scalarOrPointerFieldSize(field);
    return scalarSize ?? nestedTypeFieldSize(field, map, depth);
}

/** Named-type discriminator: `struct` / `bitfield` / `enum` size through their def, not as scalars. */
function isNamedFieldType(type: TypeFieldType): type is 'struct' | 'bitfield' | 'enum' {
    return type === 'struct' || type === 'bitfield' || type === 'enum';
}

function scalarOrPointerFieldSize(field: TypeField): number | null {
    if (field.isPointer) { return POINTER_BYTE_SIZE; }
    if (isNamedFieldType(field.type)) { return null; }
    return fieldByteSize(field.type);
}

function nestedTypeFieldSize(field: TypeField, map: Map<string, TypeDef>, depth: number): number {
    if (depth >= MAX_NESTED_DEPTH) { return 0; }
    const child = referencedType(field, map);
    // Nested references resolve their own parameter defaults (validation rejects
    // a nested templated type that has a parameter without a default).
    return child ? typeByteSizeWithDefs(child, map, depth + 1, layoutParams(child)) : 0;
}

function fieldAlignWithDefs(field: TypeField, map: Map<string, TypeDef>, depth: number): number {
    field = normalizeTypeField(field);
    const enumTarget = referencedEnumDef(field, map);
    if (enumTarget) { return fieldAlignment(enumBaseType(enumTarget)); }
    const scalarAlign = scalarOrPointerFieldAlign(field);
    return scalarAlign ?? nestedTypeFieldAlign(field, map, depth);
}

function scalarOrPointerFieldAlign(field: TypeField): number | null {
    if (field.isPointer) { return POINTER_BYTE_SIZE; }
    if (isNamedFieldType(field.type)) { return null; }
    return fieldAlignment(field.type);
}

function nestedTypeFieldAlign(field: TypeField, map: Map<string, TypeDef>, depth: number): number {
    if (depth >= MAX_NESTED_DEPTH) { return 1; }
    const child = referencedType(field, map);
    return child ? typeAlignmentWithDefs(child, map, depth + 1) : 1;
}

function typeAlignmentWithDefs(def: TypeDef, map: Map<string, TypeDef>, depth: number): number {
    if (def.packed || def.fields.length === 0) { return 1; }
    let maxAlign = 1;
    for (const f of def.fields) {
        const align = fieldAlignWithDefs(f, map, depth);
        maxAlign = Math.max(maxAlign, align);
    }
    return maxAlign;
}

function typeByteSizeWithDefs(def: TypeDef, map: Map<string, TypeDef>, depth: number, params: LayoutParams): number {
    let offset = 0;
    let maxAlign = 1;

    for (const f of def.fields) {
        const sz = fieldSizeWithDefs(f, map, depth);
        const align = def.packed ? 1 : fieldAlignWithDefs(f, map, depth);
        maxAlign = Math.max(maxAlign, align);
        offset = alignUp(offset, align);
        offset += sz * resolvedFieldCount(f, params);
    }

    if (def.packed) { return offset; }
    return alignUp(offset, maxAlign);
}

/**
 * Compute byte size of a type, respecting alignment padding unless packed.
 * Includes trailing padding so that arrays of the type are correctly aligned.
 * `params` supplies instance values for a templated type; omitted = defaults.
 */
export function typeByteSize(def: TypeDef, defs: readonly TypeDef[] = [], params?: LayoutParams): number {
    const { def: resolved, map } = materializedDefsMap(def, defs);
    return typeByteSizeWithDefs(resolved, map, 1, layoutParams(resolved, params));
}

/** Validate nested type references, cycles, and max depth constraints. */
export function validateTypes(defs: TypeDef[], maxDepth = MAX_NESTED_DEPTH): string[] {
    const byId = new Map<string, TypeDef>();
    defs.forEach(d => byId.set(d.id, d));
    const errors: string[] = [];

    for (const d of defs) {
        validateTypeDefPoolEntry(d, byId, errors);
    }

    defs.forEach(d => validateNestedTypeGraph(d.id, 1, [d.id], byId, maxDepth, errors));
    return [...new Set(errors)];
}

/** Per-def shape + reference validation (kind dispatch, then fields). */
function validateTypeDefPoolEntry(d: TypeDef, byId: Map<string, TypeDef>, errors: string[]): void {
    validateEndianAllocationOverrides(d, errors);
    validateTypeDefKind(d, errors);
    validateTypeParams(d, errors);
    validateDuplicateFieldNames(d, errors);
    if (typeDefKind(d) === 'bitfield') {
        validateBitFieldDefShape(d, byId, errors);
        return;
    }
    if (typeDefKind(d) === 'enum') {
        validateEnumDefShape(d, errors);
        return;
    }
    validateFieldCountParams(d, errors);
    for (const f of d.fields) {
        validateTypeFieldEntry(d, f, byId, errors);
    }
}

const PARAM_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parameter declarations: unique C identifiers, `kind: 'size'`, positive-integer defaults, struct-only. */
function validateTypeParams(def: TypeDef, errors: string[]): void {
    if (def.params === undefined) { return; }
    if (!Array.isArray(def.params)) {
        errors.push(`Type "${def.name}": params must be an array.`);
        return;
    }
    validateTypeParamList(def, def.params, errors);
}

function validateTypeParamList(def: TypeDef, params: TypeParam[], errors: string[]): void {
    if (params.length > 0 && typeDefKind(def) !== 'struct') {
        errors.push(`Type "${def.name}": only a struct type can declare parameters.`);
    }
    const seen = new Set<string>();
    const ctx = `Type "${def.name}"`;
    for (const param of params) {
        validateTypeParam(param, ctx, seen, errors);
    }
}

function validateTypeParam(param: TypeParam, ctx: string, seen: Set<string>, errors: string[]): void {
    if (!isPresentParam(param)) {
        errors.push(`${ctx}: parameter name must not be empty.`);
        return;
    }
    appendParamNameErrors(param.name, ctx, seen, errors);
    appendParamKindError(param, ctx, errors);
    appendParamDefaultError(param, ctx, errors);
}

function isPresentParam(param: TypeParam): param is TypeParam & { name: string } {
    return Boolean(param) && typeof param.name === 'string' && param.name.trim() !== '';
}

function appendParamNameErrors(name: string, ctx: string, seen: Set<string>, errors: string[]): void {
    if (!PARAM_NAME_RE.test(name)) {
        errors.push(`${ctx}: invalid parameter name "${name}" (must be a C identifier).`);
    }
    if (seen.has(name)) {
        errors.push(`${ctx}: duplicate parameter name "${name}".`);
    }
    seen.add(name);
}

function appendParamKindError(param: TypeParam, ctx: string, errors: string[]): void {
    if (param.kind !== 'size') {
        errors.push(`${ctx}: parameter "${param.name}" has invalid kind "${param.kind}" (expected "size").`);
    }
}

function appendParamDefaultError(param: TypeParam, ctx: string, errors: string[]): void {
    if (param.default !== undefined && !isValidLayoutValue(param.default)) {
        errors.push(`${ctx}: parameter "${param.name}" default must be a positive integer.`);
    }
}

/** Every `countParam` must name a parameter declared by the containing type. */
function validateFieldCountParams(def: TypeDef, errors: string[]): void {
    const names = declaredParamNames(def);
    for (const field of def.fields) {
        appendCountParamError(def, field, names, errors);
    }
}

function appendCountParamError(def: TypeDef, field: TypeField, names: ReadonlySet<string>, errors: string[]): void {
    if (field.countParam === undefined || names.has(field.countParam)) { return; }
    errors.push(`Type "${def.name}": field "${field.name}" references unknown parameter "${field.countParam}".`);
}

/** One field: reference check plus inline bit-field container validation. */
function validateTypeFieldEntry(d: TypeDef, f: TypeField, byId: Map<string, TypeDef>, errors: string[]): void {
    validateTypeReference(d, f, byId, errors);
    validateNestedParamDefaults(d, f, byId, errors);
    if (isBitFieldContainer(f)) {
        validateBitFieldContainer(d, f, byId, errors);
    }
}

/**
 * First-release restriction: a templated struct nested as a field has no
 * per-usage values, so every parameter must carry a default.
 */
function validateNestedParamDefaults(def: TypeDef, field: TypeField, byId: Map<string, TypeDef>, errors: string[]): void {
    const target = nestedStructTarget(field, byId);
    if (!target) { return; }
    for (const param of target.params ?? []) {
        appendMissingNestedDefault(def, field, target, param, errors);
    }
}

function nestedStructTarget(field: TypeField, byId: Map<string, TypeDef>): TypeDef | null {
    const normalized = normalizeTypeField(field);
    if (!isNestedStructField(normalized)) { return null; }
    const target = byId.get(normalized.refTypeId);
    return target && typeDefKind(target) === 'struct' ? target : null;
}

function isNestedStructField(field: TypeField): field is TypeField & { refTypeId: string } {
    return field.type === 'struct' && !field.isPointer && Boolean(field.refTypeId);
}

function appendMissingNestedDefault(
    def: TypeDef,
    field: TypeField,
    target: TypeDef,
    param: TypeParam,
    errors: string[],
): void {
    if (param.default !== undefined) { return; }
    errors.push(
        `Type "${def.name}": field "${field.name}" references templated type "${target.name}" ` +
        `whose parameter "${param.name}" has no default.`,
    );
}

const TYPE_DEF_KINDS = new Set(['struct', 'bitfield', 'enum']);

function validateTypeDefKind(def: TypeDef, errors: string[]): void {
    if (def.kind !== undefined && !TYPE_DEF_KINDS.has(def.kind)) {
        errors.push(`Type "${def.name}": invalid kind "${def.kind}".`);
    }
}

/** Shape check for a standalone `kind: 'bitfield'` def (unsigned base, children in range, no nesting). */
function validateBitFieldDefShape(def: TypeDef, byId: Map<string, TypeDef>, errors: string[]): void {
    const ctx = `Type "${def.name}"`;
    validateNoOwnFields(def, ctx, 'bit-field', errors);
    const children = def.bitFields ?? [];
    if (children.length === 0) {
        errors.push(`${ctx}: bit-field type must declare at least one bit-field child.`);
        return;
    }
    validateBitFieldDefBase(def, children, byId, errors);
}

/** Base width + child width/enum-ref checks for a standalone bit-field def. */
function validateBitFieldDefBase(
    def: TypeDef,
    children: readonly BitFieldChild[],
    byId: Map<string, TypeDef>,
    errors: string[],
): void {
    const ctx = `Type "${def.name}"`;
    const totalBits = validateBitFieldChildWidths(def.name, children, errors);
    validateBitChildEnumRefs(def.name, children, byId, errors);
    if (!isUnsignedBaseType(def.baseType)) {
        errors.push(`${ctx}: bit-field type must declare an unsigned base type.`);
        return;
    }
    const unitBits = fieldByteSize(def.baseType) * 8;
    if (totalBits > unitBits) {
        errors.push(`${ctx}: children total ${totalBits} bits exceeds ${unitBits}-bit base.`);
    }
}

/** Named defs (`bitfield` / `enum`) carry no own fields. */
function validateNoOwnFields(def: TypeDef, ctx: string, noun: string, errors: string[]): void {
    if (def.fields.length > 0) {
        errors.push(`${ctx}: ${noun} type cannot contain fields.`);
    }
}

/** Exclusive upper bound implied by an enum def's base width (defaults to 8 bits). */
export function enumValueBound(baseType: string | undefined): number {
    const bits = isUnsignedBaseType(baseType) ? fieldByteSize(baseType) * 8 : 8;
    return 2 ** bits;
}

/** Shape check for a standalone `kind: 'enum'` def (unsigned base, entries within range, no fields). */
function validateEnumDefShape(def: TypeDef, errors: string[]): void {
    const ctx = `Type "${def.name}"`;
    validateNoOwnFields(def, ctx, 'enum', errors);
    const baseType = isUnsignedBaseType(def.baseType) ? def.baseType : null;
    if (!baseType) {
        errors.push(`${ctx}: enum type must declare an unsigned base type.`);
        return;
    }
    validateEnumEntryBounds(def, baseType, ctx, errors);
}

/** Reject enum entries whose value does not fit the declared base width. */
function validateEnumEntryBounds(def: TypeDef, baseType: TypeBaseType, ctx: string, errors: string[]): void {
    const bound = enumValueBound(baseType);
    for (const entry of def.entries ?? []) {
        if (!isEnumEntryInBound(entry.value, bound)) {
            errors.push(`${ctx}: enum entry "${entry.name}" value ${entry.value} does not fit ${baseType}.`);
        }
    }
}

/** A non-negative integer entry value below the base-width bound. */
function isEnumEntryInBound(value: number, bound: number): boolean {
    return Number.isInteger(value) && value >= 0 && value < bound;
}

/** Reject bit-field children whose enum reference does not resolve to an enum def. */
function validateBitChildEnumRefs(
    defName: string,
    children: readonly BitFieldChild[],
    byId: Map<string, TypeDef>,
    errors: string[],
): void {
    for (const child of children) {
        validateBitChildEnumRef(child, defName, byId, errors);
    }
}

/** One bit-field child's enum reference check. */
function validateBitChildEnumRef(
    child: BitFieldChild,
    defName: string,
    byId: Map<string, TypeDef>,
    errors: string[],
): void {
    if (child.refTypeId === undefined) { return; }
    const target = byId.get(child.refTypeId);
    if (!target) {
        errors.push(`Type "${defName}": bit-field child "${child.name}" references an unknown enum type.`);
        return;
    }
    if (typeDefKind(target) !== 'enum') {
        errors.push(`Type "${defName}": bit-field child "${child.name}" references "${target.name}", which is not an enum type.`);
    }
}

const ENDIAN_VALUES = new Set(['le', 'be']);
const ALLOCATION_VALUES = new Set(['lsb', 'msb']);

function validateEndianAllocationOverrides(def: TypeDef, errors: string[]): void {
    const typeCtx = `Type "${def.name}"`;
    checkOverrideValue(def.endian, ENDIAN_VALUES, errors, v => `${typeCtx}: invalid endian "${v}" (expected "le" or "be").`);
    checkOverrideValue(def.allocation, ALLOCATION_VALUES, errors, v => `${typeCtx}: invalid allocation "${v}" (expected "lsb" or "msb").`);
    for (const f of def.fields) {
        const fieldCtx = `${typeCtx}: field "${f.name}"`;
        checkOverrideValue(f.endian, ENDIAN_VALUES, errors, v => `${fieldCtx} invalid endian "${v}" (expected "le" or "be").`);
        checkOverrideValue(f.allocation, ALLOCATION_VALUES, errors, v => `${fieldCtx} invalid allocation "${v}" (expected "lsb" or "msb").`);
    }
}

function checkOverrideValue(
    value: string | undefined,
    allowed: ReadonlySet<string>,
    errors: string[],
    message: (got: string) => string,
): void {
    if (value !== undefined && !allowed.has(value)) {
        errors.push(message(value));
    }
}

function validateDuplicateFieldNames(def: TypeDef, errors: string[]): void {
    const seen = new Set<string>();
    for (const f of def.fields) {
        if (seen.has(f.name)) {
            errors.push(`Type "${def.name}": duplicate field name "${f.name}".`);
        } else {
            seen.add(f.name);
        }
    }
}

/** Spec for validating a `type: 'bitfield'` / `type: 'enum'` field reference. */
interface TypedRefSpec {
    kind: TypeDefKind;
    pointerError: (ctx: string) => string;
    missing: (ctx: string) => string;
    unknown: (ctx: string) => string;
    mismatch: (ctx: string, targetName: string) => string;
    checkExtra?: (field: TypeField, ctx: string, errors: string[]) => void;
}

const TYPED_REF_SPECS: Partial<Record<TypeFieldType, TypedRefSpec>> = {
    bitfield: {
        kind: 'bitfield',
        pointerError: ctx => `${ctx} cannot be a bit-field pointer.`,
        missing: ctx => `${ctx} is missing a referenced bit-field type.`,
        unknown: ctx => `${ctx} references an unknown bit-field type.`,
        mismatch: (ctx, name) => `${ctx} references "${name}", which is not a bit-field type.`,
        checkExtra: validateNoInlineBitFieldsWithRef,
    },
    enum: {
        kind: 'enum',
        pointerError: ctx => `${ctx} cannot be an enum pointer.`,
        missing: ctx => `${ctx} is missing a referenced enum.`,
        unknown: ctx => `${ctx} references an unknown enum type.`,
        mismatch: (ctx, name) => `${ctx} references "${name}", which is not an enum type.`,
    },
};

function validateTypeReference(
    def: TypeDef,
    field: TypeField,
    byId: Map<string, TypeDef>,
    errors: string[],
): void {
    field = normalizeTypeField(field);
    const spec = TYPED_REF_SPECS[field.type];
    if (spec) {
        validateTypedFieldReference(def, field, byId, errors, spec);
        return;
    }
    if (field.type !== 'struct') { return; }
    validateTypeFieldTarget(def, field, byId, errors);
}

/** Shared pointer/shape/reference checks for a typed (bit-field / enum) field. */
function validateTypedFieldReference(
    def: TypeDef,
    field: TypeField,
    byId: Map<string, TypeDef>,
    errors: string[],
    spec: TypedRefSpec,
): void {
    const ctx = `Type "${def.name}": field "${field.name}"`;
    if (field.isPointer) {
        errors.push(spec.pointerError(ctx));
        return;
    }
    spec.checkExtra?.(field, ctx, errors);
    const target = resolveReferencedType(field, byId, ctx, spec, errors);
    validateRefTargetKind(target, ctx, spec, errors);
}

/** Reject a resolvable target whose def kind does not match the spec. */
function validateRefTargetKind(target: TypeDef | null, ctx: string, spec: TypedRefSpec, errors: string[]): void {
    if (target && typeDefKind(target) !== spec.kind) {
        errors.push(spec.mismatch(ctx, target.name));
    }
}

/** A referenced bit-field container carries no inline `bitFields`. */
function validateNoInlineBitFieldsWithRef(field: TypeField, ctx: string, errors: string[]): void {
    if (field.bitFields !== undefined && field.bitFields.length > 0) {
        errors.push(`${ctx} cannot combine a bit-field reference with inline bit-fields.`);
    }
}

/** Resolve a field's reference id, pushing the spec's missing/unknown message when it fails. */
function resolveReferencedType(
    field: TypeField,
    byId: Map<string, TypeDef>,
    ctx: string,
    spec: TypedRefSpec,
    errors: string[],
): TypeDef | null {
    if (!field.refTypeId) {
        errors.push(spec.missing(ctx));
        return null;
    }
    const target = byId.get(field.refTypeId);
    if (!target) {
        errors.push(spec.unknown(ctx));
        return null;
    }
    return target;
}

/** A plain `type: 'struct'` field's reference must resolve in the pool. */
function validateTypeFieldTarget(def: TypeDef, field: TypeField, byId: Map<string, TypeDef>, errors: string[]): void {
    const ctx = `Type "${def.name}": field "${field.name}"`;
    if (!field.refTypeId) {
        errors.push(`${ctx} is missing a referenced type.`);
        return;
    }
    if (!byId.has(field.refTypeId)) {
        errors.push(`${ctx} references an unknown type.`);
    }
}

function validateBitFieldContainer(def: TypeDef, field: TypeField, byId: Map<string, TypeDef>, errors: string[]): void {
    if (!isValidBitFieldContainerShape(def, field, errors)) { return; }
    validateBitFieldContainerWidth(def, field, byId, errors);
}

/** Pointer/unsigned-base shape guard for an inline bit-field container. */
function isValidBitFieldContainerShape(def: TypeDef, field: TypeField, errors: string[]): boolean {
    const ctx = `Type "${def.name}": field "${field.name}"`;
    if (isPointerField(field)) {
        errors.push(`${ctx} cannot combine pointer and bit-field details.`);
        return false;
    }
    if (!isUnsignedScalarType(field.type)) {
        errors.push(`${ctx} bit-field container must be an unsigned type.`);
        return false;
    }
    return true;
}

/** Child widths + enum refs + total-bit bound for an inline bit-field container. */
function validateBitFieldContainerWidth(def: TypeDef, field: TypeField, byId: Map<string, TypeDef>, errors: string[]): void {
    const unitBits = fieldByteSize(field.type as UnsignedScalarType) * 8;
    const totalBits = validateBitFieldChildren(def, field, errors);
    validateBitChildEnumRefs(def.name, field.bitFields ?? [], byId, errors);
    if (totalBits > unitBits) {
        errors.push(`Type "${def.name}": field "${field.name}" children total ${totalBits} bits exceeds ${unitBits}-bit container.`);
    }
}

/** Sum + validate child widths; returns the total valid bit width. */
function validateBitFieldChildWidths(defName: string, children: readonly BitFieldChild[], errors: string[]): number {
    let totalBits = 0;
    for (const child of children) {
        if (!isValidBitWidth(child.bitWidth)) {
            errors.push(`Type "${defName}": bit-field child "${child.name}" bit width must be > 0.`);
        } else {
            totalBits += child.bitWidth;
        }
    }
    return totalBits;
}

function validateBitFieldChildren(def: TypeDef, field: TypeField, errors: string[]): number {
    let totalBits = 0;
    for (const child of field.bitFields ?? []) {
        if (!isValidBitWidth(child.bitWidth)) {
            errors.push(`Type "${def.name}": field "${field.name}" child "${child.name}" bit width must be > 0.`);
        } else {
            totalBits += child.bitWidth;
        }
    }
    return totalBits;
}

function isValidBitWidth(bitWidth: number): boolean {
    return Number.isInteger(bitWidth) && bitWidth > 0;
}

function validateNestedTypeGraph(
    defId: string,
    depth: number,
    stack: string[],
    byId: Map<string, TypeDef>,
    maxDepth: number,
    errors: string[],
): void {
    if (depth > maxDepth) {
        const name = nestedTypeName(byId, defId);
        errors.push(`Nesting depth exceeds ${maxDepth} at type "${name}".`);
        return;
    }

    const def = byId.get(defId);
    if (!def) { return; }

    for (const field of def.fields) {
        validateNestedTypeField(field, depth, stack, byId, maxDepth, errors);
    }
}

function nestedTypeName(byId: Map<string, TypeDef>, defId: string): string {
    return byId.get(defId)?.name ?? defId;
}

function validateNestedTypeField(
    field: TypeField,
    depth: number,
    stack: string[],
    byId: Map<string, TypeDef>,
    maxDepth: number,
    errors: string[],
): void {
    const refId = nestedTypeTraversalRef(field);
    if (!refId) { return; }
    if (stack.includes(refId)) {
        errors.push(`Nested type cycle detected: ${formatTypeCycle([...stack, refId], byId)}`);
        return;
    }

    validateNestedTypeGraph(refId, depth + 1, [...stack, refId], byId, maxDepth, errors);
}

function nestedTypeTraversalRef(field: TypeField): string | null {
    field = normalizeTypeField(field);
    if (field.isPointer || field.type !== 'struct') { return null; }
    return field.refTypeId ?? null;
}

function formatTypeCycle(stack: string[], byId: Map<string, TypeDef>): string {
    return stack.map(id => byId.get(id)?.name ?? id).join(' -> ');
}

// -- Decode logic --------------------------------------------------

export interface DecodedField {
    fieldName: string;
    type: TypeScalarFieldType;
    /** Declared target type for pointer rows. */
    pointerTargetType?: TypeFieldType;
    pointerTargetTypeId?: string;
    pointerTargetTypeName?: string;
    pointerTargetByteSize?: number;
    pointerValue?: number;
    isPointer?: boolean;
    /** Index within the array (0 for scalars). */
    arrayIdx: number;
    byteOffset: number;
    bytesHex: string;
    decoded: string;
    hasData: boolean;
    isBitField?: boolean;
    bitWidth?: number;
    /** Bit offset within the storage unit in declaration order. */
    bitOffset?: number;
    bitStorageByteSize?: number;
    bitValueUnsigned?: string;
    /** Resolved enum entry name when this row's value matches an enum entry (label reference only). */
    enumLabel?: string;
    /** Resolved effective byte order for this row (field beats type beats nested parents beats global). */
    endian?: 'le' | 'be';
    /** Resolved effective bit allocation for this row (only meaningful for bit-field rows/units). */
    allocation?: BitFieldAllocation;
}

export interface ResolvedTypeFieldPath {
    field: TypeField;
    typeName?: string;
    /** Resolved element count (parameter value when `countParam` is set). */
    count: number;
}

/**
 * Resolve a dotted field path (optionally containing array indices) to the declared field.
 * Example accepted paths: "nodes", "nodes[0]", "outer[1].nodes".
 * `params` supplies the top-level type's instance values; nested defs use defaults.
 */
export function resolveTypeFieldByPath(
    def: TypeDef,
    fieldPath: string,
    defs: readonly TypeDef[] = [],
    params?: LayoutParams,
): ResolvedTypeFieldPath | null {
    const parts = parseTypeFieldPathParts(fieldPath);
    if (!parts) { return null; }

    const { def: resolved, map: byId } = materializedDefsMap(def, defs);
    const found = resolveTypePathParts(resolved, parts, byId, layoutParams(resolved, params));
    return found ? buildResolvedTypeFieldPath(found.field, byId, found.params) : null;
}

function parseTypeFieldPathParts(fieldPath: string): string[] | null {
    const normalized = fieldPath.replace(/\[\d+\]/g, '');
    const parts = normalized.split('.').map(p => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
}

function resolveTypePathParts(
    def: TypeDef,
    parts: string[],
    byId: Map<string, TypeDef>,
    params: LayoutParams,
): { field: TypeField; params: LayoutParams } | null {
    const field = findTypeField(def, parts[0]);
    if (!field) { return null; }
    if (parts.length === 1) { return { field, params }; }
    const child = resolveChildTypeDef(field, byId);
    if (!child) { return null; }
    return resolveTypePathParts(child, parts.slice(1), byId, layoutParams(child));
}

function findTypeField(def: TypeDef, fieldName: string): TypeField | undefined {
    return def.fields.find((candidate: TypeField) => candidate.name === fieldName);
}

function resolveChildTypeDef(field: TypeField, byId: Map<string, TypeDef>): TypeDef | null {
    if (field.type !== 'struct' || !field.refTypeId) { return null; }
    return byId.get(field.refTypeId) ?? null;
}

function buildResolvedTypeFieldPath(
    field: TypeField,
    byId: Map<string, TypeDef>,
    params: LayoutParams,
): ResolvedTypeFieldPath {
    const count = resolvedFieldCount(field, params);
    if (field.type !== 'struct') { return { field, count }; }
    const child = field.refTypeId ? byId.get(field.refTypeId) : null;
    return { field, typeName: child?.name, count };
}

type FieldDecoder = (dv: DataView, le: boolean) => string;

function decodeFloat(value: number, precision: number): string {
    if (isNaN(value)) { return 'NaN'; }
    if (!isFinite(value)) { return String(value); }
    return value.toExponential(precision);
}

const FIELD_DECODERS: Record<TypeScalarFieldType, FieldDecoder> = {
    void: () => '',
    ascii: dv => {
        const b = dv.getUint8(0);
        if (b === 0) { return ''; }
        return b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.';
    },
    int8: dv => `${dv.getInt8(0)}`,
    int16: (dv, le) => `${dv.getInt16(0, le)}`,
    int32: (dv, le) => `${dv.getInt32(0, le)}`,
    int64: (dv, le) => dv.getBigInt64(0, le).toString(10),
    uint8: dv => `${dv.getUint8(0)}  (0x${dv.getUint8(0).toString(16).toUpperCase().padStart(2, '0')})`,
    uint16: (dv, le) => {
        const v = dv.getUint16(0, le);
        return `${v}  (0x${v.toString(16).toUpperCase().padStart(4, '0')})`;
    },
    uint32: (dv, le) => {
        const v = dv.getUint32(0, le);
        return `${v >>> 0}  (0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')})`;
    },
    uint64: (dv, le) => {
        const v = dv.getBigUint64(0, le);
        return `${v.toString(10)}  (0x${v.toString(16).toUpperCase().padStart(16, '0')})`;
    },
    float32: (dv, le) => decodeFloat(dv.getFloat32(0, le), 6),
    float64: (dv, le) => decodeFloat(dv.getFloat64(0, le), 16),
    pointer: (dv, le) => {
        const v = dv.getUint32(0, le);
        return `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
    },
};

export function decodeField(
    bytes: number[],
    type: TypeScalarFieldType,
    endian: 'le' | 'be',
): string {
    const size = fieldByteSize(type);
    if (bytes.length < size || bytes.some(b => b < 0)) { return '??'; }

    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    const le = endian === 'le';
    bytes.slice(0, size).forEach((b, i) => dv.setUint8(i, b));

    return FIELD_DECODERS[type](dv, le);
}

interface DecodeContext {
    baseAddr: number;
    getByte: (addr: number) => number | undefined;
    bitFieldAllocation: BitFieldAllocation;
    /** True global overlay endian — pointers always decode with this (never overridden). */
    globalEndian: 'le' | 'be';
    map: Map<string, TypeDef>;
    rows: DecodedField[];
    depth: number;
    pathPrefix: string;
    baseOffset: number;
    /** Resolved parameter values for the type being decoded at this level. */
    params: LayoutParams;
}

function readFieldBytes(ctx: DecodeContext, absOffset: number, count: number): number[] {
    const raw: number[] = [];
    for (let b = 0; b < count; b++) {
        const v = ctx.getByte(ctx.baseAddr + absOffset + b);
        raw.push(v !== undefined ? v : -1);
    }
    return raw;
}

function bytesToHex(raw: number[]): string {
    return raw
        .map(v => (v >= 0 ? v.toString(16).toUpperCase().padStart(2, '0') : '??'))
        .join(' ');
}

function joinFieldPath(prefix: string, name: string): string {
    return prefix ? `${prefix}.${name}` : name;
}

function decodeAsciiBytes(raw: number[]): string {
    const chars: string[] = [];
    for (const b of raw) {
        if (b === 0) { break; }
        chars.push(isPrintableAsciiByte(b) ? String.fromCharCode(b) : '.');
    }
    return chars.join('');
}

function bitFieldValueText(value: bigint, width: number): string {
    const hexDigits = Math.max(1, Math.ceil(width / 4));
    return `${value.toString(10)}  (0x${value.toString(16).toUpperCase().padStart(hexDigits, '0')})`;
}

function extractBitFieldValue(
    unitValue: bigint,
    unitBits: number,
    bitOffset: number,
    width: number,
    allocation: BitFieldAllocation,
): bigint {
    const shift = allocation === 'lsb'
        ? bitOffset
        : unitBits - bitOffset - width;
    return (unitValue >> BigInt(shift)) & bitMask(width);
}

function decodeBitFieldContainer(
    ctx: DecodeContext,
    field: TypeField,
    offset: number,
    align: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): number {
    const unitBytes = fieldByteSize(field.type as UnsignedScalarType);
    const unitBits = unitBytes * 8;
    const alignedOffset = alignUp(offset, align);
    const count = resolvedFieldCount(field, ctx.params);

    for (let idx = 0; idx < count; idx++) {
        const fieldPath = fieldElementPath(ctx, field, idx);
        const absOffset = ctx.baseOffset + alignedOffset + idx * unitBytes;
        decodeBitFieldChildren(ctx, field, fieldPath, idx, absOffset, unitBytes, unitBits, endian, allocation);
    }

    return alignedOffset + unitBytes * count;
}

function decodeBitFieldChildren(
    ctx: DecodeContext,
    field: TypeField,
    fieldPath: string,
    arrayIdx: number,
    absOffset: number,
    unitBytes: number,
    unitBits: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): void {
    const unit = readBitFieldUnit(ctx, absOffset, unitBytes, endian);
    let bitPos = 0;

    for (const child of field.bitFields!) {
        const width = child.bitWidth;
        if (width > 0) {
            ctx.rows.push(bitFieldChildRow(ctx, field, child, fieldPath, arrayIdx, absOffset, unitBytes, unitBits, bitPos, unit, endian, allocation));
        }
        bitPos += width;
    }
}

function readBitFieldUnit(ctx: DecodeContext, absOffset: number, unitBytes: number, endian: 'le' | 'be'): {
    hasData: boolean;
    bytesHex: string;
    value: bigint;
} {
    const raw = readFieldBytes(ctx, absOffset, unitBytes);
    const hasData = raw.every(v => v >= 0);
    return {
        hasData,
        bytesHex: bytesToHex(raw),
        value: hasData ? bytesToBigUint(raw.filter(v => v >= 0), endian) : 0n,
    };
}

function bitFieldChildRow(
    ctx: DecodeContext,
    field: TypeField,
    child: BitFieldChild,
    fieldPath: string,
    arrayIdx: number,
    absOffset: number,
    unitBytes: number,
    unitBits: number,
    bitPos: number,
    unit: { hasData: boolean; bytesHex: string; value: bigint },
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): DecodedField {
    const unsignedValue = readBitFieldChildValue(unit, bitPos, child, unitBits, allocation);
    const valueText = bitFieldDecodedText(unit.hasData, unsignedValue, child.bitWidth);
    const enumLabel = bitFieldChildEnumLabel(child, unit.hasData, ctx.map, unsignedValue);
    return {
        fieldName: `${fieldPath}.${child.name || `bit${bitPos}`}`,
        type: field.type as UnsignedScalarType,
        arrayIdx,
        byteOffset: absOffset,
        bytesHex: unit.bytesHex,
        decoded: valueText,
        hasData: unit.hasData,
        isBitField: true,
        bitWidth: child.bitWidth,
        bitOffset: bitPos,
        bitStorageByteSize: unitBytes,
        bitValueUnsigned: bitFieldUnsignedText(unit.hasData, unsignedValue),
        enumLabel,
        endian,
        allocation,
    };
}

/** Extract one child's unsigned value, or 0n when the storage unit has no data. */
function readBitFieldChildValue(
    unit: { hasData: boolean; value: bigint },
    bitPos: number,
    child: BitFieldChild,
    unitBits: number,
    allocation: BitFieldAllocation,
): bigint {
    return unit.hasData
        ? extractBitFieldValue(unit.value, unitBits, bitPos, child.bitWidth, allocation)
        : 0n;
}

/** Resolved enum entry label for a bit-field child, when it has data and a matching entry. */
function bitFieldChildEnumLabel(
    child: BitFieldChild,
    hasData: boolean,
    map: Map<string, TypeDef>,
    unsignedValue: bigint,
): string | undefined {
    if (!hasData) { return undefined; }
    const enumDef = enumDefById(child.refTypeId, map);
    return enumDef ? matchEnumEntry(enumDef, unsignedValue)?.name : undefined;
}

function bitFieldDecodedText(hasData: boolean, unsignedValue: bigint, width: number): string {
    return hasData ? bitFieldValueText(unsignedValue, width) : '??';
}

function bitFieldUnsignedText(hasData: boolean, unsignedValue: bigint): string | undefined {
    return hasData ? unsignedValue.toString(10) : undefined;
}

function decodeAsciiField(
    ctx: DecodeContext,
    field: TypeField,
    offset: number,
    elemSize: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): number {
    const absOffset = ctx.baseOffset + offset;
    const normalized = normalizeTypeField(field);
    const count = resolvedFieldCount(field, ctx.params);
    const totalBytes = normalized.isPointer ? POINTER_BYTE_SIZE * count : elemSize * count;
    const raw = readFieldBytes(ctx, absOffset, totalBytes);
    const hasData = raw.every(v => v >= 0);
    if (normalized.isPointer) {
        decodePointerElements(ctx, normalized, offset, endian);
        return offset + totalBytes;
    }
    ctx.rows.push({
        fieldName: joinFieldPath(ctx.pathPrefix, field.name),
        type: 'ascii',
        arrayIdx: 0,
        byteOffset: absOffset,
        bytesHex: bytesToHex(raw),
        decoded: hasData ? decodeAsciiBytes(raw) : '??',
        hasData,
        endian,
        allocation,
    });
    return offset + totalBytes;
}

function decodePointerValue(raw: number[], endian: 'le' | 'be'): number | undefined {
    if (raw.length < POINTER_BYTE_SIZE || raw.some(v => v < 0)) { return undefined; }
    const buf = new ArrayBuffer(POINTER_BYTE_SIZE);
    const dv = new DataView(buf);
    raw.slice(0, POINTER_BYTE_SIZE).forEach((b, i) => dv.setUint8(i, b));
    return dv.getUint32(0, endian === 'le') >>> 0;
}

function pointerTargetByteSize(field: TypeField, map: Map<string, TypeDef>, depth: number): number {
    if (field.type === 'struct') { return pointerTargetTypeByteSize(field, map, depth); }
    if (field.type === 'enum') { return enumPointerTargetByteSize(field, map); }
    return scalarPointerTargetByteSize(field.type);
}

function pointerTargetTypeByteSize(field: TypeField, map: Map<string, TypeDef>, depth: number): number {
    const child = referencedType(field, map);
    return child ? typeByteSizeWithDefs(child, map, depth + 1, layoutParams(child)) : 1;
}

function enumPointerTargetByteSize(field: TypeField, map: Map<string, TypeDef>): number {
    const target = enumDefById(field.refTypeId, map);
    return target ? fieldByteSize(enumBaseType(target)) : 1;
}

/** Byte size of a pointer's scalar (or opaque void/bit-field) target. */
function scalarPointerTargetByteSize(type: Exclude<TypeFieldType, 'struct' | 'enum'>): number {
    if (type === 'void' || type === 'bitfield') { return 1; }
    return fieldByteSize(type);
}

function pointerTargetTypeName(field: TypeField, map: Map<string, TypeDef>): string | undefined {
    if (field.type !== 'struct' || !field.refTypeId) { return undefined; }
    return map.get(field.refTypeId)?.name;
}

function decodePointerElements(
    ctx: DecodeContext,
    field: TypeField,
    offset: number,
    endian: 'le' | 'be',
): void {
    const count = resolvedFieldCount(field, ctx.params);
    for (let idx = 0; idx < count; idx++) {
        const fieldPath = fieldElementPath(ctx, field, idx);
        const absOffset = ctx.baseOffset + offset + idx * POINTER_BYTE_SIZE;
        const raw = readFieldBytes(ctx, absOffset, POINTER_BYTE_SIZE);
        ctx.rows.push(pointerElementRow(ctx, field, fieldPath, idx, absOffset, raw, endian));
    }
}

/** One pointer element row (a pointer's storage bytes never carry a named target type). */
function pointerElementRow(
    ctx: DecodeContext,
    field: TypeField,
    fieldPath: string,
    arrayIdx: number,
    absOffset: number,
    raw: number[],
    endian: 'le' | 'be',
): DecodedField {
    const hasData = raw.every(v => v >= 0);
    return {
        fieldName: fieldPath,
        type: pointerStorageFieldType(field.type),
        pointerTargetType: field.type,
        pointerTargetTypeId: field.refTypeId,
        pointerTargetTypeName: pointerTargetTypeName(field, ctx.map),
        pointerTargetByteSize: pointerTargetByteSize(field, ctx.map, ctx.depth),
        pointerValue: decodePointerValue(raw, endian),
        isPointer: true,
        arrayIdx,
        byteOffset: absOffset,
        bytesHex: bytesToHex(raw),
        decoded: hasData ? decodeField(raw, 'pointer', endian) : '??',
        hasData,
        endian,
    };
}

/** Storage row type for a pointer element: named targets decode as opaque `void`. */
function pointerStorageFieldType(type: TypeFieldType): TypeScalarFieldType {
    if (type === 'struct' || type === 'bitfield' || type === 'enum') { return 'void'; }
    return type;
}

function decodeScalarFieldElement(
    ctx: DecodeContext,
    field: TypeField,
    fieldPath: string,
    arrayIdx: number,
    absOffset: number,
    elemSize: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): void {
    field = normalizeTypeField(field);
    const enumDef = referencedEnumDef(field, ctx.map);
    if (!isScalarRowCandidate(field, enumDef)) { return; }
    const decodeType = decodeTypeForField(field, enumDef);
    const raw = readFieldBytes(ctx, absOffset, elemSize);
    const hasData = raw.every(v => v >= 0);
    const enumLabel = scalarEnumLabel(enumDef, hasData, raw, endian);
    ctx.rows.push({
        fieldName: fieldPath,
        type: decodeType,
        arrayIdx,
        byteOffset: absOffset,
        bytesHex: bytesToHex(raw),
        decoded: hasData ? decodeField(raw, decodeType, endian) : '??',
        hasData,
        enumLabel,
        endian,
        allocation,
    });
}

/** Scalar rows skip types/bit-fields, and enum fields only when their ref resolves. */
function isScalarRowCandidate(field: TypeField, enumDef: TypeDef | null): boolean {
    if (field.type === 'struct' || field.type === 'bitfield') { return false; }
    return field.type !== 'enum' || enumDef !== null;
}

/** Storage type used to decode a scalar row: an enum decodes as its unsigned base. */
function decodeTypeForField(field: TypeField, enumDef: TypeDef | null): TypeScalarFieldType {
    if (enumDef) { return enumBaseType(enumDef); }
    return field.type as TypeScalarFieldType;
}

/** Matched enum label for a scalar row, when the bytes are available. */
function scalarEnumLabel(enumDef: TypeDef | null, hasData: boolean, raw: number[], endian: 'le' | 'be'): string | undefined {
    if (!enumDef || !hasData) { return undefined; }
    return matchEnumEntry(enumDef, bytesToBigUint(raw, endian))?.name;
}

function decodeNestedTypeField(
    ctx: DecodeContext,
    field: TypeField,
    fieldPath: string,
    absOffset: number,
    inheritedEndian: 'le' | 'be',
    inheritedAllocation: BitFieldAllocation,
): void {
    field = normalizeTypeField(field);
    const child = referencedType(field, ctx.map);
    if (!child || ctx.depth >= MAX_NESTED_DEPTH) { return; }
    decodeTypeRecursive(
        child,
        ctx.baseAddr,
        ctx.getByte,
        ctx.globalEndian,
        ctx.bitFieldAllocation,
        ctx.map,
        ctx.rows,
        ctx.depth + 1,
        fieldPath,
        absOffset,
        inheritedEndian,
        inheritedAllocation,
        layoutParams(child),
    );
}

function decodeFieldElements(
    ctx: DecodeContext,
    field: TypeField,
    offset: number,
    elemSize: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): number {
    field = normalizeTypeField(field);
    const count = resolvedFieldCount(field, ctx.params);
    if (field.isPointer) {
        decodePointerElements(ctx, field, offset, endian);
        return offset + POINTER_BYTE_SIZE * count;
    }
    let nextOffset = offset;
    for (let idx = 0; idx < count; idx++) {
        const fieldPath = fieldElementPath(ctx, field, idx);
        const absOffset = ctx.baseOffset + nextOffset;
        if (field.type === 'struct') {
            decodeNestedTypeField(ctx, field, fieldPath, absOffset, endian, allocation);
        } else {
            decodeScalarFieldElement(ctx, field, fieldPath, idx, absOffset, elemSize, endian, allocation);
        }
        nextOffset += elemSize;
    }
    return nextOffset;
}

function fieldElementPath(ctx: DecodeContext, field: TypeField, idx: number): string {
    field = normalizeTypeField(field);
    const elementName = resolvedFieldCount(field, ctx.params) > 1 ? `${field.name}[${idx}]` : field.name;
    return joinFieldPath(ctx.pathPrefix, elementName);
}

function decodeTypeRecursive(
    def: TypeDef,
    baseAddr: number,
    getByte: (addr: number) => number | undefined,
    globalEndian: 'le' | 'be',
    bitFieldAllocation: BitFieldAllocation,
    map: Map<string, TypeDef>,
    rows: DecodedField[],
    depth: number,
    pathPrefix: string,
    baseOffset: number,
    effectiveEndian: 'le' | 'be',
    effectiveAllocation: BitFieldAllocation,
    params: LayoutParams,
): number {
    let offset = 0;
    const ctx: DecodeContext = { baseAddr, getByte, bitFieldAllocation, globalEndian, map, rows, depth, pathPrefix, baseOffset, params };

    // First explicit value up the chain wins — this type's override beats whatever
    // the enclosing type/field/global passed down as effective.
    const { endian: typeEndian, allocation: typeAllocation } = resolveEndianAllocation(def, effectiveEndian, effectiveAllocation);

    for (const field of def.fields) {
        offset = decodeTypeField(ctx, def, field, offset, typeEndian, typeAllocation);
    }

    if (!def.packed) {
        const typeAlign = typeAlignmentWithDefs(def, map, depth);
        offset = alignUp(offset, typeAlign);
    }

    return offset;
}

function decodeTypeField(
    ctx: DecodeContext,
    def: TypeDef,
    field: TypeField,
    offset: number,
    typeEndian: 'le' | 'be',
    typeAllocation: BitFieldAllocation,
): number {
    field = normalizeTypeField(field);
    const align = def.packed ? 1 : fieldAlignWithDefs(field, ctx.map, ctx.depth);
    const elemSize = fieldSizeWithDefs(field, ctx.map, ctx.depth);
    const { endian: fieldEndian, allocation: fieldAllocation } = resolveEndianAllocation(field, typeEndian, typeAllocation);
    if (isBitFieldContainer(field)) {
        return decodeBitFieldContainer(ctx, field, offset, align, fieldEndian, fieldAllocation);
    }

    const alignedOffset = alignUp(offset, align);
    if (field.type === 'ascii') {
        return decodeAsciiField(ctx, field, alignedOffset, elemSize, fieldEndian, fieldAllocation);
    }
    return decodeFieldElements(ctx, field, alignedOffset, elemSize, fieldEndian, fieldAllocation);
}

/**
 * Resolve one concern (byte order / bit allocation) independently: the first
 * explicit value up the chain wins. Applies to both TypeDef and TypeField
 * (field beats type beats nested parents beats global).
 */
function resolveEndianAllocation(
    item: { endian?: 'le' | 'be'; allocation?: BitFieldAllocation },
    inheritedEndian: 'le' | 'be',
    inheritedAllocation: BitFieldAllocation,
): { endian: 'le' | 'be'; allocation: BitFieldAllocation } {
    return { endian: item.endian ?? inheritedEndian, allocation: item.allocation ?? inheritedAllocation };
}

export function decodeType(
    def: TypeDef,
    baseAddr: number,
    getByte: (addr: number) => number | undefined,
    globalEndian: 'le' | 'be',
    bitFieldAllocation: BitFieldAllocation = 'msb',
    defs: readonly TypeDef[] = [],
    params?: LayoutParams,
): DecodedField[] {
    const rows: DecodedField[] = [];
    const { def: resolved, map } = materializedDefsMap(def, defs);
    decodeTypeRecursive(
        resolved, baseAddr, getByte, globalEndian, bitFieldAllocation, map, rows,
        1, '', 0, globalEndian, bitFieldAllocation, layoutParams(resolved, params),
    );
    return rows;
}

// -- All visible types ------------------------------------------

export function allTypes(defs: readonly TypeDef[] = []): TypeDef[] {
    return [...defs];
}

// -- C type text parser -----------------------------------------

/**
 * Maps common C scalar type names to our internal scalar field type.
 * Lookup is case-sensitive first, then case-folded as fallback.
 */
const C_TYPE_MAP: Record<string, TypeScalarFieldType> = {
    'void': 'void',
    'char': 'ascii',
    'uint8_t': 'uint8', 'uint8': 'uint8', 'u8': 'uint8',
    'unsigned char': 'uint8', 'byte': 'uint8', 'BYTE': 'uint8',

    'uint16_t': 'uint16', 'uint16': 'uint16', 'u16': 'uint16',
    'unsigned short': 'uint16', 'WORD': 'uint16', 'word': 'uint16',

    'uint32_t': 'uint32', 'uint32': 'uint32', 'u32': 'uint32',
    'unsigned int': 'uint32', 'unsigned long': 'uint32',
    'DWORD': 'uint32', 'dword': 'uint32',

    'uint64_t': 'uint64', 'uint64': 'uint64', 'u64': 'uint64',
    'unsigned long long': 'uint64',

    'int8_t': 'int8', 'int8': 'int8', 'i8': 'int8',
    'signed char': 'int8',

    'int16_t': 'int16', 'int16': 'int16', 'i16': 'int16',
    'short': 'int16', 'signed short': 'int16',

    'int32_t': 'int32', 'int32': 'int32', 'i32': 'int32',
    'int': 'int32', 'long': 'int32', 'signed int': 'int32',

    'int64_t': 'int64', 'int64': 'int64', 'i64': 'int64',
    'long long': 'int64', 'signed long long': 'int64',

    'float': 'float32', 'float32': 'float32',
    'double': 'float64', 'float64': 'float64',
};

/** Maps scalar field types back to canonical C type names for serialization. */
const TYPE_TO_C: Record<TypeScalarFieldType, string> = {
    ascii: 'char',
    uint8: 'uint8_t', uint16: 'uint16_t', uint32: 'uint32_t', uint64: 'uint64_t',
    int8: 'int8_t', int16: 'int16_t', int32: 'int32_t', int64: 'int64_t',
    float32: 'float', float64: 'double',
    pointer: 'void*',
    void: 'void',
};

function fieldTypeToC(field: TypeField, defsById: Map<string, TypeDef>): string {
    field = normalizeTypeField(field);
    const base = fieldBaseTypeToC(field, defsById);
    return field.isPointer ? `${base}*` : base;
}

function fieldBaseTypeToC(field: TypeField, defsById: Map<string, TypeDef>): string {
    if (field.type === 'enum') { return enumFieldBaseTypeToC(field, defsById); }
    return field.type === 'struct' || field.type === 'bitfield'
        ? typeFieldBaseTypeToC(field, defsById)
        : TYPE_TO_C[field.type];
}

/** An enum-typed field is emitted as its unsigned base-width integer (size/offset faithful). */
function enumFieldBaseTypeToC(field: TypeField, defsById: Map<string, TypeDef>): string {
    const target = enumDefById(field.refTypeId, defsById);
    const base = target ? enumBaseType(target) : 'uint8';
    return TYPE_TO_C[base];
}

/** `  enum <Name>` comment suffix for an enum-typed field, or '' otherwise. */
function enumFieldNote(field: TypeField, defsById: Map<string, TypeDef>): string {
    const target = enumDefById(field.refTypeId, defsById);
    return field.type === 'enum' && target ? `  enum ${target.name}` : '';
}

function typeFieldBaseTypeToC(field: TypeField, defsById: Map<string, TypeDef>): string {
    const child = defsById.get(field.refTypeId ?? '');
    return child === undefined ? 'uint8_t' : child.name;
}

function isPrintableAsciiByte(value: number): boolean {
    return value >= 0x20 && value < 0x7F;
}

export interface ParseTypeTextResult {
    /** Type name extracted from a `struct Name { }` wrapper, or null. */
    typeName: string | null;
    fields: TypeField[];
    /** Parse error messages (one per bad line). */
    errors: string[];
}

function appendParsedBitField(
    fields: TypeField[],
    type: UnsignedScalarType,
    name: string,
    bitWidth: number,
): void {
    const unitBits = fieldByteSize(type) * 8;
    const last = fields[fields.length - 1];
    const lastUsedBits = last?.bitFields?.reduce((sum, child) => sum + child.bitWidth, 0) ?? 0;
    if (canAppendBitField(last, type, lastUsedBits, bitWidth, unitBits)) {
        last.bitFields.push({ name, bitWidth });
        return;
    }

    fields.push({
        name,
        type,
        count: 1,
        bitFields: [{ name, bitWidth }],
    });
}

function canAppendBitField(
    last: TypeField | undefined,
    type: UnsignedScalarType,
    lastUsedBits: number,
    bitWidth: number,
    unitBits: number,
): last is TypeField & { bitFields: BitFieldChild[] } {
    if (!isMatchingBitFieldContainer(last, type)) { return false; }
    return lastUsedBits + bitWidth <= unitBits;
}

function isMatchingBitFieldContainer(
    field: TypeField | undefined,
    type: UnsignedScalarType,
): field is TypeField & { bitFields: BitFieldChild[] } {
    return Boolean(field) &&
        field!.type === type &&
        field!.count === 1 &&
        Array.isArray(field!.bitFields);
}

type ParsedTypeLine =
    | { kind: 'skip' }
    | { kind: 'error'; message: string }
    | { kind: 'field'; field: TypeField }
    | { kind: 'bitField'; type: UnsignedScalarType; name: string; bitWidth: number };

interface TypeDeclarationParts {
    rawType: string;
    fieldName: string;
    isPointer: boolean;
    bitWidth: number | null;
    count: number;
}

function preserveMultilineCommentSpacing(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, m => {
        const newlines = (m.match(/\n/g) ?? []).length;
        return newlines === 0 ? m : '\n'.repeat(newlines);
    });
}

function stripTypeLine(rawLine: string): string {
    const noBlock = rawLine.replace(/\/\*[^*\n]*\*\//g, '');
    const slashIdx = noBlock.indexOf('//');
    const line = (slashIdx >= 0 ? noBlock.slice(0, slashIdx) : noBlock).trim();
    return line.replace(/;$/, '').trim();
}

function parseBitFieldDeclaration(
    fieldName: string,
    mapped: TypeScalarFieldType,
    bitWidth: number,
    count: number,
): ParsedTypeLine {
    const error = bitFieldDeclarationError(fieldName, mapped, bitWidth, count);
    if (error) { return { kind: 'error', message: error }; }
    return { kind: 'bitField', type: mapped as UnsignedScalarType, name: fieldName, bitWidth };
}

function bitFieldDeclarationError(
    fieldName: string,
    mapped: TypeScalarFieldType,
    bitWidth: number,
    count: number,
): string | null {
    return bitFieldBaseTypeDeclarationError(fieldName, mapped) ??
        bitFieldWidthDeclarationError(fieldName, mapped, bitWidth) ??
        bitFieldCountDeclarationError(fieldName, count);
}

function bitFieldBaseTypeDeclarationError(fieldName: string, mapped: TypeScalarFieldType): string | null {
    return isUnsignedScalarType(mapped) ? null : bitFieldBaseTypeError(fieldName);
}

function bitFieldWidthDeclarationError(fieldName: string, mapped: TypeScalarFieldType, bitWidth: number): string | null {
    if (hasInvalidBitWidth(bitWidth)) { return bitFieldWidthError(fieldName, bitWidth); }
    if (!isUnsignedScalarType(mapped)) { return null; }
    const maxBits = fieldByteSize(mapped) * 8;
    return bitWidth > maxBits ? bitFieldMaxWidthError(fieldName, bitWidth, maxBits) : null;
}

function hasInvalidBitWidth(bitWidth: number): boolean {
    return !Number.isInteger(bitWidth) || bitWidth <= 0;
}

function bitFieldCountDeclarationError(fieldName: string, count: number): string | null {
    if (count !== 1) { return bitFieldArrayError(fieldName); }
    return null;
}

function bitFieldBaseTypeError(fieldName: string): string {
    return `Bit-field "${fieldName}" must use an unsigned integer base type.`;
}

function bitFieldWidthError(fieldName: string, bitWidth: number): string {
    return `Bit-field "${fieldName}" has invalid width "${bitWidth}".`;
}

function bitFieldMaxWidthError(fieldName: string, bitWidth: number, maxBits: number): string {
    return `Bit-field "${fieldName}" width ${bitWidth} exceeds ${maxBits}.`;
}

function bitFieldArrayError(fieldName: string): string {
    return `Bit-field "${fieldName}" cannot be declared as an array.`;
}

function parseTypeDeclarationLine(rawLine: string, defsByName: Map<string, TypeDef> = new Map()): ParsedTypeLine {
    const stripped = stripTypeLine(rawLine);
    if (shouldSkipTypeDeclaration(stripped)) { return { kind: 'skip' }; }

    const parts = parseTypeDeclarationParts(stripped);
    if (!parts) { return { kind: 'error', message: `Cannot parse: "${stripped}"` }; }

    return parseResolvedTypeDeclaration(parts, defsByName);
}

function parseResolvedTypeDeclaration(parts: TypeDeclarationParts, defsByName: Map<string, TypeDef>): ParsedTypeLine {
    const typeDef = resolvePointerType(parts.rawType, parts.isPointer, defsByName);
    if (typeDef) { return parsedPointerOrField(parts, typeDef); }

    const mapped = mapDeclarationType(parts.rawType);
    return mapped ? parseMappedTypeDeclaration(parts, mapped) : parseUnknownTypeDeclaration(parts);
}

function parseMappedTypeDeclaration(parts: TypeDeclarationParts, mapped: TypeScalarFieldType): ParsedTypeLine {
    if (parts.bitWidth !== null) {
        return parseBitFieldDeclaration(parts.fieldName, mapped, parts.bitWidth, parts.count);
    }
    const field: TypeField = { name: parts.fieldName, type: mapped, count: parts.count };
    if (parts.isPointer) { field.isPointer = true; }
    return { kind: 'field', field };
}

function parseUnknownTypeDeclaration(parts: TypeDeclarationParts): ParsedTypeLine {
    return parts.isPointer
        ? { kind: 'field', field: { name: parts.fieldName, type: 'void', isPointer: true, count: parts.count } }
        : { kind: 'error', message: `Unknown type "${parts.rawType}" for field "${parts.fieldName}"` };
}

function resolvePointerType(rawType: string, isPointer: boolean, defsByName: Map<string, TypeDef>): TypeDef | undefined {
    if (!isPointer) { return undefined; }
    const normalized = rawType.replace(/^struct\s+/, '');
    return defsByName.get(normalized);
}

function parsedPointerOrField(parts: TypeDeclarationParts, typeDef: TypeDef): ParsedTypeLine {
    const field: TypeField = {
        name: parts.fieldName,
        type: 'struct',
        refTypeId: typeDef.id,
        count: parts.count,
    };
    if (parts.isPointer) { field.isPointer = true; }
    return {
        kind: 'field',
        field,
    };
}

function shouldSkipTypeDeclaration(stripped: string): boolean {
    if (SKIP_TYPE_LINES.has(stripped)) { return true; }
    return isTypeWrapperLine(stripped);
}

const SKIP_TYPE_LINES = new Set(['', '{', '}']);
const TYPE_POINTER_DECL_RE = /^struct\s+\w+\s*\*/;
const TYPE_WRAPPER_RE = /^(?:typedef|struct|union)\b/;

function isTypeWrapperLine(stripped: string): boolean {
    return !TYPE_POINTER_DECL_RE.test(stripped) && TYPE_WRAPPER_RE.test(stripped);
}

function parseTypeDeclarationParts(stripped: string): TypeDeclarationParts | null {
    const unqual = stripped.replace(/^(?:(?:const|volatile|static|register)\s+)+/, '');
    const match = unqual.match(/^(.+?)\s+(\*?\s*\w+)\s*(?::\s*(\d+))?\s*(?:\[(\d+)\])?$/);
    if (!match) { return null; }
    const typeAndPointer = normalizeCTypePointer(match[1], match[2]);

    return {
        rawType: typeAndPointer.rawType,
        fieldName: typeAndPointer.fieldName,
        isPointer: typeAndPointer.isPointer,
        bitWidth: match[3] ? parseInt(match[3], 10) : null,
        count: match[4] ? Math.max(1, parseInt(match[4], 10)) : 1,
    };
}

function normalizeCTypePointer(rawTypePart: string, fieldNamePart: string): { rawType: string; fieldName: string; isPointer: boolean } {
    const starInType = rawTypePart.endsWith('*');
    const starInName = fieldNamePart.trim().startsWith('*');
    const rawType = rawTypePart.replace(/\s*\*+$/, '').replace(/\s+/g, ' ').trim();
    const fieldName = fieldNamePart.replace(/^\s*\*/, '').trim();
    return { rawType, fieldName, isPointer: starInType || starInName };
}

function mapDeclarationType(rawType: string): TypeScalarFieldType | undefined {
    return C_TYPE_MAP[rawType] ?? C_TYPE_MAP[rawType.toLowerCase()];
}

/**
 * Parse C-style field declarations into TypeField[].
 * Accepts bare field declarations OR a full `struct Name { ... }` / `typedef struct Name { ... }`.
 * Nested type references are not resolved here and must be chosen in the type editor.
 */
export function parseTypeText(text: string, defs: readonly TypeDef[] = []): ParseTypeTextResult {
    const errors: string[] = [];
    const fields: TypeField[] = [];
    let typeName: string | null = null;
    const defsByName = new Map(defs.map(def => [def.name, def]));

    const cleaned = preserveMultilineCommentSpacing(text);

    const nameMatch = cleaned.match(/(?:typedef\s+)?struct\s+(\w+)\s*\{/);
    if (nameMatch) { typeName = nameMatch[1]; }

    const bodyMatch = cleaned.match(/\{([\s\S]*)\}/);
    const body = bodyMatch ? bodyMatch[1] : cleaned;

    for (const rawLine of body.split('\n')) {
        appendParsedTypeLine(rawLine, fields, errors, defsByName);
    }

    return { typeName, fields, errors };
}

function appendParsedTypeLine(rawLine: string, fields: TypeField[], errors: string[], defsByName: Map<string, TypeDef>): void {
    const parsed = parseTypeDeclarationLine(rawLine, defsByName);
    if (parsed.kind === 'skip') { return; }
    if (parsed.kind === 'error') {
        errors.push(parsed.message);
        return;
    }
    if (parsed.kind === 'bitField') {
        appendParsedBitField(fields, parsed.type, parsed.name, parsed.bitWidth);
        return;
    }
    fields.push(parsed.field);
}

/** Serialize TypeField[] back to C-style declarations. */
export function fieldsToText(fields: TypeField[], defs: readonly TypeDef[] = []): string {
    if (fields.length === 0) { return ''; }
    const byId = new Map<string, TypeDef>(defs.map(d => [d.id, d]));
    const resolved = fields.map(f => materializeTypeField(f, byId));
    const typeNames = resolved.map(f => fieldTypeToC(f, byId));
    const maxTypeLen = Math.max(...typeNames.map(t => t.length));

    return resolved.map((f, i) => {
        // BitFields container: emit each child as a flat C bit declaration
        if (isBitFieldContainer(f)) {
            const cType = fieldTypeToC(f, byId).padEnd(maxTypeLen);
            const arr = f.count > 1 ? `[${f.count}]` : '';
            return f.bitFields!.map(child => `${cType} ${child.name}${arr}:${child.bitWidth};`).join('\n');
        }
        const cType = typeNames[i].padEnd(maxTypeLen);
        const arr = f.count > 1 ? `[${f.count}]` : '';
        return `${cType} ${f.name}${arr};`;
    }).join('\n');
}

type TypeCEmitState = {
    byId: Map<string, TypeDef>;
    lines: string[];
    maxTypeLen: number;
    offset: number;
    maxAlign: number;
    packed: boolean;
    params: LayoutParams;
    paramMacros: Map<string, string>;
};

function emitTypeCField(f: TypeField, fieldIndex: number, state: TypeCEmitState): void {
    if (isBitFieldContainer(f)) {
        emitBitFieldContainerC(f, state);
        return;
    }

    emitScalarTypeFieldC(f, fieldIndex, state);
}

function emitBitFieldContainerC(f: TypeField, state: TypeCEmitState): void {
    const unitBytes = fieldByteSize(f.type as UnsignedScalarType);
    const align = state.packed ? 1 : fieldAlignWithDefs(f, state.byId, 1);
    applyTypeCAlignment(align, state);

    const cType = fieldTypeToC(f, state.byId);
    const count = resolvedFieldCount(f, state.params);
    const arr = typeCArrayDimension(f, state);
    const fieldName = f.name || 'bitfield';

    state.lines.push(`    struct {`);
    appendBitFieldChildrenC(f, cType, state.lines);
    state.lines.push(`    } ${fieldName}${arr};`);
    state.offset += unitBytes * count;
}

function appendBitFieldChildrenC(f: TypeField, cType: string, lines: string[]): void {
    let childBitPos = 0;
    for (const child of f.bitFields!) {
        const width = child.bitWidth;
        const childName = child.name || `bit${childBitPos}`;
        lines.push(
            `        ${cType} ${childName}:${width};`.padEnd(44) +
            `/* ${childBitPos.toString().padStart(2)}..${(childBitPos + width - 1).toString().padStart(2)} */`
        );
        childBitPos += width;
    }
}

function emitScalarTypeFieldC(f: TypeField, fieldIndex: number, state: TypeCEmitState): void {
    const fieldSize = fieldSizeWithDefs(f, state.byId, 1);
    const align = state.packed ? 1 : fieldAlignWithDefs(f, state.byId, 1);
    applyTypeCAlignment(align, state);

    const cType = fieldTypeToC(f, state.byId).padEnd(state.maxTypeLen);
    const displayFieldName = f.name || `field${fieldIndex}`;
    const count = resolvedFieldCount(f, state.params);
    const arr = typeCArrayDimension(f, state);
    const fieldBytes = fieldSize * count;
    state.lines.push(
        `    ${cType} ${displayFieldName}${arr};`.padEnd(44) +
        `/* +${state.offset.toString().padStart(3)}  ${fieldBytes}B${enumFieldNote(f, state.byId)} */`
    );
    state.offset += fieldBytes;
}

/**
 * C array dimension for a field: the bound parameter's macro (never a fake
 * fixed length), a literal count when > 1, or nothing for a scalar.
 */
function typeCArrayDimension(f: TypeField, state: TypeCEmitState): string {
    if (f.countParam !== undefined) {
        return `[${state.paramMacros.get(f.countParam) ?? f.countParam}]`;
    }
    const count = resolvedFieldCount(f, state.params);
    return count > 1 ? `[${count}]` : '';
}

function applyTypeCAlignment(align: number, state: TypeCEmitState): void {
    if (align > state.maxAlign) { state.maxAlign = align; }
    const aligned = alignUp(state.offset, align);
    if (!state.packed && aligned > state.offset) {
        appendTypeCPadding(state.lines, state.offset, aligned - state.offset);
    }
    state.offset = aligned;
}

function appendTypeCPadding(lines: string[], offset: number, padBytes: number): void {
    lines.push(
        `    uint8_t  _pad${offset}[${padBytes}];`.padEnd(44) +
        `/* +${offset.toString().padStart(3)}  ${padBytes}B padding */`
    );
}

function maxTypeCTypeLength(fields: TypeField[], byId: Map<string, TypeDef>): number {
    const typeLens = fields.map(f => fieldTypeToC(f, byId).length);
    return typeLens.length > 0 ? Math.max(...typeLens) : 8;
}

function createTypeCEmitState(
    def: TypeDef,
    lines: string[],
    byId: Map<string, TypeDef>,
    params: LayoutParams,
    paramMacros: Map<string, string>,
): TypeCEmitState {
    return {
        byId, lines, maxTypeLen: maxTypeCTypeLength(def.fields, byId),
        offset: 0, maxAlign: 1, packed: !!def.packed, params, paramMacros,
    };
}

function appendTypeCFooter(def: TypeDef, lines: string[], totalBytes: number, alignNote: string): void {
    const displayName = def.name || 'MyType';
    lines.push(`} ${displayName};`.padEnd(44) + `/* ${totalBytes}B, ${alignNote} */`);
}

function emitTypeCFields(def: TypeDef, state: TypeCEmitState): void {
    for (let fieldIndex = 0; fieldIndex < def.fields.length; fieldIndex++) {
        emitTypeCField(def.fields[fieldIndex], fieldIndex, state);
    }
}

function appendTrailingTypeCPadding(def: TypeDef, lines: string[], offset: number, totalPadded: number): void {
    if (def.packed || totalPadded <= offset) { return; }
    appendTypeCPadding(lines, offset, totalPadded - offset);
}

function typeCTotalBytes(def: TypeDef, totalUnpadded: number, totalPadded: number): number {
    return def.packed ? totalUnpadded : totalPadded;
}

function typeCAlignNote(def: TypeDef, maxAlign: number): string {
    return def.packed ? 'packed' : `align=${maxAlign}`;
}

/** Render a TypeDef as a C typedef with per-field offset comments. */
export function typeDefToC(def: TypeDef, defs: readonly TypeDef[] = [], params?: LayoutParams): string {
    const { def: resolved, map: byId } = materializedDefsMap(def, defs);
    if (typeDefKind(resolved) === 'bitfield') { return bitFieldDefToC(resolved); }
    if (typeDefKind(resolved) === 'enum') { return enumDefToC(resolved); }

    const resolvedParams = layoutParams(resolved, params);
    const paramMacros = paramMacroNames(resolved);
    const attr = resolved.packed ? ' __attribute__((packed))' : '';
    const lines: string[] = [];
    appendParamMacros(resolved, resolvedParams, paramMacros, lines);
    lines.push(`typedef struct${attr} {`);

    const state = createTypeCEmitState(resolved, lines, byId, resolvedParams, paramMacros);

    emitTypeCFields(resolved, state);

    const totalUnpadded = state.offset;
    const totalPadded = alignUp(state.offset, state.maxAlign);
    appendTrailingTypeCPadding(resolved, lines, state.offset, totalPadded);

    const totalBytes = typeCTotalBytes(resolved, totalUnpadded, totalPadded);
    const alignNote = typeCAlignNote(resolved, state.maxAlign);
    appendTypeCFooter(resolved, lines, totalBytes, alignNote);

    return lines.join('\n');
}

/** Parameter names referenced by at least one field's `countParam` (declaration order). */
function usedParamNames(def: TypeDef): string[] {
    const used = new Set(def.fields.map(field => field.countParam).filter((n): n is string => n !== undefined));
    return (def.params ?? []).map(param => param.name).filter(name => used.has(name));
}

/**
 * Collision-safe macro names for a def's parameters: uppercase C identifiers,
 * prefixed with the uppercased type name when two parameters map to the same
 * base name. A name that still collides gets a numeric suffix.
 */
function paramMacroNames(def: TypeDef): Map<string, string> {
    const groups = paramNameGroups(def);
    const prefix = parameterMacroBase(def.name || 'TYPE');
    const out = new Map<string, string>();
    for (const [base, names] of groups) {
        appendParamMacroNames(out, prefix, base, names);
    }
    return out;
}

function paramNameGroups(def: TypeDef): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const param of paramsOf(def)) {
        appendParamGroup(groups, param.name);
    }
    return groups;
}

function appendParamGroup(groups: Map<string, string[]>, name: string): void {
    const base = parameterMacroBase(name);
    const group = groups.get(base) ?? [];
    group.push(name);
    groups.set(base, group);
}

function appendParamMacroNames(out: Map<string, string>, prefix: string, base: string, names: string[]): void {
    if (names.length === 1) { out.set(names[0], base); return; }
    names.forEach((name, i) => out.set(name, `${prefix}_${base}${i > 0 ? `_${i}` : ''}`));
}

function parameterMacroBase(name: string): string {
    return (sanitizeTypeIdentifier(name) || 'PARAM').toUpperCase();
}

/** `#define` lines for every parameter used by a field count, above the typedef. */
function appendParamMacros(
    def: TypeDef,
    params: LayoutParams,
    macros: Map<string, string>,
    lines: string[],
): void {
    const used = usedParamNames(def);
    if (used.length === 0) { return; }
    const byName = paramsByName(def);
    for (const name of used) {
        lines.push(paramMacroLine(name, byName.get(name), params, macros));
    }
    lines.push('');
}

function paramsByName(def: TypeDef): Map<string, TypeParam> {
    return new Map(paramsOf(def).map(param => [param.name, param]));
}

function paramMacroLine(
    name: string,
    param: TypeParam | undefined,
    params: LayoutParams,
    macros: Map<string, string>,
): string {
    const value = isValidLayoutValue(params[name]) ? params[name] : 0;
    const macro = macros.get(name) ?? parameterMacroBase(name);
    return `#define ${macro} ${value} /* ${paramNote(param)} */`;
}

function paramNote(param: TypeParam | undefined): string {
    return param?.default !== undefined
        ? 'size parameter'
        : 'size parameter \u2014 no default; set per instance';
}

/** Render a standalone `kind: 'bitfield'` def as a C typedef of its storage unit. */
function bitFieldDefToC(def: TypeDef): string {
    const baseType = def.baseType ?? 'uint8';
    const lines: string[] = [];
    lines.push('typedef struct {');
    const container: TypeField = { name: typeDefDisplayName(def, 'bitfield'), type: baseType, count: 1, bitFields: def.bitFields ?? [] };
    appendBitFieldChildrenC(container, TYPE_TO_C[baseType], lines);
    lines.push(`} ${typeDefDisplayName(def, 'MyBitField')};`.padEnd(44) + `/* ${fieldByteSize(baseType)}B */`);
    return lines.join('\n');
}

/** A def's authored name, or a kind-appropriate fallback. */
function typeDefDisplayName(def: TypeDef, fallback: string): string {
    return def.name || fallback;
}

/** Render a standalone `kind: 'enum'` def as a C enum typedef sized to its base width. */
function enumDefToC(def: TypeDef): string {
    const baseType = enumBaseType(def);
    const entries = def.entries ?? [];
    const nameWidth = entries.reduce((max, entry) => Math.max(max, entry.name.length), 0);
    const lines: string[] = ['typedef enum {'];
    for (const entry of entries) {
        lines.push(`    ${entry.name.padEnd(nameWidth)} = 0x${entry.value.toString(16).toUpperCase()},`);
    }
    lines.push(`} ${def.name || 'MyEnum'};`.padEnd(44) + `/* ${fieldByteSize(baseType)}B */`);
    return lines.join('\n');
}
