import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Removes the `## [Unreleased]` section from CHANGELOG.md so a packaged VSIX
// ships a release-only changelog. Runs in the throwaway CI workspace before
// `vsce package`; use `--check` before running it against a real working tree.
//
//   node .github/scripts/strip-unreleased-changelog.mjs [--file <path>] [--check]

const DEFAULT_FILE = path.join(process.cwd(), "CHANGELOG.md");
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const filePath = path.resolve(argValue("--file", DEFAULT_FILE));
const checkOnly = args.includes("--check");

if (!existsSync(filePath)) {
  fail(`CHANGELOG.md not found at ${filePath}`);
}

const headingPattern = /^## \[([^\]]+)\](?:\s+[-\u2013\u2014]\s+.*)?\s*$/;
const unreleasedPattern = /^## \[Unreleased\]\s*$/i;
const datedReleasePattern = /^## \[[^\]]+\]\s+-\s+\d{4}-\d{2}-\d{2}\s*$/;

const original = readFileSync(filePath, "utf8");
const eol = original.includes("\r\n") ? "\r\n" : "\n";
const lines = original.split(/\r?\n/);

const startIndex = lines.findIndex((line) => unreleasedPattern.test(line));
if (startIndex === -1) {
  console.log("No ## [Unreleased] section found; the changelog is already release-only.");
  process.exit(0);
}

const nextHeadingIndex = lines.findIndex((line, index) => index > startIndex && headingPattern.test(line));
const endIndex = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
const removedLines = endIndex - startIndex;
const remaining = [...lines.slice(0, startIndex), ...lines.slice(endIndex)];

const firstSection = remaining.find((line) => headingPattern.test(line));
if (!firstSection || !datedReleasePattern.test(firstSection)) {
  fail(`Refusing to package a changelog whose first section is not a dated release heading: ${firstSection ?? "(none)"}`);
}

if (checkOnly) {
  console.log(`--check: would remove ## [Unreleased] (${removedLines} lines); packaged changelog would start at: ${firstSection}`);
  process.exit(0);
}

writeFileSync(filePath, remaining.join(eol), "utf8");
console.log(`Removed ## [Unreleased] (${removedLines} lines); packaged changelog starts at: ${firstSection}`);
