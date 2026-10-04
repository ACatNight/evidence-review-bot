import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import type { PullRequestSnapshot } from "../src/adapters/github/snapshot.js";
import { prepareAiInput, reviewWithOpenAI } from "../src/adapters/openai/security-review.js";

const token = `ghp_${"A".repeat(36)}`;
const fineGrainedToken = `github_pat_${"B".repeat(82)}`;

function responseWithFindings(findings: unknown, preface?: string) {
  return {
    status: "completed",
    output: [
      ...(preface ? [{ type: "message", content: [{ type: "output_text", text: preface }] }] : []),
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ findings }) }] },
    ],
  };
}
const snapshot: PullRequestSnapshot = {
  provider: "github",
  installationId: "1",
  repositoryId: "2",
  repositoryOwner: "example",
  repositoryName: "repo",
  pullRequestNumber: 7,
  mergeBaseSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  truncatedFiles: false,
  files: [
    {
      path: "src/auth.ts",
      blobSha: "d".repeat(40),
      baseText: "",
      headText: `const credential = "${token}";\nconst apiKey = "private-value";\nallow(user);\nconst value = "${fineGrainedToken}";`,
      changedHeadLines: new Set([1, 2, 3, 4]),
    },
    {
      path: "src/private.ts",
      blobSha: "e".repeat(40),
      baseText: "",
      headText: "-----BEGIN PRIVATE KEY-----\nPRIVATE KEY-----",
      changedHeadLines: new Set([1]),
    },
  ],
};

test("AI input is bounded, masks credential lines and skips private key files", () => {
  const prepared = prepareAiInput(snapshot);
  assert.equal(prepared.inspectedFiles, 1);
  assert.equal(prepared.eligibleFiles, 2);
  assert.equal(prepared.input.includes(token), false);
  assert.equal(prepared.input.includes(fineGrainedToken), false);
  assert.equal(prepared.input.includes("private-value"), false);
  assert.equal(prepared.input.includes("src/private.ts"), false);
});

test("AI input includes changed Java lines", () => {
  const prepared = prepareAiInput({
    ...snapshot,
    files: [
      {
        path: "src/Auth.java",
        blobSha: "f".repeat(40),
        baseText: "",
        headText: "class Auth {\n  void check() {}\n}",
        changedHeadLines: new Set([2]),
      },
    ],
  });
  assert.equal(prepared.eligibleFiles, 1);
  assert.equal(prepared.inspectedFiles, 1);
  assert.equal(prepared.input.includes('File: "src/Auth.java"'), true);
  assert.equal(prepared.allowedLines.get("src/Auth.java")?.has(2), true);
});

test("AI findings must point to changed lines and failed calls are not clean reviews", async () => {
  const config = {
    apiKey: "test-key",
    model: "test-model",
    allowedRepositories: new Set(["github:2"]),
  };
  const fake = {
    responses: {
      create: async (request: { store: boolean; input: unknown; max_output_tokens: number }) => {
        assert.equal(request.store, false);
        assert.equal(request.max_output_tokens, 4_000);
        assert.equal(JSON.stringify(request.input).includes(token), false);
        assert.equal(JSON.stringify(request.input).includes(fineGrainedToken), false);
        return responseWithFindings(
          [
            {
              path: "src/auth.ts",
              line: 3,
              category: "access_control",
              severity: "high",
              confidence: "medium",
              title: "Authorization bypass",
              evidence: `The changed line grants access without checking a role. ${fineGrainedToken}`,
              recommendation: "Check the authorized role before granting access.",
            },
            {
              path: "src/auth.ts",
              line: 100,
              category: "other",
              severity: "high",
              confidence: "high",
              title: "Invented line",
              evidence: "Not in changed code.",
              recommendation: "None.",
            },
          ],
          "这是不符合 JSON 格式的前置说明。",
        );
      },
    },
  } as unknown as OpenAI;
  const result = await reviewWithOpenAI(snapshot, config, fake);
  assert.equal(result.state, "partial");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.line, 3);
  assert.equal(JSON.stringify(result).includes(fineGrainedToken), false);

  const failing = {
    responses: {
      create: async () => {
        throw new Error("API error");
      },
    },
  } as unknown as OpenAI;
  const error = await reviewWithOpenAI(snapshot, config, failing);
  assert.equal(error.state, "error");
  assert.equal(error.findings.length, 0);
  const rateLimited = {
    responses: {
      create: async () => {
        throw Object.assign(new Error("rate limit"), { status: 429 });
      },
    },
  } as unknown as OpenAI;
  assert.equal((await reviewWithOpenAI(snapshot, config, rateLimited)).reason, "api_rate_limited");
  const incomplete = {
    responses: {
      create: async () => ({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    },
  } as unknown as OpenAI;
  assert.equal((await reviewWithOpenAI(snapshot, config, incomplete)).reason, "api_output_limit");
  assert.equal((await reviewWithOpenAI(snapshot, null)).state, "not_run");
});

test("AI review continues through later chunks of the same file", async () => {
  const firstFile = snapshot.files[0];
  assert.ok(firstFile);
  const longSnapshot: PullRequestSnapshot = {
    ...snapshot,
    files: [
      {
        ...firstFile,
        headText: Array.from({ length: 200 }, (_, index) => `const value${index} = ${index};`).join(
          "\n",
        ),
        changedHeadLines: new Set(Array.from({ length: 200 }, (_, index) => index + 1)),
      },
    ],
  };
  const prepared = prepareAiInput(longSnapshot);
  assert.equal(prepared.truncatedContext, true);
  assert.equal(prepared.allowedLines.get("src/auth.ts")?.has(200), false);
  let calls = 0;
  const fake = {
    responses: {
      create: async () => {
        calls++;
        return responseWithFindings([]);
      },
    },
  } as unknown as OpenAI;
  const result = await reviewWithOpenAI(
    longSnapshot,
    { apiKey: "test-key", model: "test-model", allowedRepositories: new Set(["github:2"]) },
    fake,
  );
  assert.equal(calls, 2);
  assert.equal(result.state, "complete");
  assert.equal(result.inspectedChangedLines, 200);
  assert.equal(result.eligibleChangedLines, 200);
  assert.deepEqual(result.unreviewedPaths, []);
  assert.deepEqual(result.unreviewedRanges, []);
});

test("AI review reports the exact remaining lines after the batch limit", async () => {
  const file = snapshot.files[0];
  assert.ok(file);
  const large = {
    ...snapshot,
    files: [
      {
        ...file,
        headText: Array.from({ length: 500 }, (_, index) => `const value${index} = ${index};`).join(
          "\n",
        ),
        changedHeadLines: new Set(Array.from({ length: 500 }, (_, index) => index + 1)),
      },
    ],
  };
  const client = {
    responses: { create: async () => responseWithFindings([]) },
  } as unknown as OpenAI;
  const result = await reviewWithOpenAI(
    large,
    { apiKey: "test-key", model: "test-model", allowedRepositories: new Set(["github:2"]) },
    client,
  );
  assert.equal(result.state, "partial");
  assert.equal(result.reason, "context_truncated");
  assert.equal(result.inspectedFiles, 1);
  assert.ok(result.inspectedChangedLines > 0 && result.inspectedChangedLines < 500);
  assert.equal(result.eligibleChangedLines, 500);
  assert.deepEqual(result.unreviewedPaths, ["src/auth.ts"]);
  assert.deepEqual(result.unreviewedRanges, [
    { path: "src/auth.ts", startLine: result.inspectedChangedLines + 1, endLine: 500 },
  ]);
  assert.equal(result.unreviewedRangeCount, 1);
});

test("AI coverage bounds the stored range list without losing its total", async () => {
  const file = snapshot.files[0];
  assert.ok(file);
  const sparse = {
    ...snapshot,
    files: [
      {
        ...file,
        headText: Array.from({ length: 60 }, () => "const value = 1;").join("\n"),
        changedHeadLines: new Set(Array.from({ length: 30 }, (_, index) => index * 2 + 1)),
      },
    ],
  };
  const client = {
    responses: {
      create: async () => {
        throw new Error("provider unavailable");
      },
    },
  } as unknown as OpenAI;
  const result = await reviewWithOpenAI(
    sparse,
    { apiKey: "test-key", model: "test-model", allowedRepositories: new Set(["github:2"]) },
    client,
  );
  assert.equal(result.state, "error");
  assert.equal(result.unreviewedRangeCount, 30);
  assert.equal(result.unreviewedRanges?.length, 20);
});

test("AI repository authorization includes its platform", async () => {
  const config = {
    apiKey: "test-key",
    model: "test-model",
    allowedRepositories: new Set(["github:2"]),
  };
  assert.equal(
    (await reviewWithOpenAI({ ...snapshot, provider: "gitee" }, config)).state,
    "not_run",
  );
  const unreadable = {
    ...snapshot,
    files: [{ path: "src/auth.ts", blobSha: "d".repeat(40), reason: "read_failed" as const }],
  };
  const result = await reviewWithOpenAI(unreadable, config);
  assert.equal(result.state, "partial");
  assert.equal(result.reason, "snapshot_incomplete");
});

test("AI review batches Java changes and validates findings in later batches", async () => {
  const files = Array.from({ length: 14 }, (_, index) => ({
    path: `src/File${index}.java`,
    blobSha: "f".repeat(40),
    baseText: "",
    headText: `class File${index} {}`,
    changedHeadLines: new Set([1]),
  }));
  let calls = 0;
  const fake = {
    responses: {
      create: async (request: { input: unknown }) => {
        calls++;
        const prompt = JSON.stringify(request.input);
        return responseWithFindings(
          prompt.includes("src/File13.java")
            ? [
                {
                  path: "src/File13.java",
                  line: 1,
                  category: "other",
                  severity: "medium",
                  confidence: "medium",
                  title: "Later batch finding",
                  evidence: "Changed line",
                  recommendation: "Review this line",
                },
              ]
            : [],
        );
      },
    },
  } as unknown as OpenAI;
  const result = await reviewWithOpenAI(
    { ...snapshot, files },
    { apiKey: "test-key", model: "test-model", allowedRepositories: new Set(["github:2"]) },
    fake,
  );
  assert.equal(calls, 2);
  assert.equal(result.state, "complete");
  assert.equal(result.inspectedFiles, 14);
  assert.deepEqual(result.unreviewedPaths, []);
  assert.equal(result.findings[0]?.path, "src/File13.java");
});
