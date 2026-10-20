/// <reference path="./types/hexscope.d.ts" />

/**
 * Array size source for a templated Type Overlay parameter.
 *
 * @script size
 *
 * Adapt PARAM_NAME and COUNT_AT to your type and firmware. The script runs once
 * per parameter it is attached to; `api.context.param` tells it which parameter
 * is being resolved, and `api.context.paramValues` already contains the
 * resolved/authors values of the sibling parameters.
 *
 * Size scripts are read-only: `hex.write` is denied without a prompt. The
 * returned count must be a positive integer.
 */

const PARAM_NAME = 'ITEM_COUNT';
const COUNT_AT = 0x08000010;
const COUNT_BYTES = 2;

export function getSize(api: HexScopeAPI): number {
    if (api.context.param !== PARAM_NAME) {
        // Another parameter uses this script: fall back to a single element.
        api.output(`Ignoring parameter '${api.context.param ?? ''}' (this script resolves ${PARAM_NAME}).`);
        return 1;
    }

    const raw = api.hex.read(COUNT_AT, COUNT_BYTES);
    if (raw.length < COUNT_BYTES) {
        api.output(`No count mapped at 0x${COUNT_AT.toString(16).toUpperCase()} — adapt COUNT_AT in this script.`);
        return 1;
    }

    const count = raw[0] | (raw[1] << 8);
    if (count < 1) {
        api.output(`Stored count is ${count}; using 1.`);
        return 1;
    }
    return count;
}
