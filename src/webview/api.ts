// ── VS Code webview API singleton ───────────────────────────────

declare function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(s: unknown): void;
};

export const vscode = acquireVsCodeApi();
