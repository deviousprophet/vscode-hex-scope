// @ts-check
/// <reference path="./types/hexscope.d.ts" />

/**
 * Minimal manual script.
 *
 * Hex Scope calls `run(api)` when you press the Run button on this card.
 * `.js` scripts run as CommonJS in the sandbox, so expose the entry with
 * `module.exports`; a `.ts` script can use `export function run(api)` instead.
 *
 * This example needs no permissions. It only reads `api.hex.size` and reports
 * a result, so it is safe to run in any trusted workspace.
 */

/**
 * @param {HexScopeAPI} api
 * @returns {void}
 */
function run(api) {
    api.setResult('Hello', 'Hex Scope');
    api.setResult('Document size', `${api.hex.size} byte(s)`);
    api.output('Edit this file to start writing your own script.');
}

module.exports = { run };
