// ── Render callback registry ─────────────────────────────────────
// Breaks circular dependencies between UI modules.
// hexViewer.ts fills these in after wiring all modules together.

export const rerender = {
    /** Re-render the memory body and re-attach byte listeners. */
    memory: () => { /* wired by hexViewer.ts */ },

    /** Re-render the labels sidebar section. */
    labels: () => { /* wired by hexViewer.ts */ },

    /** Switch to memory view (and re-render). */
    toMemory: () => { /* wired by hexViewer.ts */ },
};
