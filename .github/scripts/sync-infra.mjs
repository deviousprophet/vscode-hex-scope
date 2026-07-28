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
  const res = await fetch(VERSION_URL);
  if (!res.ok) throw new Error(`Failed to fetch VERSION: ${res.status}`);
  const tag = (await res.text()).trim();
  console.log(`Syncing from tag: ${tag}`);

  const tmp = mkdtempSync(join(tmpdir(), "infra-sync-"));
  try {
    execSync(
      `git clone --depth 1 --branch ${tag} https://github.com/${INFRA_REPO}.git "${tmp}"`,
      { stdio: "pipe" }
    );
    console.log("Cloned infra repo.");

    const ignorePath = join(ROOT, ".infra-ignore");
    const ignoreList = existsSync(ignorePath)
      ? readFileSync(ignorePath, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
      : [];

    for (const { src, dst } of MAPPINGS) {
      const srcDir = join(tmp, src.replace(/\//g, sep));
      const dstDir = join(ROOT, dst.replace(/\//g, sep));
      if (!existsSync(srcDir)) { console.log(`  SKIP  ${dst}`); continue; }
      syncDir(srcDir, dstDir, ignoreList);
      console.log(`  OK    ${dst}`);
    }

    console.log("\nSync complete.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function syncDir(srcDir, dstDir, ignoreList) {
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

  const srcFiles = collectFiles(srcDir);
  const dstFiles = existsSync(dstDir) ? collectFiles(dstDir) : new Set();

  for (const relPath of srcFiles) {
    const srcFile = join(srcDir, relPath);
    const dstFile = join(dstDir, relPath);
    const parent = dstFile.substring(0, dstFile.lastIndexOf(sep));
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    cpSync(srcFile, dstFile, { force: true, dereference: true });
  }

  for (const relPath of dstFiles) {
    if (srcFiles.has(relPath)) continue;
    const fullDstPath = join(dstDir, relPath);
    const fullRelFromRoot = join(relative(ROOT, dstDir), relPath).replace(/\\/g, "/");
    if (ignoreList.some((p) => fullRelFromRoot === p || fullRelFromRoot.startsWith(p + "/") || fullRelFromRoot.endsWith("/" + p))) {
      continue;
    }
    unlinkSync(fullDstPath);
  }

  cleanEmptyDirs(dstDir);
}

function collectFiles(dir) {
  const result = new Set();
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile()) result.add(rel);
      else if (entry.isDirectory()) walk(join(current, entry.name), rel);
    }
  };
  walk(dir, "");
  return result;
}

function cleanEmptyDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    cleanEmptyDirs(full);
    try { rmSync(full, { recursive: true, force: true }); } catch { /* not empty */ }
  }
}

main().catch((err) => {
  console.error("Sync failed:", err.message);
  process.exit(1);
});
