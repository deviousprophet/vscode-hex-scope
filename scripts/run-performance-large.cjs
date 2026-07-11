'use strict';

const { execFileSync } = require('child_process');
const { mkdtempSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const { buildSync } = require('esbuild');

const buildDirectory = mkdtempSync(path.join(tmpdir(), 'hex-scope-performance-'));
const bundlePath = path.join(buildDirectory, 'performance-large.cjs');

try {
    buildSync({
        entryPoints: [path.join(__dirname, 'performance-large.cjs')],
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
