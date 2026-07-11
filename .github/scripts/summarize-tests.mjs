import { appendFileSync, existsSync, readFileSync } from "node:fs";

const runTestsOutcome = process.env.RUN_TESTS_OUTCOME ?? "unknown";
const logFile = process.env.LOG_FILE ?? "test-output.log";
const suiteName = process.env.SUITE_NAME ?? "Automated test results";
const testFormat = process.env.TEST_FORMAT ?? "mocha"; // "mocha" | "performance"
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

const passedIcon = "\u2705";
const failedIcon = "\u274c";
const timerIcon = "\u23f1";
const robotIcon = "\u{1F916}";
const clipboardIcon = "\u{1F4CB}";
const logIcon = "\u{1FAB5}";

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

const logText = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";

if (testFormat === "performance") {
  summarizePerformance();
} else {
  summarizeMocha();
}

function summarizeMocha() {
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

  const pass = firstNumber(/([0-9]+) passing \([^)]+\)/, logText);
  const fail = firstNumber(/([0-9]+) failing/, logText);
  const duration = passingDuration(logText);
  const total = pass + fail;

  let status;
  if (runTestsOutcome !== "success" && total === 0) {
    status = `${failedIcon} Tests were not executed successfully`;
  } else if (fail === 0 && total > 0) {
    status = `${passedIcon} All tests passed`;
  } else {
    status = `${failedIcon} Some tests failed`;
  }

  if (duration) {
    status += ` ${timerIcon} ${duration}`;
  }

  appendSummary(`# ${robotIcon} ${suiteName}

${status}

| ${passedIcon} Passed | ${failedIcon} Failed | ${clipboardIcon} Total |
|---:|---:|---:|
| ${pass} | ${fail} | ${total} |
`);

  if (fail > 0 && logText) {
    const block = failureBlock(logText);
    const titles = failedTitles(block);

    appendSummary(`
<details>
<summary>${failedIcon} ${fail} failing test(s)</summary>

`);

    for (const title of titles) {
      appendSummary(`- \`${title}\`\n`);
    }

    appendSummary(`
### Error details

\`\`\`
${block}
\`\`\`

</details>
`);
  }

  if (runTestsOutcome !== "success" && total === 0 && logText) {
    appendSummary(`
## ${logIcon} Last 30 lines of output

\`\`\`
${tailLines(logText, 30)}
\`\`\`
`);
  }
}

function summarizePerformance() {
  const lines = logText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const measurements = [];
  let summaryLine = null;

  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // not a JSON line (e.g. stray text) - skip
    }

    if (parsed && typeof parsed === "object") {
      if (typeof parsed.name === "string" && "elapsedMs" in parsed) {
        measurements.push(parsed);
      } else if ("concurrentRetainedMiB" in parsed) {
        summaryLine = parsed;
      }
    }
  }

  const success = runTestsOutcome === "success";
  const status = success
    ? `${passedIcon} Performance run passed`
    : `${failedIcon} Performance run failed`;

  appendSummary(`# ${robotIcon} ${suiteName}

${status}

`);

  if (measurements.length > 0) {
    appendSummary(`| Name | Source (MiB) | Records | Elapsed (ms) | Retained (MiB) |
|---|---:|---:|---:|---:|
`);
    for (const m of measurements) {
      appendSummary(`| ${m.name} | ${m.sourceMiB ?? ""} | ${m.records ?? ""} | ${m.elapsedMs ?? ""} | ${m.retainedMiB ?? ""} |\n`);
    }
    appendSummary("\n");
  }

  if (summaryLine) {
    appendSummary(
      `${clipboardIcon} Concurrent retained: **${summaryLine.concurrentRetainedMiB} MiB** (documents: ${summaryLine.documents?.join(", ") ?? ""})\n\n`
    );
  }

  if (measurements.length === 0 && !summaryLine) {
    appendSummary(`${failedIcon} No performance measurements were found in the log.\n\n`);
  }

  if (!success && logText) {
    appendSummary(`
<details>
<summary>${failedIcon} Failure output</summary>

\`\`\`
${tailLines(logText, 40)}
\`\`\`

</details>
`);
  }
}
