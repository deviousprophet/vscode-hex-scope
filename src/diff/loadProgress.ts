/**
 * Combined load progress for the two diff sides.
 *
 * Each file reports a fraction in `[0, 1]` with a read-then-parse split: the read (on the extension
 * host, concurrent only) fills the small leading slice `0 → 0.05` (`READ_SHARE` in
 * `diffEditorPanel.ts`) and the Rust engine parse fills the rest. The sum of two monotonic
 * fractions is monotonic: `completed` never regresses and never exceeds two.
 */
export function combinedLoadProgress(fractions: readonly number[]): number {
    return fractions.reduce((total, fraction) => total + clamp(fraction), 0);
}

function clamp(fraction: number): number {
    return Math.max(0, Math.min(1, fraction));
}
