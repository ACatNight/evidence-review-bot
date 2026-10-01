import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { GiteeClient, giteeInteger, giteeObject, giteeString } from "../adapters/gitee/client.js";
import { enqueueSnapshot } from "../adapters/postgres/jobs.js";

const databaseUrl = process.env.DATABASE_URL;
const token = process.env.GITEE_API_TOKEN;
const owner = process.env.GITEE_OWNER;
const name = process.env.GITEE_REPO;
const repositoryId = process.env.GITEE_REPOSITORY_ID;
const number = Number(process.argv[2]);
if (!databaseUrl || !token || !owner || !name || !repositoryId) {
  throw new Error("DATABASE_URL and Gitee worker configuration are required");
}
if (!/^\d+$/.test(repositoryId) || !Number.isSafeInteger(number) || number < 1) {
  throw new Error("Gitee repository ID and PR number must be positive integers");
}

const client = new GiteeClient(token);
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
    installationId: "gitee:personal",
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
