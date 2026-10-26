/** Byte-for-byte equality for typed arrays and number arrays. */
export function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
    if (a.length !== b.length) { return false; }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) { return false; }
    }
    return true;
}
