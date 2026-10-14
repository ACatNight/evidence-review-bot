import { z } from "zod";

const text = z.string().refine((value) => value.trim().length > 0);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const line = count.min(1);
const severity = z.enum(["info", "low", "medium", "high", "critical"]);
const status = z.enum(["complete", "partial", "not_run", "error"]);
const location = z.strictObject({ path: text, startLine: line, endLine: line });
const checkCoverage = z.strictObject({
  status,
  processed: count,
  total: count.optional(),
  reason: text.optional(),
});

export const requestSchema = z.strictObject({
  protocolVersion: z.literal("1.0"),
  provider: z.enum(["github", "gitee", "local"]),
  repository: z.strictObject({
    id: text,
    fullName: text,
    visibility: z.enum(["public", "private"]).optional(),
  }),
  pullRequest: z.strictObject({ number: line, baseSha: text, headSha: text }).optional(),
  snapshot: z.strictObject({
    baseSha: text.optional(),
    headSha: text.optional(),
    files: z
      .array(
        z.strictObject({
          path: text,
          blobSha: text.optional(),
          content: z.string().optional(),
          changedLines: z.array(location).optional(),
        }),
      )
      .min(1),
    changedLines: z.array(location),
  }),
  policy: z.strictObject({ enabledRules: z.array(text), aiEnabled: z.boolean(), failOn: severity }),
});

const producerEvidence = {
  id: text,
  source: text,
  version: text,
  dependsOn: z.array(text).min(1),
  explanation: text,
};

export const resultSchema = z.strictObject({
  runId: text,
  protocolVersion: z.literal("1.0"),
  engineVersion: text,
  ruleSetVersion: text,
  status: z.enum(["passed", "findings", "partial", "failed"]),
  coverage: z.strictObject({
    files: z.strictObject({ eligible: count, reviewed: count, skipped: count }),
    changedLines: z.strictObject({ eligible: count, reviewed: count }).optional(),
    checks: z.strictObject({
      deterministic: checkCoverage,
      ai: checkCoverage.optional(),
      lint: checkCoverage,
      build: checkCoverage,
      tests: checkCoverage,
      dependencies: checkCoverage,
    }),
  }),
  findings: z.array(
    z.strictObject({
      id: text,
      ruleId: text,
      severity,
      confidence: z.enum(["deterministic", "candidate"]),
      location,
      title: text,
      explanation: text,
      remediation: text.optional(),
      evidenceIds: z.array(text).min(1),
    }),
  ),
  evidence: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({
        id: text,
        kind: z.literal("source"),
        snapshotSha: text,
        path: text,
        startLine: line,
        endLine: line,
        redactedExcerpt: z.string().optional(),
      }),
      z.strictObject({ ...producerEvidence, kind: z.literal("rule") }),
      z.strictObject({ ...producerEvidence, kind: z.literal("model") }),
    ]),
  ),
  skipped: z.array(z.strictObject({ path: text.optional(), check: text, reason: text })),
  checks: z.array(
    z.strictObject({ id: text, status, findingIds: z.array(text), message: text.optional() }),
  ),
});

export function validateShape(schema: z.ZodType, value: unknown, label: string): void {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Report only field paths and codes, never rejected source text or credentials.
    throw new Error(
      `Invalid ${label} at ${issue?.path.join(".") || "root"}: ${issue?.code ?? "invalid"}`,
    );
  }
}
