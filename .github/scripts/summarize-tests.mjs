import { appendFileSync, existsSync, readFileSync } from "node:fs";

const runTestsOutcome = process.env.RUN_TESTS_OUTCOME ?? "unknown";
const logFile = process.env.LOG_FILE ?? "test-output.log";
const suiteName = process.env.SUITE_NAME ?? "Automated test results";
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

function orEmpty(value) {
  return value ?? "";
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
// Typed benchmark registry  — new benchmark = new renderer in registry map
// ---------------------------------------------------------------------------

function tryParseJsonLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function groupEntry(groups, line) {
  const entry = tryParseJsonLine(line);
  if (!entry || typeof entry._type !== "string") {
    return;
  }
  if (!groups.has(entry._type)) {
    groups.set(entry._type, []);
  }
  groups.get(entry._type).push(entry);
}

/** Group parsed log lines by _type. Lines without _type are ignored here. */
function groupByType(logText) {
  const groups = new Map();
  logText.split(/\r?\n/).forEach(line => groupEntry(groups, line));
  return groups;
}

function statusBadge() {
  return runTestsOutcome === "success"
    ? `${ICONS.passed} Passed`
    : `${ICONS.failed} Failed`;
}

function renderFailureTail(logText) {
  if (runTestsOutcome === "success" || !logText) {
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

// -- Renderers registered by _type ------------------------------------------

const registry = new Map();

registry.set("large-file-load", (records, logText) => {
  const header = `| Name | Source (MiB) | Records | Elapsed (ms) | Retained (MiB) |
|---|---:|---:|---:|---:|
`;
  const rows = records.map(r =>
    `| ${[r.name, r.sourceMiB, r.records, r.elapsedMs, r.retainedMiB].map(v => v ?? "").join(" | ")} |\n`
  ).join("");
  return { body: `${header}${rows}\n` };
});

registry.set("large-file-summary", (records) => {
  const s = records[0];
  if (!s) {
    return { body: "" };
  }
  return { body: `${ICONS.clipboard} Concurrent retained: **${s.concurrentRetainedMiB} MiB** (documents: ${s.documents?.join(", ") ?? ""})\n\n` };
});

registry.set("memory-release", (records) => {
  const m = records[0];
  if (!m) {
    return { body: `${ICONS.failed} No measurement found.\n\n` };
  }
  return {
    body: `| Baseline | Opened | Closed | Allocated | Retained |
|---:|---:|---:|---:|---:|
| ${m.baseline} | ${m.opened} | ${m.closed} | ${m.allocated} | ${m.retained} |

`
  };
});

// -- Typed-summary driver ---------------------------------------------------

function renderUnknownType(type, records) {
  return {
    body: `\n<details>\n<summary>${ICONS.robot} \`${type}\` (unknown benchmark type)</summary>\n\n\`\`\`json\n${records.map(r => JSON.stringify(r, null, 2)).join("\n")}\n\`\`\`\n\n</details>\n`
  };
}

function typeDisplayName(type) {
  return type
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function renderTypedGroup(type, records, logText) {
  const renderer = registry.get(type) ?? renderUnknownType;
  const { header = "", body = "" } = renderer(records, logText);
  const text = `## ${ICONS.robot} ${typeDisplayName(type)}

${statusBadge()}

${header}${body}`;
  if (text.trim()) {
    appendSummary(text);
  }
}

function summarizeTyped() {
  const logText = readLog();
  const groups = groupByType(logText);

  if (groups.size === 0) {
    return;
  }

  appendSummary(`\n---\n# ${ICONS.robot} Benchmark\n`);
  for (const [type, records] of groups) {
    renderTypedGroup(type, records, logText);
  }
  renderFailureTail(logText);
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

summarizeMocha();
summarizeTyped();
