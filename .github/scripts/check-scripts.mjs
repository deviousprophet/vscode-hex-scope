#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');

checkSyntax('extract-release-notes.mjs');
checkSyntax('prepare-release.mjs');
checkSyntax('strip-unreleased-changelog.mjs');
checkSyntax('summarize-tests.mjs');
checkReleaseNotes();
checkPrepareRelease();
checkStripUnreleasedChangelog();
checkTestSummary();

console.log('github script checks passed');

function checkSyntax(scriptName) {
  const result = runNode(['--check', join(scriptDir, scriptName)], { cwd: repoRoot });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function checkReleaseNotes() {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'CHANGELOG.md'), `# Changelog

## [1.2.3] - 2026-06-30

### Added

- New release note

## [1.2.2] - 2026-06-29

### Fixed

- Old release note
`);

    const happy = runNode([join(scriptDir, 'extract-release-notes.mjs'), '1.2.3'], { cwd: dir });
    assert.equal(happy.status, 0, happy.stderr || happy.stdout);
    assert.match(happy.stdout, /## \[1\.2\.3\]/);
    assert.match(happy.stdout, /New release note/);
    assert.doesNotMatch(happy.stdout, /Old release note/);

    const missing = runNode([join(scriptDir, 'extract-release-notes.mjs'), '9.9.9'], { cwd: dir });
    assert.notEqual(missing.status, 0, 'missing changelog version should fail');
    assert.match(missing.stderr, /no '## \[9\.9\.9\]' entry/);

    writeFileSync(join(dir, 'CHANGELOG.md'), `# Changelog

## [1.2.3] - 2026-06-30

### Added

## [1.2.2] - 2026-06-29

- Old release note
`);
    const empty = runNode([join(scriptDir, 'extract-release-notes.mjs'), '1.2.3'], { cwd: dir });
    assert.notEqual(empty.status, 0, 'empty changelog version should fail');
    assert.match(empty.stderr, /has no release notes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkPrepareRelease() {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'CHANGELOG.md'), `# Changelog

## [Unreleased]

### Added

- Fresh release note

## [1.2.2] - 2026-06-29

### Fixed

- Old release note
`);

    const prepared = runNode([join(scriptDir, 'prepare-release.mjs'), '1.2.3'], { cwd: dir });
    assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);

    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## \[Unreleased\]\n\n## \[1\.2\.3\] - \d{4}-\d{2}-\d{2}/);
    assert.match(changelog, /Fresh release note/);

    const notes = runNode([join(scriptDir, 'extract-release-notes.mjs'), '1.2.3'], { cwd: dir });
    assert.equal(notes.status, 0, notes.stderr || notes.stdout);
    assert.match(notes.stdout, /Fresh release note/);
    assert.doesNotMatch(notes.stdout, /Old release note/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkStripUnreleasedChangelog() {
  const dir = makeTempDir();
  try {
    writeFileSync(join(dir, 'CHANGELOG.md'), `# Changelog

## [Unreleased]

### Added

- Work in progress

## [1.2.3] - 2026-06-30

### Fixed

- Release note
`);

    const stripped = runNode([join(scriptDir, 'strip-unreleased-changelog.mjs')], { cwd: dir });
    assert.equal(stripped.status, 0, stripped.stderr || stripped.stdout);

    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.doesNotMatch(changelog, /\[Unreleased\]/);
    assert.doesNotMatch(changelog, /Work in progress/);
    assert.match(changelog, /## \[1\.2\.3\] - 2026-06-30/);
    assert.match(changelog, /Release note/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkTestSummary() {
  const dir = makeTempDir();
  try {
    const logFile = join(dir, 'test-output.log');
    const summaryFile = join(dir, 'summary.md');

    let summary = writeAndSummarize({
      log: '  3 passing (1s)\n',
      logFile,
      summaryFile,
      outcome: 'success',
    });
    assert.match(summary, /All tests passed/);
    assert.match(summary, /\| 3 \| 0 \| 3 \|/);

    summary = writeAndSummarize({
      log: `  1 passing (2s)
  2 failing

  1) Suite alpha
       test one:
     AssertionError: expected one

  2) Suite beta
       test two:
     AssertionError: expected two
`,
      logFile,
      summaryFile,
      outcome: 'failure',
    });
    assert.match(summary, /2 failing test\(s\)/);
    assert.match(summary, /Suite alpha/);
    assert.match(summary, /AssertionError: expected two/);

    summary = writeAndSummarize({
      log: Array.from({ length: 35 }, (_, i) => `line-${i + 1}`).join('\n'),
      logFile,
      summaryFile,
      outcome: 'failure',
    });
    assert.match(summary, /Last 30 lines of output/);
    assert.match(summary, /line-35/);
    assert.doesNotMatch(summary, /line-1\n/);

    const missingSummary = runNode([join(scriptDir, 'summarize-tests.mjs')], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RUN_TESTS_OUTCOME: 'success',
        LOG_FILE: logFile,
        GITHUB_STEP_SUMMARY: '',
      },
    });
    assert.notEqual(missingSummary.status, 0, 'missing GITHUB_STEP_SUMMARY should fail');
    assert.match(missingSummary.stderr, /GITHUB_STEP_SUMMARY is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAndSummarize({ log, logFile, summaryFile, outcome }) {
  writeFileSync(logFile, log);
  writeFileSync(summaryFile, '');
  runSummary({ logFile, summaryFile, outcome });
  return readFileSync(summaryFile, 'utf8');
}

function runSummary({ logFile, summaryFile, outcome }) {
  const result = runNode([join(scriptDir, 'summarize-tests.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RUN_TESTS_OUTCOME: outcome,
      LOG_FILE: logFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runNode(args, options) {
  return spawnSync(process.execPath, args, {
    encoding: 'utf8',
    ...options,
  });
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'hex-scope-scripts-'));
}
