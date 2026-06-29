#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
const CHANGELOG_HEADER_RE = /^## \[([^\]]+)\](?:\s+-\s+.+)?\s*$/;
const SUBSECTION_HEADER_RE = /^### (.+)\s*$/;

if (!version) {
  console.error('usage: prepare-release.mjs <version>');
  process.exit(1);
}

const changelogPath = 'CHANGELOG.md';
const changelog = readFileSync(changelogPath, 'utf8').replace(/\r\n?/g, '\n');
const parsed = parseChangelog(changelog);
const unreleasedIndex = parsed.blocks.findIndex(block => block.name === 'Unreleased');
const versionIndex = parsed.blocks.findIndex(block => block.name === version);

if (unreleasedIndex === -1) {
  fail('CHANGELOG.md must contain a ## [Unreleased] block');
}

const unreleased = parsed.blocks[unreleasedIndex];

if (!blockHasContent(unreleased.body)) {
  if (versionIndex === -1) {
    fail(`CHANGELOG.md has no release notes for [${version}] or [Unreleased]`);
  }
  console.log(`prepare-release: [Unreleased] empty; using existing [${version}] block`);
  process.exit(0);
}

if (versionIndex === -1) {
  parsed.blocks.splice(unreleasedIndex, 1, emptyUnreleasedBlock(), {
    header: `## [${version}] - ${todayUtcIsoDate()}`,
    name: version,
    body: trimTrailingBlank(unreleased.body).concat(''),
  });
} else {
  mergeUnreleasedIntoVersion(unreleased, parsed.blocks[versionIndex]);
  unreleased.body = [''];
}

writeFileSync(changelogPath, joinChangelog(parsed));
console.log(`prepare-release: promoted [Unreleased] into [${version}]`);

function parseChangelog(text) {
  const lines = text.split('\n');
  const firstBlock = lines.findIndex(line => CHANGELOG_HEADER_RE.test(line));
  const preface = firstBlock === -1 ? lines : lines.slice(0, firstBlock);
  const blockLines = firstBlock === -1 ? [] : lines.slice(firstBlock);
  const blocks = collectBlocks(blockLines, CHANGELOG_HEADER_RE, match => ({ name: match[1] }));
  return { preface, blocks };
}

function joinChangelog({ preface, blocks }) {
  const sections = [preface.join('\n'), ...blocks.map(block => [block.header, ...block.body].join('\n'))];
  return sections.join('\n').replace(/\s+$/u, '') + '\n';
}

function mergeUnreleasedIntoVersion(unreleased, versionBlock) {
  const unreleasedSections = splitSubsections(unreleased.body);
  const versionSections = splitSubsections(versionBlock.body);

  appendLeadingContent(unreleasedSections.leading, versionSections);
  for (const section of unreleasedSections.subsections) {
    appendSubsection(section, versionSections.subsections);
  }

  versionBlock.body = rebuildSubsections(versionSections);
}

function appendLeadingContent(sourceLines, targetSections) {
  const leading = trimTrailingBlank(sourceLines);
  if (leading.length > 0) {
    targetSections.leading = trimTrailingBlank(targetSections.leading).concat('', ...leading, '');
  }
}

function appendSubsection(section, subsections) {
  const sourceBody = trimTrailingBlank(section.body);
  if (sourceBody.length === 0) { return; }

  const target = subsections.find(item => item.heading === section.heading);
  if (target) {
    target.body = trimTrailingBlank(target.body).concat('', ...sourceBody, '');
  } else {
    subsections.push({ heading: section.heading, header: section.header, body: sourceBody.concat('') });
  }
}

function splitSubsections(body) {
  const firstSubsection = body.findIndex(line => SUBSECTION_HEADER_RE.test(line));
  const leading = firstSubsection === -1 ? body : body.slice(0, firstSubsection);
  const subsectionLines = firstSubsection === -1 ? [] : body.slice(firstSubsection);
  const subsections = collectBlocks(subsectionLines, SUBSECTION_HEADER_RE, match => ({ heading: match[1] }));
  return { leading, subsections };
}

function collectBlocks(lines, headerPattern, meta) {
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(headerPattern);
    if (match) {
      current = startBlock(blocks, current, line, meta(match));
    } else {
      current?.body.push(line);
    }
  }

  if (current) { blocks.push(current); }
  return blocks;
}

function startBlock(blocks, current, header, meta) {
  if (current) { blocks.push(current); }
  return { header, body: [], ...meta };
}

function rebuildSubsections({ leading, subsections }) {
  const lines = [...trimTrailingBlank(leading)];
  for (const section of subsections) {
    if (lines.length > 0 && lines.at(-1) !== '') { lines.push(''); }
    lines.push(section.header, ...section.body);
  }
  return trimTrailingBlank(lines).concat('');
}

function blockHasContent(body) {
  return body.some(line => /^\s*([-*]|\d+\.)\s+/.test(line));
}

function trimTrailingBlank(lines) {
  let end = lines.length;
  while (end > 0 && /^\s*$/.test(lines[end - 1])) { end--; }
  return lines.slice(0, end);
}

function emptyUnreleasedBlock() {
  return { header: '## [Unreleased]', name: 'Unreleased', body: [''] };
}

function todayUtcIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function fail(message) {
  console.error(`prepare-release: ${message}`);
  process.exit(1);
}
