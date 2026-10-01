import type { Pool } from "pg";
import { transaction } from "./transaction.js";

export interface IncomingDelivery {
  readonly provider: string;
  readonly installationId: string;
  readonly deliveryId: string;
  readonly eventType: string;
  readonly repositoryId: string;
  readonly pullRequestId: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly payloadDigest: string;
}

export interface ClaimedJob {
  readonly id: string;
  readonly kind: "snapshot" | "analysis";
  readonly deliveryId: string | null;
  readonly runId: string | null;
  readonly repositoryId: string;
  readonly pullRequestId: string;
  readonly attempts: number;
  readonly leaseGeneration: number;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
    throw new Error(`${name} must be a positive integer`);
}

export async function enqueueSnapshot(pool: Pool, delivery: IncomingDelivery): Promise<boolean> {
  for (const value of Object.values(delivery)) {
    if (!value) throw new Error("Delivery fields must be nonempty");
  }
  return transaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO review_bot.webhook_delivery
         (provider, installation_id, delivery_id, event_type, repository_id, pull_request_id,
          base_sha, head_sha, payload_digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (provider, installation_id, delivery_id) DO NOTHING
       RETURNING id`,
      [
        delivery.provider,
        delivery.installationId,
        delivery.deliveryId,
        delivery.eventType,
        delivery.repositoryId,
        delivery.pullRequestId,
        delivery.baseSha,
        delivery.headSha,
        delivery.payloadDigest,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      const existing = await client.query<{
        payload_digest: string;
        event_type: string;
        repository_id: string;
        pull_request_id: string;
        base_sha: string | null;
        head_sha: string | null;
      }>(
        `SELECT payload_digest, event_type, repository_id, pull_request_id, base_sha, head_sha
         FROM review_bot.webhook_delivery
         WHERE provider = $1 AND installation_id = $2 AND delivery_id = $3`,
        [delivery.provider, delivery.installationId, delivery.deliveryId],
      );
      const prior = existing.rows[0];
      if (
        !prior ||
        prior.payload_digest !== delivery.payloadDigest ||
        prior.event_type !== delivery.eventType ||
        prior.repository_id !== delivery.repositoryId ||
        prior.pull_request_id !== delivery.pullRequestId ||
        (prior.base_sha !== null && prior.base_sha !== delivery.baseSha) ||
        (prior.head_sha !== null && prior.head_sha !== delivery.headSha)
      ) {
        throw new Error("Conflicting payload for an existing delivery ID");
      }
      return false;
    }
    const job = await client.query<{ id: string }>(
      `INSERT INTO review_bot.review_job
         (kind, delivery_id, repository_id, pull_request_id)
       VALUES ('snapshot', $1, $2, $3)
       RETURNING id`,
      [id, delivery.repositoryId, delivery.pullRequestId],
    );
    await client.query(
      `INSERT INTO review_bot.audit_event (delivery_id, job_id, action, redacted_metadata)
       VALUES ($1, $2, 'snapshot_queued', $3::jsonb)`,
      [id, job.rows[0]?.id, JSON.stringify({ eventType: delivery.eventType })],
    );
    return true;
  });
}

export async function claimJobs(
  pool: Pool,
  workerId: string,
  limit: number,
  leaseMs: number,
): Promise<ClaimedJob[]> {
  if (!workerId) throw new Error("workerId must be nonempty");
  positiveInteger(limit, "limit");
  positiveInteger(leaseMs, "leaseMs");
  return transaction(pool, async (client) => {
    const exhausted = await client.query<{ id: string; delivery_id: string | null }>(
      `UPDATE review_bot.review_job
       SET state = 'failed', lease_owner = NULL, lease_until = NULL,
           last_error_code = 'attempts_exhausted', updated_at = clock_timestamp()
       WHERE state = 'running' AND lease_until < clock_timestamp()
         AND attempts >= max_attempts
       RETURNING id, delivery_id`,
    );
    for (const row of exhausted.rows) {
      await client.query(
        `INSERT INTO review_bot.audit_event (delivery_id, job_id, action, redacted_metadata)
         VALUES ($1, $2, 'job_failed', '{"errorCode":"attempts_exhausted"}'::jsonb)`,
        [row.delivery_id, row.id],
      );
    }
    const result = await client.query<{
      id: string;
      kind: ClaimedJob["kind"];
      delivery_id: string | null;
      run_id: string | null;
      repository_id: string;
      pull_request_id: string;
      attempts: number;
      lease_generation: string;
    }>(
      `WITH eligible AS (
         SELECT id FROM review_bot.review_job
         WHERE ((state IN ('queued', 'retrying') AND available_at <= clock_timestamp())
             OR (state = 'running' AND lease_until < clock_timestamp()))
           AND attempts < max_attempts
         ORDER BY priority DESC, available_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE review_bot.review_job AS job
       SET state = 'running', attempts = attempts + 1,
           lease_owner = $2, lease_until = clock_timestamp() + $3::integer * interval '1 millisecond',
           lease_generation = lease_generation + 1, updated_at = clock_timestamp()
       FROM eligible WHERE job.id = eligible.id
       RETURNING job.id, job.kind, job.delivery_id, job.run_id, job.repository_id,
                 job.pull_request_id, job.attempts, job.lease_generation`,
      [limit, workerId, leaseMs],
    );
    for (const row of result.rows) {
      await client.query(
        `INSERT INTO review_bot.audit_event (delivery_id, job_id, action, redacted_metadata)
         VALUES ($1, $2, 'job_claimed', $3::jsonb)`,
        [row.delivery_id, row.id, JSON.stringify({ workerId, generation: row.lease_generation })],
      );
    }
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      deliveryId: row.delivery_id,
      runId: row.run_id,
      repositoryId: row.repository_id,
      pullRequestId: row.pull_request_id,
      attempts: row.attempts,
      leaseGeneration: Number(row.lease_generation),
    }));
  });
}

export async function renewLease(
  pool: Pool,
  job: ClaimedJob,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  positiveInteger(leaseMs, "leaseMs");
  const result = await pool.query(
    `UPDATE review_bot.review_job
     SET lease_until = clock_timestamp() + $4::integer * interval '1 millisecond',
         updated_at = clock_timestamp()
     WHERE id = $1 AND lease_owner = $2 AND lease_generation = $3
       AND state = 'running' AND lease_until > clock_timestamp()`,
    [job.id, workerId, job.leaseGeneration, leaseMs],
  );
  return result.rowCount === 1;
}

export async function completeJob(pool: Pool, job: ClaimedJob, workerId: string): Promise<boolean> {
  return transaction(pool, async (client) => {
    const result = await client.query<{ delivery_id: string | null }>(
      `UPDATE review_bot.review_job
       SET state = 'completed', lease_owner = NULL, lease_until = NULL,
           updated_at = clock_timestamp()
       WHERE id = $1 AND lease_owner = $2 AND lease_generation = $3
         AND state = 'running' AND lease_until > clock_timestamp()
       RETURNING delivery_id`,
      [job.id, workerId, job.leaseGeneration],
    );
    if (result.rowCount !== 1) return false;
    await client.query(
      `INSERT INTO review_bot.audit_event (delivery_id, job_id, action)
       VALUES ($1, $2, 'job_completed')`,
      [result.rows[0]?.delivery_id, job.id],
    );
    return true;
  });
}

export async function failJob(
  pool: Pool,
  job: ClaimedJob,
  workerId: string,
  errorCode: string,
  delayMs: number,
): Promise<"retrying" | "failed" | "stale"> {
  if (!errorCode || !/^[a-z0-9_]{1,64}$/.test(errorCode)) {
    throw new Error("errorCode must be a short machine-readable code");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 2_147_483_647)
    throw new Error("delayMs must be a nonnegative 32-bit integer");
  return transaction(pool, async (client) => {
    const result = await client.query<{ state: "retrying" | "failed"; delivery_id: string | null }>(
      `UPDATE review_bot.review_job
       SET state = CASE WHEN attempts < max_attempts THEN 'retrying' ELSE 'failed' END,
           available_at = clock_timestamp() + $5::integer * interval '1 millisecond',
           lease_owner = NULL, lease_until = NULL, last_error_code = $4,
           updated_at = clock_timestamp()
       WHERE id = $1 AND lease_owner = $2 AND lease_generation = $3
         AND state = 'running' AND lease_until > clock_timestamp()
       RETURNING state, delivery_id`,
      [job.id, workerId, job.leaseGeneration, errorCode, delayMs],
    );
    const row = result.rows[0];
    if (!row) return "stale";
    await client.query(
      `INSERT INTO review_bot.audit_event (delivery_id, job_id, action, redacted_metadata)
       VALUES ($1, $2, 'job_failed', $3::jsonb)`,
      [row.delivery_id, job.id, JSON.stringify({ errorCode, nextState: row.state })],
    );
    return row.state;
  });
}
