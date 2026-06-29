#!/usr/bin/env bash
set -euo pipefail

# ── Inputs ───────────────────────────────────────────────────────────────────
RUN_TESTS_OUTCOME=${RUN_TESTS_OUTCOME:-unknown}
LOG_FILE=${LOG_FILE:-test-output.log}

# ── Parse test results from log ──────────────────────────────────────────────
PASS=0; FAIL=0; DURATION=""

if [ -f "$LOG_FILE" ]; then
  # "  352 passing (1s)"
  PASS_LINE=$(grep -Eo '[0-9]+ passing \([^)]+\)' "$LOG_FILE" | head -n1 || true)
  if [ -n "$PASS_LINE" ]; then
    PASS=$(echo "$PASS_LINE" | grep -Eo '^[0-9]+')
    DURATION=$(echo "$PASS_LINE" | grep -Eo '\([^)]+\)' | tr -d '()')
  fi

  # "  3 failing"
  FAIL=$(grep -Eo '[0-9]+ failing' "$LOG_FILE" | head -n1 | grep -Eo '^[0-9]+' || true)
  FAIL=${FAIL:-0}
fi

TOTAL=$((PASS + FAIL))

# ── Determine overall status ─────────────────────────────────────────────────
if [ "$RUN_TESTS_OUTCOME" != "success" ] && [ "$TOTAL" -eq 0 ]; then
  STATUS="❌ Tests were not executed successfully"
elif [ "$FAIL" -eq 0 ] && [ "$TOTAL" -gt 0 ]; then
  STATUS="✅ All tests passed"
else
  STATUS="❌ Some tests failed"
fi

if [ -n "$DURATION" ]; then
  STATUS="$STATUS ⏱ ${DURATION}"
fi

# ── Write summary table ───────────────────────────────────────────────────────
cat >> "$GITHUB_STEP_SUMMARY" <<SUMMARY
# 🤖 Automated test results

$STATUS

| ✅ Passed | ❌ Failed | 📋 Total |
|---:|---:|---:|
| $PASS | $FAIL | $TOTAL |
SUMMARY

# ── Failing test details ──────────────────────────────────────────────────────
if [ "$FAIL" -gt 0 ] && [ -f "$LOG_FILE" ]; then
  # The bottom failure block starts after "  N failing" and contains entries like:
  #   1) Suite name
  #        test description:
  #      AssertionError: ...
  FAILURE_BLOCK=$(awk '
    /^[[:space:]]+[0-9]+ failing/ { capture=1; next }
    capture { print }
  ' "$LOG_FILE")

  # Extract test titles: lines matching "  N) some text" at the start of each entry
  FAILED_TITLES=$(echo "$FAILURE_BLOCK" \
    | grep -E '^[[:space:]]+[0-9]+\) ' \
    | sed 's/^[[:space:]]*[0-9]*) //' \
    || true)

  cat >> "$GITHUB_STEP_SUMMARY" <<SUMMARY

<details>
<summary>❌ $FAIL failing test(s)</summary>

SUMMARY

  # List each failed test name
  echo "$FAILED_TITLES" | while IFS= read -r title; do
    [ -n "$title" ] && echo "- \`$title\`" >> "$GITHUB_STEP_SUMMARY"
  done

  cat >> "$GITHUB_STEP_SUMMARY" <<SUMMARY

### Error details

\`\`\`
$FAILURE_BLOCK
\`\`\`

</details>
SUMMARY
fi

# ── Runner crash: show tail of log ───────────────────────────────────────────
if [ "$RUN_TESTS_OUTCOME" != "success" ] && [ "$TOTAL" -eq 0 ] && [ -f "$LOG_FILE" ]; then
  TAIL=$(tail -n 30 "$LOG_FILE")
  cat >> "$GITHUB_STEP_SUMMARY" <<SUMMARY

## 🪵 Last 30 lines of output

\`\`\`
$TAIL
\`\`\`
SUMMARY
fi