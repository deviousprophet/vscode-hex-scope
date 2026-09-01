// ── Selection-edit session helpers (pure) ─────────────────────────
// Mapped-only walking used by the context-menu "Edit selected bytes"
// session. Kept free of webview globals so unit tests import directly
// (pattern: editTransactions.ts) — `isMapped` is injected by the host.

/** Next mapped address strictly after `addr`, still `<= end`; null when none. */
export function advanceWithinRange(addr: number, end: number, isMapped: (a: number) => boolean): number | null {
    for (let a = addr + 1; a <= end; a++) {
        if (isMapped(a)) { return a; }
    }
    return null;
}

/** Collapse same-address duplicates to the last write (session re-edit at range end). */
export function dedupeEditsLastWriteWins(edits: Array<[number, number]>): Array<[number, number]> {
    const last = new Map<number, number>();
    for (const [addr, value] of edits) { last.set(addr, value); }
    return Array.from(last.entries());
}