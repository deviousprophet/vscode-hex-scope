import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Open repo as test workspace so file-system watchers (profile +
	// watcher tests) deliver events deterministically; test roots are created
	// by suite under .test-tmp/ removed afterwards.
	launchArgs: ['--disable-workspace-trust', '--folder-uri', 'file:///' + process.cwd().replace(/\\/g, '/')],
});
