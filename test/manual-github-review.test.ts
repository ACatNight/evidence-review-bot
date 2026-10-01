import assert from "node:assert/strict";
import test from "node:test";
import type { GitHubClient } from "../src/adapters/github/client.js";
import type { IncomingDelivery } from "../src/adapters/postgres/jobs.js";
import { queueManualGitHubReview } from "../src/application/manual-github-review.js";

const owner = "ACatNight";
const name = "evidence-review-bot";
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function clientFor(prState = "open", repositoryName = name): GitHubClient {
  return {
    getApp: async (path: string) => {
      assert.equal(path, `/repos/${owner}/${name}/installation`);
      return { data: { id: 123 }, headers: new Headers() };
    },
    get: async (installationId: string, path: string) => {
      assert.equal(installationId, "123");
      if (path === `/repos/${owner}/${name}`) {
        return {
          data: { id: 456, owner: { login: owner }, name: repositoryName },
          headers: new Headers(),
        };
      }
      assert.equal(path, `/repos/${owner}/${name}/pulls/7`);
      return {
        data: { number: 7, state: prState, base: { sha: baseSha }, head: { sha: headSha } },
        headers: new Headers(),
      };
    },
  } as unknown as GitHubClient;
}

test("manual GitHub review verifies installation and queues the current PR", async () => {
  const queued: IncomingDelivery[] = [];
  const result = await queueManualGitHubReview(clientFor(), owner, name, 7, async (delivery) => {
    queued.push(delivery);
    return true;
  });
  assert.equal(result, true);
  const delivery = queued[0];
  assert.ok(delivery);
  assert.equal(delivery.provider, "github");
  assert.equal(delivery.installationId, "123");
  assert.equal(delivery.repositoryId, "456");
  assert.equal(delivery.pullRequestId, "7");
  assert.equal(delivery.baseSha, baseSha);
  assert.equal(delivery.headSha, headSha);
  assert.match(delivery.deliveryId, /^manual-[0-9a-f-]{36}$/);
  assert.match(delivery.payloadDigest, /^sha256:[0-9a-f]{64}$/);
});

test("manual GitHub review rejects wrong repository and closed PR before enqueueing", async () => {
  const enqueue = async () => {
    throw new Error("Unexpected enqueue");
  };
  await assert.rejects(
    queueManualGitHubReview(clientFor("open", "other-repo"), owner, name, 7, enqueue),
    /repository identity mismatch/,
  );
  await assert.rejects(
    queueManualGitHubReview(clientFor("closed"), owner, name, 7, enqueue),
    /not open/,
  );
  await assert.rejects(
    queueManualGitHubReview(clientFor(), owner, name, 0, enqueue),
    /positive integer/,
  );
});
