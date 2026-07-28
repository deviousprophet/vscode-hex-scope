const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
const { tmpdir } = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');
const { buildSync } = require('esbuild') as typeof import('esbuild');

const profileName = process.argv[2];
if (!profileName || !/^[a-z-]+$/.test(profileName)) {
    throw new Error('Usage: run-profile.ts <profile-name>');
}

const summaryFile = path.join(process.cwd(), `${profileName}-profile-test-summary.md`);
const buildDirectory = mkdtempSync(path.join(tmpdir(), 'hex-scope-profile-'));
const bundlePath = path.join(buildDirectory, `${profileName}-profile.cjs`);
const entryPath = path.join(__dirname, `${profileName}-profile.ts`);

try {
    buildSync({
        entryPoints: [entryPath],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: bundlePath,
        logLevel: 'silent',
    });
    execFileSync(process.execPath, ['--expose-gc', bundlePath], { stdio: 'inherit' });
    writeFileSync(summaryFile, `✅ **${profileName}** profile passed\n\n`);
} catch (error) {
    writeFileSync(summaryFile, `❌ **${profileName}** profile failed\n\nSee \`${profileName}-profile-output.log\` for details.\n\n`);
    throw error;
} finally {
    rmSync(buildDirectory, { recursive: true, force: true });
}
