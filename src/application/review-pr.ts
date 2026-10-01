import { createHmac } from "node:crypto";
import type { PullRequestSnapshot } from "../adapters/github/snapshot.js";
import { AI_NOT_RUN, type AiReview } from "../adapters/openai/security-review.js";
import { summarizeCoverage } from "../domain/coverage.js";
import type { CoverageReason, CoverageState } from "../domain/review.js";
import { SECRET_RULE_VERSION, type SecretKind, scanSecrets } from "../rules/secret.js";
import { reviewCoverageTable } from "./review-coverage.js";

export interface ReportFinding {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly kind: SecretKind;
  readonly redactedExcerpt: string;
  readonly hmacFingerprint: string;
}

export interface ReportCoverage {
  readonly state: CoverageState;
  readonly changedFiles: number;
  readonly completedFiles: number;
  readonly incompleteFiles: number;
  readonly excludedFiles: number;
  readonly truncatedFiles: boolean;
  readonly gaps: readonly { path: string; reason: CoverageReason }[];
}

export interface ReviewReport {
  readonly ruleVersion: string;
  readonly coverage: ReportCoverage;
  readonly findings: readonly ReportFinding[];
  readonly aiReview: AiReview;
}

export function reviewSnapshot(snapshot: PullRequestSnapshot, masterHmacKey: Buffer): ReviewReport {
  if (masterHmacKey.length < 32) throw new Error("Review HMAC key must be at least 32 bytes");
  const tenantHmacKey = createHmac("sha256", masterHmacKey)
    .update(snapshot.installationId)
    .digest();
  const records = [];
  const findings: ReportFinding[] = [];
  const gaps: { path: string; reason: CoverageReason }[] = [];
  for (const file of snapshot.files) {
    if (file.reason) {
      records.push({
        ruleId: "SEC-001",
        path: file.path,
        state: file.reason === "unsupported" ? "excluded" : "incomplete",
        reason: file.reason,
      } as const);
      gaps.push({ path: file.path, reason: file.reason });
      continue;
    }
    if (
      file.headText === undefined ||
      file.baseText === undefined ||
      file.changedHeadLines === undefined
    ) {
      throw new Error("Snapshot file has neither content nor a coverage reason");
    }
    const scan = scanSecrets({
      headText: file.headText,
      baseText: file.baseText,
      changedHeadLines: file.changedHeadLines,
      tenantHmacKey,
      maxBytes: 256_000,
    });
    if (scan.state === "partial") {
      records.push({
        ruleId: "SEC-001",
        path: file.path,
        state: "incomplete",
        reason: scan.reason,
      } as const);
      gaps.push({ path: file.path, reason: scan.reason });
      continue;
    }
    records.push({ ruleId: "SEC-001", path: file.path, state: "complete" } as const);
    for (const candidate of scan.candidates) {
      findings.push({
        path: file.path,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        kind: candidate.kind,
        redactedExcerpt: candidate.redactedExcerpt,
        hmacFingerprint: candidate.hmacFingerprint,
      });
    }
  }
  const summary = summarizeCoverage(
    snapshot.files.map((file) => file.path),
    ["SEC-001"],
    records,
  );
  return {
    ruleVersion: SECRET_RULE_VERSION,
    coverage: {
      state: snapshot.truncatedFiles ? "partial" : summary.state,
      changedFiles: summary.changedFiles,
      completedFiles: summary.completedFiles,
      incompleteFiles: summary.incompleteFiles,
      excludedFiles: summary.excludedFiles,
      truncatedFiles: snapshot.truncatedFiles,
      gaps,
    },
    findings,
    aiReview: AI_NOT_RUN,
  };
}

function displayPath(path: string): string {
  return path.replace(/[^\p{L}\p{N}._/-]/gu, "?").slice(0, 180);
}

export function checkOutput(
  report: ReviewReport,
  headSha: string,
): {
  title: string;
  summary: string;
  text: string;
} {
  const { coverage, findings, aiReview } = report;
  const title =
    findings.length > 0 || aiReview.findings.length > 0
      ? `Review: ${findings.length} rule, ${aiReview.findings.length} AI candidate(s)`
      : coverage.state === "complete"
        ? "SEC-001: no candidates in checked files"
        : "SEC-001: review incomplete";
  const summary =
    `Coverage: ${coverage.state}; ${coverage.completedFiles}/${coverage.changedFiles} listed changed files checked${coverage.truncatedFiles ? " (more files were omitted)" : ""}. ` +
    `${findings.length} SEC-001 candidate(s). AI review: ${aiReview.state}` +
    (aiReview.state === "complete" || aiReview.state === "partial"
      ? `, ${aiReview.findings.length} suggestion(s) from ${aiReview.inspectedFiles}/${aiReview.eligibleFiles} eligible files${aiReview.inspectedChangedLines === undefined || aiReview.eligibleChangedLines === undefined ? " (changed-line coverage unavailable for this run)" : ` and ${aiReview.inspectedChangedLines}/${aiReview.eligibleChangedLines} eligible changed lines`}.`
      : ".") +
    " Neither check proves the PR is safe.";
  const lines = [
    `Commit: \`${headSha}\``,
    "",
    ...reviewCoverageTable(report, "en"),
    `Rule: SEC-001 v${report.ruleVersion} (GitHub classic and fine-grained token formats; supported PEM private key formats).`,
    "",
  ];
  if (findings.length > 0) {
    lines.push("## Candidates", "");
    for (const finding of findings.slice(0, 20)) {
      lines.push(
        `- ${displayPath(finding.path)}:${finding.startLine}-${finding.endLine}: ${finding.kind}; ${finding.redactedExcerpt}. Format match only; validity not checked.`,
      );
    }
    if (findings.length > 20)
      lines.push(`- ${findings.length - 20} additional candidates omitted.`);
    lines.push(
      "",
      "If a candidate is real, revoke or rotate it and remove it from source. Deleting the line alone does not revoke a credential.",
      "",
    );
  }
  if (coverage.gaps.length > 0 || coverage.truncatedFiles) {
    lines.push("## Coverage gaps", "");
    for (const gap of coverage.gaps.slice(0, 20)) {
      lines.push(`- ${displayPath(gap.path)}: ${gap.reason}`);
    }
    if (coverage.gaps.length > 20)
      lines.push(`- ${coverage.gaps.length - 20} additional gaps omitted.`);
    if (coverage.truncatedFiles)
      lines.push("- File list exceeded the first 50 files; remaining files were not checked.");
  }
  lines.push("", "## AI security review", "");
  lines.push(
    `State: ${aiReview.state}${aiReview.model ? `; model: ${displayPath(aiReview.model)}` : ""}${aiReview.reason ? `; reason: ${aiReview.reason}` : ""}.`,
  );
  for (const finding of aiReview.findings) {
    lines.push(
      `- ${displayPath(finding.path)}:${finding.line} [${finding.severity}, ${finding.confidence} confidence] ${finding.title}: ${finding.evidence} Suggested action: ${finding.recommendation}`,
    );
  }
  if (aiReview.findings.length > 0) {
    lines.push("AI suggestions require human verification; they are not deterministic findings.");
  }
  return { title, summary, text: lines.join("\n").slice(0, 60_000) };
}
