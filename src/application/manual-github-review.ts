import { createHash, randomUUID } from "node:crypto";
import {
  type GitHubClient,
  githubInteger,
  githubObject,
  githubPullRequest,
  githubRepository,
} from "../adapters/github/client.js";
import type { IncomingDelivery } from "../adapters/postgres/jobs.js";

export async function queueManualGitHubReview(
  client: GitHubClient,
  owner: string,
  name: string,
  number: number,
  enqueue: (delivery: IncomingDelivery) => Promise<boolean>,
): Promise<boolean> {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    throw new Error("Invalid GitHub repository owner or name");
  }
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("Pull request number must be a positive integer");
  }
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const installation = githubObject((await client.getApp(`${path}/installation`)).data);
  const installationId = String(githubInteger(installation.id));
  const repository = githubRepository((await client.get(installationId, path)).data);
  if (
    repository.owner.toLowerCase() !== owner.toLowerCase() ||
    repository.name.toLowerCase() !== name.toLowerCase()
  ) {
    throw new Error("GitHub repository identity mismatch");
  }
  const pr = githubPullRequest((await client.get(installationId, `${path}/pulls/${number}`)).data);
  if (pr.state !== "open" || pr.number !== number) {
    throw new Error("GitHub pull request is not open");
  }
  const deliveryId = `manual-${randomUUID()}`;
  return enqueue({
    provider: "github",
    installationId,
    deliveryId,
    eventType: "manual_review",
    repositoryId: String(repository.id),
    pullRequestId: String(number),
    baseSha: pr.baseSha,
    headSha: pr.headSha,
    payloadDigest: `sha256:${createHash("sha256").update(deliveryId).digest("hex")}`,
  });
}
