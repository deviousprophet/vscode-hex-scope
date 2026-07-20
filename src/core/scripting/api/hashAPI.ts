function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return bytes;
}

async function digestHex(name: string, data: Uint8Array): Promise<string> {
    if (!globalThis.crypto?.subtle) { throw new Error('Web Crypto is unavailable.'); }
    const raw = await globalThis.crypto.subtle.digest(name, data.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(raw), b => b.toString(16).padStart(2, '0')).join('');
}

export function hashAPI() {
    return {
        async sha1(data: Uint8Array): Promise<Uint8Array> {
            return hexToBytes(await digestHex('SHA-1', data));
        },
        async sha256(data: Uint8Array): Promise<Uint8Array> {
            return hexToBytes(await digestHex('SHA-256', data));
        },
        async sha512(data: Uint8Array): Promise<Uint8Array> {
            return hexToBytes(await digestHex('SHA-512', data));
        },
    };
}
