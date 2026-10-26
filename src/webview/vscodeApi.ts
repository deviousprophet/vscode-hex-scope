import type { WebviewToProviderMessage } from '../webviewProtocol';
import type { DiffWebviewToProvider } from '../diffProtocol';

declare function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(s: unknown): void;
};

export const vscode = acquireVsCodeApi();

/** Single-file editor post seam. */
export function postProviderMessage(msg: WebviewToProviderMessage): void {
    vscode.postMessage(msg);
}

/** Diff panel post seam; a message must belong to the diff surface's own union. */
export function postDiffProviderMessage(msg: DiffWebviewToProvider): void {
    vscode.postMessage(msg);
}
