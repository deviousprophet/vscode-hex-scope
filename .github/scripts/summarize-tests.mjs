import { appendFileSync, existsSync, readFileSync } from "node:fs";

const runTestsOutcome = process.env.RUN_TESTS_OUTCOME ?? "unknown";
const logFile = process.env.LOG_FILE ?? "test-output.log";
const suiteName = process.env.SUITE_NAME ?? "Automated test results";
const testFormat = process.env.TEST_FORMAT ?? "mocha"; // "mocha" | "performance"
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

function mochaStatusLine({ fail, total }) {
  if (runTestsOutcome !== "success" && total === 0) {
    return `${ICONS.failed} Tests were not executed successfully`;
  }
  if (fail === 0 && total > 0) {
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
  const shouldRender = runTestsOutcome !== "success" && total === 0 && logText;
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
// Performance format
// ---------------------------------------------------------------------------

function tryParseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isMeasurement(entry) {
  return Boolean(entry) && typeof entry.name === "string" && "elapsedMs" in entry;
}

function isConcurrentSummary(entry) {
  return Boolean(entry) && "concurrentRetainedMiB" in entry;
}

function parsePerformanceLog(logText) {
  const measurements = [];
  let summaryLine = null;

  const lines = logText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const entry = tryParseJsonLine(line);
    if (isMeasurement(entry)) {
      measurements.push(entry);
    } else if (isConcurrentSummary(entry)) {
      summaryLine = entry;
    }
  }

  return { measurements, summaryLine };
}

function performanceStatusLine() {
  return runTestsOutcome === "success"
    ? `${ICONS.passed} Performance run passed`
    : `${ICONS.failed} Performance run failed`;
}

function renderPerformanceHeader() {
  appendSummary(`# ${ICONS.robot} ${suiteName}

${performanceStatusLine()}

`);
}

function measurementRow(m) {
  return `| ${m.name} | ${m.sourceMiB ?? ""} | ${m.records ?? ""} | ${m.elapsedMs ?? ""} | ${m.retainedMiB ?? ""} |\n`;
}

function renderPerformanceTable(measurements) {
  if (measurements.length === 0) {
    return;
  }

  const header = `| Name | Source (MiB) | Records | Elapsed (ms) | Retained (MiB) |
|---|---:|---:|---:|---:|
`;
  const rows = measurements.map(measurementRow).join("");
  appendSummary(`${header}${rows}\n`);
}

function renderPerformanceConcurrentSummary(summaryLine) {
  if (!summaryLine) {
    return;
  }

  const documents = summaryLine.documents?.join(", ") ?? "";
  appendSummary(
    `${ICONS.clipboard} Concurrent retained: **${summaryLine.concurrentRetainedMiB} MiB** (documents: ${documents})\n\n`
  );
}

function renderPerformanceEmptyState(measurements, summaryLine) {
  if (measurements.length > 0 || summaryLine) {
    return;
  }

  appendSummary(`${ICONS.failed} No performance measurements were found in the log.\n\n`);
}

function renderPerformanceFailure(logText) {
  const success = runTestsOutcome === "success";
  if (success || !logText) {
    return;
  }

  appendSummary(`
<details>
<summary>${ICONS.failed} Failure output</summary>

\`\`\`
${tailLines(logText, 40)}
\`\`\`

</details>
`);
}

function summarizePerformance() {
  const logText = readLog();
  const { measurements, summaryLine } = parsePerformanceLog(logText);

  renderPerformanceHeader();
  renderPerformanceTable(measurements);
  renderPerformanceConcurrentSummary(summaryLine);
  renderPerformanceEmptyState(measurements, summaryLine);
  renderPerformanceFailure(logText);
}

// ---------------------------------------------------------------------------

if (testFormat === "performance") {
  summarizePerformance();
} else {
  summarizeMocha();
}
