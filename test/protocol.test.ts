import assert from "node:assert/strict";
import test from "node:test";
import {
  parseReviewResult,
  type ReviewRequest,
  type ReviewResult,
  serializeReviewResult,
  validateReviewRequest,
  validateReviewResult,
} from "../src/protocol/index.js";

const request: ReviewRequest = {
  protocolVersion: "1.0",
  provider: "local",
  repository: { id: "repo-1", fullName: "example/repo", visibility: "private" },
  snapshot: {
    baseSha: "base",
    headSha: "head",
    files: [{ path: "src/app.ts", blobSha: "blob" }],
    changedLines: [{ path: "src/app.ts", startLine: 4, endLine: 4 }],
  },
  policy: { enabledRules: ["SEC-001"], aiEnabled: false, failOn: "high" },
};

const result: ReviewResult = {
  runId: "run-1",
  protocolVersion: "1.0",
  engineVersion: "0.2.0",
  ruleSetVersion: "sec-001@0.1.0",
  status: "findings",
  coverage: {
    files: { eligible: 1, reviewed: 1, skipped: 0 },
    changedLines: { eligible: 1, reviewed: 1 },
    checks: {
      deterministic: { status: "complete", processed: 1, total: 1 },
      lint: { status: "not_run", processed: 0 },
      build: { status: "not_run", processed: 0 },
      tests: { status: "not_run", processed: 0 },
      dependencies: { status: "not_run", processed: 0 },
    },
  },
  findings: [
    {
      id: "finding-1",
      ruleId: "SEC-001",
      severity: "high",
      confidence: "deterministic",
      location: { path: "src/app.ts", startLine: 4, endLine: 4 },
      title: "疑似凭据",
      explanation: "匹配已支持的凭据格式。",
      evidenceIds: ["source-1", "rule-1"],
    },
  ],
  evidence: [
    {
      id: "source-1",
      kind: "source",
      snapshotSha: "head",
      path: "src/app.ts",
      startLine: 4,
      endLine: 4,
      redactedExcerpt: "[REDACTED]",
    },
    {
      id: "rule-1",
      kind: "rule",
      source: "secret-format",
      version: "0.1.0",
      dependsOn: ["source-1"],
      explanation: "匹配已支持格式。",
    },
  ],
  skipped: [],
  checks: [{ id: "SEC-001", status: "complete", findingIds: ["finding-1"] }],
};

test("protocol validates requests and round-trips JSON results", () => {
  assert.doesNotThrow(() => validateReviewRequest(request));
  assert.doesNotThrow(() => validateReviewResult(result));
  const encoded = serializeReviewResult(result);
  assert.deepEqual(parseReviewResult(encoded), result);
});

test("protocol rejects incomplete coverage without a reason", () => {
  assert.throws(
    () =>
      validateReviewResult({
        ...result,
        coverage: {
          ...result.coverage,
          checks: {
            ...result.coverage.checks,
            deterministic: { status: "partial", processed: 1, total: 2 },
          },
        },
      }),
    /needs a reason/,
  );
});

test("protocol rejects findings that do not point to evidence", () => {
  const [firstFinding] = result.findings;
  assert.ok(firstFinding);
  assert.throws(
    () =>
      validateReviewResult({
        ...result,
        findings: [{ ...firstFinding, evidenceIds: ["missing"] }],
      }),
    /missing evidence/,
  );
});
