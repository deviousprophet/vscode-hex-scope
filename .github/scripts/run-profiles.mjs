import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = Object.keys(pkg.scripts ?? {})
  .filter((s) => s.startsWith("profile:"))
  .map((s) => ({ name: s.replace("profile:", ""), script: s }));

if (scripts.length === 0) {
  console.log("No profile:* scripts found — nothing to run.");
  process.exit(0);
}

console.log(`Discovered ${scripts.length} profile(s): ${scripts.map((s) => s.name).join(", ")}`);

let anyFailed = false;

for (const { name, script } of scripts) {
  const summaryFile = `${name}-profile-test-summary.md`;

  try {
    console.log(`\n--- Running ${script} ---`);
    execSync(`npm run ${script}`, { stdio: "inherit", shell: true });

    if (!existsSync(summaryFile)) {
      writeFileSync(summaryFile, `✅ **${name}** profile passed\n\n`);
    }
    console.log(`✅ ${script} passed`);
  } catch {
    if (!existsSync(summaryFile)) {
      writeFileSync(summaryFile, `❌ **${name}** profile failed\n\nSee \`${name}-profile-output.log\` for details.\n\n`);
    }
    console.log(`❌ ${script} failed`);
    anyFailed = true;
  }
}

if (anyFailed) {
  process.exit(1);
}
