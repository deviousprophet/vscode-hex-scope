#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const changelogPath = 'CHANGELOG.md';
const changelog = readFileSync(changelogPath, 'utf8').replace(/\r\n?/g, '\n');
const lines = changelog.split('\n');
const start = lines.findIndex(line => /^## \[Unreleased\]\s*$/.test(line));

if (start === -1) {
  console.log('strip-unreleased-changelog: no [Unreleased] block found');
  process.exit(0);
}

const end = lines.findIndex((line, index) => index > start && /^## \[/.test(line));
const nextBlock = end === -1 ? lines.length : end;
const before = trimTrailingBlank(lines.slice(0, start));
const after = trimLeadingBlank(lines.slice(nextBlock));
const next = [...before, '', ...after].join('\n').replace(/\s+$/u, '') + '\n';

writeFileSync(changelogPath, next);
console.log('strip-unreleased-changelog: removed [Unreleased] block from packaged changelog');

function trimTrailingBlank(items) {
  let endIndex = items.length;
  while (endIndex > 0 && /^\s*$/.test(items[endIndex - 1])) { endIndex--; }
  return items.slice(0, endIndex);
}

function trimLeadingBlank(items) {
  let startIndex = 0;
  while (startIndex < items.length && /^\s*$/.test(items[startIndex])) { startIndex++; }
  return items.slice(startIndex);
}
