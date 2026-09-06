// ── Runtime-neutral from-unknown pickers ───────────────────────────
// Shared by the host storage adapter (hexScopeStorage) and the migration
// module (hexScopeMigration). No vscode import — safe for src/core.

/** Narrow an unknown to a plain object (non-null, non-array), or null. */
export function plainObject(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { return null; }
    return value as Record<string, unknown>;
}

/** The value as an array when it is one; otherwise the given empty (default []). */
export function arrayOrEmpty(value: unknown, empty: unknown[] = []): unknown[] {
    return Array.isArray(value) ? value : empty;
}

/** String entries of a plain object; {} when the value is not an object. */
export function plainStringRecord(value: unknown): Record<string, string> {
    const raw = plainObject(value);
    if (!raw) { return {}; }
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(raw)) { if (typeof entry === 'string') { out[key] = entry; } }
    return out;
}

/** String field of a plain object ('' when absent/non-string). */
export function stringField(o: Record<string, unknown>, key: string): string {
    return typeof o[key] === 'string' ? o[key] as string : '';
}

/** Array field of a plain object ([] when absent/non-array). */
export function arrayField(o: Record<string, unknown>, key: string): unknown[] {
    return Array.isArray(o[key]) ? o[key] as unknown[] : [];
}

/** The value as a string when it is one; otherwise ''. */
export function stringOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value : '';
}