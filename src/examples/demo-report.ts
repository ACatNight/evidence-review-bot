import { giteeReportText } from "../adapters/gitee/publish.js";
import type { PullRequestSnapshot } from "../adapters/github/snapshot.js";
import { checkOutput, type ReviewReport } from "../application/review-pr.js";

const exampleSha = "a".repeat(40);

function exampleSnapshot(provider: "github" | "gitee"): PullRequestSnapshot {
  return {
    provider,
    installationId: `${provider}:example`,
    repositoryId: "1",
    repositoryOwner: "example",
    repositoryName: "sample-project",
    pullRequestNumber: 1,
    mergeBaseSha: "b".repeat(40),
    baseSha: "c".repeat(40),
    headSha: exampleSha,
    files: [],
    truncatedFiles: false,
  };
}

const exampleReport: ReviewReport = {
  ruleVersion: "0.1.0",
  coverage: {
    state: "partial",
    changedFiles: 3,
    completedFiles: 2,
    incompleteFiles: 1,
    excludedFiles: 0,
    truncatedFiles: false,
    gaps: [{ path: "src/large-file.ts", reason: "too_large" }],
  },
  findings: [
    {
      path: "src/config.ts",
      startLine: 12,
      endLine: 12,
      kind: "github_classic_token",
      redactedExcerpt: "[REDACTED GITHUB TOKEN]",
      hmacFingerprint: "synthetic-example",
    },
  ],
  aiReview: {
    state: "partial",
    model: "example-model",
    inspectedFiles: 1,
    eligibleFiles: 1,
    inspectedChangedLines: 4,
    eligibleChangedLines: 10,
    findings: [],
    reason: "context_truncated",
    unreviewedPaths: ["src/config.ts"],
    unreviewedRanges: [{ path: "src/config.ts", startLine: 21, endLine: 26 }],
    unreviewedRangeCount: 1,
  },
};

export function demoReport(provider: "github" | "gitee"): string {
  const snapshot = exampleSnapshot(provider);
  const rendered =
    provider === "gitee"
      ? giteeReportText(snapshot, exampleReport)
      : checkOutput(exampleReport, snapshot.headSha).text;
  const notice =
    provider === "gitee"
      ? "# 合成示例报告\n\n以下内容仅演示报告格式。没有读取仓库、调用模型或验证任何真实凭据。\n\n"
      : "# Synthetic example report\n\nThis only demonstrates the report format. No repository, model, or real credential was used.\n\n";
  return notice + rendered.replace(/\n\n<!-- evidence-review-bot:gitee:[^\n]* -->$/, "");
}
