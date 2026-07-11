import { performance } from 'node:perf_hooks';
import { parseIntelHexCompact } from '../../core/parser/intelHexParser';
import { parseSRecCompact } from '../../core/parser/srecParser';
import type { CompactParseResult } from '../../core/parser/compact';

const MAPPED_BYTES = 64 * 1024 * 1024;
const MAX_RETAINED_BYTES = 384 * 1024 * 1024;
const RECORD_BYTES = 32;

function hexByte(value: number): string { return value.toString(16).toUpperCase().padStart(2, '0'); }

function ihexRecord(address: number, type: number, data: number[]): string {
    const bytes = [data.length, (address >>> 8) & 0xFF, address & 0xFF, type, ...data];
    const checksum = (-bytes.reduce((sum, value) => sum + value, 0)) & 0xFF;
    return `:${bytes.map(hexByte).join('')}${hexByte(checksum)}`;
}

function srecRecord(address: number, data: number[]): string {
    const addressBytes = [(address >>> 24) & 0xFF, (address >>> 16) & 0xFF, (address >>> 8) & 0xFF, address & 0xFF];
    const count = addressBytes.length + data.length + 1;
    const checksum = (~([count, ...addressBytes, ...data].reduce((sum, value) => sum + value, 0))) & 0xFF;
    return `S3${hexByte(count)}${addressBytes.map(hexByte).join('')}${data.map(hexByte).join('')}${hexByte(checksum)}`;
}

function buildIhex(): string {
    const lines: string[] = [];
    let upper = -1;
    for (let address = 0; address < MAPPED_BYTES; address += RECORD_BYTES) {
        const nextUpper = address >>> 16;
        if (nextUpper !== upper) {
            upper = nextUpper;
            lines.push(ihexRecord(0, 4, [(upper >>> 8) & 0xFF, upper & 0xFF]));
        }
        lines.push(ihexRecord(address & 0xFFFF, 0, new Array(RECORD_BYTES).fill(address & 0xFF)));
    }
    lines.push(':00000001FF');
    return lines.join('\n');
}

function buildSrec(): string {
    const lines: string[] = [];
    for (let address = 0; address < MAPPED_BYTES; address += RECORD_BYTES) {
        lines.push(srecRecord(address, new Array(RECORD_BYTES).fill(address & 0xFF)));
    }
    lines.push('S70500000000FA');
    return lines.join('\n');
}

function retainedBytes(): number {
    global.gc!();
    const memory = process.memoryUsage();
    return memory.heapUsed + memory.arrayBuffers;
}

async function load(
    name: string,
    source: string,
    parser: (input: string) => Promise<CompactParseResult>,
): Promise<CompactParseResult> {
    const before = retainedBytes();
    const started = performance.now();
    const result = await parser(source);
    const elapsedMs = Math.round(performance.now() - started);
    const retained = retainedBytes() - before;
    console.log(JSON.stringify({ name, sourceMiB: Math.round(source.length / 1048576), records: result.records.length, elapsedMs, retainedMiB: Math.round(retained / 1048576) }));
    if (retained > MAX_RETAINED_BYTES) {
        throw new Error(`${name} retained ${Math.round(retained / 1048576)} MiB; limit is 384 MiB`);
    }
    return result;
}

async function run(): Promise<void> {
    if (typeof global.gc !== 'function') { throw new Error('Run with --expose-gc'); }
    const baseline = retainedBytes();
    const ihex = await load('ihex', buildIhex(), parseIntelHexCompact);
    const srec = await load('srec', buildSrec(), parseSRecCompact);
    const total = retainedBytes() - baseline;
    if (total > MAX_RETAINED_BYTES * 2) {
        throw new Error(`Two documents retained ${Math.round(total / 1048576)} MiB; limit is 768 MiB`);
    }
    console.log(JSON.stringify({ concurrentRetainedMiB: Math.round(total / 1048576), documents: [ihex.records.length, srec.records.length] }));
}

run().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
