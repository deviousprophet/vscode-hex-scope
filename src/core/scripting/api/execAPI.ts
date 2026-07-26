import { execFile } from 'node:child_process';
import type { ScriptHost, ExecResult } from '../types';

const MINIMAL_ENV: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    SHELL: process.env.SHELL,
};

// Win32 fallbacks for SHELL
if (process.platform === 'win32') {
    MINIMAL_ENV.SHELL ||= process.env.ComSpec ?? 'cmd.exe';
} else {
    MINIMAL_ENV.SHELL ||= '/bin/sh';
}

export function execAPI(host: ScriptHost) {
    return async (command: string, args?: string[]): Promise<ExecResult | null> => {
        const ok = await host.confirm('exec', `${command} ${(args ?? []).join(' ')}`.trim());
        if (!ok) { return null; }
        return new Promise(resolve => {
            // ponytail: inner 30s timeout acts as floor for exec. Outer runWithTimeout
            // in scriptRunner is the primary kill-switch. Both fire independently; the
            // shorter one wins. If execFile finishes naturally first its child_process
            // exits and the shell timeout is moot. Make this configurable when the CLI
            // tool needs per-invocation limits.
            execFile(command, args ?? [], { timeout: 30_000, env: MINIMAL_ENV, cwd: host.workspaceRoot ?? process.cwd() }, (err, stdout, stderr) => {
                resolve({
                    stdout,
                    stderr,
                    code: typeof err?.code === 'number' ? err.code : 0,
                });
            });
        });
    };
}
