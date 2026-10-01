import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { GitHubClient } from "../adapters/github/client.js";
import { runOneJob } from "../application/worker.js";

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
const pool = new Pool({ connectionString });
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
  });
}
try {
  do {
    const worked = await runOneJob(pool, client, Buffer.from(hmacHex, "hex"));
    if (process.argv.includes("--once")) break;
    if (!worked) await delay(3_000);
  } while (!stopping);
} finally {
  await pool.end();
}
