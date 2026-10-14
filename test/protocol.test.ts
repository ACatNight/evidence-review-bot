import assert from "node:assert/strict";
import test from "node:test";
import { demoProtocolReport } from "../src/examples/demo-report.js";
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

test("the existing review report maps to a valid protocol result", () => {
  const mapped = parseReviewResult(demoProtocolReport("github"));
  assert.equal(mapped.protocolVersion, "1.0");
  assert.equal(mapped.status, "partial");
  assert.equal(mapped.findings.length, 1);
  assert.equal(mapped.findings[0]?.confidence, "deterministic");
  assert.equal(mapped.coverage.checks.ai?.status, "partial");
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

test("external JSON rejects malformed shapes, enums and line numbers without leaking values", () => {
  const rejected: unknown[] = [
    null,
    [],
    {},
    { ...result, status: "clean" },
    { ...result, coverage: { ...result.coverage, files: { reviewed: 1, skipped: 0 } } },
    { ...result, findings: [{ ...result.findings[0], severity: "urgent" }] },
    {
      ...result,
      findings: [{ ...result.findings[0], location: { path: "a", startLine: 1.5, endLine: 2 } }],
    },
    { ...result, extra: "unexpected" },
  ];
  for (const value of rejected)
    assert.throws(() => parseReviewResult(JSON.stringify(value)), /Invalid review result/);
  assert.throws(() => parseReviewResult("{"), /not valid JSON/);
  const secret = "sensitive-value-do-not-log";
  assert.throws(
    () => parseReviewResult(JSON.stringify({ ...result, status: secret })),
    (error: unknown) => error instanceof Error && !error.message.includes(secret),
  );
});

test("all evidence dependencies are validated including unattached branches", () => {
  const producer = result.evidence[1];
  assert.ok(producer && producer.kind !== "source");
  assert.throws(
    () =>
      validateReviewResult({
        ...result,
        evidence: [...result.evidence, { ...producer, id: "unused", dependsOn: ["missing"] }],
      }),
    /missing dependency/,
  );
  assert.throws(
    () =>
      validateReviewResult({
        ...result,
        evidence: [...result.evidence, { ...producer, id: "unused", dependsOn: ["unused"] }],
      }),
    /Cycle/,
  );
  assert.throws(
    () =>
      validateReviewResult({
        ...result,
        evidence: [
          ...result.evidence,
          { ...producer, id: "a", dependsOn: ["b", "source-1"] },
          { ...producer, id: "b", dependsOn: ["a"] },
        ],
      }),
    /Cycle/,
  );
  assert.throws(
    () =>
      validateReviewResult({
        ...result,
        evidence: [result.evidence[0], { ...producer, dependsOn: ["source-1", "source-1"] }],
      }),
    /duplicate dependencies/,
  );
});

test("evidence accepts a long chain in any node order without recursion", () => {
  const producer = result.evidence[1];
  assert.ok(producer && producer.kind !== "source");
  const chain = Array.from({ length: 12_000 }, (_, index) => ({
    ...producer,
    id: `chain-${index}`,
    dependsOn: [index === 0 ? "source-1" : `chain-${index - 1}`],
  })).reverse();
  assert.doesNotThrow(() =>
    validateReviewResult({ ...result, evidence: [...chain, ...result.evidence] }),
  );
});

test("protocol rejects contradictory completion, results and request scope", () => {
  assert.throws(
    () => validateReviewResult({ ...result, status: "passed" }),
    /cannot contain findings/,
  );
  assert.throws(
    () => validateReviewResult({ ...result, checks: [...result.checks, ...result.checks] }),
    /Duplicate check/,
  );
  for (const coverage of [
    { status: "not_run", processed: 1 },
    { status: "complete", processed: 1, total: 2 },
  ]) {
    assert.throws(
      () =>
        validateReviewResult({
          ...result,
          coverage: {
            ...result.coverage,
            checks: { ...result.coverage.checks, deterministic: coverage },
          },
        }),
      /cannot/,
    );
  }
  assert.throws(
    () => validateReviewRequest({ ...request, provider: "unknown" }),
    /Invalid review request/,
  );
  assert.throws(
    () =>
      validateReviewRequest({
        ...request,
        snapshot: {
          ...request.snapshot,
          changedLines: [{ path: "missing.ts", startLine: 1, endLine: 1 }],
        },
      }),
    /outside/,
  );
});
