import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { parsePullRequestWebhook, verifyWebhookSignature } from "../src/adapters/github/webhook.js";
import { migrate } from "../src/adapters/postgres/migrate.js";
import { createWebhookServer } from "../src/application/webhook-server.js";

const secret = "synthetic-test-secret-at-least-32-characters";
const payload = Buffer.from(
  JSON.stringify({
    action: "opened",
    installation: { id: 10 },
    repository: { id: 20 },
    pull_request: {
      number: 42,
      state: "open",
      base: { sha: "a".repeat(40) },
      head: { sha: "b".repeat(40) },
    },
  }),
);

function signature(body: Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

test("signature checks raw bytes and rejects malformed digest", () => {
  assert.equal(verifyWebhookSignature(payload, signature(payload), secret), true);
  assert.equal(
    verifyWebhookSignature(Buffer.concat([payload, Buffer.from(" ")]), signature(payload), secret),
    false,
  );
  assert.equal(verifyWebhookSignature(payload, "sha256=broken", secret), false);
});

test("normalizes only actionable open PR events", () => {
  const parsed = parsePullRequestWebhook(payload, "pull_request", "delivery-1");
  assert.equal(parsed.kind, "review");
  if (parsed.kind === "review") {
    assert.equal(parsed.delivery.repositoryId, "20");
    assert.equal(parsed.delivery.pullRequestId, "42");
  }
  assert.equal(parsePullRequestWebhook(payload, "issues", "delivery-1").kind, "ignored");
  assert.equal(parsePullRequestWebhook(payload, "pull_request", "bad id").kind, "invalid");
  assert.equal(
    parsePullRequestWebhook(Buffer.from("{"), "pull_request", "delivery-1").kind,
    "invalid",
  );
});

const connectionString = process.env.TEST_DATABASE_URL;
test("webhook API verifies before enqueuing and deduplicates delivery", {
  skip: !connectionString,
}, async () => {
  if (!connectionString) return;
  const pool = new Pool({ connectionString });
  const app = createWebhookServer(pool, secret);
  try {
    const database = await pool.query<{ current_database: string }>("SELECT current_database()");
    assert.equal(database.rows[0]?.current_database, "evidence_review_bot_test");
    await migrate(pool);
    await pool.query(
      "TRUNCATE review_bot.audit_event, review_bot.review_job, review_bot.webhook_delivery RESTART IDENTITY",
    );
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": signature(payload),
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-1",
    };
    const rejected = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: {
        ...headers,
        "x-hub-signature-256": "sha256=bad",
      },
      payload,
    });
    assert.equal(rejected.statusCode, 401);
    const accepted = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers,
      payload,
    });
    assert.equal(accepted.statusCode, 202);
    assert.deepEqual(accepted.json(), { queued: true });
    const repeated = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers,
      payload,
    });
    assert.deepEqual(repeated.json(), { queued: false });
    const conflicting = Buffer.from(
      JSON.stringify({
        ...JSON.parse(payload.toString("utf8")),
        action: "synchronize",
      }),
    );
    const conflict = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: { ...headers, "x-hub-signature-256": signature(conflicting) },
      payload: conflicting,
    });
    assert.equal(conflict.statusCode, 409);
    const health = await app.inject({ method: "GET", url: "/healthz" });
    assert.deepEqual(health.json(), { status: "ok" });
    const count = await pool.query<{ count: string }>("SELECT count(*) FROM review_bot.review_job");
    assert.equal(Number(count.rows[0]?.count), 1);
  } finally {
    await app.close();
    await pool.end();
  }
});
