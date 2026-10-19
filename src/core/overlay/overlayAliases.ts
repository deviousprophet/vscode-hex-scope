/**
 * Deprecated read-window aliases for the Type Overlay rename.
 *
 * The persisted contract was renamed in data-schema v2 — `structPins` →
 * `typeInstances`, `structId` → `typeId`, `refStructId` → `refTypeId`,
 * `sourceStructId` → `sourceTypeId` (`schemas/types.schema.json`). The payload
 * migration in `hexScopeStorage` rewrites the keys of a recorded v1 payload, but
 * an old-format payload can still reach a normalizer without passing through
 * that runner (a legacy `firmware_profiles/<n>/structs.json`, a per-directory
 * `profiles/<id>/profile.json`, or Memento-era instance arrays). These helpers
 * alias the legacy keys so such data still loads; **writers emit only the new
 * names**.
 *
 * The aliases are lossless and **identity-preserving**: a value that carries no
 * legacy key is returned by reference and a renamed key keeps its position, so a
 * clean pool is untouched (no spurious self-heal write, no re-allocation).
 * Runtime-neutral — no DOM, no VS Code.
 *
 * Every nesting level is covered, including an inline bit-field container's own
 * children (`field.bitFields[].refStructId`), whose ref must be renamed *before*
 * `migrateInlineBitFields` reads the container signature and copies it into a
 * reusable def — otherwise the child's enum ref is lost and the stale key is
 * re-emitted into the (strict-schema) `types.json`.
 */

import { plainObject } from '../fromUnknown';

/** Rewrites one node of a payload; returns its input when nothing moved. */
type EntryAlias = (entry: unknown) => unknown;

/** Alias a `TypeDef[]` payload; `changed` reports whether any legacy key moved. */
export function aliasLegacyTypeDefs(value: unknown): { value: unknown; changed: boolean } {
    if (!Array.isArray(value)) { return { value, changed: false }; }
    const next = value.map(entry => aliasLegacyTypeDef(entry));
    return { value: next, changed: next.some((def, index) => def !== value[index]) };
}

/** Alias one def: a field / bit-child `refStructId` becomes `refTypeId`, and an
 *  inline bit-field container's own children are aliased in turn (their
 *  `refStructId` is the child's enum ref). */
export function aliasLegacyTypeDef(entry: unknown): unknown {
    return aliasEntry(entry, def => aliasValues(def, DEF_CHILD_ALIASES));
}

/** Alias one profile record: `structPins` → `typeInstances` (plus its instances). */
export function aliasLegacyProfileRecord(entry: unknown): unknown {
    return aliasEntry(entry, record => aliasValues(renameKeyIn(record, 'structPins', 'typeInstances'), RECORD_CHILD_ALIASES));
}

/** Alias one saved instance: `structId` → `typeId`, a pointer source's
 *  `sourceStructId` → `sourceTypeId`. */
export function aliasLegacyTypeInstance(entry: unknown): unknown {
    return aliasEntry(entry, instance => renameKeyIn(aliasValues(instance, INSTANCE_CHILD_ALIASES), 'structId', 'typeId'));
}

// ── Aliased children of each node ─────────────────────────────────
// The maps below are the whole "which key means what" contract; each entry is a
// list-valued child whose elements are aliased in turn.

const DEF_CHILD_ALIASES: Record<string, EntryAlias> = { fields: aliasMemberList, bitFields: aliasMemberList };
const INSTANCE_CHILD_ALIASES: Record<string, EntryAlias> = { pointerSources: aliasPointerSourceList };
const RECORD_CHILD_ALIASES: Record<string, EntryAlias> = { typeInstances: aliasInstanceList };
/** A def member's own inline container children (a legacy `type: 'uint8'` field
 *  with `bitFields`), whose `refStructId` is that bit's enum ref. */
const MEMBER_CHILD_ALIASES: Record<string, EntryAlias> = { bitFields: aliasMemberList };

/** Member list of a def / bit-container: `refStructId` → `refTypeId` per member,
 *  recursing into an inline container's children. */
function aliasMemberList(list: unknown): unknown {
    return aliasEach(list, aliasMember);
}

/** One def member (field or bit child): rename its ref, then alias any inline
 *  container children; the same reference when nothing moved. */
function aliasMember(entry: unknown): unknown {
    return aliasEntry(entry, member => aliasValues(renameKeyIn(member, 'refStructId', 'refTypeId'), MEMBER_CHILD_ALIASES));
}

/** Pointer-source list of an instance: `sourceStructId` → `sourceTypeId`. */
function aliasPointerSourceList(list: unknown): unknown {
    return aliasEach(list, source => aliasEntry(source, entry => renameKeyIn(entry, 'sourceStructId', 'sourceTypeId')));
}

/** Saved-instance list of a profile record. */
function aliasInstanceList(list: unknown): unknown {
    return aliasEach(list, entry => aliasLegacyTypeInstance(entry));
}

// ── Primitives ────────────────────────────────────────────────────

/** Rebuild a plain-object `entry`; non-objects pass through untouched. */
function aliasEntry(entry: unknown, rebuild: (object: Record<string, unknown>) => Record<string, unknown>): unknown {
    const object = plainObject(entry);
    if (object === null) { return entry; }
    return rebuild(object);
}

/** Apply `alias` to every element of `list`; non-arrays pass through, and the
 *  input array is kept when no element moved (so a clean pool stays untouched). */
function aliasEach(list: unknown, alias: EntryAlias): unknown {
    if (!Array.isArray(list)) { return list; }
    const next = list.map(entry => alias(entry));
    return sameItems(list, next) ? list : next;
}

/** Every element identical (a map is 1:1, so the length never changes). */
function sameItems(before: readonly unknown[], after: readonly unknown[]): boolean {
    return after.every((entry, index) => entry === before[index]);
}

/** `mapAliasedValues`, keeping the input reference when no value moved. */
function aliasValues(object: Record<string, unknown>, aliases: Record<string, EntryAlias>): Record<string, unknown> {
    const aliased = mapAliasedValues(object, aliases);
    return valuesUnchanged(object, aliased) ? object : aliased;
}

/** Copy of `object` with each present key passed through its registered alias. */
function mapAliasedValues(object: Record<string, unknown>, aliases: Record<string, EntryAlias>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(object)) { out[key] = aliasValueFor(value, aliases[key]); }
    return out;
}

function aliasValueFor(value: unknown, alias: EntryAlias | undefined): unknown {
    return alias === undefined ? value : alias(value);
}

function valuesUnchanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
    return Object.keys(before).every(key => before[key] === after[key]);
}

/** Rename `from` → `to` in a copy, keeping every other key's position; the same
 *  object when `from` is absent. When a payload carries **both** keys (the schema
 *  allows it) the new key wins and the legacy one is dropped, matching the
 *  documented `newKey ?? legacyKey` read chain. */
function renameKeyIn(object: Record<string, unknown>, from: string, to: string): Record<string, unknown> {
    if (!(from in object)) { return object; }
    return mapEntryKeys(object, keepNewKey(from, to, to in object));
}

/** Per-key mapper: drop `from` when the new key is present, else rename it. */
function keepNewKey(from: string, to: string, dropLegacy: boolean): (key: string) => string | null {
    return key => key !== from ? key : (dropLegacy ? null : to);
}

/** Rebuild `object` through a per-key mapper; a `null` mapping drops the entry. */
function mapEntryKeys(object: Record<string, unknown>, mapKey: (key: string) => string | null): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(object)) {
        const mapped = mapKey(key);
        if (mapped !== null) { out[mapped] = value; }
    }
    return out;
}
