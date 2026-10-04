import assert from "node:assert/strict";
import test from "node:test";
import { AI_NOT_RUN } from "../src/adapters/openai/security-review.js";
import { reviewCoverageTable } from "../src/application/review-coverage.js";
import type { ReviewReport } from "../src/application/review-pr.js";

const report: ReviewReport = {
  ruleVersion: "0.1.0",
  coverage: {
    state: "partial",
    changedFiles: 4,
    completedFiles: 3,
    incompleteFiles: 1,
    excludedFiles: 0,
    truncatedFiles: false,
    gaps: [],
  },
  findings: [],
  aiReview: {
    ...AI_NOT_RUN,
    state: "partial",
    inspectedFiles: 2,
    eligibleFiles: 3,
    inspectedChangedLines: 43,
    eligibleChangedLines: 100,
    reason: "context_truncated",
  },
};

test("review coverage reports independent denominators and unrun checks", () => {
  const chinese = reviewCoverageTable(report, "zh").join("\n");
  assert.match(chinese, /确定性规则 \| 75% \(3\/4\)/);
  assert.match(chinese, /AI 安全审查 \| 43% \(43\/100\)/);
  assert.match(chinese, /凭据扫描 \| 75% \(3\/4\).*同一次 SEC-001/);
  assert.match(chinese, /编译\/类型检查 \| 0% \| 未执行/);
  assert.match(chinese, /依赖漏洞审计 \| 0% \| 未执行/);
  assert.match(chinese, /不是问题检出率或代码安全评分/);

  const english = reviewCoverageTable(report, "en").join("\n");
  assert.match(english, /AI security review \| 43% \(43\/100\)/);
  assert.match(english, /Same SEC-001 run/);
  const truncated = reviewCoverageTable(
    {
      ...report,
      coverage: {
        ...report.coverage,
        state: "partial",
        completedFiles: 4,
        incompleteFiles: 0,
        truncatedFiles: true,
      },
    },
    "en",
  ).join("\n");
  assert.match(truncated, /100% \(4\/4\).*file list truncated/);
});

test("review coverage distinguishes missing scope from zero work", () => {
  const noEligible = reviewCoverageTable(
    {
      ...report,
      coverage: { ...report.coverage, changedFiles: 0, completedFiles: 0, state: "not_run" },
      aiReview: { ...AI_NOT_RUN, state: "partial", reason: "snapshot_incomplete" },
    },
    "zh",
  ).join("\n");
  assert.match(noEligible, /确定性规则 \| N\/A/);
  assert.match(noEligible, /AI 安全审查 \| N\/A/);
  const disabled = reviewCoverageTable(reportWithDisabledAi(), "zh").join("\n");
  assert.match(disabled, /AI 安全审查 \| 0% \| 未运行/);
});

function reportWithDisabledAi(): ReviewReport {
  return { ...report, aiReview: AI_NOT_RUN };
}
