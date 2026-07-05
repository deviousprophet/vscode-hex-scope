import type { WebviewToProviderMessage } from '../webviewProtocol';

declare function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(s: unknown): void;
};

export const vscode = acquireVsCodeApi();

export function postProviderMessage(msg: WebviewToProviderMessage): void {
    vscode.postMessage(msg);
}
