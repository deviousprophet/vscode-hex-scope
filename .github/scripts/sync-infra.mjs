#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const INFRA_REPO = "deviousprophet/vscode-ci-infra";
const VERSION_URL = `https://raw.githubusercontent.com/${INFRA_REPO}/main/VERSION`;

const MAPPINGS = [
  { src: ".github/workflows", dst: ".github/workflows" },
  { src: ".github/scripts", dst: ".github/scripts" },
  { src: "agents/skills/custom", dst: ".agents/skills/custom" },
];

const ROOT = process.cwd();

async function main() {
  // 1. Fetch version tag from infra repo
  console.log("Fetching infra version...");
  const res = await fetch(VERSION_URL);
  if (!res.ok) throw new Error(`Failed to fetch VERSION: ${res.status}`);
  const tag = (await res.text()).trim();
  console.log(`Syncing from tag: ${tag}`);

  // 2. Clone infra repo (shallow, pinned to tag)
  const tmp = mkdtempSync(join(tmpdir(), "infra-sync-"));
  try {
    execSync(
      `git clone --depth 1 --branch ${tag} https://github.com/${INFRA_REPO}.git "${tmp}"`,
      { stdio: "pipe" }
    );
    console.log("Cloned infra repo.");

    // 3. Read ignore list (consumer-local files never to delete)
    const ignorePath = join(ROOT, ".infra-ignore");
    const ignoreList = existsSync(ignorePath)
      ? readFileSync(ignorePath, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
      : [];

    // 4. Sync each directory
    for (const { src, dst } of MAPPINGS) {
      const srcDir = join(tmp, src.replace(/\//g, sep));
      const dstDir = join(ROOT, dst.replace(/\//g, sep));

      if (!existsSync(srcDir)) {
        console.log(`  SKIP  ${dst} — not found in source`);
        continue;
      }

      mirrorDir(srcDir, dstDir, ignoreList);
      console.log(`  OK    ${dst}`);
    }

    console.log("\nSync complete.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function mirrorDir(srcDir, dstDir, ignoreList) {
  // Ensure destination exists
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

  // Build set of relative paths in source
  const srcFiles = new Set();
  collectRelativePaths(srcDir, srcDir, srcFiles);

  // Build set of relative paths in destination
  const dstFiles = new Set();
  if (existsSync(dstDir)) collectRelativePaths(dstDir, dstDir, dstFiles);

  // Copy files from source to destination (updates + adds)
  for (const relPath of srcFiles) {
    const srcFile = join(srcDir, relPath);
    const dstFile = join(dstDir, relPath);
    const parent = dstFile.substring(0, dstFile.lastIndexOf(sep));
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    cpSync(srcFile, dstFile, { force: true, dereference: true });
  }

  // Delete files in destination not in source, unless ignored
  for (const relPath of dstFiles) {
    if (srcFiles.has(relPath)) continue;

    const fullDstPath = join(dstDir, relPath);
    const fullRelFromRoot = join(relative(ROOT, dstDir), relPath).replace(/\\/g, "/");

    if (isIgnored(fullRelFromRoot, ignoreList)) {
      console.log(`  keep  ${fullRelFromRoot}`);
      continue;
    }

    unlinkSync(fullDstPath);
    console.log(`  del   ${fullRelFromRoot}`);
  }

  // Clean up empty directories
  removeEmptyDirs(dstDir);
}

function collectRelativePaths(baseDir, currentDir, result) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const full = join(currentDir, entry.name);
    const rel = relative(baseDir, full);
    if (entry.isFile()) {
      result.add(rel);
    } else if (entry.isDirectory()) {
      collectRelativePaths(baseDir, full, result);
    }
  }
}

function isIgnored(relPath, ignoreList) {
  for (const pattern of ignoreList) {
    const normalized = pattern.replace(/\\/g, "/");
    if (
      relPath === normalized ||
      relPath.startsWith(normalized + "/") ||
      relPath.endsWith("/" + normalized)
    ) {
      return true;
    }
  }
  return false;
}

function removeEmptyDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const full = join(dir, entry.name);
      removeEmptyDirs(full);
      try { rmSync(full, { recursive: true, force: true }); } catch { /* not empty */ }
    }
  }
}

main().catch((err) => {
  console.error("Sync failed:", err.message);
  process.exit(1);
});
