import type { CoverageReason } from "../../domain/review.js";
import {
  GitHubApiError,
  type GitHubClient,
  githubObject,
  githubPullRequest,
  githubRepository,
  githubString,
} from "./client.js";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 256_000;

export interface SnapshotFile {
  readonly path: string;
  readonly blobSha: string;
  readonly baseText?: string;
  readonly headText?: string;
  readonly changedHeadLines?: ReadonlySet<number>;
  readonly reason?: CoverageReason;
}

export interface PullRequestSnapshot {
  readonly provider: "github" | "gitee";
  readonly installationId: string;
  readonly repositoryId: string;
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly pullRequestNumber: number;
  readonly mergeBaseSha: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly files: readonly SnapshotFile[];
  readonly truncatedFiles: boolean;
}

export interface SnapshotTarget {
  readonly provider: "github" | "gitee";
  readonly installationId: string;
  readonly repositoryId: string;
  readonly pullRequestNumber: number;
  readonly expectedBaseSha: string | null;
  readonly expectedHeadSha: string | null;
}

export function changedLinesFromPatch(patch: string): ReadonlySet<number> | null {
  const changed = new Set<number>();
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (inHunk && (oldRemaining !== 0 || newRemaining !== 0)) return null;
      newLine = Number(header[3]);
      oldRemaining = Number(header[2] ?? "1");
      newRemaining = Number(header[4] ?? "1");
      inHunk = true;
      continue;
    }
    if (!inHunk) return null;
    if (line.startsWith("\\ No newline at end of file")) continue;
    if (line === "" && oldRemaining === 0 && newRemaining === 0) continue;
    if (line.startsWith("+")) {
      changed.add(newLine++);
      newRemaining--;
    } else if (line.startsWith("-")) {
      oldRemaining--;
    } else if (line.startsWith(" ")) {
      newLine++;
      oldRemaining--;
      newRemaining--;
    } else {
      return null;
    }
    if (oldRemaining < 0 || newRemaining < 0) return null;
  }
  return inHunk && oldRemaining === 0 && newRemaining === 0 ? changed : null;
}

type DecodedContent = { text: string } | { reason: CoverageReason };

function decodeContent(value: unknown): DecodedContent {
  const file = githubObject(value);
  if (typeof file.size !== "number") return { reason: "read_failed" };
  if (file.size > MAX_FILE_BYTES) return { reason: "too_large" };
  if (file.encoding !== "base64" || typeof file.content !== "string") {
    return { reason: "read_failed" };
  }
  const bytes = Buffer.from(file.content.replace(/\s/g, ""), "base64");
  if (bytes.byteLength > MAX_FILE_BYTES) return { reason: "too_large" };
  if (bytes.includes(0)) return { reason: "unsupported" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { reason: "unsupported" };
  }
}

async function readFile(
  client: GitHubClient,
  installationId: string,
  repository: string,
  path: string,
  ref: string,
  blob: boolean,
): Promise<DecodedContent> {
  const apiPath = blob
    ? `/repos/${repository}/git/blobs/${encodeURIComponent(ref)}`
    : `/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;
  return decodeContent((await client.get(installationId, apiPath)).data);
}

export async function fetchSnapshot(
  client: GitHubClient,
  target: SnapshotTarget,
): Promise<PullRequestSnapshot | null> {
  const { installationId, repositoryId, pullRequestNumber } = target;
  const repository = githubRepository(
    (await client.get(installationId, `/repositories/${encodeURIComponent(repositoryId)}`)).data,
  );
  if (String(repository.id) !== repositoryId) throw new Error("Repository identity mismatch");
  const repositoryPath = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  const pr = githubPullRequest(
    (await client.get(installationId, `/repos/${repositoryPath}/pulls/${pullRequestNumber}`)).data,
  );
  if (pr.number !== pullRequestNumber) throw new Error("Pull request identity mismatch");
  if (
    pr.state !== "open" ||
    (target.expectedBaseSha !== null && target.expectedBaseSha !== pr.baseSha) ||
    (target.expectedHeadSha !== null && target.expectedHeadSha !== pr.headSha)
  ) {
    return null;
  }
  const comparison = githubObject(
    (
      await client.get(
        installationId,
        `/repos/${repositoryPath}/compare/${pr.baseSha}...${pr.headSha}`,
      )
    ).data,
  );
  const mergeBaseSha = githubString(githubObject(comparison.merge_base_commit).sha);
  const list = await client.get(
    installationId,
    `/repos/${repositoryPath}/pulls/${pullRequestNumber}/files?per_page=${MAX_FILES}`,
  );
  if (!Array.isArray(list.data)) throw new Error("Unexpected pull request files response");
  const truncatedFiles = /rel="next"/.test(list.headers.get("link") ?? "");
  const files: SnapshotFile[] = [];
  for (const item of list.data) {
    const file = githubObject(item);
    const path = githubString(file.filename);
    const blobSha = githubString(file.sha);
    if (file.status === "removed") {
      files.push({ path, blobSha, reason: "unsupported" });
      continue;
    }
    const changedHeadLines =
      typeof file.patch === "string" && file.patch.length <= 200_000
        ? changedLinesFromPatch(file.patch)
        : null;
    if (!changedHeadLines) {
      files.push({ path, blobSha, reason: "diff_unavailable" });
      continue;
    }
    try {
      const headText = await readFile(client, installationId, repositoryPath, path, blobSha, true);
      const basePath =
        file.status === "renamed" && typeof file.previous_filename === "string"
          ? file.previous_filename
          : path;
      const base =
        file.status === "added"
          ? ({ text: "" } as const)
          : await readFile(client, installationId, repositoryPath, basePath, mergeBaseSha, false);
      if ("reason" in headText) {
        files.push({ path, blobSha, reason: headText.reason });
      } else if ("reason" in base) {
        files.push({ path, blobSha, reason: base.reason });
      } else {
        files.push({
          path,
          blobSha,
          headText: headText.text,
          baseText: base.text,
          changedHeadLines,
        });
      }
    } catch (error) {
      if (error instanceof GitHubApiError && error.retryable) throw error;
      files.push({ path, blobSha, reason: "read_failed" });
    }
  }
  return {
    provider: "github",
    installationId,
    repositoryId,
    repositoryOwner: repository.owner,
    repositoryName: repository.name,
    pullRequestNumber,
    mergeBaseSha,
    baseSha: pr.baseSha,
    headSha: pr.headSha,
    files,
    truncatedFiles,
  };
}
