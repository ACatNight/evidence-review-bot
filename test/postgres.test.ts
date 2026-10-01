import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { getQueueStatus } from "../src/adapters/postgres/inspection.js";
import {
  claimJobs,
  completeJob,
  enqueueSnapshot,
  failJob,
  renewLease,
} from "../src/adapters/postgres/jobs.js";
import { migrate } from "../src/adapters/postgres/migrate.js";

const connectionString = process.env.TEST_DATABASE_URL;

test("PostgreSQL delivery deduplication, lease fencing and retry", {
  skip: !connectionString,
}, async () => {
  if (!connectionString) return;
  const pool = new Pool({ connectionString, max: 4 });
  try {
    const database = await pool.query<{ current_database: string }>("SELECT current_database()");
    assert.equal(database.rows[0]?.current_database, "evidence_review_bot_test");
    await migrate(pool);
    await migrate(pool);
    await pool.query(
      "TRUNCATE review_bot.review_report, review_bot.audit_event, review_bot.review_job, review_bot.webhook_delivery RESTART IDENTITY",
    );

    const event = {
      provider: "github",
      installationId: "installation-1",
      deliveryId: "delivery-1",
      eventType: "pull_request",
      repositoryId: "repo-1",
      pullRequestId: "42",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      payloadDigest: "sha256:sample",
    };
    assert.equal(await enqueueSnapshot(pool, event), true);
    assert.equal(await enqueueSnapshot(pool, event), false);
    await assert.rejects(
      enqueueSnapshot(pool, { ...event, payloadDigest: "sha256:different" }),
      /Conflicting payload/,
    );

    const first = await claimJobs(pool, "worker-a", 1, 100);
    assert.equal(first.length, 1);
    const initial = first[0];
    assert.ok(initial);
    assert.equal(initial.kind, "snapshot");
    assert.equal((await claimJobs(pool, "worker-b", 1, 100)).length, 0);
    await delay(160);

    const second = await claimJobs(pool, "worker-b", 1, 1000);
    assert.equal(second.length, 1);
    const reclaimed = second[0];
    assert.ok(reclaimed);
    assert.equal(reclaimed.id, initial.id);
    assert.equal(reclaimed.leaseGeneration, 2);
    assert.equal(await renewLease(pool, initial, "worker-a", 1000), false);
    assert.equal(await completeJob(pool, initial, "worker-a"), false);
    assert.equal(await failJob(pool, reclaimed, "worker-b", "temporary_error", 0), "retrying");

    const third = await claimJobs(pool, "worker-c", 1, 1000);
    const retried = third[0];
    assert.ok(retried);
    assert.equal(retried.attempts, 3);
    assert.equal(await completeJob(pool, retried, "worker-c"), true);
    assert.equal(await completeJob(pool, retried, "worker-c"), false);
    assert.equal((await claimJobs(pool, "worker-d", 1, 1000)).length, 0);

    await enqueueSnapshot(pool, { ...event, deliveryId: "delivery-2" });
    await enqueueSnapshot(pool, { ...event, deliveryId: "delivery-3" });
    const [left, right] = await Promise.all([
      claimJobs(pool, "worker-left", 1, 1000),
      claimJobs(pool, "worker-right", 1, 1000),
    ]);
    assert.equal(left.length, 1);
    assert.equal(right.length, 1);
    assert.notEqual(left[0]?.id, right[0]?.id);
    assert.ok(left[0]);
    assert.ok(right[0]);
    assert.equal(await completeJob(pool, left[0], "worker-left"), true);
    assert.equal(await completeJob(pool, right[0], "worker-right"), true);

    await enqueueSnapshot(pool, { ...event, deliveryId: "delivery-4" });
    await pool.query(
      `UPDATE review_bot.review_job SET max_attempts = 1
       WHERE delivery_id = (SELECT id FROM review_bot.webhook_delivery WHERE delivery_id = 'delivery-4')`,
    );
    const exhausted = await claimJobs(pool, "worker-expiring", 1, 100);
    assert.equal(exhausted.length, 1);
    await delay(160);
    assert.equal((await claimJobs(pool, "worker-after-expiry", 1, 1000)).length, 0);
    const exhaustedState = await pool.query<{ state: string; last_error_code: string }>(
      `SELECT state, last_error_code FROM review_bot.review_job
       WHERE delivery_id = (SELECT id FROM review_bot.webhook_delivery WHERE delivery_id = 'delivery-4')`,
    );
    assert.deepEqual(exhaustedState.rows[0], {
      state: "failed",
      last_error_code: "attempts_exhausted",
    });

    const counts = await pool.query<{ deliveries: string; jobs: string; audits: string }>(
      `SELECT (SELECT count(*) FROM review_bot.webhook_delivery) AS deliveries,
              (SELECT count(*) FROM review_bot.review_job) AS jobs,
              (SELECT count(*) FROM review_bot.audit_event) AS audits`,
    );
    assert.equal(Number(counts.rows[0]?.deliveries), 4);
    assert.equal(Number(counts.rows[0]?.jobs), 4);
    assert.ok(Number(counts.rows[0]?.audits) >= 10);

    const status = await getQueueStatus(pool);
    assert.deepEqual(status.jobsByState, { completed: 3, failed: 1 });
    assert.equal(status.recentDeliveries.length, 4);
    const failedDelivery = status.recentDeliveries.find((row) => row.deliveryId === "delivery-4");
    assert.equal(failedDelivery?.jobState, "failed");
    assert.equal(failedDelivery?.lastErrorCode, "attempts_exhausted");
    assert.equal(failedDelivery?.publicationState, null);
  } finally {
    await pool.end();
  }
});
