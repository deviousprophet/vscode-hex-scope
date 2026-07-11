const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs') as typeof import('node:fs');
const { tmpdir } = require('node:os') as typeof import('node:os');
const path = require('node:path') as typeof import('node:path');
const { buildSync } = require('esbuild') as typeof import('esbuild');

const profileName = process.argv[2];
if (!profileName || !/^[a-z-]+$/.test(profileName)) {
    throw new Error('Usage: run-profile.ts <profile-name>');
}

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
} finally {
    rmSync(buildDirectory, { recursive: true, force: true });
}
