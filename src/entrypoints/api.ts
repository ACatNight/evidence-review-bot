import { Pool } from "pg";
import { createWebhookServer } from "../application/webhook-server.js";

const connectionString = process.env.DATABASE_URL;
const secret = process.env.GITHUB_WEBHOOK_SECRET;
const giteeSecret = process.env.GITEE_WEBHOOK_SECRET;
const giteeRepositoryId = process.env.GITEE_REPOSITORY_ID;
if (!connectionString || !secret)
  throw new Error("DATABASE_URL and GITHUB_WEBHOOK_SECRET are required");

const port = Number(process.env.PORT ?? "3000");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be 1-65535");
const host = process.env.HOST ?? "127.0.0.1";
const pool = new Pool({ connectionString });
if ((giteeSecret && !giteeRepositoryId) || (!giteeSecret && giteeRepositoryId)) {
  throw new Error("GITEE_WEBHOOK_SECRET and GITEE_REPOSITORY_ID must be set together");
}
const app = createWebhookServer(
  pool,
  secret,
  giteeSecret && giteeRepositoryId
    ? { secret: giteeSecret, repositoryId: giteeRepositoryId }
    : undefined,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().finally(() => pool.end());
  });
}

try {
  await app.listen({ host, port });
  process.stdout.write(`Webhook API listening on ${host}:${port}\n`);
} catch (error) {
  await pool.end();
  throw error;
}
