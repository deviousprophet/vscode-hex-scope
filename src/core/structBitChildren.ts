/**
 * Shared inline bit-field child-list helper. Runtime-neutral, so struct-def
 * normalization and the pin reference stripper rebuild children the same way
 * (same reference when nothing changed).
 */

import type { BitFieldChild } from './types';

function bitChildListChanged(before: readonly BitFieldChild[], after: readonly BitFieldChild[]): boolean {
    return before.some((c, i) => c !== after[i]);
}

/**
 * Rebuild an item's inline bit-field children through `cleanChild`, returning the
 * original item (same reference) when it has no children or none changed.
 */
export function withCleanedBitChildren<T extends { bitFields?: BitFieldChild[] }>(
    item: T,
    cleanChild: (child: BitFieldChild) => BitFieldChild,
): T {
    const children = item.bitFields;
    if (!Array.isArray(children) || children.length === 0) { return item; }
    const cleaned = children.map(cleanChild);
    return bitChildListChanged(children, cleaned) ? { ...item, bitFields: cleaned } : item;
}
