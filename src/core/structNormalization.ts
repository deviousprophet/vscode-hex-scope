/**
 * Struct-definition normalization. Runtime-neutral, so both the extension
 * host (session + migration) and tests share it.
 */

import type { StructDef } from './types';
import { hasSeenStructDefIdentity, rememberStructDefIdentity, structDefIdentity } from './structIdentities';

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