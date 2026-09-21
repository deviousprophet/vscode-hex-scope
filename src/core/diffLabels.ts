export interface PathLabelInput {
    name: string;
    path: string;
}

function pathParts(path: string): string[] {
    return path.split(/[\\/]/).filter(Boolean);
}

/**
 * Side labels for a pair of files: the basename, unless both sides share one —
 * then the shortest trailing path suffix that tells them apart.
 */
export function disambiguatedLabels(a: PathLabelInput, b: PathLabelInput): [string, string] {
    if (a.name !== b.name) { return [a.name, b.name]; }
    const aParts = pathParts(a.path);
    const bParts = pathParts(b.path);
    const depth = shortestDistinctDepth(aParts, bParts);
    return [suffixLabel(aParts, depth, a.name), suffixLabel(bParts, depth, b.name)];
}

/** Smallest trailing depth whose suffixes differ (clamped to the longer path). */
function shortestDistinctDepth(aParts: string[], bParts: string[]): number {
    const maxDepth = Math.max(aParts.length, bParts.length);
    let depth = 1;
    while (depth < maxDepth && sameSuffix(aParts, bParts, depth)) { depth++; }
    return depth;
}

function sameSuffix(aParts: string[], bParts: string[], depth: number): boolean {
    return aParts.slice(-depth).join('/') === bParts.slice(-depth).join('/');
}

function suffixLabel(parts: string[], depth: number, fallback: string): string {
    return parts.slice(-depth).join('/') || fallback;
}
