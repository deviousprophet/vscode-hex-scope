// ── Struct-definition migration and normalization ─────────────────
// Single owner for struct-def migration/deduplication. Runtime-neutral,
// so both the extension host (session + migration) and tests share it.

import type { StructDef } from './types';

type StructDefIdentity = { id: string; name: string };

export function migrateStructDefinitions(value: unknown): unknown {
    if (!Array.isArray(value)) { return value; }
    return value.map(item => {
        if (item === null || typeof item !== 'object') { return item; }
        const def = item as { fields?: unknown };
        if (!Array.isArray(def.fields)) { return item; }
        return {
            ...def,
            fields: def.fields.map(field => {
                if (field === null || typeof field !== 'object') { return field; }
                const clean = { ...field } as Record<string, unknown>;
                delete clean.endian;
                return clean;
            }),
        };
    });
}

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
    return { defs: out, changed };
}

function appendUniqueStructDef(item: unknown, out: StructDef[], seenIds: Set<string>, seenNames: Set<string>): boolean {
    const identity = structDefIdentity(item);
    if (!identity || hasSeenStructDefIdentity(identity, seenIds, seenNames)) { return false; }
    rememberStructDefIdentity(identity, seenIds, seenNames);
    out.push(item as StructDef);
    return true;
}

export function mergeLegacyStructDefs(globalArr: StructDef[], legacyArr: StructDef[]): { defs: StructDef[]; changed: boolean } {
    if (legacyArr.length === 0) { return { defs: globalArr, changed: false }; }
    const { usedIds, usedNames } = createStructDefIdentitySets(globalArr);
    const migrated = legacyArr.filter(s => {
        const identity = structDefIdentity(s);
        if (!identity || hasSeenStructDefIdentity(identity, usedIds, usedNames)) { return false; }
        rememberStructDefIdentity(identity, usedIds, usedNames);
        return true;
    });
    return migrated.length > 0 ? { defs: [...globalArr, ...migrated], changed: true } : { defs: globalArr, changed: false };
}

function createStructDefIdentitySets(defs: StructDef[]): { usedIds: Set<string>; usedNames: Set<string> } {
    return {
        usedIds: new Set(defs.map(s => structDefIdentity(s)?.id).filter((id): id is string => typeof id === 'string')),
        usedNames: new Set(defs.map(s => structDefIdentity(s)?.name).filter((name): name is string => typeof name === 'string')),
    };
}

function structDefIdentity(value: unknown): StructDefIdentity | null {
    const id = stringProperty(value, 'id');
    if (!id) { return null; }
    const name = stringProperty(value, 'name');
    return name ? { id, name } : null;
}

function stringProperty(value: unknown, key: 'id' | 'name'): string | null {
    const prop = (value as { id?: unknown; name?: unknown })?.[key];
    return typeof prop === 'string' ? prop : null;
}

function rememberStructDefIdentity(identity: StructDefIdentity, seenIds: Set<string>, seenNames: Set<string>): void {
    seenIds.add(identity.id);
    seenNames.add(identity.name);
}

function hasSeenStructDefIdentity(identity: StructDefIdentity, seenIds: Set<string>, seenNames: Set<string>): boolean {
    return seenIds.has(identity.id) || seenNames.has(identity.name);
}