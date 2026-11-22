/**
 * Builds the Rust parsing engine and stages it for packaging.
 *
 * Writes `dist/engine/<platform>-<arch>/hex-engine[.exe]`, the path the host client loads.
 * The binary is a build artifact, not a source file. Set `HEXSCOPE_SKIP_RUST_BUILD=1` when the
 * binaries were produced elsewhere (the packaging job downloads them).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

if (process.env.HEXSCOPE_SKIP_RUST_BUILD === '1') {
	console.log(JSON.stringify({ _type: 'engine-build', skipped: true }));
	process.exit(0);
}

const root = process.cwd();
const target = `${process.platform}-${process.arch}`;
const name = process.platform === 'win32' ? 'hex-engine.exe' : 'hex-engine';
const profile = process.argv.includes('--debug') ? 'debug' : 'release';

execFileSync(
	'cargo',
	[
		'build',
		'--manifest-path',
		path.join(root, 'rust', 'Cargo.toml'),
		'-p',
		'hex-engine',
		...(profile === 'release' ? ['--release'] : [])
	],
	{ stdio: 'inherit' }
);

const source = path.join(root, 'rust', 'target', profile, name);
const destinationDir = path.join(root, 'dist', 'engine', target);
mkdirSync(destinationDir, { recursive: true });
const destination = path.join(destinationDir, name);
copyFileSync(source, destination);
console.log(JSON.stringify({ _type: 'engine-build', target, profile, destination }));
