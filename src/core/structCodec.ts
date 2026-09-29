// -- Struct Overlay - pure codec (no DOM / VS Code API dependencies) --
// Contains field size helpers, decode logic, parser/serializer helpers, and struct validation.

import type {
    BitFieldAllocation,
    BitFieldChild,
    EnumEntry,
    StructBaseType,
    StructDef,
    StructDefKind,
    StructField,
    StructFieldType,
    StructScalarFieldType,
} from './types';

export type { StructDef, StructField };

export const MAX_NESTED_DEPTH = 32;
const POINTER_BYTE_SIZE = 4;

// -- Constants -----------------------------------------------------

export const FIELD_TYPES: StructScalarFieldType[] = [
    'void', 'ascii',
    'uint8', 'uint16', 'uint32', 'uint64',
    'int8', 'int16', 'int32', 'int64',
    'float32', 'float64',
];

const FIELD_BYTE_SIZE: Record<StructScalarFieldType, number> = {
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
export function isUnsignedScalarType(type: StructFieldType): type is UnsignedScalarType {
    return type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64';
}

function isUnsignedBaseType(type: string | undefined): type is StructBaseType {
    return type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64';
}

/** Named-type discriminator; absent = plain struct. */
export function structDefKind(def: StructDef): StructDefKind {
    return def.kind === 'bitfield' || def.kind === 'enum' ? def.kind : 'struct';
}

/**
 * Resolve a `kind: 'enum'` target from a reference id. Returns null when the
 * reference is absent or does not point at an enum def.
 */
export function enumDefById(refStructId: string | undefined, byId: Map<string, StructDef>): StructDef | null {
    if (!refStructId) { return null; }
    const target = byId.get(refStructId);
    return target && structDefKind(target) === 'enum' ? target : null;
}

/** Resolve the enum def referenced by a scalar `type: 'enum'` field (non-pointer only). */
function referencedEnumDef(field: StructField, map: Map<string, StructDef>): StructDef | null {
    if (field.type !== 'enum' || field.isPointer) { return null; }
    return enumDefById(field.refStructId, map);
}

/** Unsigned base width of an enum def (defaults to uint8 when unspecified/invalid). */
function enumBaseType(def: StructDef): UnsignedScalarType {
    return isUnsignedBaseType(def.baseType) ? def.baseType : 'uint8';
}

/** First entry whose value matches, or undefined when the value is unmatched. */
export function matchEnumEntry(def: StructDef, value: bigint): EnumEntry | undefined {
    for (const entry of def.entries ?? []) {
        if (Number.isInteger(entry.value) && entry.value >= 0 && BigInt(entry.value) === value) {
            return entry;
        }
    }
    return undefined;
}

/** Canonical enum value label: `NAME (0xNN)`; `hexDigits` sizes the numeric part. */
export function formatEnumLabel(label: string, value: bigint, hexDigits: number): string {
    return `${label} (0x${value.toString(16).toUpperCase().padStart(hexDigits, '0')})`;
}

/** Hexadecimal digit count for an enum/bit value of `width` bits. */
export function enumHexDigits(width: number): number {
    return Math.max(1, Math.ceil(width / 4));
}


export function normalizeStructField(field: StructField): StructField {
    const normalized = LEGACY_POINTER_NORMALIZERS[field.type]?.(field) ?? normalizePointerModifierField(field);
    return normalizeOptionalFieldFlags(normalized);
}

/**
 * Optional display flags are preserved as authored; an explicit `false` is
 * dropped so saved pools stay minimal (absent = default). Mirrors the
 * pointer-cleared `bitFieldsCollapsed` handling above.
 */
function normalizeOptionalFieldFlags(field: StructField): StructField {
    if (field.hidden !== false) { return field; }
    const { hidden: _hidden, ...rest } = field;
    return rest;
}

const LEGACY_POINTER_NORMALIZERS: Partial<Record<StructFieldType, (field: StructField) => StructField>> = {
    pointer: field => ({ ...field, type: 'void', isPointer: true, refStructId: undefined, bitFields: undefined, bitFieldsCollapsed: undefined }),
    void: field => ({ ...field, isPointer: true, refStructId: undefined, bitFields: undefined, bitFieldsCollapsed: undefined }),
};

function normalizePointerModifierField(field: StructField): StructField {
    return field.isPointer ? { ...field, bitFields: undefined, bitFieldsCollapsed: undefined } : field;
}

function isPointerField(field: StructField): boolean {
    return normalizeStructField(field).isPointer === true;
}

function isBitFieldContainer(field: StructField): boolean {
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

export function fieldByteSize(type: StructScalarFieldType): number {
    return FIELD_BYTE_SIZE[type];
}

/** Natural alignment for a scalar field type. */
function fieldAlignment(type: StructScalarFieldType): number {
    return fieldByteSize(type);
}

function alignUp(offset: number, align: number): number {
    return align <= 1 ? offset : (offset + align - 1) & ~(align - 1);
}

function defsMap(defs: readonly StructDef[] = [], extra?: StructDef): Map<string, StructDef> {
    const map = new Map<string, StructDef>();
    defs.forEach(d => map.set(d.id, d));
    if (extra) { map.set(extra.id, extra); }
    return map;
}

/**
 * Rewrite a referenced bit-field field into its inline container form: the
 * referenced def's base type + children are copied onto the field and
 * `refStructId` is cleared. Fields that are not `type: 'bitfield'` (or whose
 * target is missing/not a bit-field) pass through untouched.
 */
function materializeStructField(field: StructField, byId: Map<string, StructDef>): StructField {
    const normalized = normalizeStructField(field);
    if (normalized.type !== 'bitfield') { return normalized; }
    const target = normalized.refStructId ? byId.get(normalized.refStructId) : undefined;
    if (!target || structDefKind(target) !== 'bitfield') { return normalized; }
    return {
        ...normalized,
        type: target.baseType ?? 'uint8',
        refStructId: undefined,
        // A rewritten container is never pointer-typed: an authored
        // `type:'bitfield' + isPointer` is invalid (validation rejects it), so
        // materialization drops the flag rather than yielding a pointer-typed
        // inline container the layout/decode paths would size as a pointer.
        isPointer: undefined,
        bitFields: (target.bitFields ?? []).map(child => ({ ...child })),
    };
}

function materializeStructDef(def: StructDef, byId: Map<string, StructDef>): StructDef {
    if (structDefKind(def) === 'bitfield') { return def; }
    if (!def.fields.some(f => f.type === 'bitfield')) { return def; }
    return { ...def, fields: def.fields.map(f => materializeStructField(f, byId)) };
}

/**
 * Single "materialize" seam: the authored (referenced) form is what validation,
 * persistence, and editing see; decode/size/C resolve references to the inline
 * container form here so the intricate inline code paths stay the only ones.
 */
function materializedDefsMap(def: StructDef, defs: readonly StructDef[] = []): { def: StructDef; map: Map<string, StructDef> } {
    const authored = defsMap(defs, def);
    const map = new Map<string, StructDef>();
    authored.forEach((d, id) => map.set(id, materializeStructDef(d, authored)));
    return { def: map.get(def.id) ?? def, map };
}

/** Materialize a def's bit-field references (see `materializedDefsMap`). */
export function materializeBitFieldRefs(def: StructDef, defs: readonly StructDef[] = []): StructDef {
    return materializedDefsMap(def, defs).def;
}

/**
 * Count references to any id in `deletedIds` across the surviving pool — the
 * number of fields/bit-children whose `refStructId` the deletion would strip.
 * Mirrors `withoutStructDefinition` (webview pin model) so the delete
 * confirmation can warn that referencing layouts change, not just pins.
 */
export function countStructFieldRefs(defs: readonly StructDef[], deletedIds: readonly string[]): number {
    const deleted = new Set(deletedIds);
    if (deleted.size === 0) { return 0; }
    const refsIn = (children: readonly BitFieldChild[] | undefined): number =>
        (children ?? []).filter(child => child.refStructId !== undefined && deleted.has(child.refStructId)).length;
    let count = 0;
    for (const def of defs) {
        if (!def || deleted.has(def.id)) { continue; }
        count += refsIn(def.bitFields);
        for (const field of def.fields ?? []) {
            if (field.refStructId !== undefined && deleted.has(field.refStructId)) { count++; }
            count += refsIn(field.bitFields);
        }
    }
    return count;
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
export function migrateInlineBitFields(defs: StructDef[]): { defs: StructDef[]; changed: boolean } {
    const bySignature = new Map<string, StructDef>();
    const usedIds = new Set<string>();
    const usedNames = new Set<string>();
    for (const def of defs) {
        if (!def) { continue; }
        if (typeof def.id === 'string') { usedIds.add(def.id); }
        if (typeof def.name === 'string') { usedNames.add(def.name); }
        if (structDefKind(def) === 'bitfield') {
            const signature = bitFieldContainerSignature(def.baseType, def.bitFields ?? []);
            if (!bySignature.has(signature)) { bySignature.set(signature, def); }
        }
    }

    const generated: StructDef[] = [];
    let changed = false;
    const next = defs.map(def => {
        if (!def || structDefKind(def) === 'bitfield') { return def; }
        const fields = Array.isArray(def.fields) ? def.fields : [];
        let defChanged = false;
        const migratedFields = fields.map(field => {
            if (!isBitFieldContainer(field)) { return field; }
            const signature = bitFieldContainerSignature(field.type, field.bitFields ?? []);
            let target = bySignature.get(signature);
            if (!target) {
                target = createMigratedBitFieldDef(field, usedIds, usedNames);
                bySignature.set(signature, target);
                generated.push(target);
            }
            defChanged = true;
            return referencingBitField(field, target.id);
        });
        if (!defChanged) { return def; }
        changed = true;
        return { ...def, fields: migratedFields };
    });

    if (!changed) { return { defs, changed: false }; }
    return { defs: [...next, ...generated], changed: true };
}

/**
 * Signature of an inline bit-field container: unsigned base + ordered child
 * name/width list + each child's optional enum ref. Two containers that differ
 * only by a child enum label are not identical, so they must not collapse onto
 * one def (that would drop the other container's labels).
 */
function bitFieldContainerSignature(baseType: string | undefined, children: readonly BitFieldChild[]): string {
    return JSON.stringify([baseType ?? 'uint8', children.map(child => [child.name, child.bitWidth, child.refStructId ?? null])]);
}

/** Copy a container field into the referenced form, keeping every usage-scoped override. */
function referencingBitField(field: StructField, refStructId: string): StructField {
    const { bitFields: _children, bitFieldsCollapsed: _collapsed, ...rest } = field;
    return { ...rest, type: 'bitfield', refStructId };
}

function createMigratedBitFieldDef(field: StructField, usedIds: Set<string>, usedNames: Set<string>): StructDef {
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
    const base = sanitizeStructIdentifier(rawName) || 'bitfield';
    if (!usedNames.has(base)) { return base; }
    let n = 1;
    while (usedNames.has(`${base}_${n}`)) { n++; }
    return `${base}_${n}`;
}

function sanitizeStructIdentifier(raw: string): string {
    return (raw ?? '').replace(/[^A-Za-z0-9_]/g, '').replace(/^(\d)/, '_$1');
}

function referencedStruct(field: StructField, map: Map<string, StructDef>): StructDef | null {
    field = normalizeStructField(field);
    if (field.type !== 'struct' || !field.refStructId) { return null; }
    return map.get(field.refStructId) ?? null;
}

function fieldSizeWithDefs(field: StructField, map: Map<string, StructDef>, depth: number): number {
    field = normalizeStructField(field);
    const enumTarget = referencedEnumDef(field, map);
    if (enumTarget) { return fieldByteSize(enumBaseType(enumTarget)); }
    const scalarSize = scalarOrPointerFieldSize(field);
    return scalarSize ?? nestedStructFieldSize(field, map, depth);
}

function scalarOrPointerFieldSize(field: StructField): number | null {
    if (field.isPointer) { return POINTER_BYTE_SIZE; }
    if (field.type === 'struct' || field.type === 'bitfield' || field.type === 'enum') { return null; }
    return fieldByteSize(field.type);
}

function nestedStructFieldSize(field: StructField, map: Map<string, StructDef>, depth: number): number {
    if (depth >= MAX_NESTED_DEPTH) { return 0; }
    const child = referencedStruct(field, map);
    return child ? structByteSizeWithDefs(child, map, depth + 1) : 0;
}

function fieldAlignWithDefs(field: StructField, map: Map<string, StructDef>, depth: number): number {
    field = normalizeStructField(field);
    const enumTarget = referencedEnumDef(field, map);
    if (enumTarget) { return fieldAlignment(enumBaseType(enumTarget)); }
    const scalarAlign = scalarOrPointerFieldAlign(field);
    return scalarAlign ?? nestedStructFieldAlign(field, map, depth);
}

function scalarOrPointerFieldAlign(field: StructField): number | null {
    if (field.isPointer) { return POINTER_BYTE_SIZE; }
    if (field.type === 'struct' || field.type === 'bitfield' || field.type === 'enum') { return null; }
    return fieldAlignment(field.type);
}

function nestedStructFieldAlign(field: StructField, map: Map<string, StructDef>, depth: number): number {
    if (depth >= MAX_NESTED_DEPTH) { return 1; }
    const child = referencedStruct(field, map);
    return child ? structAlignmentWithDefs(child, map, depth + 1) : 1;
}

function structAlignmentWithDefs(def: StructDef, map: Map<string, StructDef>, depth: number): number {
    if (def.packed || def.fields.length === 0) { return 1; }
    let maxAlign = 1;
    for (const f of def.fields) {
        const align = fieldAlignWithDefs(f, map, depth);
        maxAlign = Math.max(maxAlign, align);
    }
    return maxAlign;
}

function structByteSizeWithDefs(def: StructDef, map: Map<string, StructDef>, depth: number): number {
    let offset = 0;
    let maxAlign = 1;

    for (const f of def.fields) {
        const sz = fieldSizeWithDefs(f, map, depth);
        const align = def.packed ? 1 : fieldAlignWithDefs(f, map, depth);
        maxAlign = Math.max(maxAlign, align);
        offset = alignUp(offset, align);
        offset += sz * f.count;
    }

    if (def.packed) { return offset; }
    return alignUp(offset, maxAlign);
}

/**
 * Compute byte size of a struct, respecting alignment padding unless packed.
 * Includes trailing padding so that arrays of the struct are correctly aligned.
 */
export function structByteSize(def: StructDef, defs: readonly StructDef[] = []): number {
    const { def: resolved, map } = materializedDefsMap(def, defs);
    return structByteSizeWithDefs(resolved, map, 1);
}

/** Validate nested struct references, cycles, and max depth constraints. */
export function validateStructs(defs: StructDef[], maxDepth = MAX_NESTED_DEPTH): string[] {
    const byId = new Map<string, StructDef>();
    defs.forEach(d => byId.set(d.id, d));
    const errors: string[] = [];

    for (const d of defs) {
        validateEndianAllocationOverrides(d, errors);
        validateStructDefKind(d, errors);
        validateDuplicateFieldNames(d, errors);
        if (structDefKind(d) === 'bitfield') {
            validateBitFieldDefShape(d, byId, errors);
            continue;
        }
        if (structDefKind(d) === 'enum') {
            validateEnumDefShape(d, errors);
            continue;
        }
        for (const f of d.fields) {
            validateStructReference(d, f, byId, errors);

            // ── New bitFields container validation ──────────────────────────────
            if (isBitFieldContainer(f)) {
                validateBitFieldContainer(d, f, byId, errors);
                continue;
            }
        }
    }

    defs.forEach(d => validateNestedStructGraph(d.id, 1, [d.id], byId, maxDepth, errors));
    return [...new Set(errors)];
}

const STRUCT_DEF_KINDS = new Set(['struct', 'bitfield', 'enum']);

function validateStructDefKind(def: StructDef, errors: string[]): void {
    if (def.kind !== undefined && !STRUCT_DEF_KINDS.has(def.kind)) {
        errors.push(`Struct "${def.name}": invalid kind "${def.kind}".`);
    }
}

/** Shape check for a standalone `kind: 'bitfield'` def (unsigned base, children in range, no nesting). */
function validateBitFieldDefShape(def: StructDef, byId: Map<string, StructDef>, errors: string[]): void {
    const ctx = `Struct "${def.name}"`;
    if (def.fields.length > 0) {
        errors.push(`${ctx}: bit-field type cannot contain fields.`);
    }
    const children = def.bitFields ?? [];
    if (children.length === 0) {
        errors.push(`${ctx}: bit-field type must declare at least one bit-field child.`);
        return;
    }
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

/** Exclusive upper bound implied by an enum def's base width (defaults to 8 bits). */
export function enumValueBound(baseType: string | undefined): number {
    const bits = isUnsignedBaseType(baseType) ? fieldByteSize(baseType) * 8 : 8;
    return 2 ** bits;
}

/** Shape check for a standalone `kind: 'enum'` def (unsigned base, entries within range, no fields). */
function validateEnumDefShape(def: StructDef, errors: string[]): void {
    const ctx = `Struct "${def.name}"`;
    if (def.fields.length > 0) {
        errors.push(`${ctx}: enum type cannot contain fields.`);
    }
    const baseType = isUnsignedBaseType(def.baseType) ? def.baseType : null;
    if (!baseType) {
        errors.push(`${ctx}: enum type must declare an unsigned base type.`);
        return;
    }
    const bound = enumValueBound(baseType);
    for (const entry of def.entries ?? []) {
        if (!Number.isInteger(entry.value) || entry.value < 0 || entry.value >= bound) {
            errors.push(`${ctx}: enum entry "${entry.name}" value ${entry.value} does not fit ${baseType}.`);
        }
    }
}

/** Reject bit-field children whose enum reference does not resolve to an enum def. */
function validateBitChildEnumRefs(
    defName: string,
    children: readonly BitFieldChild[],
    byId: Map<string, StructDef>,
    errors: string[],
): void {
    for (const child of children) {
        if (child.refStructId === undefined) { continue; }
        const target = byId.get(child.refStructId);
        if (!target) {
            errors.push(`Struct "${defName}": bit-field child "${child.name}" references an unknown enum type.`);
        } else if (structDefKind(target) !== 'enum') {
            errors.push(`Struct "${defName}": bit-field child "${child.name}" references "${target.name}", which is not an enum type.`);
        }
    }
}

const ENDIAN_VALUES = new Set(['le', 'be']);
const ALLOCATION_VALUES = new Set(['lsb', 'msb']);

function validateEndianAllocationOverrides(def: StructDef, errors: string[]): void {
    const structCtx = `Struct "${def.name}"`;
    checkOverrideValue(def.endian, ENDIAN_VALUES, errors, v => `${structCtx}: invalid endian "${v}" (expected "le" or "be").`);
    checkOverrideValue(def.allocation, ALLOCATION_VALUES, errors, v => `${structCtx}: invalid allocation "${v}" (expected "lsb" or "msb").`);
    for (const f of def.fields) {
        const fieldCtx = `${structCtx}: field "${f.name}"`;
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

function validateDuplicateFieldNames(def: StructDef, errors: string[]): void {
    const seen = new Set<string>();
    for (const f of def.fields) {
        if (seen.has(f.name)) {
            errors.push(`Struct "${def.name}": duplicate field name "${f.name}".`);
        } else {
            seen.add(f.name);
        }
    }
}

function validateStructReference(
    def: StructDef,
    field: StructField,
    byId: Map<string, StructDef>,
    errors: string[],
): void {
    field = normalizeStructField(field);
    if (field.type === 'bitfield') {
        validateBitFieldReference(def, field, byId, errors);
        return;
    }
    if (field.type === 'enum') {
        validateEnumReference(def, field, byId, errors);
        return;
    }
    if (field.type !== 'struct') { return; }

    if (!field.refStructId) {
        errors.push(`Struct "${def.name}": field "${field.name}" is missing a referenced struct.`);
        return;
    }
    if (!byId.has(field.refStructId)) {
        errors.push(`Struct "${def.name}": field "${field.name}" references an unknown struct.`);
    }
}

function validateBitFieldReference(
    def: StructDef,
    field: StructField,
    byId: Map<string, StructDef>,
    errors: string[],
): void {
    const ctx = `Struct "${def.name}": field "${field.name}"`;
    if (field.isPointer) {
        errors.push(`${ctx} cannot be a bit-field pointer.`);
        return;
    }
    if (field.bitFields && field.bitFields.length > 0) {
        errors.push(`${ctx} cannot combine a bit-field reference with inline bit-fields.`);
    }
    if (!field.refStructId) {
        errors.push(`${ctx} is missing a referenced bit-field type.`);
        return;
    }
    const target = byId.get(field.refStructId);
    if (!target) {
        errors.push(`${ctx} references an unknown bit-field type.`);
        return;
    }
    if (structDefKind(target) !== 'bitfield') {
        errors.push(`${ctx} references "${target.name}", which is not a bit-field type.`);
    }
}

function validateEnumReference(
    def: StructDef,
    field: StructField,
    byId: Map<string, StructDef>,
    errors: string[],
): void {
    const ctx = `Struct "${def.name}": field "${field.name}"`;
    if (field.isPointer) {
        errors.push(`${ctx} cannot be an enum pointer.`);
        return;
    }
    if (!field.refStructId) {
        errors.push(`${ctx} is missing a referenced enum.`);
        return;
    }
    const target = byId.get(field.refStructId);
    if (!target) {
        errors.push(`${ctx} references an unknown enum type.`);
        return;
    }
    if (structDefKind(target) !== 'enum') {
        errors.push(`${ctx} references "${target.name}", which is not an enum type.`);
    }
}

function validateBitFieldContainer(def: StructDef, field: StructField, byId: Map<string, StructDef>, errors: string[]): void {
    if (isPointerField(field)) {
        errors.push(`Struct "${def.name}": field "${field.name}" cannot combine pointer and bit-field details.`);
        return;
    }
    if (!isUnsignedScalarType(field.type)) {
        errors.push(`Struct "${def.name}": field "${field.name}" bit-field container must be an unsigned type.`);
        return;
    }

    const unitBits = fieldByteSize(field.type as UnsignedScalarType) * 8;
    const totalBits = validateBitFieldChildren(def, field, errors);
    validateBitChildEnumRefs(def.name, field.bitFields ?? [], byId, errors);
    if (totalBits > unitBits) {
        errors.push(`Struct "${def.name}": field "${field.name}" children total ${totalBits} bits exceeds ${unitBits}-bit container.`);
    }
}

/** Sum + validate child widths; returns the total valid bit width. */
function validateBitFieldChildWidths(defName: string, children: readonly BitFieldChild[], errors: string[]): number {
    let totalBits = 0;
    for (const child of children) {
        if (!isValidBitWidth(child.bitWidth)) {
            errors.push(`Struct "${defName}": bit-field child "${child.name}" bit width must be > 0.`);
        } else {
            totalBits += child.bitWidth;
        }
    }
    return totalBits;
}

function validateBitFieldChildren(def: StructDef, field: StructField, errors: string[]): number {
    let totalBits = 0;
    for (const child of field.bitFields ?? []) {
        if (!isValidBitWidth(child.bitWidth)) {
            errors.push(`Struct "${def.name}": field "${field.name}" child "${child.name}" bit width must be > 0.`);
        } else {
            totalBits += child.bitWidth;
        }
    }
    return totalBits;
}

function isValidBitWidth(bitWidth: number): boolean {
    return Number.isInteger(bitWidth) && bitWidth > 0;
}

function validateNestedStructGraph(
    defId: string,
    depth: number,
    stack: string[],
    byId: Map<string, StructDef>,
    maxDepth: number,
    errors: string[],
): void {
    if (depth > maxDepth) {
        const name = nestedStructName(byId, defId);
        errors.push(`Nesting depth exceeds ${maxDepth} at struct "${name}".`);
        return;
    }

    const def = byId.get(defId);
    if (!def) { return; }

    for (const field of def.fields) {
        validateNestedStructField(field, depth, stack, byId, maxDepth, errors);
    }
}

function nestedStructName(byId: Map<string, StructDef>, defId: string): string {
    return byId.get(defId)?.name ?? defId;
}

function validateNestedStructField(
    field: StructField,
    depth: number,
    stack: string[],
    byId: Map<string, StructDef>,
    maxDepth: number,
    errors: string[],
): void {
    const refId = nestedStructTraversalRef(field);
    if (!refId) { return; }
    if (stack.includes(refId)) {
        errors.push(`Nested struct cycle detected: ${formatStructCycle([...stack, refId], byId)}`);
        return;
    }

    validateNestedStructGraph(refId, depth + 1, [...stack, refId], byId, maxDepth, errors);
}

function nestedStructTraversalRef(field: StructField): string | null {
    field = normalizeStructField(field);
    if (field.isPointer || field.type !== 'struct') { return null; }
    return field.refStructId ?? null;
}

function formatStructCycle(stack: string[], byId: Map<string, StructDef>): string {
    return stack.map(id => byId.get(id)?.name ?? id).join(' -> ');
}

// -- Decode logic --------------------------------------------------

export interface DecodedField {
    fieldName: string;
    type: StructScalarFieldType;
    /** Declared target type for pointer rows. */
    pointerTargetType?: StructFieldType;
    pointerTargetStructId?: string;
    pointerTargetStructName?: string;
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
    /** Resolved effective byte order for this row (field beats struct beats nested parents beats global). */
    endian?: 'le' | 'be';
    /** Resolved effective bit allocation for this row (only meaningful for bit-field rows/units). */
    allocation?: BitFieldAllocation;
}

export interface ResolvedStructFieldPath {
    field: StructField;
    structName?: string;
}

/**
 * Resolve a dotted field path (optionally containing array indices) to the declared field.
 * Example accepted paths: "nodes", "nodes[0]", "outer[1].nodes".
 */
export function resolveStructFieldByPath(
    def: StructDef,
    fieldPath: string,
    defs: readonly StructDef[] = [],
): ResolvedStructFieldPath | null {
    const parts = parseStructFieldPathParts(fieldPath);
    if (!parts) { return null; }

    const { def: resolved, map: byId } = materializedDefsMap(def, defs);
    const field = resolveStructPathParts(resolved, parts, byId);
    return field ? buildResolvedStructFieldPath(field, byId) : null;
}

function parseStructFieldPathParts(fieldPath: string): string[] | null {
    const normalized = fieldPath.replace(/\[\d+\]/g, '');
    const parts = normalized.split('.').map(p => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
}

function resolveStructPathParts(
    def: StructDef,
    parts: string[],
    byId: Map<string, StructDef>,
): StructField | null {
    const field = findStructField(def, parts[0]);
    if (!field) { return null; }
    if (parts.length === 1) { return field; }
    const child = resolveChildStructDef(field, byId);
    if (!child) { return null; }
    return resolveStructPathParts(child, parts.slice(1), byId);
}

function findStructField(def: StructDef, fieldName: string): StructField | undefined {
    return def.fields.find((candidate: StructField) => candidate.name === fieldName);
}

function resolveChildStructDef(field: StructField, byId: Map<string, StructDef>): StructDef | null {
    if (field.type !== 'struct' || !field.refStructId) { return null; }
    return byId.get(field.refStructId) ?? null;
}

function buildResolvedStructFieldPath(field: StructField, byId: Map<string, StructDef>): ResolvedStructFieldPath {
    if (field.type !== 'struct') { return { field }; }
    const child = field.refStructId ? byId.get(field.refStructId) : null;
    return { field, structName: child?.name };
}

type FieldDecoder = (dv: DataView, le: boolean) => string;

function decodeFloat(value: number, precision: number): string {
    if (isNaN(value)) { return 'NaN'; }
    if (!isFinite(value)) { return String(value); }
    return value.toExponential(precision);
}

const FIELD_DECODERS: Record<StructScalarFieldType, FieldDecoder> = {
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
    type: StructScalarFieldType,
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
    map: Map<string, StructDef>;
    rows: DecodedField[];
    depth: number;
    pathPrefix: string;
    baseOffset: number;
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
    field: StructField,
    offset: number,
    align: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): number {
    const unitBytes = fieldByteSize(field.type as UnsignedScalarType);
    const unitBits = unitBytes * 8;
    const alignedOffset = alignUp(offset, align);

    for (let idx = 0; idx < field.count; idx++) {
        const fieldPath = fieldElementPath(ctx, field, idx);
        const absOffset = ctx.baseOffset + alignedOffset + idx * unitBytes;
        decodeBitFieldChildren(ctx, field, fieldPath, idx, absOffset, unitBytes, unitBits, endian, allocation);
    }

    return alignedOffset + unitBytes * field.count;
}

function decodeBitFieldChildren(
    ctx: DecodeContext,
    field: StructField,
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
    field: StructField,
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
    const unsignedValue = unit.hasData
        ? extractBitFieldValue(unit.value, unitBits, bitPos, child.bitWidth, allocation)
        : 0n;
    const valueText = bitFieldDecodedText(unit.hasData, unsignedValue, child.bitWidth);
    const enumDef = enumDefById(child.refStructId, ctx.map);
    const enumLabel = enumDef && unit.hasData ? matchEnumEntry(enumDef, unsignedValue)?.name : undefined;
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

function bitFieldDecodedText(hasData: boolean, unsignedValue: bigint, width: number): string {
    return hasData ? bitFieldValueText(unsignedValue, width) : '??';
}

function bitFieldUnsignedText(hasData: boolean, unsignedValue: bigint): string | undefined {
    return hasData ? unsignedValue.toString(10) : undefined;
}

function decodeAsciiField(
    ctx: DecodeContext,
    field: StructField,
    offset: number,
    elemSize: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): number {
    const absOffset = ctx.baseOffset + offset;
    const normalized = normalizeStructField(field);
    const totalBytes = normalized.isPointer ? POINTER_BYTE_SIZE * field.count : elemSize * field.count;
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

function pointerTargetByteSize(field: StructField, map: Map<string, StructDef>, depth: number): number {
    if (field.type === 'void') { return 1; }
    if (field.type === 'struct') {
        const child = referencedStruct(field, map);
        return child ? structByteSizeWithDefs(child, map, depth + 1) : 1;
    }
    if (field.type === 'bitfield') { return 1; }
    if (field.type === 'enum') {
        const target = enumDefById(field.refStructId, map);
        return target ? fieldByteSize(enumBaseType(target)) : 1;
    }
    return fieldByteSize(field.type);
}

function pointerTargetStructName(field: StructField, map: Map<string, StructDef>): string | undefined {
    if (field.type !== 'struct' || !field.refStructId) { return undefined; }
    return map.get(field.refStructId)?.name;
}

function decodePointerElements(
    ctx: DecodeContext,
    field: StructField,
    offset: number,
    endian: 'le' | 'be',
): void {
    for (let idx = 0; idx < field.count; idx++) {
        const fieldPath = fieldElementPath(ctx, field, idx);
        const absOffset = ctx.baseOffset + offset + idx * POINTER_BYTE_SIZE;
        const raw = readFieldBytes(ctx, absOffset, POINTER_BYTE_SIZE);
        const hasData = raw.every(v => v >= 0);
        ctx.rows.push({
            fieldName: fieldPath,
            type: field.type === 'struct' || field.type === 'bitfield' || field.type === 'enum' ? 'void' : field.type,
            pointerTargetType: field.type,
            pointerTargetStructId: field.refStructId,
            pointerTargetStructName: pointerTargetStructName(field, ctx.map),
            pointerTargetByteSize: pointerTargetByteSize(field, ctx.map, ctx.depth),
            pointerValue: decodePointerValue(raw, endian),
            isPointer: true,
            arrayIdx: idx,
            byteOffset: absOffset,
            bytesHex: bytesToHex(raw),
            decoded: hasData ? decodeField(raw, 'pointer', endian) : '??',
            hasData,
            endian,
        });
    }
}

function decodeScalarFieldElement(
    ctx: DecodeContext,
    field: StructField,
    fieldPath: string,
    arrayIdx: number,
    absOffset: number,
    elemSize: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): void {
    field = normalizeStructField(field);
    if (field.type === 'struct' || field.type === 'bitfield') { return; }
    const enumDef = referencedEnumDef(field, ctx.map);
    if (field.type === 'enum' && !enumDef) { return; }
    const decodeType: StructScalarFieldType = enumDef ? enumBaseType(enumDef) : (field.type as StructScalarFieldType);
    const raw = readFieldBytes(ctx, absOffset, elemSize);
    const hasData = raw.every(v => v >= 0);
    const enumLabel = enumDef && hasData ? matchEnumEntry(enumDef, bytesToBigUint(raw, endian))?.name : undefined;
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

function decodeNestedStructField(
    ctx: DecodeContext,
    field: StructField,
    fieldPath: string,
    absOffset: number,
    inheritedEndian: 'le' | 'be',
    inheritedAllocation: BitFieldAllocation,
): void {
    field = normalizeStructField(field);
    const child = referencedStruct(field, ctx.map);
    if (!child || ctx.depth >= MAX_NESTED_DEPTH) { return; }
    decodeStructRecursive(
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
    );
}

function decodeFieldElements(
    ctx: DecodeContext,
    field: StructField,
    offset: number,
    elemSize: number,
    endian: 'le' | 'be',
    allocation: BitFieldAllocation,
): number {
    field = normalizeStructField(field);
    if (field.isPointer) {
        decodePointerElements(ctx, field, offset, endian);
        return offset + POINTER_BYTE_SIZE * field.count;
    }
    let nextOffset = offset;
    for (let idx = 0; idx < field.count; idx++) {
        const fieldPath = fieldElementPath(ctx, field, idx);
        const absOffset = ctx.baseOffset + nextOffset;
        if (field.type === 'struct') {
            decodeNestedStructField(ctx, field, fieldPath, absOffset, endian, allocation);
        } else {
            decodeScalarFieldElement(ctx, field, fieldPath, idx, absOffset, elemSize, endian, allocation);
        }
        nextOffset += elemSize;
    }
    return nextOffset;
}

function fieldElementPath(ctx: DecodeContext, field: StructField, idx: number): string {
    field = normalizeStructField(field);
    const elementName = field.count > 1 ? `${field.name}[${idx}]` : field.name;
    return joinFieldPath(ctx.pathPrefix, elementName);
}

function decodeStructRecursive(
    def: StructDef,
    baseAddr: number,
    getByte: (addr: number) => number | undefined,
    globalEndian: 'le' | 'be',
    bitFieldAllocation: BitFieldAllocation,
    map: Map<string, StructDef>,
    rows: DecodedField[],
    depth: number,
    pathPrefix: string,
    baseOffset: number,
    effectiveEndian: 'le' | 'be',
    effectiveAllocation: BitFieldAllocation,
): number {
    let offset = 0;
    const ctx: DecodeContext = { baseAddr, getByte, bitFieldAllocation, globalEndian, map, rows, depth, pathPrefix, baseOffset };

    // First explicit value up the chain wins — this struct's override beats whatever
    // the enclosing struct/field/global passed down as effective.
    const { endian: structEndian, allocation: structAllocation } = resolveEndianAllocation(def, effectiveEndian, effectiveAllocation);

    for (const field of def.fields) {
        offset = decodeStructField(ctx, def, field, offset, structEndian, structAllocation);
    }

    if (!def.packed) {
        const structAlign = structAlignmentWithDefs(def, map, depth);
        offset = alignUp(offset, structAlign);
    }

    return offset;
}

function decodeStructField(
    ctx: DecodeContext,
    def: StructDef,
    field: StructField,
    offset: number,
    structEndian: 'le' | 'be',
    structAllocation: BitFieldAllocation,
): number {
    field = normalizeStructField(field);
    const align = def.packed ? 1 : fieldAlignWithDefs(field, ctx.map, ctx.depth);
    const elemSize = fieldSizeWithDefs(field, ctx.map, ctx.depth);
    const { endian: fieldEndian, allocation: fieldAllocation } = resolveEndianAllocation(field, structEndian, structAllocation);
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
 * explicit value up the chain wins. Applies to both StructDef and StructField
 * (field beats struct beats nested parents beats global).
 */
function resolveEndianAllocation(
    item: { endian?: 'le' | 'be'; allocation?: BitFieldAllocation },
    inheritedEndian: 'le' | 'be',
    inheritedAllocation: BitFieldAllocation,
): { endian: 'le' | 'be'; allocation: BitFieldAllocation } {
    return { endian: item.endian ?? inheritedEndian, allocation: item.allocation ?? inheritedAllocation };
}

export function decodeStruct(
    def: StructDef,
    baseAddr: number,
    getByte: (addr: number) => number | undefined,
    globalEndian: 'le' | 'be',
    bitFieldAllocation: BitFieldAllocation = 'msb',
    defs: readonly StructDef[] = [],
): DecodedField[] {
    const rows: DecodedField[] = [];
    const { def: resolved, map } = materializedDefsMap(def, defs);
    decodeStructRecursive(resolved, baseAddr, getByte, globalEndian, bitFieldAllocation, map, rows, 1, '', 0, globalEndian, bitFieldAllocation);
    return rows;
}

// -- All visible structs ------------------------------------------

export function allStructs(defs: readonly StructDef[] = []): StructDef[] {
    return [...defs];
}

// -- C struct text parser -----------------------------------------

/**
 * Maps common C scalar type names to our internal scalar field type.
 * Lookup is case-sensitive first, then case-folded as fallback.
 */
const C_TYPE_MAP: Record<string, StructScalarFieldType> = {
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
const TYPE_TO_C: Record<StructScalarFieldType, string> = {
    ascii: 'char',
    uint8: 'uint8_t', uint16: 'uint16_t', uint32: 'uint32_t', uint64: 'uint64_t',
    int8: 'int8_t', int16: 'int16_t', int32: 'int32_t', int64: 'int64_t',
    float32: 'float', float64: 'double',
    pointer: 'void*',
    void: 'void',
};

function fieldTypeToC(field: StructField, defsById: Map<string, StructDef>): string {
    field = normalizeStructField(field);
    const base = fieldBaseTypeToC(field, defsById);
    return field.isPointer ? `${base}*` : base;
}

function fieldBaseTypeToC(field: StructField, defsById: Map<string, StructDef>): string {
    if (field.type === 'enum') { return enumFieldBaseTypeToC(field, defsById); }
    return field.type === 'struct' || field.type === 'bitfield'
        ? structFieldBaseTypeToC(field, defsById)
        : TYPE_TO_C[field.type];
}

/** An enum-typed field is emitted as its unsigned base-width integer (size/offset faithful). */
function enumFieldBaseTypeToC(field: StructField, defsById: Map<string, StructDef>): string {
    const target = enumDefById(field.refStructId, defsById);
    const base = target ? enumBaseType(target) : 'uint8';
    return TYPE_TO_C[base];
}

/** `  enum <Name>` comment suffix for an enum-typed field, or '' otherwise. */
function enumFieldNote(field: StructField, defsById: Map<string, StructDef>): string {
    const target = enumDefById(field.refStructId, defsById);
    return field.type === 'enum' && target ? `  enum ${target.name}` : '';
}

function structFieldBaseTypeToC(field: StructField, defsById: Map<string, StructDef>): string {
    const child = defsById.get(field.refStructId ?? '');
    return child === undefined ? 'uint8_t' : child.name;
}

function isPrintableAsciiByte(value: number): boolean {
    return value >= 0x20 && value < 0x7F;
}

export interface ParseStructTextResult {
    /** Struct name extracted from a `struct Name { }` wrapper, or null. */
    structName: string | null;
    fields: StructField[];
    /** Parse error messages (one per bad line). */
    errors: string[];
}

function appendParsedBitField(
    fields: StructField[],
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
    last: StructField | undefined,
    type: UnsignedScalarType,
    lastUsedBits: number,
    bitWidth: number,
    unitBits: number,
): last is StructField & { bitFields: BitFieldChild[] } {
    if (!isMatchingBitFieldContainer(last, type)) { return false; }
    return lastUsedBits + bitWidth <= unitBits;
}

function isMatchingBitFieldContainer(
    field: StructField | undefined,
    type: UnsignedScalarType,
): field is StructField & { bitFields: BitFieldChild[] } {
    return Boolean(field) &&
        field!.type === type &&
        field!.count === 1 &&
        Array.isArray(field!.bitFields);
}

type ParsedStructLine =
    | { kind: 'skip' }
    | { kind: 'error'; message: string }
    | { kind: 'field'; field: StructField }
    | { kind: 'bitField'; type: UnsignedScalarType; name: string; bitWidth: number };

interface StructDeclarationParts {
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

function stripStructLine(rawLine: string): string {
    const noBlock = rawLine.replace(/\/\*[^*\n]*\*\//g, '');
    const slashIdx = noBlock.indexOf('//');
    const line = (slashIdx >= 0 ? noBlock.slice(0, slashIdx) : noBlock).trim();
    return line.replace(/;$/, '').trim();
}

function parseBitFieldDeclaration(
    fieldName: string,
    mapped: StructScalarFieldType,
    bitWidth: number,
    count: number,
): ParsedStructLine {
    const error = bitFieldDeclarationError(fieldName, mapped, bitWidth, count);
    if (error) { return { kind: 'error', message: error }; }
    return { kind: 'bitField', type: mapped as UnsignedScalarType, name: fieldName, bitWidth };
}

function bitFieldDeclarationError(
    fieldName: string,
    mapped: StructScalarFieldType,
    bitWidth: number,
    count: number,
): string | null {
    return bitFieldBaseTypeDeclarationError(fieldName, mapped) ??
        bitFieldWidthDeclarationError(fieldName, mapped, bitWidth) ??
        bitFieldCountDeclarationError(fieldName, count);
}

function bitFieldBaseTypeDeclarationError(fieldName: string, mapped: StructScalarFieldType): string | null {
    return isUnsignedScalarType(mapped) ? null : bitFieldBaseTypeError(fieldName);
}

function bitFieldWidthDeclarationError(fieldName: string, mapped: StructScalarFieldType, bitWidth: number): string | null {
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

function parseStructDeclarationLine(rawLine: string, defsByName: Map<string, StructDef> = new Map()): ParsedStructLine {
    const stripped = stripStructLine(rawLine);
    if (shouldSkipStructDeclaration(stripped)) { return { kind: 'skip' }; }

    const parts = parseStructDeclarationParts(stripped);
    if (!parts) { return { kind: 'error', message: `Cannot parse: "${stripped}"` }; }

    return parseResolvedStructDeclaration(parts, defsByName);
}

function parseResolvedStructDeclaration(parts: StructDeclarationParts, defsByName: Map<string, StructDef>): ParsedStructLine {
    const structDef = resolvePointerStructType(parts.rawType, parts.isPointer, defsByName);
    if (structDef) { return parsedStructPointerOrField(parts, structDef); }

    const mapped = mapStructDeclarationType(parts.rawType);
    return mapped ? parseMappedStructDeclaration(parts, mapped) : parseUnknownStructDeclaration(parts);
}

function parseMappedStructDeclaration(parts: StructDeclarationParts, mapped: StructScalarFieldType): ParsedStructLine {
    if (parts.bitWidth !== null) {
        return parseBitFieldDeclaration(parts.fieldName, mapped, parts.bitWidth, parts.count);
    }
    const field: StructField = { name: parts.fieldName, type: mapped, count: parts.count };
    if (parts.isPointer) { field.isPointer = true; }
    return { kind: 'field', field };
}

function parseUnknownStructDeclaration(parts: StructDeclarationParts): ParsedStructLine {
    return parts.isPointer
        ? { kind: 'field', field: { name: parts.fieldName, type: 'void', isPointer: true, count: parts.count } }
        : { kind: 'error', message: `Unknown type "${parts.rawType}" for field "${parts.fieldName}"` };
}

function resolvePointerStructType(rawType: string, isPointer: boolean, defsByName: Map<string, StructDef>): StructDef | undefined {
    if (!isPointer) { return undefined; }
    const normalized = rawType.replace(/^struct\s+/, '');
    return defsByName.get(normalized);
}

function parsedStructPointerOrField(parts: StructDeclarationParts, structDef: StructDef): ParsedStructLine {
    const field: StructField = {
        name: parts.fieldName,
        type: 'struct',
        refStructId: structDef.id,
        count: parts.count,
    };
    if (parts.isPointer) { field.isPointer = true; }
    return {
        kind: 'field',
        field,
    };
}

function shouldSkipStructDeclaration(stripped: string): boolean {
    if (SKIP_STRUCT_LINES.has(stripped)) { return true; }
    return isStructWrapperLine(stripped);
}

const SKIP_STRUCT_LINES = new Set(['', '{', '}']);
const STRUCT_POINTER_DECL_RE = /^struct\s+\w+\s*\*/;
const STRUCT_WRAPPER_RE = /^(?:typedef|struct|union)\b/;

function isStructWrapperLine(stripped: string): boolean {
    return !STRUCT_POINTER_DECL_RE.test(stripped) && STRUCT_WRAPPER_RE.test(stripped);
}

function parseStructDeclarationParts(stripped: string): StructDeclarationParts | null {
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

function mapStructDeclarationType(rawType: string): StructScalarFieldType | undefined {
    return C_TYPE_MAP[rawType] ?? C_TYPE_MAP[rawType.toLowerCase()];
}

/**
 * Parse C-style struct field declarations into StructField[].
 * Accepts bare field declarations OR a full `struct Name { ... }` / `typedef struct Name { ... }`.
 * Nested type references are not resolved here and must be chosen in the struct editor.
 */
export function parseStructText(text: string, defs: readonly StructDef[] = []): ParseStructTextResult {
    const errors: string[] = [];
    const fields: StructField[] = [];
    let structName: string | null = null;
    const defsByName = new Map(defs.map(def => [def.name, def]));

    const cleaned = preserveMultilineCommentSpacing(text);

    const nameMatch = cleaned.match(/(?:typedef\s+)?struct\s+(\w+)\s*\{/);
    if (nameMatch) { structName = nameMatch[1]; }

    const bodyMatch = cleaned.match(/\{([\s\S]*)\}/);
    const body = bodyMatch ? bodyMatch[1] : cleaned;

    for (const rawLine of body.split('\n')) {
        appendParsedStructLine(rawLine, fields, errors, defsByName);
    }

    return { structName, fields, errors };
}

function appendParsedStructLine(rawLine: string, fields: StructField[], errors: string[], defsByName: Map<string, StructDef>): void {
    const parsed = parseStructDeclarationLine(rawLine, defsByName);
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

/** Serialize StructField[] back to C-style declarations. */
export function fieldsToText(fields: StructField[], defs: readonly StructDef[] = []): string {
    if (fields.length === 0) { return ''; }
    const byId = new Map<string, StructDef>(defs.map(d => [d.id, d]));
    const resolved = fields.map(f => materializeStructField(f, byId));
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

type StructCEmitState = {
    byId: Map<string, StructDef>;
    lines: string[];
    maxTypeLen: number;
    offset: number;
    maxAlign: number;
    packed: boolean;
};

function emitStructCField(f: StructField, fieldIndex: number, state: StructCEmitState): void {
    if (isBitFieldContainer(f)) {
        emitBitFieldContainerC(f, state);
        return;
    }

    emitScalarStructFieldC(f, fieldIndex, state);
}

function emitBitFieldContainerC(f: StructField, state: StructCEmitState): void {
    const unitBytes = fieldByteSize(f.type as UnsignedScalarType);
    const align = state.packed ? 1 : fieldAlignWithDefs(f, state.byId, 1);
    applyStructCAlignment(align, state);

    const cType = fieldTypeToC(f, state.byId);
    const arr = f.count > 1 ? `[${f.count}]` : '';
    const fieldName = f.name || 'bitfield';

    state.lines.push(`    struct {`);
    appendBitFieldChildrenC(f, cType, state.lines);
    state.lines.push(`    } ${fieldName}${arr};`);
    state.offset += unitBytes * f.count;
}

function appendBitFieldChildrenC(f: StructField, cType: string, lines: string[]): void {
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

function emitScalarStructFieldC(f: StructField, fieldIndex: number, state: StructCEmitState): void {
    const fieldSize = fieldSizeWithDefs(f, state.byId, 1);
    const align = state.packed ? 1 : fieldAlignWithDefs(f, state.byId, 1);
    applyStructCAlignment(align, state);

    const cType = fieldTypeToC(f, state.byId).padEnd(state.maxTypeLen);
    const displayFieldName = f.name || `field${fieldIndex}`;
    const arr = f.count > 1 ? `[${f.count}]` : '';
    const fieldBytes = fieldSize * f.count;
    state.lines.push(
        `    ${cType} ${displayFieldName}${arr};`.padEnd(44) +
        `/* +${state.offset.toString().padStart(3)}  ${fieldBytes}B${enumFieldNote(f, state.byId)} */`
    );
    state.offset += fieldBytes;
}

function applyStructCAlignment(align: number, state: StructCEmitState): void {
    if (align > state.maxAlign) { state.maxAlign = align; }
    const aligned = alignUp(state.offset, align);
    if (!state.packed && aligned > state.offset) {
        appendStructCPadding(state.lines, state.offset, aligned - state.offset);
    }
    state.offset = aligned;
}

function appendStructCPadding(lines: string[], offset: number, padBytes: number): void {
    lines.push(
        `    uint8_t  _pad${offset}[${padBytes}];`.padEnd(44) +
        `/* +${offset.toString().padStart(3)}  ${padBytes}B padding */`
    );
}

function maxStructCTypeLength(fields: StructField[], byId: Map<string, StructDef>): number {
    const typeLens = fields.map(f => fieldTypeToC(f, byId).length);
    return typeLens.length > 0 ? Math.max(...typeLens) : 8;
}

function createStructCEmitState(def: StructDef, lines: string[], byId: Map<string, StructDef>): StructCEmitState {
    return { byId, lines, maxTypeLen: maxStructCTypeLength(def.fields, byId), offset: 0, maxAlign: 1, packed: !!def.packed };
}

function appendStructCFooter(def: StructDef, lines: string[], totalBytes: number, alignNote: string): void {
    const displayName = def.name || 'MyStruct';
    lines.push(`} ${displayName};`.padEnd(44) + `/* ${totalBytes}B, ${alignNote} */`);
}

function emitStructCFields(def: StructDef, state: StructCEmitState): void {
    for (let fieldIndex = 0; fieldIndex < def.fields.length; fieldIndex++) {
        emitStructCField(def.fields[fieldIndex], fieldIndex, state);
    }
}

function appendTrailingStructCPadding(def: StructDef, lines: string[], offset: number, totalPadded: number): void {
    if (def.packed || totalPadded <= offset) { return; }
    appendStructCPadding(lines, offset, totalPadded - offset);
}

function structCTotalBytes(def: StructDef, totalUnpadded: number, totalPadded: number): number {
    return def.packed ? totalUnpadded : totalPadded;
}

function structCAlignNote(def: StructDef, maxAlign: number): string {
    return def.packed ? 'packed' : `align=${maxAlign}`;
}

/** Render a StructDef as a C typedef with per-field offset comments. */
export function structToC(def: StructDef, defs: readonly StructDef[] = []): string {
    const { def: resolved, map: byId } = materializedDefsMap(def, defs);
    if (structDefKind(resolved) === 'bitfield') { return bitFieldDefToC(resolved); }
    if (structDefKind(resolved) === 'enum') { return enumDefToC(resolved); }

    const attr = resolved.packed ? ' __attribute__((packed))' : '';
    const lines: string[] = [];
    lines.push(`typedef struct${attr} {`);

    const state = createStructCEmitState(resolved, lines, byId);

    emitStructCFields(resolved, state);

    const totalUnpadded = state.offset;
    const totalPadded = alignUp(state.offset, state.maxAlign);
    appendTrailingStructCPadding(resolved, lines, state.offset, totalPadded);

    const totalBytes = structCTotalBytes(resolved, totalUnpadded, totalPadded);
    const alignNote = structCAlignNote(resolved, state.maxAlign);
    appendStructCFooter(resolved, lines, totalBytes, alignNote);

    return lines.join('\n');
}

/** Render a standalone `kind: 'bitfield'` def as a C typedef of its storage unit. */
function bitFieldDefToC(def: StructDef): string {
    const baseType = def.baseType ?? 'uint8';
    const lines: string[] = [];
    lines.push('typedef struct {');
    const container: StructField = { name: def.name || 'bitfield', type: baseType, count: 1, bitFields: def.bitFields ?? [] };
    appendBitFieldChildrenC(container, TYPE_TO_C[baseType], lines);
    lines.push(`} ${def.name || 'MyBitField'};`.padEnd(44) + `/* ${fieldByteSize(baseType)}B */`);
    return lines.join('\n');
}

/** Render a standalone `kind: 'enum'` def as a C enum typedef sized to its base width. */
function enumDefToC(def: StructDef): string {
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
