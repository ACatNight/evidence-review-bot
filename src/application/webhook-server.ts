import Fastify from "fastify";
import type { Pool } from "pg";
import { parseGiteeWebhook, verifyGiteeWebhook } from "../adapters/gitee/webhook.js";
import { parsePullRequestWebhook, verifyWebhookSignature } from "../adapters/github/webhook.js";
import { enqueueSnapshot } from "../adapters/postgres/jobs.js";

export function createWebhookServer(
  pool: Pool,
  secret: string,
  gitee?: { readonly secret: string; readonly repositoryId: string },
) {
  if (secret.length < 32) throw new Error("GITHUB_WEBHOOK_SECRET must be at least 32 characters");
  const app = Fastify({ bodyLimit: 1_048_576, logger: false });
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode =
      error instanceof Error && "statusCode" in error ? error.statusCode : undefined;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: "invalid_request" });
    }
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/healthz", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  app.post("/webhooks/github", async (request, reply) => {
    const body = request.body;
    if (!Buffer.isBuffer(body)) return reply.code(415).send({ error: "unsupported_content_type" });
    const signature = request.headers["x-hub-signature-256"];
    if (
      !verifyWebhookSignature(body, typeof signature === "string" ? signature : undefined, secret)
    ) {
      return reply.code(401).send({ error: "invalid_signature" });
    }
    const event = request.headers["x-github-event"];
    const delivery = request.headers["x-github-delivery"];
    const parsed = parsePullRequestWebhook(
      body,
      typeof event === "string" ? event : undefined,
      typeof delivery === "string" ? delivery : undefined,
    );
    if (parsed.kind === "invalid") return reply.code(400).send({ error: "invalid_event" });
    if (parsed.kind === "ignored") return reply.code(202).send({ queued: false });
    try {
      const queued = await enqueueSnapshot(pool, parsed.delivery);
      return reply.code(202).send({ queued });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Conflicting payload for an existing delivery ID"
      ) {
        return reply.code(409).send({ error: "delivery_conflict" });
      }
      throw error;
    }
  });

  if (gitee) {
    if (gitee.secret.length < 32 || !/^\d+$/.test(gitee.repositoryId)) {
      throw new Error("Invalid Gitee Webhook configuration");
    }
    app.post("/webhooks/gitee", async (request, reply) => {
      const body = request.body;
      if (!Buffer.isBuffer(body))
        return reply.code(415).send({ error: "unsupported_content_type" });
      const token = request.headers["x-gitee-token"];
      const timestamp = request.headers["x-gitee-timestamp"];
      if (
        !verifyGiteeWebhook(
          typeof token === "string" ? token : undefined,
          typeof timestamp === "string" ? timestamp : undefined,
          gitee.secret,
        )
      ) {
        return reply.code(401).send({ error: "invalid_signature" });
      }
      const event = request.headers["x-gitee-event"];
      const parsed = parseGiteeWebhook(
        body,
        typeof event === "string" ? event : undefined,
        gitee.repositoryId,
      );
      if (parsed.kind === "invalid") return reply.code(400).send({ error: "invalid_event" });
      if (parsed.kind === "ignored") return reply.code(202).send({ queued: false });
      const queued = await enqueueSnapshot(pool, parsed.delivery);
      return reply.code(202).send({ queued });
    });
  }

  return app;
}
