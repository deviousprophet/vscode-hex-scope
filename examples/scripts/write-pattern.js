/**
 * Write example: stages bytes behind the inline approval and lets the editor
 * save them.
 *
 * @requires write
 *
 * `.js` scripts run as CommonJS in the sandbox, so the entry point is exported
 * with `module.exports` (a `.ts` script can use `export function run`).
 *
 * Adapt START and PATTERN to the bytes you want to patch. The script does not
 * ask for confirmation itself: the first `api.hex.write()` opens one inline
 * prompt in the Scripts panel (allow once, for this script, for this session,
 * or for this workspace).
 *
 * Approved bytes are staged during the run and saved once, as a single undoable
 * transaction, when the run finishes without error. A denied or failed run
 * writes nothing. Ctrl+Z after a successful run restores the previous bytes.
 */

const START = 0x08000000;
const PATTERN = [0xde, 0xad, 0xbe, 0xef];

async function run(api) {
    const hexStart = `0x${START.toString(16).toUpperCase()}`;
    const before = api.hex.read(START, PATTERN.length);
    api.output(`Before at ${hexStart}: ${toHex(before)}`);

    const approved = await api.hex.write(START, new Uint8Array(PATTERN));
    api.setResult('Write approved', approved ? 'Yes' : 'No');
    if (!approved) {
        api.output('Write denied — the document was not changed.');
        return;
    }

    const after = api.hex.read(START, PATTERN.length);
    api.setResult('After', toHex(after));
    api.output('Bytes are saved when this run finishes; Ctrl+Z restores the old value.');
}

function toHex(bytes) {
    return bytes.length === 0
        ? '(unmapped)'
        : [...bytes].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

module.exports = { run };
