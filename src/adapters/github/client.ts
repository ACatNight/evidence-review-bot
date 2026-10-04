import { createSign } from "node:crypto";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const MAX_RESPONSE_BYTES = 2_000_000;

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`GitHub API request failed (${status})`);
  }
}

interface Token {
  readonly value: string;
  readonly expiresAt: number;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Unexpected GitHub API response");
  }
  return value as JsonObject;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Unexpected GitHub API response");
  }
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Unexpected GitHub API response");
  }
  return value;
}

async function limitedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty GitHub API response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("GitHub API response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

export class GitHubClient {
  private readonly tokens = new Map<string, Token>();

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async request(
    path: string,
    token: string,
    method = "GET",
    body?: JsonObject,
  ): Promise<{ readonly data: unknown; readonly headers: Headers }> {
    const response = await this.transport(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "evidence-review-bot",
        "X-GitHub-Api-Version": API_VERSION,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new GitHubApiError(
        response.status,
        response.status === 429 || response.status >= 500 || response.headers.has("retry-after"),
      );
    }
    return { data: await limitedJson(response), headers: response.headers };
  }

  private async installationToken(installationId: string): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.value;
    const response = await this.request(
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      appJwt(this.appId, this.privateKey),
      "POST",
    );
    const data = object(response.data);
    const value = string(data.token);
    const expiresAt = Date.parse(string(data.expires_at));
    if (!Number.isFinite(expiresAt)) throw new Error("Unexpected token expiry");
    this.tokens.set(installationId, { value, expiresAt });
    return value;
  }

  async getApp(path: string): Promise<{ data: unknown; headers: Headers }> {
    return this.request(path, appJwt(this.appId, this.privateKey));
  }

  async get(installationId: string, path: string): Promise<{ data: unknown; headers: Headers }> {
    return this.request(path, await this.installationToken(installationId));
  }

  async post(installationId: string, path: string, body: JsonObject): Promise<unknown> {
    return (await this.request(path, await this.installationToken(installationId), "POST", body))
      .data;
  }

  async patch(installationId: string, path: string, body: JsonObject): Promise<unknown> {
    return (await this.request(path, await this.installationToken(installationId), "PATCH", body))
      .data;
  }
}

export function githubRepository(value: unknown): { owner: string; name: string; id: number } {
  const repository = object(value);
  return {
    id: integer(repository.id),
    owner: string(object(repository.owner).login),
    name: string(repository.name),
  };
}

export function githubPullRequest(value: unknown): {
  state: string;
  baseSha: string;
  headSha: string;
  number: number;
} {
  const pr = object(value);
  return {
    state: string(pr.state),
    baseSha: string(object(pr.base).sha),
    headSha: string(object(pr.head).sha),
    number: integer(pr.number),
  };
}

export function githubObject(value: unknown): JsonObject {
  return object(value);
}

export function githubString(value: unknown): string {
  return string(value);
}

export function githubInteger(value: unknown): number {
  return integer(value);
}
