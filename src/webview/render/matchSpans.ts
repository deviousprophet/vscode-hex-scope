// ── Shared search-match span expansion ───────────────────────────
// One match base address covers `length` consecutive addresses; both
// grids build their highlight set through this single helper.

export function addMatchSpan(set: Set<number>, base: number, length: number): void {
    for (let i = 0; i < length; i++) { set.add(base + i); }
}
