import type { ReviewReport } from "../../application/review-pr.js";
import type { PullRequestSnapshot } from "../github/snapshot.js";
import { type GiteeClient, giteeInteger, giteeObject } from "./client.js";
import type { GiteeRepository } from "./snapshot.js";

function display(value: string, limit = 180): string {
  return value.replace(/[\r\n\t<>`]/g, " ").slice(0, limit);
}

function marker(snapshot: PullRequestSnapshot): string {
  return `<!-- evidence-review-bot:gitee:${snapshot.repositoryId}:${snapshot.pullRequestNumber}:${snapshot.baseSha}:${snapshot.headSha} -->`;
}

const gapText: Record<string, string> = {
  diff_unavailable: "差异内容不可用",
  read_failed: "文件读取失败",
  too_large: "文件超过大小限制",
  unsupported: "文件类型暂不支持",
};

const severityText: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

export function giteeReportText(snapshot: PullRequestSnapshot, report: ReviewReport): string {
  const { coverage, findings, aiReview } = report;
  const lines = [
    "## 代码审查报告",
    "",
    `提交：\`${snapshot.headSha}\``,
    `确定性规则 SEC-001：已检查 ${coverage.completedFiles}/${coverage.changedFiles} 个列出的变更文件；覆盖状态：${coverage.state === "complete" ? "完整" : "部分"}。`,
    `发现 ${findings.length} 个凭据格式候选。仅匹配已支持格式，不验证凭据是否有效。`,
    "",
  ];
  if (findings.length > 0) {
    lines.push("### 确定性发现", "");
    for (const finding of findings.slice(0, 20)) {
      lines.push(
        `- \`${display(finding.path)}:${finding.startLine}-${finding.endLine}\`：疑似${finding.kind === "github_classic_token" ? "GitHub 令牌" : "私钥"}，${display(finding.redactedExcerpt, 300)}。如为真实凭据，请撤销或轮换。`,
      );
    }
    if (findings.length > 20) lines.push(`- 另有 ${findings.length - 20} 项未展开。`);
    lines.push("");
  }
  if (coverage.gaps.length > 0 || coverage.truncatedFiles) {
    lines.push("### 未检查范围", "");
    for (const gap of coverage.gaps.slice(0, 20)) {
      lines.push(`- \`${display(gap.path)}\`：${gapText[gap.reason] ?? gap.reason}`);
    }
    if (coverage.truncatedFiles) lines.push("- 变更文件列表已截断，后续文件未检查。");
    lines.push("");
  }
  const aiState = {
    not_run: "未运行",
    complete: "完成",
    partial: "部分完成",
    error: "调用失败",
  }[aiReview.state];
  lines.push(
    "### AI 安全审查",
    "",
    `状态：${aiState}；已检查 ${aiReview.inspectedFiles}/${aiReview.eligibleFiles} 个符合条件的文件；候选问题 ${aiReview.findings.length} 项。`,
  );
  for (const finding of aiReview.findings) {
    lines.push(
      `- \`${display(finding.path)}:${finding.line}\` [风险：${severityText[finding.severity] ?? finding.severity}；置信度：${severityText[finding.confidence] ?? finding.confidence}] ${display(finding.title)}：${display(finding.evidence, 500)}。建议：${display(finding.recommendation, 500)}`,
    );
  }
  lines.push(
    "",
    "AI 输出仅为待人工核实的候选；没有发现问题不代表代码安全。部分覆盖或调用失败时，未检查范围不能视为通过。",
    "",
  );
  const key = marker(snapshot);
  return `${lines.join("\n").slice(0, 50_000 - key.length - 2)}\n\n${key}`;
}

export async function publishGiteeReport(
  client: GiteeClient,
  repository: GiteeRepository,
  snapshot: PullRequestSnapshot,
  report: ReviewReport,
  allowCreate: boolean,
): Promise<number | null> {
  const prefix = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  const pr = giteeObject((await client.get(`${prefix}/pulls/${snapshot.pullRequestNumber}`)).data);
  if (
    pr.state !== "open" ||
    giteeObject(pr.base).sha !== snapshot.baseSha ||
    giteeObject(pr.head).sha !== snapshot.headSha
  ) {
    return null;
  }
  const commentPath = `${prefix}/pulls/${snapshot.pullRequestNumber}/comments`;
  const key = marker(snapshot);
  for (let page = 1; page <= 10; page++) {
    const response = await client.get(`${commentPath}?page=${page}&per_page=100`);
    if (!Array.isArray(response.data)) throw new Error("Unexpected Gitee comments response");
    for (const item of response.data) {
      const comment = giteeObject(item);
      if (typeof comment.body === "string" && comment.body.includes(key)) {
        return giteeInteger(comment.id);
      }
    }
    if (response.data.length < 100) break;
    if (page === 10) throw new Error("Gitee comment lookup was truncated");
  }
  if (!allowCreate) throw new Error("Gitee report publication outcome is uncertain");
  const created = giteeObject(
    (await client.post(commentPath, { body: giteeReportText(snapshot, report) })).data,
  );
  return giteeInteger(created.id);
}
