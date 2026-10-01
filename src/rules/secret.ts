import { createHmac } from "node:crypto";

export const SECRET_RULE_VERSION = "0.1.0";

export type SecretKind = "github_classic_token" | "pem_private_key";

export interface SecretCandidate {
  readonly kind: SecretKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly hmacFingerprint: string;
  readonly redactedExcerpt: string;
}

export interface SecretScanInput {
  readonly headText: string;
  readonly baseText: string;
  readonly changedHeadLines: ReadonlySet<number>;
  readonly tenantHmacKey: Buffer;
  readonly maxBytes: number;
}

export type SecretScanResult =
  | { readonly state: "complete"; readonly candidates: readonly SecretCandidate[] }
  | { readonly state: "partial"; readonly reason: "too_large"; readonly candidates: readonly [] };

interface RawMatch {
  readonly kind: SecretKind;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const githubClassic = /\bgh[pousr]_[A-Za-z0-9]{36}\b/g;
const pemPrivateKey =
  /-----BEGIN ((?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----\r?\n(?:[A-Za-z0-9+/=]{16,76}\r?\n){2,}-----END \1-----/g;

function* matches(text: string): Iterable<RawMatch> {
  for (const match of text.matchAll(githubClassic)) {
    yield {
      kind: "github_classic_token",
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    };
  }
  for (const match of text.matchAll(pemPrivateKey)) {
    yield {
      kind: "pem_private_key",
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    };
  }
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) {
    if (text.charCodeAt(index) === 10) line++;
  }
  return line;
}

function fingerprint(key: Buffer, kind: SecretKind, value: string): string {
  return createHmac("sha256", key)
    .update(kind)
    .update("\0")
    .update(value.replace(/\r\n/g, "\n"))
    .digest("hex");
}

export function scanSecrets(input: SecretScanInput): SecretScanResult {
  if (input.tenantHmacKey.length < 32) throw new Error("Tenant HMAC key must be at least 32 bytes");
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0)
    throw new Error("maxBytes must be positive");
  if (
    Buffer.byteLength(input.headText, "utf8") > input.maxBytes ||
    Buffer.byteLength(input.baseText, "utf8") > input.maxBytes
  ) {
    return { state: "partial", reason: "too_large", candidates: [] };
  }

  const previous = new Set(
    Array.from(matches(input.baseText), (match) =>
      fingerprint(input.tenantHmacKey, match.kind, match.value),
    ),
  );
  const candidates: SecretCandidate[] = [];
  for (const match of matches(input.headText)) {
    const startLine = lineAt(input.headText, match.start);
    const endLine = lineAt(input.headText, match.end - 1);
    let changed = false;
    for (let line = startLine; line <= endLine; line++) {
      if (input.changedHeadLines.has(line)) changed = true;
    }
    if (!changed) continue;
    const hmacFingerprint = fingerprint(input.tenantHmacKey, match.kind, match.value);
    if (previous.has(hmacFingerprint)) continue;
    candidates.push({
      kind: match.kind,
      startLine,
      endLine,
      hmacFingerprint,
      redactedExcerpt:
        match.kind === "pem_private_key" ? "[REDACTED PRIVATE KEY]" : "[REDACTED GITHUB TOKEN]",
    });
  }
  return { state: "complete", candidates };
}
