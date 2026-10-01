import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GiteeClient, giteeInteger, giteeObject, giteeString } from "../adapters/gitee/client.js";
import { parseGiteeWorkerRepositories } from "../adapters/gitee/config.js";
import { enqueueSnapshot } from "../adapters/postgres/jobs.js";

const databaseUrl = process.env.DATABASE_URL;
const [owner, name, numberText] = process.argv.slice(2);
if (!databaseUrl || !owner || !name || !numberText || process.argv.length !== 5)
  throw new Error("Usage: npm run gitee:review -- <owner> <repository> <PR number>");
const number = Number(numberText);
if (!Number.isSafeInteger(number) || number < 1)
  throw new Error("PR number must be a positive integer");
const configured = parseGiteeWorkerRepositories(process.env.GITEE_REPOSITORIES_JSON).find(
  (item) =>
    item.owner.toLowerCase() === owner.toLowerCase() &&
    item.name.toLowerCase() === name.toLowerCase(),
);
if (!configured) throw new Error("Gitee repository is not configured");
const repositoryId = configured.id;

const client = new GiteeClient(configured.token);
const repository = giteeObject(
  (await client.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`)).data,
);
if (String(giteeInteger(repository.id)) !== repositoryId) {
  throw new Error("Gitee repository identity mismatch");
}
const pr = giteeObject(
  (
    await client.get(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}`,
    )
  ).data,
);
if (pr.state !== "open" || giteeInteger(pr.number) !== number) {
  throw new Error("Gitee PR is not open");
}
const baseSha = giteeString(giteeObject(pr.base).sha);
const headSha = giteeString(giteeObject(pr.head).sha);
const deliveryId = `manual-${randomUUID()}`;
const pool = new Pool({ connectionString: databaseUrl });
try {
  const queued = await enqueueSnapshot(pool, {
    provider: "gitee",
    installationId: `gitee:${repositoryId}`,
    deliveryId,
    eventType: "manual_review",
    repositoryId,
    pullRequestId: String(number),
    baseSha,
    headSha,
    payloadDigest: `sha256:${createHash("sha256").update(deliveryId).digest("hex")}`,
  });
  process.stdout.write(`Gitee PR #${number} queued: ${queued}\n`);
} finally {
  await pool.end();
}
