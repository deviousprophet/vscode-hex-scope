import type { ScriptHost } from '../types';

export function hexAPI(host: ScriptHost) {
    return {
        read(address: number, length: number): Uint8Array {
            return host.readBytes(address, length);
        },
        async write(address: number, data: Uint8Array): Promise<boolean> {
            const ok = await host.confirm('write', `Write ${data.length} bytes at 0x${address.toString(16).toUpperCase()}`);
            if (!ok || host.stale) { return false; }
            return host.writeBytes(address, data);
        },
        get size(): number {
            return host.totalSize;
        },
    };
}
