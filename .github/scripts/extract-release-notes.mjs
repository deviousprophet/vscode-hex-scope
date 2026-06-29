#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const version = process.argv[2];

if (!version) {
  console.error('usage: extract-release-notes.mjs <version>');
  process.exit(1);
}

const lines = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n?/g, '\n').split('\n');
const header = `## [${version}]`;
const start = lines.findIndex(line => line === header || line.startsWith(`${header} `));

if (start === -1) {
  console.error(`no '## [${version}]' entry found in CHANGELOG.md`);
  process.exit(1);
}

const end = lines.findIndex((line, index) => index > start && line.startsWith('## ['));
const block = lines.slice(start, end === -1 ? lines.length : end);
const hasContent = block.some(line => /^\s*([-*]|\d+\.)\s+/.test(line));

if (!hasContent) {
  console.error(`'## [${version}]' entry in CHANGELOG.md has no release notes`);
  process.exit(1);
}

process.stdout.write(block.join('\n').replace(/\s+$/u, ''));
process.stdout.write('\n');
