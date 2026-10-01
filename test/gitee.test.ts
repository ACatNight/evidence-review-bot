import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { GiteeClient } from "../src/adapters/gitee/client.js";
import {
  parseGiteeWebhookRepositories,
  parseGiteeWorkerRepositories,
} from "../src/adapters/gitee/config.js";
import { giteeReportText, publishGiteeReport } from "../src/adapters/gitee/publish.js";
import { fetchGiteeSnapshot } from "../src/adapters/gitee/snapshot.js";
import { parseGiteeWebhook, verifyGiteeWebhook } from "../src/adapters/gitee/webhook.js";
import type { PullRequestSnapshot } from "../src/adapters/github/snapshot.js";
import { AI_NOT_RUN } from "../src/adapters/openai/security-review.js";
import { migrate } from "../src/adapters/postgres/migrate.js";
import type { ReviewReport } from "../src/application/review-pr.js";
import { createWebhookServer } from "../src/application/webhook-server.js";

const repository = { owner: "mournic", name: "evidence-review-bot", id: "50617958" };
const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const mergeBaseSha = "c".repeat(40);
const pr = {
  number: 1,
  state: "open",
  base: { sha: baseSha, repo: { id: Number(repository.id) } },
  head: { sha: headSha },
};

const snapshot: PullRequestSnapshot = {
  installationId: `gitee:${repository.id}`,
  repositoryId: repository.id,
  repositoryOwner: repository.owner,
  repositoryName: repository.name,
  pullRequestNumber: 1,
  mergeBaseSha,
  baseSha,
  headSha,
  files: [],
  truncatedFiles: false,
};

const report: ReviewReport = {
  ruleVersion: "0.1.0",
  coverage: {
    state: "partial",
    changedFiles: 1,
    completedFiles: 0,
    incompleteFiles: 1,
    excludedFiles: 0,
    truncatedFiles: false,
    gaps: [{ path: "src/a.ts", reason: "diff_unavailable" }],
  },
  findings: [],
  aiReview: AI_NOT_RUN,
};

test("Gitee Webhook checks timestamped signature and repository identity", () => {
  const secret = "s".repeat(32);
  const timestamp = "1790840000000";
  const signature = encodeURIComponent(
    createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64"),
  );
  assert.equal(verifyGiteeWebhook(signature, timestamp, secret, Number(timestamp)), true);
  assert.equal(
    verifyGiteeWebhook(signature, timestamp, secret, Number(timestamp) + 3_600_001),
    false,
  );
  assert.equal(verifyGiteeWebhook(signature, timestamp, "x".repeat(32), Number(timestamp)), false);
  const body = Buffer.from(
    JSON.stringify({
      hook_name: "merge_request_hooks",
      repository: { id: Number(repository.id) },
      pull_request: pr,
    }),
  );
  const parsed = parseGiteeWebhook(body, "Merge Request Hook", repository.id);
  assert.equal(parsed.kind, "review");
  if (parsed.kind === "review") {
    assert.equal(parsed.delivery.provider, "gitee");
    assert.equal(parsed.delivery.installationId, `gitee:${repository.id}`);
  }
  assert.equal(parseGiteeWebhook(body, "Merge Request Hook", "9").kind, "invalid");
  assert.equal(parseGiteeWebhook(body, "Push Hook", repository.id).kind, "ignored");
});

test("Gitee repository configuration rejects duplicate IDs", () => {
  const first = {
    id: repository.id,
    owner: repository.owner,
    name: repository.name,
    token: "test",
  };
  assert.equal(parseGiteeWorkerRepositories(JSON.stringify([first])).length, 1);
  assert.throws(() => parseGiteeWorkerRepositories(JSON.stringify([first, first])));
  assert.throws(() =>
    parseGiteeWebhookRepositories(JSON.stringify([{ id: repository.id, secret: "short" }])),
  );
});

test("a valid signature from another configured Gitee repository cannot queue this PR", async () => {
  const otherId = "49998972";
  const secret = "s".repeat(32);
  const otherSecret = "t".repeat(32);
  const timestamp = String(Date.now());
  const body = Buffer.from(
    JSON.stringify({
      hook_name: "merge_request_hooks",
      repository: { id: Number(repository.id) },
      pull_request: pr,
    }),
  );
  const signature = encodeURIComponent(
    createHmac("sha256", otherSecret).update(`${timestamp}\n${otherSecret}`).digest("base64"),
  );
  const app = createWebhookServer({} as Pool, "github-secret-at-least-32-characters", [
    { secret, repositoryId: repository.id },
    { secret: otherSecret, repositoryId: otherId },
  ]);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/gitee",
      headers: {
        "content-type": "application/json",
        "x-gitee-event": "Merge Request Hook",
        "x-gitee-timestamp": timestamp,
        "x-gitee-token": signature,
      },
      payload: body,
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("Gitee snapshot reads fixed SHA content and marks missing diff coverage", async () => {
  const transport = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    let data: unknown;
    if (path.endsWith("/pulls/1")) data = pr;
    else if (path.includes("/compare/")) {
      data = { merge_base_commit: { sha: mergeBaseSha }, truncated: false };
    } else if (path.endsWith("/pulls/1/files")) {
      data = [
        {
          filename: "src/a.ts",
          patch: { diff: "@@ -0,0 +1 @@\n+const value = 1;", new_file: true },
        },
        { filename: "src/b.ts", patch: null },
      ];
    } else if (path.endsWith("/contents/src/a.ts")) {
      data = {
        size: 16,
        encoding: "base64",
        content: Buffer.from("const value = 1;").toString("base64"),
        sha: "d".repeat(40),
      };
    } else throw new Error(`Unexpected path ${path}`);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  const client = new GiteeClient("test-token", transport as typeof fetch);
  const result = await fetchGiteeSnapshot(client, repository, {
    provider: "gitee",
    installationId: `gitee:${repository.id}`,
    repositoryId: repository.id,
    pullRequestNumber: 1,
    expectedBaseSha: "e".repeat(40),
    expectedHeadSha: headSha,
  });
  assert.equal(result?.files[0]?.blobSha, "d".repeat(40));
  assert.deepEqual([...((result?.files[0]?.changedHeadLines as Set<number>) ?? [])], [1]);
  assert.equal(result?.files[1]?.reason, "diff_unavailable");
  assert.equal(result?.baseSha, baseSha);
  assert.equal(
    await fetchGiteeSnapshot(client, repository, {
      provider: "gitee",
      installationId: `gitee:${repository.id}`,
      repositoryId: repository.id,
      pullRequestNumber: 1,
      expectedBaseSha: baseSha,
      expectedHeadSha: "e".repeat(40),
    }),
    null,
  );
});

test("Chinese Gitee report is partial and publication reuses its marker", async () => {
  const body = giteeReportText(snapshot, report);
  assert.match(body, /代码审查报告/);
  assert.match(body, /未检查范围/);
  assert.match(body, /不代表代码安全/);
  let comment: { id: number; body: string } | null = null;
  let posts = 0;
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/pulls/1")) return new Response(JSON.stringify(pr));
    if (path.endsWith("/pulls/1/comments")) {
      if (init?.method === "POST") {
        posts++;
        comment = { id: 42, body: JSON.parse(String(init.body)).body };
        return new Response(JSON.stringify(comment));
      }
      return new Response(JSON.stringify(comment ? [comment] : []));
    }
    throw new Error(`Unexpected path ${path}`);
  };
  const client = new GiteeClient("test-token", transport as typeof fetch);
  assert.equal(await publishGiteeReport(client, repository, snapshot, report, true), 42);
  assert.equal(await publishGiteeReport(client, repository, snapshot, report, true), 42);
  assert.equal(posts, 1);
});

test("Chinese report names fine-grained tokens without exposing candidate values", () => {
  const syntheticToken = `github_pat_${"A".repeat(82)}`;
  const body = giteeReportText(snapshot, {
    ...report,
    findings: [
      {
        path: "src/config.ts",
        startLine: 2,
        endLine: 2,
        kind: "github_fine_grained_token",
        redactedExcerpt: "[REDACTED GITHUB TOKEN]",
        hmacFingerprint: "f".repeat(64),
      },
    ],
  });
  assert.match(body, /GitHub 精细化访问令牌/);
  assert.equal(body.includes(syntheticToken), false);
  assert.equal(body.includes("f".repeat(64)), false);
});

const connectionString = process.env.TEST_DATABASE_URL;
test("Gitee Webhook route rejects invalid signatures and deduplicates events", {
  skip: !connectionString,
}, async () => {
  if (!connectionString) return;
  const pool = new Pool({ connectionString });
  const secret = "g".repeat(32);
  const app = createWebhookServer(pool, "github-secret-at-least-32-characters", [
    { secret, repositoryId: repository.id },
  ]);
  try {
    const database = await pool.query<{ current_database: string }>("SELECT current_database()");
    assert.equal(database.rows[0]?.current_database, "evidence_review_bot_test");
    await migrate(pool);
    await pool.query(
      "TRUNCATE review_bot.review_report, review_bot.audit_event, review_bot.review_job, review_bot.webhook_delivery RESTART IDENTITY",
    );
    const timestamp = String(Date.now());
    const payload = Buffer.from(
      JSON.stringify({
        hook_name: "merge_request_hooks",
        repository: { id: Number(repository.id) },
        pull_request: pr,
      }),
    );
    const signature = encodeURIComponent(
      createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64"),
    );
    const headers = {
      "content-type": "application/json",
      "x-gitee-event": "Merge Request Hook",
      "x-gitee-timestamp": timestamp,
      "x-gitee-token": signature,
    };
    const rejected = await app.inject({
      method: "POST",
      url: "/webhooks/gitee",
      headers: { ...headers, "x-gitee-token": "invalid" },
      payload,
    });
    assert.equal(rejected.statusCode, 401);
    const accepted = await app.inject({
      method: "POST",
      url: "/webhooks/gitee",
      headers,
      payload,
    });
    assert.deepEqual(accepted.json(), { queued: true });
    const repeated = await app.inject({
      method: "POST",
      url: "/webhooks/gitee",
      headers,
      payload,
    });
    assert.deepEqual(repeated.json(), { queued: false });
  } finally {
    await app.close();
    await pool.end();
  }
});
