import type { TypeDef } from '../types';

export type TypeDefIdentity = { id: string; name: string };

export function createTypeDefIdentitySets(defs: TypeDef[]): { usedIds: Set<string>; usedNames: Set<string> } {
    return {
        usedIds: new Set(defs.map(s => typeDefIdentity(s)?.id).filter((id): id is string => typeof id === 'string')),
        usedNames: new Set(defs.map(s => typeDefIdentity(s)?.name).filter((name): name is string => typeof name === 'string')),
    };
}

export function typeDefIdentity(value: unknown): TypeDefIdentity | null {
    const id = stringProperty(value, 'id');
    if (!id) { return null; }
    const name = stringProperty(value, 'name');
    return name ? { id, name } : null;
}

export function rememberTypeDefIdentity(identity: TypeDefIdentity, seenIds: Set<string>, seenNames: Set<string>): void {
    seenIds.add(identity.id);
    seenNames.add(identity.name);
}

export function hasSeenTypeDefIdentity(identity: TypeDefIdentity, seenIds: Set<string>, seenNames: Set<string>): boolean {
    return seenIds.has(identity.id) || seenNames.has(identity.name);
}

function stringProperty(value: unknown, key: 'id' | 'name'): string | null {
    const prop = (value as { id?: unknown; name?: unknown })?.[key];
    return typeof prop === 'string' ? prop : null;
}