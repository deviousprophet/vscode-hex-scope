import { appendFileSync, existsSync, readFileSync } from "node:fs";

const runTestsOutcome = process.env.RUN_TESTS_OUTCOME ?? "unknown";
const logFile = process.env.LOG_FILE ?? "test-output.log";
const suiteName = process.env.SUITE_NAME ?? "Automated test results";
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

function firstNumber(pattern, text) {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : 0;
}

function passingDuration(logText) {
  return /[0-9]+ passing \(([^)]+)\)/.exec(logText)?.[1] ?? "";
}

function failureBlock(logText) {
  const lines = logText.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^[ \t]+[0-9]+ failing/.test(line));
  return startIndex === -1 ? "" : lines.slice(startIndex + 1).join("\n").trimEnd();
}

function failedTitles(block) {
  return block
    .split(/\r?\n/)
    .map((line) => /^[ \t]+[0-9]+\) (.+)$/.exec(line)?.[1])
    .filter(Boolean);
}

function tailLines(logText, count) {
  return logText.split(/\r?\n/).slice(-count).join("\n");
}

const logText = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
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
