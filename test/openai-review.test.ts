import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";
import type { PullRequestSnapshot } from "../src/adapters/github/snapshot.js";
import { prepareAiInput, reviewWithOpenAI } from "../src/adapters/openai/security-review.js";

const token = `ghp_${"A".repeat(36)}`;
const snapshot: PullRequestSnapshot = {
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
      headText: `const credential = "${token}";\nconst apiKey = "private-value";\nallow(user);`,
      changedHeadLines: new Set([1, 2, 3]),
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
  assert.equal(prepared.input.includes("private-value"), false);
  assert.equal(prepared.input.includes("src/private.ts"), false);
});

test("AI findings must point to changed lines and failed calls are not clean reviews", async () => {
  const config = { apiKey: "test-key", model: "test-model", allowedRepositoryIds: new Set(["2"]) };
  const fake = {
    responses: {
      parse: async (request: { store: boolean; input: unknown }) => {
        assert.equal(request.store, false);
        assert.equal(JSON.stringify(request.input).includes(token), false);
        return {
          status: "completed",
          output_parsed: {
            findings: [
              {
                path: "src/auth.ts",
                line: 3,
                category: "access_control",
                severity: "high",
                confidence: "medium",
                title: "Authorization bypass",
                evidence: "The changed line grants access without checking a role.",
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
          },
        };
      },
    },
  } as unknown as OpenAI;
  const result = await reviewWithOpenAI(snapshot, config, fake);
  assert.equal(result.state, "partial");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.line, 3);

  const failing = {
    responses: {
      parse: async () => {
        throw new Error("API error");
      },
    },
  } as unknown as OpenAI;
  const error = await reviewWithOpenAI(snapshot, config, failing);
  assert.equal(error.state, "error");
  assert.equal(error.findings.length, 0);
  assert.equal((await reviewWithOpenAI(snapshot, null)).state, "not_run");
});

test("AI review reports partial coverage when changed lines exceed the prompt limit", async () => {
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
  const fake = {
    responses: {
      parse: async () => ({ status: "completed", output_parsed: { findings: [] } }),
    },
  } as unknown as OpenAI;
  const result = await reviewWithOpenAI(
    longSnapshot,
    { apiKey: "test-key", model: "test-model", allowedRepositoryIds: new Set(["2"]) },
    fake,
  );
  assert.equal(result.state, "partial");
});
