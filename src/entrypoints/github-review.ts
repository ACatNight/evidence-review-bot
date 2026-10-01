import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { GitHubClient } from "../adapters/github/client.js";
import { enqueueSnapshot } from "../adapters/postgres/jobs.js";
import { queueManualGitHubReview } from "../application/manual-github-review.js";

const databaseUrl = process.env.DATABASE_URL;
const appId = process.env.GITHUB_APP_ID;
const privateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
const [owner, name, numberText] = process.argv.slice(2);
if (!databaseUrl || !appId || !privateKeyPath || !/^\d+$/.test(appId)) {
  throw new Error("DATABASE_URL, GITHUB_APP_ID and GITHUB_PRIVATE_KEY_PATH are required");
}
if (!owner || !name || !numberText || process.argv.length !== 5) {
  throw new Error("Usage: npm run github:review -- <owner> <repository> <PR number>");
}
const number = Number(numberText);
const client = new GitHubClient(appId, await readFile(privateKeyPath, "utf8"));
const pool = new Pool({ connectionString: databaseUrl });
try {
  const queued = await queueManualGitHubReview(client, owner, name, number, (delivery) =>
    enqueueSnapshot(pool, delivery),
  );
  process.stdout.write(`GitHub ${owner}/${name} PR #${number} queued: ${queued}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "GitHub review failed"}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
