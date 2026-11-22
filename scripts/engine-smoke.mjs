/**
 * End-to-end engine check for CI: spawn the staged binary, speak the framed protocol, and
 * assert a parse result. Prints one JSON line; exits non-zero on any mismatch.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const target = `${process.platform}-${process.arch}`;
const name = process.platform === 'win32' ? 'hex-engine.exe' : 'hex-engine';
const binary = path.join(process.cwd(), 'dist', 'engine', target, name);

function frame(header, body = Buffer.alloc(0)) {
	const json = Buffer.from(JSON.stringify(header), 'utf8');
	const prefix = Buffer.alloc(6);
	prefix.writeUInt32LE(json.length + body.length, 0);
	prefix.writeUInt16LE(json.length, 4);
	return Buffer.concat([prefix, json, body]);
}

function frames(chunks) {
	const all = Buffer.concat(chunks);
	const out = [];
	let at = 0;
	while (at + 6 <= all.length) {
		const length = all.readUInt32LE(at);
		const headerLength = all.readUInt16LE(at + 4);
		const end = at + 6 + length;
		if (end > all.length) {
			break;
		}
		out.push({
			header: JSON.parse(all.subarray(at + 6, at + 6 + headerLength).toString('utf8')),
			body: all.subarray(at + 6 + headerLength, end)
		});
		at = end;
	}
	return out;
}

const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const chunks = [];
child.stdout.on('data', chunk => chunks.push(chunk));
const exited = new Promise(resolve => child.on('exit', resolve));

child.stdin.write(frame({ id: 1, op: 'ping' }));
child.stdin.write(frame({ id: 2, op: 'parse', format: 'ihex' }, Buffer.from(':0400100001020304E2\n:00000001FF\n')));
child.stdin.end();

const status = await exited;
const received = frames(chunks);
const pong = received.find(entry => entry.header.id === 1);
const result = received.find(entry => entry.header.id === 2);
const ok =
	status === 0 &&
	pong?.header.protocol === 1 &&
	result?.header.recordCount === 2 &&
	result?.header.totalDataBytes === 4 &&
	Buffer.compare(result.body.subarray(result.body.length - 4), Buffer.from([1, 2, 3, 4])) === 0;

console.log(JSON.stringify({
	_type: 'engine-smoke',
	binary,
	exit: status,
	protocol: pong?.header.protocol,
	recordCount: result?.header.recordCount,
	totalDataBytes: result?.header.totalDataBytes,
	ok
}));
if (!ok) {
	process.exitCode = 1;
}
