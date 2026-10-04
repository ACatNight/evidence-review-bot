import assert from "node:assert/strict";
import test from "node:test";
import { publishCheck } from "../src/adapters/github/checks.js";
import type { GitHubClient } from "../src/adapters/github/client.js";
import type { PullRequestSnapshot } from "../src/adapters/github/snapshot.js";
import { AI_NOT_RUN } from "../src/adapters/openai/security-review.js";
import type { ReviewReport } from "../src/application/review-pr.js";
import { checkOutput } from "../src/application/review-pr.js";

const snapshot: PullRequestSnapshot = {
  provider: "github",
  installationId: "1",
  repositoryId: "2",
  repositoryOwner: "example",
  repositoryName: "repo",
  pullRequestNumber: 7,
  mergeBaseSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  files: [],
  truncatedFiles: false,
};

const report: ReviewReport = {
  ruleVersion: "0.1.0",
  coverage: {
    state: "complete",
    changedFiles: 1,
    completedFiles: 1,
    incompleteFiles: 0,
    excludedFiles: 0,
    truncatedFiles: false,
    gaps: [],
  },
  findings: [],
  aiReview: AI_NOT_RUN,
};

test("Check publishing rejects stale PR and reuses an existing check", async () => {
  assert.match(checkOutput(report, snapshot.headSha).text, /Review Coverage/);
  let writes = 0;
  const stale = {
    get: async () => ({
      data: { state: "open", base: { sha: snapshot.baseSha }, head: { sha: "d".repeat(40) } },
      headers: new Headers(),
    }),
    post: async () => {
      writes++;
      return { id: 1 };
    },
    patch: async () => {
      writes++;
      return { id: 1 };
    },
  } as unknown as GitHubClient;
  assert.equal(await publishCheck(stale, snapshot, report, true), null);
  assert.equal(writes, 0);

  const existing = {
    get: async (_installation: string, path: string) =>
      path.includes("check-runs?")
        ? {
            data: {
              check_runs: [
                {
                  id: 99,
                  external_id: `reviewbot:${snapshot.repositoryId}:${snapshot.pullRequestNumber}:${snapshot.headSha}`,
                },
              ],
            },
            headers: new Headers(),
          }
        : {
            data: {
              state: "open",
              base: { sha: snapshot.baseSha },
              head: { sha: snapshot.headSha },
            },
            headers: new Headers(),
          },
    post: async () => {
      throw new Error("duplicate Check created");
    },
    patch: async (_installation: string, path: string, body: Record<string, unknown>) => {
      assert.match(path, /\/check-runs\/99$/);
      assert.equal(body.head_sha, snapshot.headSha);
      writes++;
      return { id: 99 };
    },
  } as unknown as GitHubClient;
  assert.equal(await publishCheck(existing, snapshot, report, false), 99);
  assert.equal(writes, 1);
});
