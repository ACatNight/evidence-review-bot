import type { ReviewReport } from "./review-pr.js";

type Language = "en" | "zh";

interface CoverageRow {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

function percentage(completed: number, total: number): string {
  if (total === 0) return "N/A";
  return `${Math.floor((completed / total) * 100)}% (${completed}/${total})`;
}

export function reviewCoverageTable(report: ReviewReport, language: Language): string[] {
  const { coverage, aiReview } = report;
  const chinese = language === "zh";
  const ruleValue = percentage(coverage.completedFiles, coverage.changedFiles);
  const ruleDetail = chinese
    ? `仅 SEC-001；按已列出的变更文件统计${coverage.truncatedFiles ? "，文件列表已截断" : ""}${coverage.excludedFiles ? `，${coverage.excludedFiles} 个文件不适用` : ""}`
    : `SEC-001 only; listed changed files${coverage.truncatedFiles ? "; file list truncated" : ""}${coverage.excludedFiles ? `; ${coverage.excludedFiles} excluded` : ""}`;
  const aiValue =
    aiReview.state === "not_run"
      ? "0%"
      : aiReview.inspectedChangedLines === undefined || aiReview.eligibleChangedLines === undefined
        ? "N/A"
        : percentage(aiReview.inspectedChangedLines, aiReview.eligibleChangedLines);
  const aiState = chinese
    ? { not_run: "未运行", complete: "完成", partial: "部分完成", error: "调用失败" }[
        aiReview.state
      ]
    : aiReview.state;
  const aiDetail =
    aiReview.state === "not_run"
      ? aiState
      : aiReview.eligibleChangedLines === undefined
        ? chinese
          ? "旧运行未记录变更行覆盖"
          : "Changed-line coverage unavailable for this run"
        : chinese
          ? `${aiState}；按已识别的适用变更行统计`
          : `${aiState}; identified eligible changed lines`;
  const notRun = chinese ? "未执行；不包含独立 CI 结果" : "Not run; separate CI results excluded";
  const rows: CoverageRow[] = [
    {
      label: chinese ? "确定性规则" : "Deterministic rules",
      value: ruleValue,
      detail: ruleDetail,
    },
    {
      label: chinese ? "AI 安全审查" : "AI security review",
      value: aiValue,
      detail: aiDetail,
    },
    {
      label: chinese ? "凭据扫描" : "Secret scan",
      value: ruleValue,
      detail: chinese
        ? "与确定性规则为同一次 SEC-001 检查"
        : "Same SEC-001 run as deterministic rules",
    },
    { label: "Lint", value: "0%", detail: notRun },
    { label: chinese ? "编译/类型检查" : "Build / type check", value: "0%", detail: notRun },
    { label: chinese ? "测试" : "Tests", value: "0%", detail: notRun },
    { label: chinese ? "依赖漏洞审计" : "Dependency audit", value: "0%", detail: notRun },
  ];
  return [
    chinese ? "### 审查覆盖率" : "## Review Coverage",
    "",
    chinese ? "| 检查 | 覆盖率 | 范围与状态 |" : "| Check | Coverage | Scope and status |",
    "| --- | ---: | --- |",
    ...rows.map((row) => `| ${row.label} | ${row.value} | ${row.detail} |`),
    "",
    chinese
      ? "覆盖率表示本次机器人实际处理的范围，不是问题检出率或代码安全评分。"
      : "Coverage measures scope processed by this bot, not detection rate or a code safety score.",
    "",
  ];
}
