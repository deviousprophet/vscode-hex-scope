/**
 * Type-definition migration and legacy merge. Runtime-neutral, so both the
 * extension host (session + migration) and tests share it.
 *
 * NOTE: legacy type fields may carry a per-field `endian` annotation
 * (pre-global-endian era). That key is a first-class per-field override
 * again, so migration passes it through untouched — annotated fields
 * decode with their declared byte order, and new saves round-trip.
 */

import type { TypeDef } from '../types';
import { createTypeDefIdentitySets, hasSeenTypeDefIdentity, rememberTypeDefIdentity, typeDefIdentity } from './overlayIdentities';

export function migrateTypeDefinitions(value: unknown): unknown {
    return value;
}

export function mergeLegacyTypeDefs(globalArr: TypeDef[], legacyArr: TypeDef[]): { defs: TypeDef[]; changed: boolean } {
    if (legacyArr.length === 0) { return { defs: globalArr, changed: false }; }
    const { usedIds, usedNames } = createTypeDefIdentitySets(globalArr);
    const migrated = legacyArr.filter(s => {
        const identity = typeDefIdentity(s);
        if (!identity || hasSeenTypeDefIdentity(identity, usedIds, usedNames)) { return false; }
        rememberTypeDefIdentity(identity, usedIds, usedNames);
        return true;
    });
    return migrated.length > 0 ? { defs: [...globalArr, ...migrated], changed: true } : { defs: globalArr, changed: false };
}