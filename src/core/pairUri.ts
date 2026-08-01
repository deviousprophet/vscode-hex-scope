// Pair-keyed virtual document URI encoding (PRD D14).
// Pure string logic — no `vscode` import, testable under node.
// Round-trips two paths -> one opaque key -> two paths.
// Canonical order by fsPath so the same pair always maps to the same key,
// and same-name-different-folder pairs stay distinct (pair identity is by
// fsPath, never by filename, D8).

/** Opaque key: base64 of JSON [aPath, bPath], canonicalized, uri-encoded. */
export function encodePairKey(aPath: string, bPath: string): string {
    const [ap, bp] = pairCanonical(aPath, bPath);
    return encodeURIComponent(Buffer.from(JSON.stringify([ap, bp]), 'utf8').toString('base64'));
}

/** Decode an opaque pair key back into [aPath, bPath] (canonical order). */
export function decodePairKey(key: string): { aPath: string; bPath: string } {
    let pair: unknown;
    try {
        pair = JSON.parse(Buffer.from(decodeURIComponent(key), 'base64').toString('utf8'));
    } catch {
        throw new Error('invalid pair key');
    }
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some(p => typeof p !== 'string')) {
        throw new Error('invalid pair key');
    }
    const [ap, bp] = pairCanonical(pair[0] as string, pair[1] as string);
    return { aPath: ap, bPath: bp };
}

/** Canonical order: sort by fsPath, tiebreak by raw path string. */
function pairCanonical(a: string, b: string): [string, string] {
    return a === b ? [a, b] : a < b ? [a, b] : [b, a];
}
