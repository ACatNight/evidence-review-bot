import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCoverage } from "../src/domain/coverage.js";
import { validateEvidence } from "../src/domain/evidence.js";
import type { EvidenceNode, Finding } from "../src/domain/review.js";

test("coverage distinguishes a clean run, incomplete files and no executed rules", () => {
  const files = ["src/a.ts", "src/b.ts"];
  const rules = ["SEC-001"];
  assert.deepEqual(summarizeCoverage(files, rules, [
    { ruleId: "SEC-001", path: files[0]!, state: "complete" },
    { ruleId: "SEC-001", path: files[1]!, state: "complete" },
  ]), {
    state: "complete", changedFiles: 2, applicableFiles: 2,
    completedFiles: 2, incompleteFiles: 0, excludedFiles: 0,
  });
  assert.equal(summarizeCoverage(files, rules, [
    { ruleId: "SEC-001", path: files[0]!, state: "complete" },
  ]).state, "partial");
  assert.equal(summarizeCoverage(files, [], []).state, "not_run");
  assert.equal(summarizeCoverage(files, rules, files.map(path => ({
    ruleId: "SEC-001", path, state: "excluded", reason: "unsupported",
  }))).state, "not_run");
});

test("coverage rejects duplicate and out-of-scope records", () => {
  const row = { ruleId: "SEC-001", path: "a.ts", state: "complete" } as const;
  assert.throws(() => summarizeCoverage(["a.ts"], ["SEC-001"], [row, row]));
  assert.throws(() => summarizeCoverage(["a.ts"], ["SEC-001"], [
    { ...row, path: "b.ts" },
  ]));
});

const observed: EvidenceNode = {
  id: "source", kind: "observed", redactedExcerpt: "token = [REDACTED]",
  source: {
    snapshotSha: "head", path: "src/a.ts", blobSha: "blob",
    startLine: 3, endLine: 3, contentDigest: "sha256:example",
  },
};

const finding: Finding = {
  id: "f1", ruleId: "SEC-001", ruleVersion: "1.0.0", severity: "high",
  confidence: "high", method: "deterministic", title: "Credential format",
  location: { path: "src/a.ts", blobSha: "blob", side: "RIGHT", startLine: 3, endLine: 3 },
  evidenceRootIds: ["reason"],
};

test("finding has a path through versioned derivation to an observed source", () => {
  assert.doesNotThrow(() => validateEvidence([
    observed,
    { id: "derived", kind: "derived", producer: "scanner", producerVersion: "1.0.0",
      dependsOn: ["source"], description: "Matches known credential format" },
    { id: "reason", kind: "reasoning", dependsOn: ["derived"],
      description: "Source contains a candidate credential" },
  ], [finding]));
});

test("evidence rejects missing sources, cycles and unversioned derivations", () => {
  assert.throws(() => validateEvidence([
    { id: "reason", kind: "reasoning", dependsOn: ["missing"], description: "x" },
  ], [finding]), /Missing evidence/);
  assert.throws(() => validateEvidence([
    { id: "reason", kind: "reasoning", dependsOn: ["loop"], description: "x" },
    { id: "loop", kind: "reasoning", dependsOn: ["reason"], description: "x" },
  ], [finding]), /Cycle/);
  assert.throws(() => validateEvidence([
    observed,
    { id: "reason", kind: "reasoning", dependsOn: ["source", "loop"], description: "x" },
    { id: "loop", kind: "reasoning", dependsOn: ["reason"], description: "x" },
  ], [finding]), /Cycle/);
  assert.throws(() => validateEvidence([
    observed,
    { id: "reason", kind: "derived", producer: "scanner", producerVersion: "",
      dependsOn: ["source"], description: "x" },
  ], [finding]), /producer version/);
});
