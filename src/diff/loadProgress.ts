/**
 * Combined load progress for the two diff sides.
 *
 * Each file reports a fraction in `[0, 1]` (read fills the first half, parse the second), so the
 * sum of two monotonic fractions is monotonic: `completed` never regresses and never exceeds two.
 */
export function combinedLoadProgress(fractions: readonly number[]): number {
    return fractions.reduce((total, fraction) => total + clamp(fraction), 0);
}

function clamp(fraction: number): number {
    return Math.max(0, Math.min(1, fraction));
}
