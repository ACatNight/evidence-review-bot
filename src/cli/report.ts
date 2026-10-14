import type { PullRequestSnapshot } from "../adapters/github/snapshot.js";
import { reviewCoverageTable } from "../application/review-coverage.js";
import type { ReviewReport } from "../application/review-pr.js";
import type { CoverageReason } from "../domain/review.js";
import type { ScanOptions } from "./options.js";

const GAP_LABELS: Record<CoverageReason, string> = {
  read_failed: "文件读取失败",
  diff_unavailable: "无法取得完整的文件内容或变更行",
  too_large: "文件超过大小限制",
  parse_failed: "文件或差异解析失败",
  timeout: "检查超时",
  unsupported: "不支持此文件格式",
  rule_disabled: "规则未启用",
};

// Escape file names before displaying them in a terminal or Markdown report.
function display(value: string): string {
  return `\`${JSON.stringify(value).replaceAll("`", "\\u0060")}\``;
}

export function renderLocalReport(
  snapshot: PullRequestSnapshot,
  report: ReviewReport,
  options: ScanOptions,
): string {
  const zh = options.language === "zh";
  const scope =
    options.head === "INDEX" ? "staged" : options.head === "WORKTREE" ? "worktree" : "commit";
  const states = { complete: "完成", partial: "部分完成", not_run: "未运行" };
  const lines = [
    zh ? "# 本地代码审查报告" : "# Local code review report",
    "",
    `${zh ? "仓库" : "Repository"}: ${display(snapshot.repositoryName)}`,
    `${zh ? "范围" : "Scope"}: ${scope}; ${display(options.base)} → ${display(options.head)}`,
    `${zh ? "比较起点" : "Comparison base"}: ${snapshot.mergeBaseSha}`,
    `${zh ? "快照" : "Snapshot"}: ${snapshot.headSha}`,
    `${zh ? "状态" : "State"}: ${zh ? states[report.coverage.state] : report.coverage.state}; ${report.findings.length} ${zh ? "项候选" : "candidate(s)"}`,
    "",
    ...reviewCoverageTable(report, options.language),
  ];
  if (report.coverage.changedFiles === 0) {
    lines.push(
      zh
        ? "本次范围没有可检查的新增或修改文件，SEC-001 未运行。"
        : "No added or modified files in this scope; SEC-001 did not run.",
      "",
    );
  }
  if (report.findings.length > 0) {
    lines.push(zh ? "## 候选问题" : "## Candidates", "");
    for (const finding of report.findings) {
      lines.push(
        `- ${display(finding.path)}:${finding.startLine}-${finding.endLine} — ${finding.kind}; ${finding.redactedExcerpt}`,
      );
    }
    lines.push(
      "",
      zh
        ? "仅匹配凭据格式，未验证有效性。请人工核实；如为真实凭据，撤销或轮换后从代码中移除。"
        : "Format matches only; validity was not checked. Verify each candidate; revoke or rotate real credentials and remove them from source.",
      "",
    );
  }
  if (report.coverage.gaps.length > 0 || report.coverage.truncatedFiles) {
    lines.push(zh ? "## 未检查范围" : "## Coverage gaps", "");
    for (const gap of report.coverage.gaps) {
      lines.push(
        `- ${display(gap.path)}: ${zh ? `${GAP_LABELS[gap.reason]} (${gap.reason})` : gap.reason}`,
      );
    }
    if (report.coverage.truncatedFiles)
      lines.push(
        zh
          ? "- 超过 50 个文件；仅检查前 50 个，剩余文件未检查。"
          : "- More than 50 files; files beyond the first 50 were not checked.",
      );
    lines.push("");
  }
  lines.push(
    zh
      ? "本地入口仅执行 SEC-001。AI、Lint、构建、测试和依赖审计未运行；0 项候选不代表代码安全。"
      : "This local command runs SEC-001 only. AI, lint, build, tests and dependency audit did not run; zero candidates does not prove code safety.",
  );
  return `${lines.join("\n")}\n`;
}
