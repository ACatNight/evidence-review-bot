import { checkOutput, type ReviewReport } from "../../application/review-pr.js";
import { type GitHubClient, githubInteger, githubObject } from "./client.js";
import type { PullRequestSnapshot } from "./snapshot.js";

const CHECK_NAME = "Evidence Review Bot / SEC-001";

function checkKey(snapshot: PullRequestSnapshot): string {
  return `reviewbot:${snapshot.repositoryId}:${snapshot.pullRequestNumber}:${snapshot.headSha}`;
}

async function existingCheck(
  client: GitHubClient,
  snapshot: PullRequestSnapshot,
): Promise<number | null> {
  const repository = `${encodeURIComponent(snapshot.repositoryOwner)}/${encodeURIComponent(snapshot.repositoryName)}`;
  const response = await client.get(
    snapshot.installationId,
    `/repos/${repository}/commits/${snapshot.headSha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&per_page=100`,
  );
  const data = githubObject(response.data);
  if (!Array.isArray(data.check_runs)) throw new Error("Unexpected check runs response");
  for (const entry of data.check_runs) {
    const check = githubObject(entry);
    if (check.external_id === checkKey(snapshot)) return githubInteger(check.id);
  }
  if (/rel="next"/.test(response.headers.get("link") ?? "")) {
    throw new Error("Check run lookup was truncated");
  }
  return null;
}

export async function publishCheck(
  client: GitHubClient,
  snapshot: PullRequestSnapshot,
  report: ReviewReport,
  allowCreate: boolean,
): Promise<number | null> {
  const repository = `${encodeURIComponent(snapshot.repositoryOwner)}/${encodeURIComponent(snapshot.repositoryName)}`;
  const current = await client.get(
    snapshot.installationId,
    `/repos/${repository}/pulls/${snapshot.pullRequestNumber}`,
  );
  const pr = githubObject(current.data);
  if (
    pr.state !== "open" ||
    githubObject(pr.base).sha !== snapshot.baseSha ||
    githubObject(pr.head).sha !== snapshot.headSha
  ) {
    return null;
  }
  const prior = await existingCheck(client, snapshot);
  const output = checkOutput(report, snapshot.headSha);
  const body = {
    name: CHECK_NAME,
    head_sha: snapshot.headSha,
    status: "completed",
    conclusion: "neutral",
    external_id: checkKey(snapshot),
    output,
  };
  if (prior !== null) {
    const updated = githubObject(
      await client.patch(snapshot.installationId, `/repos/${repository}/check-runs/${prior}`, body),
    );
    return githubInteger(updated.id);
  }
  if (!allowCreate) throw new Error("Check publication outcome is uncertain");
  const created = githubObject(
    await client.post(snapshot.installationId, `/repos/${repository}/check-runs`, body),
  );
  return githubInteger(created.id);
}
