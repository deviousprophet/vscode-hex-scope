import { appendFileSync, existsSync, readFileSync } from "node:fs";

const runTestsOutcome = process.env.RUN_TESTS_OUTCOME ?? "unknown";
const logFile = process.env.LOG_FILE ?? "test-output.log";
const suiteName = process.env.SUITE_NAME ?? "Automated test results";
const testFormat = process.env.TEST_FORMAT ?? "mocha"; // "mocha" | "raw"
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

const ICONS = {
  passed: "\u2705",
  failed: "\u274c",
  timer: "\u23f1",
  robot: "\u{1F916}",
  clipboard: "\u{1F4CB}",
  log: "\u{1FAB5}",
};

function appendSummary(markdown) {
  if (summaryPath) {
    appendFileSync(summaryPath, markdown, "utf8");
    return;
  }

  process.stdout.write(markdown);
}

function tailLines(logText, count) {
  return logText.split(/\r?\n/).slice(-count).join("\n");
}

function readLog() {
  return existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
}

// ---------------------------------------------------------------------------
// Mocha format
// ---------------------------------------------------------------------------

function firstNumber(pattern, text) {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : 0;
}

function passingDuration(text) {
  return /[0-9]+ passing \(([^)]+)\)/.exec(text)?.[1] ?? "";
}

function failureBlock(text) {
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^[ \t]+[0-9]+ failing/.test(line));
  return startIndex === -1 ? "" : lines.slice(startIndex + 1).join("\n").trimEnd();
}

function failedTitles(block) {
  return block
    .split(/\r?\n/)
    .map((line) => /^[ \t]+[0-9]+\) (.+)$/.exec(line)?.[1])
    .filter(Boolean);
}

function parseMochaStats(logText) {
  const pass = firstNumber(/([0-9]+) passing \([^)]+\)/, logText);
  const fail = firstNumber(/([0-9]+) failing/, logText);
  const duration = passingDuration(logText);
  return { pass, fail, duration, total: pass + fail };
}

function testsDidNotRun(total) {
  return runTestsOutcome !== "success" && total === 0;
}

function allTestsPassed(fail, total) {
  return fail === 0 && total > 0;
}

function mochaStatusLine({ fail, total }) {
  if (testsDidNotRun(total)) {
    return `${ICONS.failed} Tests were not executed successfully`;
  }
  if (allTestsPassed(fail, total)) {
    return `${ICONS.passed} All tests passed`;
  }
  return `${ICONS.failed} Some tests failed`;
}

function renderMochaHeader(stats) {
  const durationSuffix = stats.duration ? ` ${ICONS.timer} ${stats.duration}` : "";
  const status = `${mochaStatusLine(stats)}${durationSuffix}`;

  appendSummary(`# ${ICONS.robot} ${suiteName}

${status}

| ${ICONS.passed} Passed | ${ICONS.failed} Failed | ${ICONS.clipboard} Total |
|---:|---:|---:|
| ${stats.pass} | ${stats.fail} | ${stats.total} |
`);
}

function renderMochaFailures(logText, fail) {
  if (fail === 0 || !logText) {
    return;
  }

  const block = failureBlock(logText);
  const titles = failedTitles(block);
  const titleList = titles.map((title) => `- \`${title}\`\n`).join("");

  appendSummary(`
<details>
<summary>${ICONS.failed} ${fail} failing test(s)</summary>

${titleList}
### Error details

\`\`\`
${block}
\`\`\`

</details>
`);
}

function renderMochaMissingRun(logText, total) {
  const shouldRender = testsDidNotRun(total) && logText;
  if (!shouldRender) {
    return;
  }

  appendSummary(`
## ${ICONS.log} Last 30 lines of output

\`\`\`
${tailLines(logText, 30)}
\`\`\`
`);
}

function summarizeMocha() {
  const logText = readLog();
  const stats = parseMochaStats(logText);

  renderMochaHeader(stats);
  renderMochaFailures(logText, stats.fail);
  renderMochaMissingRun(logText, stats.total);
}

// ---------------------------------------------------------------------------
// Raw format — dump log text for custom test output
// ---------------------------------------------------------------------------

function summarizeRaw() {
  const logText = readLog();
  if (!logText) {
    return; // no output to show
  }

  appendSummary(`<details>
<summary>${suiteName}</summary>

\`\`\`
${logText}
\`\`\`

</details>
`);
}

// ---------------------------------------------------------------------------

if (testFormat === "raw") {
  summarizeRaw();
} else {
  summarizeMocha();
}
