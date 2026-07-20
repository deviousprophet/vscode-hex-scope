import { execFile } from 'node:child_process';
import type { ScriptHost, ExecResult } from '../types';

export function execAPI(host: ScriptHost) {
    return async (command: string, args?: string[]): Promise<ExecResult | null> => {
        const ok = await host.confirm('exec', `${command} ${(args ?? []).join(' ')}`.trim());
        if (!ok) { return null; }
        return new Promise(resolve => {
            execFile(command, args ?? [], { timeout: 30_000 }, (err, stdout, stderr) => {
                resolve({
                    stdout,
                    stderr,
                    code: typeof err?.code === 'number' ? err.code : 0,
                });
            });
        });
    };
}
