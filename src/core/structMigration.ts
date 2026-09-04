/**
 * Struct-definition migration and legacy merge. Runtime-neutral, so both the
 * extension host (session + migration) and tests share it.
 *
 * NOTE: legacy struct fields may carry a per-field `endian` annotation
 * (pre-global-endian era). That key is a first-class per-field override
 * again, so migration passes it through untouched — annotated fields
 * decode with their declared byte order, and new saves round-trip.
 */

import type { StructDef } from './types';
import { createStructDefIdentitySets, hasSeenStructDefIdentity, rememberStructDefIdentity, structDefIdentity } from './structIdentities';

export function migrateStructDefinitions(value: unknown): unknown {
    return value;
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