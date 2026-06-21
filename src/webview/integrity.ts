const INTEGRITY_ALGORITHMS = [
    'crc16-ccitt-false',
    'crc32-iso-hdlc',
    'md5',
    'sha-1',
    'sha-256',
    'sha-512',
] as const;

export type IntegrityAlgorithm = typeof INTEGRITY_ALGORITHMS[number];
export type IntegrityByteOrder = 'be' | 'le';

export function isChecksumAlgorithm(algorithm: IntegrityAlgorithm): boolean {
    return algorithm === 'crc16-ccitt-false' || algorithm === 'crc32-iso-hdlc';
}

const INTEGRITY_PROFILE_SCHEMA_VERSION = 1 as const;

export interface IntegrityCheckConfig {
    algorithm: IntegrityAlgorithm;
    startAddress: number;
    endAddress: number;
    storedAddress?: number;
    autoFixStoredValue: boolean;
}

export interface IntegrityProfile {
    schemaVersion: typeof INTEGRITY_PROFILE_SCHEMA_VERSION;
    id: string;
    name: string;
    byteOrder: IntegrityByteOrder;
    checks: IntegrityCheckConfig[];
}

export interface IntegrityCheckSet {
    schemaVersion: typeof INTEGRITY_PROFILE_SCHEMA_VERSION;
    byteOrder: IntegrityByteOrder;
    checks: IntegrityCheckConfig[];
}

interface IntegrityProfileCandidate {
    schemaVersion?: unknown;
    id?: unknown;
    name?: unknown;
    byteOrder?: unknown;
    checks?: unknown;
}

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

export interface IntegrityStoredField {
    startAddress: number;
    byteLength: number;
}

export type IntegrityValidation<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

export type IntegrityEdit = [number, number];

const MAX_ADDRESS = 0xFFFF_FFFF;

function isIntegrityAlgorithm(value: unknown): value is IntegrityAlgorithm {
    return typeof value === 'string' && (INTEGRITY_ALGORITHMS as readonly string[]).includes(value);
}

function isUint32(value: number): boolean {
    return Number.isSafeInteger(value) && (value >>> 0) === value;
}

export function normalizeIntegrityProfiles(value: unknown): IntegrityProfile[] {
    if (!Array.isArray(value)) { return []; }
    const profiles: IntegrityProfile[] = [];
    for (const candidate of value) {
        appendNormalizedProfile(profiles, candidate);
    }
    return profiles;
}

export function normalizeIntegrityCheckSet(value: unknown): IntegrityCheckSet | null {
    const raw = integrityCheckSetCandidate(value);
    return raw ? normalizeIntegrityCheckSetCandidate(raw) : null;
}

function normalizeIntegrityCheckSetCandidate(raw: Partial<IntegrityCheckSet>): IntegrityCheckSet | null {
    if (raw.schemaVersion !== INTEGRITY_PROFILE_SCHEMA_VERSION) { return null; }
    if (!isIntegrityByteOrder(raw.byteOrder)) { return null; }
    const checks = normalizeIntegrityChecks(raw.checks);
    if (!checks) { return null; }
    return { schemaVersion: INTEGRITY_PROFILE_SCHEMA_VERSION, byteOrder: raw.byteOrder, checks };
}

function integrityCheckSetCandidate(value: unknown): Partial<IntegrityCheckSet> | null {
    return value !== null && typeof value === 'object' ? value as Partial<IntegrityCheckSet> : null;
}

function appendNormalizedProfile(profiles: IntegrityProfile[], candidate: unknown): void {
    const profile = normalizeIntegrityProfile(candidate);
    if (!profile) { return; }
    if (profiles.some(item => item.id === profile.id)) { return; }
    if (profiles.some(item => item.name.toLocaleLowerCase() === profile.name.toLocaleLowerCase())) { return; }
    profiles.push(profile);
}

function normalizeIntegrityProfile(value: unknown): IntegrityProfile | null {
    const raw = integrityProfileCandidate(value);
    if (!raw) { return null; }
    const identity = integrityProfileIdentity(raw);
    if (!identity) { return null; }
    if (raw.schemaVersion !== INTEGRITY_PROFILE_SCHEMA_VERSION) { return null; }
    return normalizeCurrentIntegrityProfile(raw, identity);
}

function integrityProfileCandidate(value: unknown): IntegrityProfileCandidate | null {
    if (value === null) { return null; }
    if (typeof value !== 'object') { return null; }
    return value as IntegrityProfileCandidate;
}

function integrityProfileIdentity(raw: IntegrityProfileCandidate): Pick<IntegrityProfile, 'id' | 'name'> | null {
    const id = trimmedString(raw.id);
    if (!id) { return null; }
    const name = trimmedString(raw.name);
    return name ? { id, name } : null;
}

function normalizeCurrentIntegrityProfile(
    raw: IntegrityProfileCandidate,
    identity: Pick<IntegrityProfile, 'id' | 'name'>,
): IntegrityProfile | null {
    if (!isIntegrityByteOrder(raw.byteOrder)) { return null; }
    const checks = normalizeIntegrityChecks(raw.checks);
    if (!checks || checks.length === 0) { return null; }
    return { schemaVersion: INTEGRITY_PROFILE_SCHEMA_VERSION, ...identity, byteOrder: raw.byteOrder, checks };
}

function isIntegrityByteOrder(value: unknown): value is IntegrityByteOrder {
    return value === 'le' || value === 'be';
}

function trimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeIntegrityChecks(value: unknown): IntegrityCheckConfig[] | null {
    if (!Array.isArray(value)) { return null; }
    const checks: IntegrityCheckConfig[] = [];
    for (const item of value) {
        const check = normalizeIntegrityCheck(item);
        if (!check) { return null; }
        checks.push(check);
    }
    return checks;
}

function normalizeIntegrityCheck(value: unknown): IntegrityCheckConfig | null {
    const raw = integrityCheckCandidate(value);
    if (!raw) { return null; }
    if (!isIntegrityCheckCore(raw)) { return null; }
    const verification = normalizeVerificationSettings(raw);
    if (!verification.ok) { return null; }
    return {
        algorithm: raw.algorithm,
        startAddress: raw.startAddress as number,
        endAddress: raw.endAddress as number,
        ...verification.value,
    };
}

function normalizeVerificationSettings(raw: IntegrityCheckConfig):
    | { ok: true; value: Pick<IntegrityCheckConfig, 'autoFixStoredValue' | 'storedAddress'> }
    | { ok: false } {
    if (!isChecksumAlgorithm(raw.algorithm)) {
        return { ok: true, value: { autoFixStoredValue: false } };
    }
    if (!isStoredAddressValid(raw.storedAddress)) { return { ok: false }; }
    return {
        ok: true,
        value: { autoFixStoredValue: raw.autoFixStoredValue, ...normalizedStoredAddress(raw.storedAddress) },
    };
}

function normalizedStoredAddress(value: number | undefined): { storedAddress?: number } {
    return value === undefined ? {} : { storedAddress: value };
}

function integrityCheckCandidate(value: unknown): Partial<IntegrityCheckConfig> | null {
    if (value === null) { return null; }
    return typeof value === 'object' ? value as Partial<IntegrityCheckConfig> : null;
}

function isIntegrityCheckCore(raw: Partial<IntegrityCheckConfig>): raw is IntegrityCheckConfig {
    if (!isIntegrityAlgorithm(raw.algorithm)) { return false; }
    if (typeof raw.autoFixStoredValue !== 'boolean') { return false; }
    return isIntegrityRange(raw.startAddress, raw.endAddress);
}

function isIntegrityRange(start: unknown, end: unknown): start is number {
    if (!isUint32(start as number)) { return false; }
    if (!isUint32(end as number)) { return false; }
    return (end as number) >= (start as number);
}

function isStoredAddressValid(value: unknown): boolean {
    if (value === undefined) { return true; }
    return isUint32(value as number);
}

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
    excluded?: IntegrityStoredField,
): IntegrityValidation<Uint8Array> {
    const values: number[] = [];
    for (let address = request.startAddress; address <= request.endAddress; address++) {
        if (isExcludedIntegrityAddress(address, excluded)) { continue; }
        const value = readByte(address);
        if (value === undefined) {
            return { ok: false, error: `No mapped byte at ${formatIntegrityAddress(address)}.` };
        }
        values.push(value);
    }
    return { ok: true, value: Uint8Array.from(values) };
}

function isExcludedIntegrityAddress(address: number, excluded?: IntegrityStoredField): boolean {
    if (!excluded) { return false; }
    if (address < excluded.startAddress) { return false; }
    return address < excluded.startAddress + excluded.byteLength;
}

export function integrityValueToBytes(value: string, byteOrder: IntegrityByteOrder): Uint8Array {
    if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
        throw new Error('Integrity value must contain complete hexadecimal bytes.');
    }
    const bytes = Uint8Array.from(value.match(/../g)!, pair => Number.parseInt(pair, 16));
    return byteOrder === 'le' ? bytes.reverse() : bytes;
}

export function readStoredIntegrityBytes(
    field: IntegrityStoredField,
    readByte: (address: number) => number | undefined,
): IntegrityValidation<Uint8Array> {
    if (!isStoredFieldInAddressSpace(field)) {
        return { ok: false, error: 'Stored value extends beyond 0xFFFFFFFF.' };
    }
    const bytes = new Uint8Array(field.byteLength);
    for (let offset = 0; offset < field.byteLength; offset++) {
        const address = field.startAddress + offset;
        const value = readByte(address);
        if (value === undefined) {
            return { ok: false, error: `No mapped stored byte at ${formatIntegrityAddress(address)}.` };
        }
        bytes[offset] = value;
    }
    return { ok: true, value: bytes };
}

function isStoredFieldInAddressSpace(field: IntegrityStoredField): boolean {
    if (field.byteLength < 1) { return false; }
    return field.startAddress + field.byteLength - 1 <= MAX_ADDRESS;
}

export function integrityBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function integrityBytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function mergeIntegrityEdits(groups: IntegrityEdit[][]): IntegrityValidation<IntegrityEdit[]> {
    const merged = new Map<number, number>();
    for (const [address, value] of groups.flat()) {
        if (isConflictingIntegrityEdit(merged, address, value)) {
            return { ok: false, error: `Fix all conflict at ${formatIntegrityAddress(address)}.` };
        }
        merged.set(address, value);
    }
    return { ok: true, value: Array.from(merged.entries()) };
}

function isConflictingIntegrityEdit(merged: Map<number, number>, address: number, value: number): boolean {
    if (!merged.has(address)) { return false; }
    return merged.get(address) !== value;
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
