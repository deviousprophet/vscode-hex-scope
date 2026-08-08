const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
const { mkdtempSync, rmSync, readdirSync } = require('node:fs') as typeof import('node:fs');
const { tmpdir } = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');
const { buildSync } = require('esbuild') as typeof import('esbuild');

const allBenchmarks = readdirSync(__dirname)
    .filter(f => f.endsWith('-benchmark.ts') && f !== 'runBenchmark.ts')
    .map(f => path.join(__dirname, f));

const args = process.argv.slice(2);
const continueOnError = args.includes('--continue');
const filter = args.filter(a => a !== '--continue')[0];
const toRun = filter
    ? allBenchmarks.filter(f => path.basename(f).includes(filter))
    : allBenchmarks;

if (toRun.length === 0) {
    console.error(`No benchmarks found${filter ? ` matching '${filter}'` : ''}.`);
    console.error(`Available: ${allBenchmarks.map(f => path.basename(f, '.ts')).join(', ')}`);
    process.exit(1);
}

let exitCode = 0;
for (const entryPath of toRun) {
    const name = path.basename(entryPath, '.ts');
    const buildDirectory = mkdtempSync(path.join(tmpdir(), 'hex-scope-benchmark-'));
    const bundlePath = path.join(buildDirectory, `${name}.cjs`);
    try {
        buildSync({
            entryPoints: [entryPath],
            bundle: true,
            platform: 'node',
            format: 'cjs',
            outfile: bundlePath,
            logLevel: 'silent',
        });
        console.log(`\n=== ${name} ===`);
        execFileSync(process.execPath, ['--expose-gc', bundlePath], { stdio: 'inherit' });
    } catch (e) {
        console.error(`❌ ${name} failed: ${(e as Error).message}`);
        exitCode = 1;
        if (!continueOnError) {process.exit(1);}
    } finally {
        rmSync(buildDirectory, { recursive: true, force: true });
    }
}
process.exit(exitCode);
