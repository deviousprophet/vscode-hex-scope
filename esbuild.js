const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	// Extension host bundle
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	// Worker isolate bundle (loaded dynamically by scriptRunner.ts)
	const ctxWorker = await esbuild.context({
		entryPoints: [
			'src/core/scripting/scriptWorker.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/scriptWorker.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	// Webview bundle (browser environment, no node/vscode externals)
	const ctxWebview = await esbuild.context({
		entryPoints: [
			'src/webview/hexViewer.ts'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview.js',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	// Diff webview bundle
	const ctxDiffWebview = await esbuild.context({
		entryPoints: [
			'src/webview/hexDiffViewer.ts'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/hexDiffViewer.js',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	if (watch) {
		await ctx.watch();
		await ctxWorker.watch();
		await ctxWebview.watch();
		await ctxDiffWebview.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
		await ctxWorker.rebuild();
		await ctxWorker.dispose();
		await ctxWebview.rebuild();
		await ctxWebview.dispose();
		await ctxDiffWebview.rebuild();
		await ctxDiffWebview.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
