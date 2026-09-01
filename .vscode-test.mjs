import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// Open a disposable temp dir (not the repo) as the test workspace so
// file-system watchers (profile-watcher tests) deliver events deterministically
// and the extension never writes .hexscope/ into the repository. The suite
// removes its own test roots; the empty workspace shell is left to the OS temp
// cleaner.
const ws = mkdtempSync(join(tmpdir(), 'hexscope-test-ws-'));

export default defineConfig({
	files: 'out/test/**/*.test.js',
	launchArgs: ['--disable-workspace-trust', '--folder-uri', 'file:///' + ws.replace(/\\/g, '/')],
});

process.on('exit', () => { try { rmSync(ws, { recursive: true, force: true }); } catch { /* best-effort */ } });