import assert from "node:assert/strict";
import test from "node:test";
import { scanSecrets } from "../src/rules/secret.js";

const key = Buffer.alloc(32, 7);
const token = `ghp_${"A".repeat(36)}`;
const fineGrainedToken = `github_pat_${"A".repeat(82)}`;

function scan(headText: string, baseText = "", changedHeadLines = new Set([1, 2, 3, 4, 5])) {
  return scanSecrets({ headText, baseText, changedHeadLines, tenantHmacKey: key, maxBytes: 4096 });
}

test("reports a new candidate without returning its original value", () => {
  const result = scan(`const credential = "${token}";`);
  assert.equal(result.state, "complete");
  if (result.state !== "complete") return;
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.kind, "github_classic_token");
  assert.equal(result.candidates[0]?.startLine, 1);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("ignores unchanged and moved candidate values", () => {
  assert.deepEqual(scan(`const x = "${token}";`, `const x = "${token}";`).candidates, []);
  assert.deepEqual(
    scan(`// moved\nconst x = "${token}";`, `const x = "${token}";`, new Set([2])).candidates,
    [],
  );
  assert.deepEqual(scan(`const x = "${token}";`, "", new Set([2])).candidates, []);
});

test("detects only complete fine-grained GitHub token formats", () => {
  const result = scan(`const credential = "${fineGrainedToken}";`);
  assert.equal(result.state, "complete");
  if (result.state !== "complete") return;
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.kind, "github_fine_grained_token");
  assert.equal(result.candidates[0]?.redactedExcerpt, "[REDACTED GITHUB TOKEN]");
  assert.equal(JSON.stringify(result).includes(fineGrainedToken), false);

  for (const value of [
    `github_pat_${"A".repeat(81)}`,
    `${fineGrainedToken}A`,
    `_${fineGrainedToken}`,
    `${fineGrainedToken}_`,
    "github_pat_example",
  ]) {
    assert.deepEqual(scan(`const credential = "${value}";`).candidates, []);
  }
});

test("fine-grained tokens already in the base or outside changed lines are ignored", () => {
  const source = `const credential = "${fineGrainedToken}";`;
  assert.deepEqual(scan(source, source).candidates, []);
  assert.deepEqual(scan(`// moved\n${source}`, source, new Set([2])).candidates, []);
  assert.deepEqual(scan(source, "", new Set([2])).candidates, []);
});

test("reports multiline PEM candidates when a changed line intersects the block", () => {
  const block = [
    "-----BEGIN PRIVATE KEY-----",
    "A".repeat(64),
    "B".repeat(64),
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const result = scan(`// added\n${block}`, "", new Set([3]));
  assert.equal(result.state, "complete");
  if (result.state !== "complete") return;
  assert.equal(result.candidates.length, 1);
  assert.deepEqual([result.candidates[0]?.startLine, result.candidates[0]?.endLine], [2, 5]);
  assert.equal(JSON.stringify(result).includes("A".repeat(64)), false);
  assert.deepEqual(scan(block.replace("END PRIVATE KEY", "END RSA PRIVATE KEY")).candidates, []);
});

test("rejects placeholders and marks oversized input as partial", () => {
  assert.deepEqual(scan('const token = "ghp_example";').candidates, []);
  const result = scanSecrets({
    headText: "x".repeat(100),
    baseText: "",
    changedHeadLines: new Set([1]),
    tenantHmacKey: key,
    maxBytes: 10,
  });
  assert.deepEqual(result, { state: "partial", reason: "too_large", candidates: [] });
});

test("fingerprints are tenant scoped", () => {
  const first = scan(`const x = "${token}";`);
  const second = scanSecrets({
    headText: `const x = "${token}";`,
    baseText: "",
    changedHeadLines: new Set([1]),
    tenantHmacKey: Buffer.alloc(32, 8),
    maxBytes: 4096,
  });
  assert.equal(first.candidates.length, 1);
  assert.equal(second.candidates.length, 1);
  assert.notEqual(first.candidates[0]?.hmacFingerprint, second.candidates[0]?.hmacFingerprint);
});
