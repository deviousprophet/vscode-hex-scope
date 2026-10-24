/** Script templates for `HexScope: Manage Scripts`, the Scripts panel's New
 *  split button, and the empty provider pickers. Pure data: no fs, no vscode.
 *
 *  Every body carries `// @ts-check`, the shipped type reference, and a working
 *  minimal implementation. `scriptingTemplates.test.ts` compiles the bodies with
 *  the same compiler options as `examples/tsconfig.json` (`npm run check-examples`)
 *  and runs each one against a mock host. */

import type { ScriptRole } from './types';

export type ScriptTemplateId = 'action' | 'integrity' | 'address' | 'size';

export interface ScriptTemplate {
    id: ScriptTemplateId;
    /** Picker/manager label ("New action script"). */
    name: string;
    /** Suggested file name inside `.hexscope/scripts/`. */
    fileName: string;
    /** One-line picker description. */
    description: string;
    /** Role tag declared by the header; absent for the plain action template. */
    role?: ScriptRole;
    /** Complete script source, written verbatim on creation. */
    body: string;
}

const ACTION_BODY = `// @ts-check
/// <reference path="./types/hexscope.d.ts" />

/**
 * Action script.
 *
 * Hex Scope calls run(api) when you press Run on this card. Use the api to
 * read bytes, compute checksums/hashes, or (with approval) write them back.
 *
 * This starter is read-only. If you add a dangerous call, declare it in the
 * header so the card shows the capability badge:
 *
 *     // @requires write
 */

/**
 * @param {HexScopeAPI} api
 * @returns {void}
 */
function run(api) {
    api.setResult('Document size', api.hex.size + ' byte(s)');
    api.output('Edit this file to start writing your own script.');
}

module.exports = { run };
`;

const INTEGRITY_BODY = `// @ts-check
/// <reference path="./types/hexscope.d.ts" />

/**
 * Integrity check source for the Integrity panel.
 *
 * @script integrity
 *
 * The panel passes its check range in api.context.selection (inclusive) and the
 * stored field in api.context.storedStart / storedEnd when it has one.
 * Adapt DEFAULT_START / DEFAULT_END to a range that suits your firmware.
 * Integrity scripts are read-only: hex.write is denied without a prompt.
 */

const DEFAULT_START = 0x08000000;
const DEFAULT_END = 0x080000ff;

/**
 * @param {HexScopeAPI} api
 * @param {number} address
 * @returns {boolean}
 */
function inStoredField(api, address) {
    const { storedStart, storedEnd } = api.context;
    if (storedStart === undefined || storedEnd === undefined) { return false; }
    return address >= storedStart && address <= storedEnd;
}

/**
 * One-byte additive checksum over the check range, skipping the stored bytes.
 *
 * @param {HexScopeAPI} api
 * @returns {number}
 */
function checksumByte(api) {
    const range = api.context.selection ?? { start: DEFAULT_START, end: DEFAULT_END };
    let sum = 0;
    for (let address = range.start; address <= range.end; address++) {
        if (inStoredField(api, address)) { continue; }
        const byte = api.hex.read(address, 1);
        if (byte.length === 0) { break; } // unmapped: stop at the first gap
        sum = (sum + byte[0]) & 0xff;
    }
    return sum;
}

/**
 * Bytes that belong in the stored field.
 *
 * @param {HexScopeAPI} api
 * @returns {Uint8Array}
 */
function getIntegrityValue(api) {
    return new Uint8Array([checksumByte(api)]);
}

/**
 * @param {HexScopeAPI} api
 * @returns {boolean}
 */
function verifyIntegrity(api) {
    const sum = checksumByte(api);
    const storedAt = api.context.storedStart;
    if (storedAt === undefined) { return true; } // display-only: nothing to compare
    const stored = api.hex.read(storedAt, 1);
    return stored.length > 0 && stored[0] === sum;
}

module.exports = { getIntegrityValue, verifyIntegrity };
`;

const ADDRESS_BODY = `// @ts-check
/// <reference path="./types/hexscope.d.ts" />

/**
 * Instance address source for the Type Overlay.
 *
 * @script address
 *
 * The Overlay calls getAddress(api) for every instance that uses this script;
 * return the base address of the instance. Adapt POINTER_AT to the address of
 * the pointer in your firmware. Address scripts are read-only.
 */

const POINTER_AT = 0x08000000;

/**
 * @param {HexScopeAPI} api
 * @returns {number}
 */
function getAddress(api) {
    const raw = api.hex.read(POINTER_AT, 4);
    if (raw.length < 4) {
        throw new Error('No 4-byte pointer mapped at 0x' + POINTER_AT.toString(16).toUpperCase() + ' - adapt POINTER_AT in this script.');
    }
    return (raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0;
}

module.exports = { getAddress };
`;

const SIZE_BODY = `// @ts-check
/// <reference path="./types/hexscope.d.ts" />

/**
 * Array size source for a templated Type Overlay parameter.
 *
 * @script size
 *
 * The Overlay calls getSize(api) once per parameter this script is attached
 * to; api.context.param names that parameter. Adapt PARAM_NAME and COUNT_AT to
 * your type and firmware. Size scripts are read-only; the returned count must
 * be a positive integer.
 */

const PARAM_NAME = 'ITEM_COUNT';
const COUNT_AT = 0x08000010;

/**
 * @param {HexScopeAPI} api
 * @returns {number}
 */
function getSize(api) {
    if (api.context.param !== PARAM_NAME) {
        api.output('Ignoring parameter ' + (api.context.param ?? '') + ' (this script resolves ' + PARAM_NAME + ').');
        return 1;
    }
    const raw = api.hex.read(COUNT_AT, 2);
    if (raw.length < 2) {
        api.output('No count mapped at 0x' + COUNT_AT.toString(16).toUpperCase() + ' - adapt COUNT_AT in this script.');
        return 1;
    }
    return Math.max(1, raw[0] | (raw[1] << 8));
}

module.exports = { getSize };
`;

/** Catalog order: the plain action first, then the role providers. */
export const SCRIPT_TEMPLATES: readonly ScriptTemplate[] = [
    {
        id: 'action',
        name: 'New action script',
        fileName: 'new-action.js',
        description: 'A run(api) script with a result row and a log line',
        body: ACTION_BODY,
    },
    {
        id: 'integrity',
        name: 'New integrity check',
        fileName: 'integrity-check.js',
        description: 'A @script integrity provider for the Integrity panel',
        role: 'integrity',
        body: INTEGRITY_BODY,
    },
    {
        id: 'address',
        name: 'New instance address script',
        fileName: 'instance-address.js',
        description: 'A @script address provider for the Type Overlay',
        role: 'address',
        body: ADDRESS_BODY,
    },
    {
        id: 'size',
        name: 'New array size script',
        fileName: 'array-size.js',
        description: 'A @script size provider for a templated parameter',
        role: 'size',
        body: SIZE_BODY,
    },
];

/** Template lookup; undefined for an absent/unknown id (caller picks instead). */
export function scriptTemplate(id: string | undefined): ScriptTemplate | undefined {
    return SCRIPT_TEMPLATES.find(template => template.id === id);
}
