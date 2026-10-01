import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { GiteeClient } from "../adapters/gitee/client.js";
import { parseGiteeWorkerRepositories } from "../adapters/gitee/config.js";
import { GitHubClient } from "../adapters/github/client.js";
import type { AiReviewConfig } from "../adapters/openai/security-review.js";
import { type GiteeWorkerConfig, runOneJob } from "../application/worker.js";

const connectionString = process.env.DATABASE_URL;
const appId = process.env.GITHUB_APP_ID;
const privateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH;
const hmacHex = process.env.REVIEW_HMAC_KEY;
if (!connectionString || !appId || !privateKeyPath || !hmacHex) {
  throw new Error(
    "DATABASE_URL, GITHUB_APP_ID, GITHUB_PRIVATE_KEY_PATH and REVIEW_HMAC_KEY are required",
  );
}
if (!/^\d+$/.test(appId) || !/^[a-f0-9]{64,}$/i.test(hmacHex) || hmacHex.length % 2 !== 0) {
  throw new Error("Invalid GitHub App ID or review HMAC key");
}

const privateKey = await readFile(privateKeyPath, "utf8");
const client = new GitHubClient(appId, privateKey);
const gitee = new Map<string, GiteeWorkerConfig>();
for (const repository of parseGiteeWorkerRepositories(process.env.GITEE_REPOSITORIES_JSON)) {
  gitee.set(repository.id, {
    client: new GiteeClient(repository.token),
    repository: { owner: repository.owner, name: repository.name, id: repository.id },
  });
}
let aiConfig: AiReviewConfig | null = null;
if (process.env.OPENAI_REVIEW_ENABLED === "true") {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  const baseURL = process.env.OPENAI_BASE_URL;
  const repositories = process.env.OPENAI_ALLOWED_REPOSITORIES;
  if (!apiKey || !model || !repositories) {
    throw new Error(
      "OPENAI_API_KEY, OPENAI_MODEL and OPENAI_ALLOWED_REPOSITORIES are required when AI review is enabled",
    );
  }
  const allowedRepositoryIds = new Set(repositories.split(",").map((value) => value.trim()));
  if ([...allowedRepositoryIds].some((value) => !/^\d+$/.test(value))) {
    throw new Error("OPENAI_ALLOWED_REPOSITORIES must contain numeric GitHub repository IDs");
  }
  if (baseURL) {
    let url: URL;
    try {
      url = new URL(baseURL);
    } catch {
      throw new Error("OPENAI_BASE_URL must be a valid HTTPS URL");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error(
        "OPENAI_BASE_URL must be an HTTPS URL without credentials, query or fragment",
      );
    }
  }
  aiConfig = { apiKey, model, ...(baseURL ? { baseURL } : {}), allowedRepositoryIds };
}
const pool = new Pool({ connectionString });
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}
try {
  do {
    const worked = await runOneJob(pool, client, Buffer.from(hmacHex, "hex"), aiConfig, gitee);
    if (process.argv.includes("--once")) break;
    if (!worked) await delay(3_000);
  } while (!stopping);
} finally {
  await pool.end();
}
