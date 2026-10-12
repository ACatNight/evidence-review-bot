import { createHash } from "node:crypto";
import type { PullRequestSnapshot } from "../adapters/github/snapshot.js";
import type { ReviewReport } from "../application/review-pr.js";
import {
  type EvidenceNode,
  type ProtocolFinding,
  REVIEW_PROTOCOL_VERSION,
  type ReviewResult,
} from "./types.js";

const ENGINE_VERSION = "0.1.0";

function id(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function sourceEvidence(
  snapshot: PullRequestSnapshot,
  path: string,
  startLine: number,
  endLine: number,
  excerpt?: string,
): EvidenceNode {
  return {
    id: id("source", `${snapshot.headSha}:${path}:${startLine}:${endLine}`),
    kind: "source",
    snapshotSha: snapshot.headSha,
    path,
    startLine,
    endLine,
    ...(excerpt ? { redactedExcerpt: excerpt } : {}),
  };
}

function deterministicFinding(
  snapshot: PullRequestSnapshot,
  ruleVersion: string,
  finding: ReviewReport["findings"][number],
  index: number,
): { finding: ProtocolFinding; evidence: EvidenceNode[] } {
  const source = sourceEvidence(
    snapshot,
    finding.path,
    finding.startLine,
    finding.endLine,
    finding.redactedExcerpt,
  );
  const rule: EvidenceNode = {
    id: id("rule", `${finding.kind}:${ruleVersion}`),
    kind: "rule",
    source: `SEC-001/${finding.kind}`,
    version: ruleVersion,
    dependsOn: [source.id],
    explanation: "The changed source matched a supported credential format.",
  };
  return {
    finding: {
      id: id(
        "finding",
        `${snapshot.headSha}:${finding.path}:${finding.startLine}:${finding.kind}:${index}`,
      ),
      ruleId: "SEC-001",
      severity: "high",
      confidence: "deterministic",
      location: { path: finding.path, startLine: finding.startLine, endLine: finding.endLine },
      title: `Possible ${finding.kind}`,
      explanation:
        "The changed line matches a supported credential format; validity was not checked.",
      remediation: "If this is a real credential, revoke or rotate it and remove it from source.",
      evidenceIds: [source.id, rule.id],
    },
    evidence: [source, rule],
  };
}

function checkStatus(
  state: ReviewReport["aiReview"]["state"],
): "complete" | "partial" | "not_run" | "error" {
  return state === "complete" || state === "partial" || state === "error" ? state : "not_run";
}

export function reviewReportToProtocolResult(
  snapshot: PullRequestSnapshot,
  report: ReviewReport,
  engineVersion = ENGINE_VERSION,
): ReviewResult {
  const findings: ProtocolFinding[] = [];
  const evidence: EvidenceNode[] = [];
  for (const [index, finding] of report.findings.entries()) {
    const mapped = deterministicFinding(snapshot, report.ruleVersion, finding, index);
    findings.push(mapped.finding);
    evidence.push(...mapped.evidence);
  }
  for (const [index, finding] of report.aiReview.findings.entries()) {
    const source = sourceEvidence(snapshot, finding.path, finding.line, finding.line);
    const model: EvidenceNode = {
      id: id(
        "model",
        `${report.aiReview.model ?? "unknown"}:${finding.path}:${finding.line}:${index}`,
      ),
      kind: "model",
      source: report.aiReview.model ?? "unknown-model",
      version: engineVersion,
      dependsOn: [source.id],
      explanation: "The model returned a candidate that was restricted to a changed line.",
    };
    findings.push({
      id: id("finding", `${snapshot.headSha}:ai:${finding.path}:${finding.line}:${index}`),
      ruleId: `AI-${finding.category}`,
      severity: finding.severity,
      confidence: "candidate",
      location: { path: finding.path, startLine: finding.line, endLine: finding.line },
      title: finding.title,
      explanation: finding.evidence,
      remediation: finding.recommendation,
      evidenceIds: [source.id, model.id],
    });
    evidence.push(source, model);
  }
  const aiStatus = checkStatus(report.aiReview.state);
  const deterministicStatus = report.coverage.state === "complete" ? "complete" : "partial";
  const status =
    report.coverage.state !== "complete" || aiStatus === "partial" || aiStatus === "error"
      ? "partial"
      : findings.length > 0
        ? "findings"
        : "passed";
  return {
    runId: id(
      "run",
      `${snapshot.provider}:${snapshot.repositoryId}:${snapshot.pullRequestNumber}:${snapshot.headSha}`,
    ),
    protocolVersion: REVIEW_PROTOCOL_VERSION,
    engineVersion,
    ruleSetVersion: `SEC-001@${report.ruleVersion}`,
    status,
    coverage: {
      files: {
        eligible: report.coverage.changedFiles - report.coverage.excludedFiles,
        reviewed: report.coverage.completedFiles,
        skipped: report.coverage.incompleteFiles,
      },
      checks: {
        deterministic: {
          status: deterministicStatus,
          processed: report.coverage.completedFiles,
          total: report.coverage.changedFiles - report.coverage.excludedFiles,
          ...(report.coverage.state !== "complete"
            ? { reason: "snapshot_or_file_incomplete" }
            : {}),
        },
        ai: {
          status: aiStatus,
          processed: report.aiReview.inspectedChangedLines,
          total: report.aiReview.eligibleChangedLines,
          ...(report.aiReview.reason ? { reason: report.aiReview.reason } : {}),
        },
        lint: { status: "not_run", processed: 0 },
        build: { status: "not_run", processed: 0 },
        tests: { status: "not_run", processed: 0 },
        dependencies: { status: "not_run", processed: 0 },
      },
    },
    findings,
    evidence,
    skipped: report.coverage.gaps.map((gap) => ({
      path: gap.path,
      check: "SEC-001",
      reason: gap.reason,
    })),
    checks: [
      {
        id: "SEC-001",
        status: deterministicStatus,
        findingIds: findings
          .filter((finding) => finding.ruleId === "SEC-001")
          .map((finding) => finding.id),
      },
      {
        id: "AI-security",
        status: aiStatus,
        findingIds: findings
          .filter((finding) => finding.ruleId.startsWith("AI-"))
          .map((finding) => finding.id),
        ...(report.aiReview.reason ? { message: report.aiReview.reason } : {}),
      },
    ],
  };
}
