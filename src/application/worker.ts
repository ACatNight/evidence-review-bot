import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { GiteeApiError, type GiteeClient } from "../adapters/gitee/client.js";
import { publishGiteeReport } from "../adapters/gitee/publish.js";
import { fetchGiteeSnapshot, type GiteeRepository } from "../adapters/gitee/snapshot.js";
import { publishCheck } from "../adapters/github/checks.js";
import { GitHubApiError, type GitHubClient } from "../adapters/github/client.js";
import { fetchSnapshot } from "../adapters/github/snapshot.js";
import { type AiReviewConfig, reviewWithOpenAI } from "../adapters/openai/security-review.js";
import {
  type ClaimedJob,
  claimJobs,
  completeJob,
  failJob,
  renewLease,
} from "../adapters/postgres/jobs.js";
import {
  getReport,
  saveReport,
  snapshotTarget,
  transitionReport,
} from "../adapters/postgres/reports.js";
import { reviewSnapshot } from "./review-pr.js";

const LEASE_MS = 120_000;

export interface GiteeWorkerConfig {
  readonly client: GiteeClient;
  readonly repository: GiteeRepository;
}

function failureCode(error: unknown): string {
  if (error instanceof GitHubApiError)
    return error.retryable ? "github_temporary" : "github_rejected";
  if (error instanceof GiteeApiError) return error.retryable ? "gitee_temporary" : "gitee_rejected";
  if (error instanceof Error && error.name === "TimeoutError") return "github_timeout";
  return "worker_error";
}

async function processJob(
  pool: Pool,
  client: GitHubClient,
  masterHmacKey: Buffer,
  aiConfig: AiReviewConfig | null,
  gitee: GiteeWorkerConfig | null,
  job: ClaimedJob,
  workerId: string,
): Promise<void> {
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void renewLease(pool, job, workerId, LEASE_MS)
      .then((renewed) => {
        if (!renewed) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 30_000);
  try {
    if (job.kind !== "snapshot") throw new Error("Unsupported job kind");
    const target = await snapshotTarget(pool, job);
    if (target.provider === "gitee" && !gitee) throw new Error("Gitee worker is not configured");
    const snapshot =
      target.provider === "gitee" && gitee
        ? await fetchGiteeSnapshot(gitee.client, gitee.repository, target)
        : await fetchSnapshot(client, target);
    if (leaseLost) return;
    if (!snapshot) {
      await completeJob(pool, job, workerId);
      return;
    }
    let stored = await getReport(pool, job.id);
    if (!stored) {
      const deterministic = reviewSnapshot(snapshot, masterHmacKey);
      const aiReview = await reviewWithOpenAI(
        snapshot,
        aiConfig && target.provider === "gitee" ? { ...aiConfig, language: "zh-CN" } : aiConfig,
      );
      const report = { ...deterministic, aiReview };
      if (!(await saveReport(pool, job, workerId, snapshot, report))) {
        stored = await getReport(pool, job.id);
        if (!stored) return;
      } else {
        stored = { report, state: "pending", checkRunId: null };
      }
    }
    if (
      stored.state === "published" ||
      stored.state === "superseded" ||
      stored.state === "uncertain"
    ) {
      await completeJob(pool, job, workerId);
      return;
    }
    const allowCreate = stored.state === "pending";
    if (allowCreate) {
      if (!(await transitionReport(pool, job, workerId, "pending", "publishing"))) return;
    }
    if (leaseLost) return;
    try {
      const checkId =
        target.provider === "gitee" && gitee
          ? await publishGiteeReport(
              gitee.client,
              gitee.repository,
              snapshot,
              stored.report,
              allowCreate,
            )
          : await publishCheck(client, snapshot, stored.report, allowCreate);
      if (checkId === null) {
        await transitionReport(pool, job, workerId, "publishing", "superseded");
      } else {
        await transitionReport(pool, job, workerId, "publishing", "published", String(checkId));
      }
    } catch {
      await transitionReport(pool, job, workerId, "publishing", "uncertain");
    }
    await completeJob(pool, job, workerId);
  } catch (error) {
    if (!leaseLost) {
      await failJob(
        pool,
        job,
        workerId,
        failureCode(error),
        Math.min(60_000, 5_000 * 2 ** Math.min(job.attempts - 1, 4)),
      );
    }
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runOneJob(
  pool: Pool,
  client: GitHubClient,
  masterHmacKey: Buffer,
  aiConfig: AiReviewConfig | null = null,
  gitee: GiteeWorkerConfig | null = null,
  workerId = randomUUID(),
): Promise<boolean> {
  const jobs = await claimJobs(pool, workerId, 1, LEASE_MS);
  const job = jobs[0];
  if (!job) return false;
  await processJob(pool, client, masterHmacKey, aiConfig, gitee, job, workerId);
  const result = await pool.query<{ state: string; last_error_code: string | null }>(
    "SELECT state, last_error_code FROM review_bot.review_job WHERE id = $1",
    [job.id],
  );
  const report = await getReport(pool, job.id);
  process.stdout.write(
    `Job ${job.id}: ${result.rows[0]?.state ?? "unknown"}, publication ${report?.state ?? "none"}, error ${result.rows[0]?.last_error_code ?? "none"}\n`,
  );
  return true;
}
