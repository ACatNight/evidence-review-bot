import assert from "node:assert/strict";
import test from "node:test";
import { AI_NOT_RUN } from "../src/adapters/openai/security-review.js";
import { reportSummary } from "../src/application/report-summary.js";
import type { ReviewReport } from "../src/application/review-pr.js";

const report: ReviewReport = {
  ruleVersion: "1",
  findings: [],
  aiReview: AI_NOT_RUN,
  coverage: {
    state: "complete",
    changedFiles: 1,
    completedFiles: 1,
    incompleteFiles: 0,
    excludedFiles: 0,
    truncatedFiles: false,
    gaps: [],
  },
};

test("report summary distinguishes checked scope, empty scope and failures", () => {
  assert.match(reportSummary(report, "zh").join("\n"), /已检查范围未发现候选/);
  assert.match(
    reportSummary({ ...report, coverage: { ...report.coverage, state: "not_run" } }, "zh").join(
      "\n",
    ),
    /没有可检查范围/,
  );
  const failed = reportSummary(
    { ...report, aiReview: { ...AI_NOT_RUN, state: "error" } },
    "en",
  ).join("\n");
  assert.match(failed, /Review incomplete/);
  assert.match(failed, /retry/);
});

test("report summary preserves findings while showing incomplete scope", () => {
  const text = reportSummary(
    {
      ...report,
      coverage: { ...report.coverage, state: "partial" },
      findings: [
        {
          path: "a.ts",
          startLine: 1,
          endLine: 1,
          kind: "github_classic_token",
          hmacFingerprint: "fingerprint",
          redactedExcerpt: "[REDACTED]",
        },
      ],
    },
    "zh",
  ).join("\n");
  assert.match(text, /候选: 1/);
  assert.match(text, /先核实/);
  assert.match(text, /未完成范围/);
});
