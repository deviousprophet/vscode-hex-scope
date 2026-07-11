import * as assert from 'node:assert';
import { DisposableStore } from '../../core/disposableStore';

const PANEL_COUNT = 4;
const BYTES_PER_PANEL = 64 * 1024 * 1024;
const RELEASE_TOLERANCE = 1024 * 1024;

type PanelPayload = { bytes: Uint8Array | null };

function collect(): void {
    if (!global.gc) { throw new Error('Run memory release profile with --expose-gc'); }
    for (let i = 0; i < 5; i++) { global.gc(); }
}

function arrayBufferBytes(): number {
    collect();
    return process.memoryUsage().arrayBuffers;
}

function openPanel(): DisposableStore {
    const bytes = new Uint8Array(BYTES_PER_PANEL);
    bytes[0] = 1;
    bytes[bytes.length - 1] = 1;
    const payload: PanelPayload = { bytes };

    const resources = new DisposableStore();
    resources.add(() => { payload.bytes = null; });
    return resources;
}

const baseline = arrayBufferBytes();
let panels = Array.from({ length: PANEL_COUNT }, openPanel);
const opened = arrayBufferBytes();

panels.forEach(panel => panel.dispose());
panels = [];
const closed = arrayBufferBytes();

const retained = Math.max(0, closed - baseline);
const allocated = opened - baseline;
console.log(JSON.stringify({ baseline, opened, closed, allocated, retained }));

assert.ok(allocated >= PANEL_COUNT * BYTES_PER_PANEL,
    `expected at least ${PANEL_COUNT * BYTES_PER_PANEL} bytes allocated, measured ${allocated}`);
assert.ok(retained <= RELEASE_TOLERANCE,
    `expected retained ArrayBuffer memory <= ${RELEASE_TOLERANCE}, measured ${retained}`);
