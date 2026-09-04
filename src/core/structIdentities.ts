import type { StructDef } from './types';

export type StructDefIdentity = { id: string; name: string };

export function createStructDefIdentitySets(defs: StructDef[]): { usedIds: Set<string>; usedNames: Set<string> } {
    return {
        usedIds: new Set(defs.map(s => structDefIdentity(s)?.id).filter((id): id is string => typeof id === 'string')),
        usedNames: new Set(defs.map(s => structDefIdentity(s)?.name).filter((name): name is string => typeof name === 'string')),
    };
}

export function structDefIdentity(value: unknown): StructDefIdentity | null {
    const id = stringProperty(value, 'id');
    if (!id) { return null; }
    const name = stringProperty(value, 'name');
    return name ? { id, name } : null;
}

export function rememberStructDefIdentity(identity: StructDefIdentity, seenIds: Set<string>, seenNames: Set<string>): void {
    seenIds.add(identity.id);
    seenNames.add(identity.name);
}

export function hasSeenStructDefIdentity(identity: StructDefIdentity, seenIds: Set<string>, seenNames: Set<string>): boolean {
    return seenIds.has(identity.id) || seenNames.has(identity.name);
}

function stringProperty(value: unknown, key: 'id' | 'name'): string | null {
    const prop = (value as { id?: unknown; name?: unknown })?.[key];
    return typeof prop === 'string' ? prop : null;
}