import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/{webview,core,extension,shared,benchmarks}/**/*.test.js',
});
