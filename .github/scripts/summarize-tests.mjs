#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const runTestsOutcome = process.env.RUN_TESTS_OUTCOME ?? 'unknown';
const logFile = process.env.LOG_FILE ?? 'test-output.log';
const summaryFile = process.env.GITHUB_STEP_SUMMARY;

if (!summaryFile) {
  console.error('GITHUB_STEP_SUMMARY is required');
  process.exit(1);
}

const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
const passMatch = log.match(/([0-9]+) passing \(([^)]+)\)/);
const failMatch = log.match(/([0-9]+) failing/);
const passed = passMatch ? Number(passMatch[1]) : 0;
const failed = failMatch ? Number(failMatch[1]) : 0;
const duration = passMatch?.[2] ?? '';
const total = passed + failed;

let status;
if (runTestsOutcome !== 'success' && total === 0) {
  status = `${icon('274c')} Tests were not executed successfully`;
} else if (failed === 0 && total > 0) {
  status = `${icon('2705')} All tests passed`;
} else {
  status = `${icon('274c')} Some tests failed`;
}

if (duration) {
  status = `${status} ${icon('23f1')} ${duration}`;
}

appendSummary(`# ${icon('1f916')} Automated test results

${status}

| ${icon('2705')} Passed | ${icon('274c')} Failed | ${icon('1f4cb')} Total |
|---:|---:|---:|
| ${passed} | ${failed} | ${total} |
`);

if (failed > 0 && log) {
  const failureBlock = extractFailureBlock(log);
  const failedTitles = failureBlock
    .split('\n')
    .map(line => line.match(/^\s+[0-9]+\) (.+)$/)?.[1])
    .filter(Boolean);

  appendSummary(`
<details>
<summary>${icon('274c')} ${failed} failing test(s)</summary>

${failedTitles.map(title => `- \`${title}\``).join('\n')}

### Error details

\`\`\`
${failureBlock}
\`\`\`

</details>
`);
}

if (runTestsOutcome !== 'success' && total === 0 && log) {
  appendSummary(`
## ${icon('1faa5')} Last 30 lines of output

\`\`\`
${tail(log, 30)}
\`\`\`
`);
}

function appendSummary(markdown) {
  appendFileSync(summaryFile, markdown);
}

function extractFailureBlock(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^\s+[0-9]+ failing/.test(line));
  return start === -1 ? '' : lines.slice(start + 1).join('\n').trimEnd();
}

function tail(text, count) {
  return text.split(/\r?\n/).slice(-count).join('\n').trimEnd();
}

function icon(codePointHex) {
  return String.fromCodePoint(Number.parseInt(codePointHex, 16));
}
