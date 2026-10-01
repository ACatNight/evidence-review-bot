import type { Pool } from "pg";
import type { ReviewReport } from "../../application/review-pr.js";
import type { PullRequestSnapshot, SnapshotTarget } from "../github/snapshot.js";
import type { ClaimedJob } from "./jobs.js";
import { transaction } from "./transaction.js";

export type PublicationState = "pending" | "publishing" | "published" | "uncertain" | "superseded";

export interface StoredReport {
  readonly report: ReviewReport;
  readonly state: PublicationState;
  readonly checkRunId: string | null;
}

export async function snapshotTarget(pool: Pool, job: ClaimedJob): Promise<SnapshotTarget> {
  const result = await pool.query<{
    provider: SnapshotTarget["provider"];
    installation_id: string;
    repository_id: string;
    pull_request_id: string;
    base_sha: string | null;
    head_sha: string | null;
  }>(
    `SELECT delivery.provider, delivery.installation_id, delivery.repository_id, delivery.pull_request_id,
            delivery.base_sha, delivery.head_sha
     FROM review_bot.review_job AS job
     JOIN review_bot.webhook_delivery AS delivery ON delivery.id = job.delivery_id
     WHERE job.id = $1 AND job.kind = 'snapshot'`,
    [job.id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Snapshot job has no delivery");
  return {
    provider: row.provider,
    installationId: row.installation_id,
    repositoryId: row.repository_id,
    pullRequestNumber: Number(row.pull_request_id),
    expectedBaseSha: row.base_sha,
    expectedHeadSha: row.head_sha,
  };
}

export async function saveReport(
  pool: Pool,
  job: ClaimedJob,
  workerId: string,
  snapshot: PullRequestSnapshot,
  report: ReviewReport,
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO review_bot.review_report
       (job_id, installation_id, repository_id, pull_request_id, merge_base_sha,
        base_sha, head_sha, rule_version, coverage, findings, ai_review)
     SELECT job.id, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb
     FROM review_bot.review_job AS job
     WHERE job.id = $1 AND job.lease_owner = $2 AND job.lease_generation = $3
       AND job.state = 'running' AND job.lease_until > clock_timestamp()
     ON CONFLICT (job_id) DO NOTHING`,
    [
      job.id,
      workerId,
      job.leaseGeneration,
      snapshot.installationId,
      snapshot.repositoryId,
      String(snapshot.pullRequestNumber),
      snapshot.mergeBaseSha,
      snapshot.baseSha,
      snapshot.headSha,
      report.ruleVersion,
      JSON.stringify(report.coverage),
      JSON.stringify(report.findings),
      JSON.stringify(report.aiReview),
    ],
  );
  return result.rowCount === 1;
}

export async function getReport(pool: Pool, jobId: string): Promise<StoredReport | null> {
  const result = await pool.query<{
    rule_version: string;
    coverage: ReviewReport["coverage"];
    findings: ReviewReport["findings"];
    ai_review: ReviewReport["aiReview"];
    publication_state: PublicationState;
    check_run_id: string | null;
  }>(
    `SELECT rule_version, coverage, findings, ai_review, publication_state, check_run_id
     FROM review_bot.review_report WHERE job_id = $1`,
    [jobId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    report: {
      ruleVersion: row.rule_version,
      coverage: row.coverage,
      findings: row.findings,
      aiReview: row.ai_review,
    },
    state: row.publication_state,
    checkRunId: row.check_run_id,
  };
}

export async function transitionReport(
  pool: Pool,
  job: ClaimedJob,
  workerId: string,
  from: PublicationState,
  to: PublicationState,
  checkRunId?: string,
): Promise<boolean> {
  return transaction(pool, async (database) => {
    const result = await database.query(
      `UPDATE review_bot.review_report AS report
       SET publication_state = $5, check_run_id = COALESCE($6::bigint, report.check_run_id),
           updated_at = clock_timestamp()
       FROM review_bot.review_job AS job
       WHERE report.job_id = job.id AND job.id = $1 AND job.lease_owner = $2
         AND job.lease_generation = $3 AND job.state = 'running'
         AND job.lease_until > clock_timestamp() AND report.publication_state = $4`,
      [job.id, workerId, job.leaseGeneration, from, to, checkRunId ?? null],
    );
    if (result.rowCount !== 1) return false;
    await database.query(
      `INSERT INTO review_bot.audit_event (delivery_id, job_id, action, redacted_metadata)
       SELECT delivery_id, id, 'report_state_changed', $2::jsonb
       FROM review_bot.review_job WHERE id = $1`,
      [job.id, JSON.stringify({ from, to, checkRunId: checkRunId ?? null })],
    );
    return true;
  });
}
