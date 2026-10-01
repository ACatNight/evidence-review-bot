import assert from "node:assert/strict";
import test from "node:test";
import {
  changedLinesFromPatch,
  type PullRequestSnapshot,
} from "../src/adapters/github/snapshot.js";
import { checkOutput, reviewSnapshot } from "../src/application/review-pr.js";

test("diff parser accepts complete hunks and rejects truncated patches", () => {
  const patch = ["@@ -1,2 +1,3 @@", " existing", "+new line", " second"].join("\n");
  assert.deepEqual([...((changedLinesFromPatch(patch) ?? new Set()) as Set<number>)], [2]);
  assert.equal(changedLinesFromPatch("@@ -1,2 +1,3 @@\n existing\n+new line"), null);
  assert.equal(changedLinesFromPatch("not a hunk"), null);
});

test("review report redacts candidates and marks incomplete coverage", () => {
  const token = `ghp_${"A".repeat(36)}`;
  const snapshot: PullRequestSnapshot = {
    provider: "github",
    installationId: "123",
    repositoryId: "456",
    repositoryOwner: "example",
    repositoryName: "repo",
    pullRequestNumber: 7,
    mergeBaseSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    headSha: "c".repeat(40),
    truncatedFiles: true,
    files: [
      {
        path: "src/config.ts",
        blobSha: "d".repeat(40),
        baseText: "",
        headText: `const token = "${token}";`,
        changedHeadLines: new Set([1]),
      },
      { path: "large.txt", blobSha: "e".repeat(40), reason: "too_large" },
    ],
  };
  const report = reviewSnapshot(snapshot, Buffer.alloc(32, 1));
  const output = checkOutput(report, snapshot.headSha);
  assert.equal(report.coverage.state, "partial");
  assert.equal(report.coverage.completedFiles, 1);
  assert.equal(report.findings.length, 1);
  assert.match(output.text, /Coverage gaps/);
  assert.match(output.text, /REDACTED GITHUB TOKEN/);
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.equal(JSON.stringify(output).includes(token), false);
});
