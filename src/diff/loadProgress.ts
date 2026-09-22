/**
 * Combined load progress for the two diff sides.
 *
 * Each file reports a fraction in `[0, 1]` with a read-then-parse split: the read (on the extension
 * host, concurrent only) fills the small leading slice `0 → 0.05` (`READ_SHARE` in
 * `diffEditorPanel.ts`) and the parse (in that file's worker thread) fills `0.05 → 1`. The sum of
 * two monotonic fractions is monotonic: `completed` never regresses and never exceeds two.
 */
export function combinedLoadProgress(fractions: readonly number[]): number {
    return fractions.reduce((total, fraction) => total + clamp(fraction), 0);
}

/** Clamp a per-file fraction to `[0, 1]` and never let it regress from `previous`. */
export function advanceFraction(previous: number, next: number): number {
    return Math.max(previous, clamp(next));
}

function clamp(fraction: number): number {
    return Math.max(0, Math.min(1, fraction));
}
