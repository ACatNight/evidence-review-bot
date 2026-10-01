import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingDelivery } from "../postgres/jobs.js";

const acceptedActions = new Set([
  "opened",
  "synchronize",
  "reopened",
  "edited",
  "ready_for_review",
]);

export function verifyWebhookSignature(
  body: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const provided = Buffer.from(signature.slice(7), "hex");
  return timingSafeEqual(expected, provided);
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numericId(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : null;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

export type ParsedEvent =
  | { readonly kind: "ignored" }
  | { readonly kind: "invalid" }
  | { readonly kind: "review"; readonly delivery: IncomingDelivery };

export function parsePullRequestWebhook(
  body: Buffer,
  eventType: string | undefined,
  deliveryId: string | undefined,
): ParsedEvent {
  if (eventType !== "pull_request") return { kind: "ignored" };
  if (!deliveryId || !/^[A-Za-z0-9-]{1,128}$/.test(deliveryId)) return { kind: "invalid" };

  let value: unknown;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    return { kind: "invalid" };
  }
  const payload = object(value);
  if (!payload || typeof payload.action !== "string") return { kind: "invalid" };
  if (!acceptedActions.has(payload.action)) return { kind: "ignored" };

  const installationId = numericId(object(payload.installation)?.id);
  const repositoryId = numericId(object(payload.repository)?.id);
  const pullRequest = object(payload.pull_request);
  const pullRequestId = numericId(pullRequest?.number);
  const base = object(pullRequest?.base);
  const head = object(pullRequest?.head);
  const baseSha = base?.sha;
  const headSha = head?.sha;
  if (!installationId || !repositoryId || !pullRequestId || !sha(baseSha) || !sha(headSha)) {
    return { kind: "invalid" };
  }
  if (pullRequest?.state !== "open") return { kind: "ignored" };

  return {
    kind: "review",
    delivery: {
      provider: "github",
      installationId,
      deliveryId,
      eventType: "pull_request",
      repositoryId,
      pullRequestId,
      baseSha,
      headSha,
      payloadDigest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    },
  };
}
