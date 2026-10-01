const API = "https://gitee.com/api/v5";
const MAX_RESPONSE_BYTES = 2_000_000;

export class GiteeApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`Gitee API request failed (${status})`);
  }
}

export class GiteeClient {
  constructor(
    private readonly token: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async request(
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
  ): Promise<{ data: unknown; headers: Headers }> {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid Gitee API path");
    const response = await this.transport(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "evidence-review-bot",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GiteeApiError(
        response.status,
        response.status === 429 || response.status >= 500 || response.headers.has("retry-after"),
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Gitee API response");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new Error("Gitee API response too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return {
      data: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      headers: response.headers,
    };
  }

  get(path: string) {
    return this.request(path);
  }

  post(path: string, body: Record<string, unknown>) {
    return this.request(path, "POST", body);
  }
}

export function giteeObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unexpected Gitee API response");
  }
  return value as Record<string, unknown>;
}

export function giteeString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Unexpected Gitee API response");
  return value;
}

export function giteeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Unexpected Gitee API response");
  }
  return value;
}
