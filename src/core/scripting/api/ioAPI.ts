import type { ScriptHost } from '../types';

export function ioAPI(host: ScriptHost) {
    return {
        output(text: string): void { host.output(text); },
        setResult(label: string, value: string): void { host.setResult(label, value); },
        assert(condition: boolean, label: string): void { host.assert(condition, label); },
    };
}
