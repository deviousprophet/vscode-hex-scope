import * as vscode from 'vscode';
import type { ProviderToWebviewMessage } from '../webviewProtocol';

/** Throttled staged-load progress poster shared by the hex editor and diff sessions. */
export class ProgressReporter {
    private lastAt = 0;
    private lastStage = '';
    private pending: ProviderToWebviewMessage | null = null;
    private flushed = false;

    constructor(
        private readonly webview: vscode.Webview,
        private readonly generation: () => number,
        private readonly messageType: 'loadProgress' | 'diffProgress',
    ) {}

    public post(stage: 'read' | 'parse' | 'build' | 'transfer', completed: number, total?: number): void {
        const now = Date.now();
        if (this.isThrottled(stage, completed, total, now)) { return; }
        this.lastAt = now;
        this.lastStage = stage;
        this.pending = {
            type: this.messageType,
            generation: this.generation(),
            stage,
            completed,
            total,
        } as ProviderToWebviewMessage;
        if (this.flushed) {
            void this.webview.postMessage(this.pending);
        }
    }

    public flush(): void {
        if (this.pending) {
            void this.webview.postMessage(this.pending);
            this.pending = null;
        }
        this.flushed = true;
    }

    private isThrottled(stage: string, completed: number, total: number | undefined, now: number): boolean {
        return stage === this.lastStage && completed !== total && now - this.lastAt < 100;
    }
}
