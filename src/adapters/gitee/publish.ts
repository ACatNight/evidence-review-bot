import type { ReviewReport } from "../../application/review-pr.js";
import type { SecretKind } from "../../rules/secret.js";
import type { PullRequestSnapshot } from "../github/snapshot.js";
import { type GiteeClient, giteeInteger, giteeObject } from "./client.js";
import type { GiteeRepository } from "./snapshot.js";

function display(value: string, limit = 180): string {
  return value.replace(/[\r\n\t<>`]/g, " ").slice(0, limit);
}

function sentence(value: string, limit: number): string {
  return `${display(value, limit).replace(/[。.!！?？;；\s]+$/u, "")}。`;
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

const secretKindText: Record<SecretKind, string> = {
  github_classic_token: "GitHub 经典令牌",
  github_fine_grained_token: "GitHub 精细化访问令牌",
  pem_private_key: "私钥",
};

export function giteeReportText(snapshot: PullRequestSnapshot, report: ReviewReport): string {
  const { coverage, findings, aiReview } = report;
  const lines = [
    "## 代码审查报告",
    "",
    `提交：\`${snapshot.headSha}\``,
    "### 确定性检查",
    "",
    `SEC-001 凭据格式扫描：已检查 ${coverage.completedFiles}/${coverage.changedFiles} 个变更文件；该规则覆盖${coverage.state === "complete" ? "完整" : "部分"}。`,
    `候选 ${findings.length} 项。仅识别已支持的凭据格式，不验证凭据有效性，也不代表完成了其他安全检查。`,
    "",
  ];
  if (findings.length > 0) {
    lines.push("### 确定性发现", "");
    for (const finding of findings.slice(0, 20)) {
      lines.push(
        `- \`${display(finding.path)}:${finding.startLine}-${finding.endLine}\`：疑似${secretKindText[finding.kind]}，${display(finding.redactedExcerpt, 300)}。如为真实凭据，请撤销或轮换。`,
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
  const aiCandidateText =
    aiReview.inspectedFiles === 0
      ? "候选问题：未评估"
      : `候选问题 ${aiReview.findings.length} 项${aiReview.state === "partial" ? "（仅已检查部分）" : ""}`;
  const changedLineCoverage =
    aiReview.inspectedChangedLines === undefined || aiReview.eligibleChangedLines === undefined
      ? "变更行覆盖未记录（旧运行）"
      : `${aiReview.inspectedChangedLines}/${aiReview.eligibleChangedLines} 行变更代码`;
  lines.push(
    "### AI 安全审查",
    "",
    `状态：${aiState}；已送入模型 ${aiReview.inspectedFiles}/${aiReview.eligibleFiles} 个符合条件的文件；${changedLineCoverage}；${aiCandidateText}。`,
  );
  if (aiReview.unreviewedRanges?.length) {
    lines.push("", "尚未完成 AI 审查的变更行：");
    for (const range of aiReview.unreviewedRanges) {
      lines.push(`- \`${display(range.path)}:${range.startLine}-${range.endLine}\``);
    }
    const omittedRanges =
      (aiReview.unreviewedRangeCount ?? aiReview.unreviewedRanges.length) -
      aiReview.unreviewedRanges.length;
    if (omittedRanges > 0) {
      lines.push(`- 另有 ${omittedRanges} 个行段未列出。`);
    }
  } else if (aiReview.unreviewedPaths?.length) {
    lines.push("", "尚未完成 AI 审查的文件（旧运行未记录行段）：");
    for (const path of aiReview.unreviewedPaths.slice(0, 20)) lines.push(`- \`${display(path)}\``);
  }
  const aiFailureText: Record<string, string> = {
    api_timeout: "AI 服务调用超时",
    api_rate_limited: "AI 服务限流",
    api_provider_error: "AI 服务返回服务器错误",
    api_request_rejected: "AI 服务拒绝审查请求",
    api_output_limit: "AI 输出达到长度上限",
    api_response_incomplete: "AI 返回结果不完整",
    api_unavailable_or_invalid_response: "AI 服务调用失败或返回内容无效",
    unreviewed_files: "部分符合条件的文件尚未进入 AI 审查",
    context_truncated: "部分文件的代码上下文超出输入上限，未展示的代码行尚未审查",
    snapshot_incomplete: "部分代码文件或变更文件列表未能完整读取",
    file_list_truncated: "变更文件列表已截断，后续文件尚未审查",
    finding_limit: "候选问题超过报告展示上限，部分候选未列出",
  };
  if (aiReview.reason && aiFailureText[aiReview.reason]) {
    lines.push(
      aiReview.reason === "context_truncated"
        ? `${aiFailureText[aiReview.reason]}。`
        : `${aiFailureText[aiReview.reason]}；未完成的范围不能视为通过。`,
    );
  }
  for (const finding of aiReview.findings) {
    lines.push(
      `- \`${display(finding.path)}:${finding.line}\` [风险：${severityText[finding.severity] ?? finding.severity}；置信度：${severityText[finding.confidence] ?? finding.confidence}] ${display(finding.title)}：${sentence(finding.evidence, 500)} 建议：${sentence(finding.recommendation, 500)}`,
    );
  }
  lines.push(
    "",
    "### 未执行的检查",
    "",
    "本报告未运行目标项目的 Lint、编译/类型检查、依赖漏洞扫描或运行时测试。AI 结果仅是待人工核实的候选；0 项候选不等于代码安全。",
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
  const body = giteeReportText(snapshot, report);
  for (let page = 1; page <= 10; page++) {
    const response = await client.get(`${commentPath}?page=${page}&per_page=100`);
    if (!Array.isArray(response.data)) throw new Error("Unexpected Gitee comments response");
    for (const item of response.data) {
      const comment = giteeObject(item);
      if (typeof comment.body === "string" && comment.body.includes(key)) {
        const id = giteeInteger(comment.id);
        if (comment.body !== body) {
          await client.patch(`${prefix}/pulls/comments/${id}`, { body });
        }
        return id;
      }
    }
    if (response.data.length < 100) break;
    if (page === 10) throw new Error("Gitee comment lookup was truncated");
  }
  if (!allowCreate) throw new Error("Gitee report publication outcome is uncertain");
  const created = giteeObject((await client.post(commentPath, { body })).data);
  return giteeInteger(created.id);
}
