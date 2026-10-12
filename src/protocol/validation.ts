import type {
  CheckCoverage,
  EvidenceNode,
  ReviewCoverage,
  ReviewRequest,
  ReviewResult,
} from "./types.js";

const CHECK_STATUSES = new Set(["complete", "partial", "not_run", "error"]);

function requireText(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be empty`);
}

function validateCheckCoverage(check: CheckCoverage, label: string): void {
  if (!CHECK_STATUSES.has(check.status)) throw new Error(`${label} has an invalid status`);
  if (!Number.isInteger(check.processed) || check.processed < 0) {
    throw new Error(`${label}.processed must be a non-negative integer`);
  }
  if (
    check.total !== undefined &&
    (!Number.isInteger(check.total) || check.total < check.processed)
  ) {
    throw new Error(`${label}.total must be an integer greater than or equal to processed`);
  }
  if ((check.status === "partial" || check.status === "error") && !check.reason) {
    throw new Error(`${label} needs a reason when it is ${check.status}`);
  }
}

function validateCoverage(coverage: ReviewCoverage): void {
  for (const [name, value] of Object.entries(coverage.files)) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`coverage.files.${name} is invalid`);
  }
  if (coverage.files.reviewed + coverage.files.skipped > coverage.files.eligible) {
    throw new Error("coverage.files exceeds eligible scope");
  }
  if (coverage.changedLines) {
    for (const [name, value] of Object.entries(coverage.changedLines)) {
      if (!Number.isInteger(value) || value < 0)
        throw new Error(`coverage.changedLines.${name} is invalid`);
    }
    if (coverage.changedLines.reviewed > coverage.changedLines.eligible) {
      throw new Error("coverage.changedLines exceeds eligible scope");
    }
  }
  const checks = coverage.checks;
  validateCheckCoverage(checks.deterministic, "coverage.checks.deterministic");
  if (checks.ai) validateCheckCoverage(checks.ai, "coverage.checks.ai");
  validateCheckCoverage(checks.lint, "coverage.checks.lint");
  validateCheckCoverage(checks.build, "coverage.checks.build");
  validateCheckCoverage(checks.tests, "coverage.checks.tests");
  validateCheckCoverage(checks.dependencies, "coverage.checks.dependencies");
}

function validateEvidence(nodes: readonly EvidenceNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    requireText(node.id, "evidence.id");
    if (ids.has(node.id)) throw new Error(`Duplicate evidence ID: ${node.id}`);
    ids.add(node.id);
    if (node.kind === "source") {
      requireText(node.snapshotSha, "source evidence snapshotSha");
      requireText(node.path, "source evidence path");
      if (node.startLine < 1 || node.endLine < node.startLine) {
        throw new Error(`Source evidence ${node.id} has an invalid line range`);
      }
    } else {
      requireText(node.source, `${node.kind} evidence source`);
      requireText(node.version, `${node.kind} evidence version`);
      requireText(node.explanation, `${node.kind} evidence explanation`);
      if (node.dependsOn.length === 0) throw new Error(`Evidence ${node.id} has no dependencies`);
    }
  }
  return ids;
}

function validateRequest(request: ReviewRequest): void {
  if (request.protocolVersion !== "1.0") throw new Error("Unsupported review protocol version");
  requireText(request.repository.id, "repository.id");
  requireText(request.repository.fullName, "repository.fullName");
  if (request.snapshot.files.length === 0) throw new Error("review snapshot has no files");
  const paths = new Set<string>();
  for (const file of request.snapshot.files) {
    requireText(file.path, "review file path");
    if (paths.has(file.path)) throw new Error(`Duplicate review file: ${file.path}`);
    paths.add(file.path);
  }
  for (const rule of request.policy.enabledRules) requireText(rule, "enabled rule");
}

export function validateReviewRequest(request: ReviewRequest): void {
  validateRequest(request);
}

export function validateReviewResult(result: ReviewResult): void {
  if (result.protocolVersion !== "1.0") throw new Error("Unsupported review protocol version");
  requireText(result.runId, "runId");
  requireText(result.engineVersion, "engineVersion");
  requireText(result.ruleSetVersion, "ruleSetVersion");
  validateCoverage(result.coverage);
  const evidenceIds = validateEvidence(result.evidence);
  const findingIds = new Set<string>();
  for (const finding of result.findings) {
    requireText(finding.id, "finding.id");
    if (findingIds.has(finding.id)) throw new Error(`Duplicate finding ID: ${finding.id}`);
    findingIds.add(finding.id);
    requireText(finding.ruleId, "finding.ruleId");
    requireText(finding.title, "finding.title");
    requireText(finding.explanation, "finding.explanation");
    if (finding.location.startLine < 1 || finding.location.endLine < finding.location.startLine) {
      throw new Error(`Finding ${finding.id} has an invalid line range`);
    }
    if (finding.evidenceIds.length === 0) throw new Error(`Finding ${finding.id} has no evidence`);
    for (const evidenceId of finding.evidenceIds) {
      if (!evidenceIds.has(evidenceId))
        throw new Error(`Finding references missing evidence: ${evidenceId}`);
    }
  }
  for (const check of result.checks) {
    if (!check.id || !CHECK_STATUSES.has(check.status))
      throw new Error(`Invalid check result: ${check.id}`);
    for (const findingId of check.findingIds) {
      if (!findingIds.has(findingId))
        throw new Error(`Check references missing finding: ${findingId}`);
    }
  }
}
