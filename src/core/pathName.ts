// ── Path helpers ─────────────────────────────────────────────────
// Shared by the host compare module and the diff panel: both name a
// file by its trailing path segment.

export function fileName(uri: { fsPath: string }): string {
    return uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath;
}
