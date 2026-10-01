import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ParsedEvent } from "../github/webhook.js";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

export function verifyGiteeWebhook(
  token: string | undefined,
  timestamp: string | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!token || !timestamp || !/^\d{13}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > 60 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
  let provided: string;
  try {
    provided = decodeURIComponent(token);
  } catch {
    return false;
  }
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function verifyGiteeWebhookToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const expected = Buffer.from(secret);
  const provided = Buffer.from(token);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function parseGiteeWebhook(
  body: Buffer,
  eventType: string | undefined,
  repositoryId: string,
): ParsedEvent {
  if (eventType !== "Merge Request Hook") return { kind: "ignored" };
  let payload: Record<string, unknown> | null;
  try {
    payload = object(JSON.parse(body.toString("utf8")));
  } catch {
    return { kind: "invalid" };
  }
  if (payload?.hook_name !== "merge_request_hooks") return { kind: "invalid" };
  const repository = object(payload.repository);
  const pr = object(payload.pull_request);
  const base = object(pr?.base);
  const head = object(pr?.head);
  if (
    !repository ||
    String(repository.id) !== repositoryId ||
    !pr ||
    typeof pr.number !== "number" ||
    !Number.isSafeInteger(pr.number) ||
    pr.number < 1 ||
    !sha(base?.sha) ||
    !sha(head?.sha)
  ) {
    return { kind: "invalid" };
  }
  if (pr.state !== "open") return { kind: "ignored" };
  const digest = createHash("sha256").update(body).digest("hex");
  return {
    kind: "review",
    delivery: {
      provider: "gitee",
      installationId: `gitee:${repositoryId}`,
      deliveryId: digest,
      eventType: "merge_request_hooks",
      repositoryId,
      pullRequestId: String(pr.number),
      baseSha: base.sha,
      headSha: head.sha,
      payloadDigest: `sha256:${digest}`,
    },
  };
}
