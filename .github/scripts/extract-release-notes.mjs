import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const changelogPath = path.join(process.cwd(), "CHANGELOG.md");
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? tagFromRef(process.env.GITHUB_REF);

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function tagFromRef(ref) {
  const prefix = "refs/tags/";
  return ref?.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
}

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function extractChangelogBody(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const headingPattern = /^## \[([^\]]+)\](?:\s+[-\u2013\u2014]\s+.*)?\s*$/;
  const startIndex = lines.findIndex((line) => headingPattern.exec(line)?.[1] === version);

  if (startIndex === -1) {
    return undefined;
  }

  const relativeEndIndex = lines
    .slice(startIndex + 1)
    .findIndex((line) => headingPattern.test(line));
  const endIndex = relativeEndIndex === -1 ? lines.length : startIndex + 1 + relativeEndIndex;
  return lines.slice(startIndex + 1, endIndex).join("\n").trim();
}

if (!tag) {
  fail("Release tag is required. Set GITHUB_REF_NAME or pass a tag argument.");
}

const version = tag.replace(/^v/, "");
if (!version) {
  fail(`Release tag "${tag}" does not contain a version.`);
}

if (!existsSync(changelogPath)) {
  fail("CHANGELOG.md was not found.");
}

const changelogBody = extractChangelogBody(readFileSync(changelogPath, "utf8"), version);
if (!changelogBody) {
  fail(`CHANGELOG.md does not contain a non-empty section for ${version}.`);
}

const previousTag = runGit(["describe", "--tags", "--abbrev=0", `${tag}^{commit}^`, "--match", "v*"]);
const fallbackRepository = "deviousprophet/vscode-hex-scope";
const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const repositoryUrl = packageJson.repository?.url;
const repositoryMatch = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(repositoryUrl ?? "");
const repository = process.env.GITHUB_REPOSITORY ?? repositoryMatch?.[1] ?? fallbackRepository;
const changelogUrl = previousTag
  ? `https://github.com/${repository}/compare/${previousTag}...${tag}`
  : `https://github.com/${repository}/commits/${tag}`;
const releaseNotes = `${changelogBody}\n\n---\n\n**Full Changelog**: ${changelogUrl}\n`;

const outputDir = process.env.RUNNER_TEMP ?? tmpdir();
mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "release-notes.md");
writeFileSync(outputPath, releaseNotes, "utf8");

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `path=${outputPath}\n`, "utf8");
}

console.log(`Release notes written to ${outputPath}`);
