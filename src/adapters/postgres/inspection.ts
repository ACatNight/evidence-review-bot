import type { Pool } from "pg";

export interface QueueStatus {
  readonly jobsByState: Record<string, number>;
  readonly recentDeliveries: readonly {
    readonly deliveryId: string;
    readonly repositoryId: string;
    readonly pullRequestId: string;
    readonly receivedAt: Date;
    readonly jobState: string | null;
    readonly lastErrorCode: string | null;
  }[];
}

export async function getQueueStatus(pool: Pool): Promise<QueueStatus> {
  const [counts, deliveries] = await Promise.all([
    pool.query<{ state: string; count: string }>(
      `SELECT state, count(*)::text AS count
       FROM review_bot.review_job GROUP BY state ORDER BY state`,
    ),
    pool.query<{
      delivery_id: string;
      repository_id: string;
      pull_request_id: string;
      received_at: Date;
      job_state: string | null;
      last_error_code: string | null;
    }>(
      `SELECT delivery.delivery_id, delivery.repository_id, delivery.pull_request_id,
              delivery.received_at, job.state AS job_state, job.last_error_code
       FROM review_bot.webhook_delivery AS delivery
       LEFT JOIN review_bot.review_job AS job ON job.delivery_id = delivery.id
       ORDER BY delivery.received_at DESC, delivery.id DESC
       LIMIT 10`,
    ),
  ]);
  return {
    jobsByState: Object.fromEntries(counts.rows.map((row) => [row.state, Number(row.count)])),
    recentDeliveries: deliveries.rows.map((row) => ({
      deliveryId: row.delivery_id,
      repositoryId: row.repository_id,
      pullRequestId: row.pull_request_id,
      receivedAt: row.received_at,
      jobState: row.job_state,
      lastErrorCode: row.last_error_code,
    })),
  };
}
