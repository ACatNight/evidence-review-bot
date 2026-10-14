import type { ReviewReport } from "./review-pr.js";

export function reportSummary(report: ReviewReport, language: "zh" | "en"): string[] {
  const zh = language === "zh";
  const count = report.findings.length + report.aiReview.findings.length;
  const incomplete =
    report.coverage.state === "partial" ||
    report.aiReview.state === "partial" ||
    report.aiReview.state === "error";
  const empty = report.coverage.state === "not_run" && report.aiReview.inspectedFiles === 0;
  const state = incomplete
    ? zh
      ? "审查未完成"
      : "Review incomplete"
    : empty
      ? zh
        ? "没有可检查范围"
        : "No applicable scope"
      : count > 0
        ? zh
          ? "有候选需要核实"
          : "Candidates need verification"
        : zh
          ? "已检查范围未发现候选"
          : "No candidates in checked scope";
  const action =
    count > 0
      ? zh
        ? "先核实下方候选，再处理修复建议；如为真实凭据，请撤销或轮换。"
        : "Verify the candidates below and apply relevant fixes; revoke or rotate real credentials."
      : incomplete
        ? zh
          ? "先查看未检查范围和失败原因，解决配置或服务问题后重试；不要将未完成范围视为通过。"
          : "Check coverage gaps and failure reasons, resolve configuration or service issues and retry."
        : empty
          ? zh
            ? "确认 PR 是否包含支持的新增或修改文件。"
            : "Check whether the PR contains supported added or modified files."
          : zh
            ? "继续人工审查和项目 CI；此结果不代表代码安全。"
            : "Continue manual review and project CI; this result does not prove code safety.";
  return [
    `**${zh ? "结论" : "Result"}：${state}**`,
    "",
    `${zh ? "候选" : "Candidates"}: ${count} (${zh ? "规则" : "rules"}: ${report.findings.length}; AI: ${report.aiReview.findings.length})`,
    `${zh ? "下一步" : "Next step"}: ${action}`,
    ...(count > 0 && incomplete
      ? [
          zh
            ? "审查同时存在未完成范围，请查看下方覆盖说明。"
            : "Some scope remains incomplete; see coverage details below.",
        ]
      : []),
    "",
  ];
}
