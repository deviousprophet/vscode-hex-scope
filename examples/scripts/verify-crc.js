// @ts-check
/// <reference path="./types/hexscope.d.ts" />

// Read-only example: checksum a short range and show the result.
//
// Adapt START and LENGTH to the region your firmware checksums. The range is
// read from the open document, pending edits included; no approval is needed
// because the script never writes.
//
// `.js` scripts run as CommonJS in the sandbox; `.ts` scripts need the optional
// esbuild compiler. Keep this example as `.js` so it runs everywhere.

const START = 0x08000000;
const LENGTH = 256;

/** @param {HexScopeAPI} api */
function run(api) {
    const hexStart = `0x${START.toString(16).toUpperCase()}`;
    const data = api.hex.read(START, LENGTH);
    if (data.length === 0) {
        api.output(`No mapped bytes at ${hexStart} - adapt START/LENGTH in this script.`);
        return;
    }

    const crc = api.crc.crc32(data);
    api.setResult('CRC32', `0x${crc.toString(16).toUpperCase().padStart(8, '0')}`);
    api.setResult('Range', `${hexStart} + ${data.length} byte(s)`);
    api.output(`Computed CRC32 over ${data.length} byte(s) at ${hexStart}`);
    if (data.length < LENGTH) {
        api.output('The range hit an unmapped gap, so fewer bytes were read than requested.');
    }
}

module.exports = { run };
