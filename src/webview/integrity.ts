const INTEGRITY_ALGORITHMS = [
    'crc16-ccitt-false',
    'crc32-iso-hdlc',
    'md5',
    'sha-1',
    'sha-256',
    'sha-512',
] as const;

export type IntegrityAlgorithm = typeof INTEGRITY_ALGORITHMS[number];

export interface IntegrityRequest {
    algorithm: IntegrityAlgorithm;
    startAddress: number;
    endAddress: number;
}

export interface IntegrityResult {
    algorithm: IntegrityAlgorithm;
    value: string;
    byteCount: number;
}

export type IntegrityValidation<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

const MAX_ADDRESS = 0xFFFF_FFFF;

export function parseIntegrityAddress(raw: string, label: string): IntegrityValidation<number> {
    const text = raw.trim();
    if (text === '') { return { ok: false, error: `${label} address is required.` }; }
    const digits = text.replace(/^0x/i, '');
    if (!/^[0-9a-f]+$/i.test(digits)) {
        return { ok: false, error: `${label} address must be hexadecimal.` };
    }
    const value = Number.parseInt(digits, 16);
    if (!isUint32(value)) {
        return { ok: false, error: `${label} address must be between 0x00000000 and 0xFFFFFFFF.` };
    }
    return { ok: true, value };
}

function isUint32(value: number): boolean {
    return Number.isSafeInteger(value) && (value >>> 0) === value;
}

export function validateIntegrityRange(
    startRaw: string,
    endRaw: string,
    algorithm: IntegrityAlgorithm,
): IntegrityValidation<IntegrityRequest> {
    const start = parseIntegrityAddress(startRaw, 'Start');
    if (!start.ok) { return start; }
    const end = parseIntegrityAddress(endRaw, 'End');
    if (!end.ok) { return end; }
    if (end.value < start.value) {
        return { ok: false, error: 'End address must be greater than or equal to start address.' };
    }
    return { ok: true, value: { algorithm, startAddress: start.value, endAddress: end.value } };
}

export function collectIntegrityBytes(
    request: IntegrityRequest,
    readByte: (address: number) => number | undefined,
): IntegrityValidation<Uint8Array> {
    const length = request.endAddress - request.startAddress + 1;
    for (let offset = 0; offset < length; offset++) {
        const address = request.startAddress + offset;
        if (readByte(address) === undefined) {
            return { ok: false, error: `No mapped byte at ${formatIntegrityAddress(address)}.` };
        }
    }
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length; offset++) {
        bytes[offset] = readByte(request.startAddress + offset)!;
    }
    return { ok: true, value: bytes };
}

export async function calculateIntegrity(
    algorithm: IntegrityAlgorithm,
    bytes: Uint8Array,
): Promise<IntegrityResult> {
    const value = await INTEGRITY_CALCULATORS[algorithm](bytes);
    return { algorithm, value: value.toUpperCase(), byteCount: bytes.length };
}

type IntegrityCalculator = (bytes: Uint8Array) => string | Promise<string>;

const INTEGRITY_CALCULATORS: Record<IntegrityAlgorithm, IntegrityCalculator> = {
    'crc16-ccitt-false': bytes => crc16CcittFalse(bytes).toString(16).padStart(4, '0'),
    'crc32-iso-hdlc': bytes => crc32IsoHdlc(bytes).toString(16).padStart(8, '0'),
    md5,
    'sha-1': bytes => subtleDigest('SHA-1', bytes),
    'sha-256': bytes => subtleDigest('SHA-256', bytes),
    'sha-512': bytes => subtleDigest('SHA-512', bytes),
};

export function formatIntegrityAddress(address: number): string {
    return `0x${address.toString(16).toUpperCase().padStart(8, '0')}`;
}

function crc16CcittFalse(bytes: Uint8Array): number {
    let crc = 0xFFFF;
    for (const byte of bytes) {
        crc ^= byte << 8;
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
    }
    return crc;
}

function crc32IsoHdlc(bytes: Uint8Array): number {
    let crc = 0xFFFF_FFFF;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xEDB8_8320 : crc >>> 1;
        }
    }
    return (crc ^ 0xFFFF_FFFF) >>> 0;
}

async function subtleDigest(name: AlgorithmIdentifier, bytes: Uint8Array): Promise<string> {
    if (!globalThis.crypto?.subtle) { throw new Error('Web Crypto is unavailable.'); }
    const digest = await globalThis.crypto.subtle.digest(name, Uint8Array.from(bytes));
    return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

const MD5_SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 0x1_0000_0000) >>> 0);

function md5(input: Uint8Array): string {
    const bitLength = BigInt(input.length) * 8n;
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[input.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Number(bitLength & 0xFFFF_FFFFn), true);
    view.setUint32(paddedLength - 4, Number(bitLength >> 32n), true);

    let a0 = 0x6745_2301;
    let b0 = 0xEFCD_AB89;
    let c0 = 0x98BA_DCFE;
    let d0 = 0x1032_5476;

    for (let block = 0; block < paddedLength; block += 64) {
        const words = Array.from({ length: 16 }, (_, i) => view.getUint32(block + i * 4, true));
        let a = a0, b = b0, c = c0, d = d0;
        for (let i = 0; i < 64; i++) {
            const { mix, wordIndex } = md5Round(i, b, c, d);
            const nextD = c;
            c = b;
            const sum = (a + mix + MD5_CONSTANTS[i] + words[wordIndex]) >>> 0;
            b = (b + rotateLeft(sum, MD5_SHIFTS[i])) >>> 0;
            a = d;
            d = nextD;
        }
        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }

    const output = new Uint8Array(16);
    const outputView = new DataView(output.buffer);
    [a0, b0, c0, d0].forEach((word, i) => outputView.setUint32(i * 4, word, true));
    return bytesToHex(output);
}

function md5Round(i: number, b: number, c: number, d: number): { mix: number; wordIndex: number } {
    if (i < 16) { return { mix: (b & c) | (~b & d), wordIndex: i }; }
    if (i < 32) { return { mix: (d & b) | (~d & c), wordIndex: (5 * i + 1) % 16 }; }
    if (i < 48) { return { mix: b ^ c ^ d, wordIndex: (3 * i + 5) % 16 }; }
    return { mix: c ^ (b | ~d), wordIndex: (7 * i) % 16 };
}

function rotateLeft(value: number, count: number): number {
    return ((value << count) | (value >>> (32 - count))) >>> 0;
}
