import type { PullRequestSnapshot, SnapshotFile, SnapshotTarget } from "../github/snapshot.js";
import { changedLinesFromPatch } from "../github/snapshot.js";
import {
  GiteeApiError,
  type GiteeClient,
  giteeInteger,
  giteeObject,
  giteeString,
} from "./client.js";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 256_000;

export interface GiteeRepository {
  readonly owner: string;
  readonly name: string;
  readonly id: string;
}

function repositoryPath(repository: GiteeRepository): string {
  return `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
}

async function contentAt(
  client: GiteeClient,
  repository: GiteeRepository,
  path: string,
  sha: string,
): Promise<{ text: string; blobSha: string } | null> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const value = giteeObject(
    (await client.get(`/repos/${repositoryPath(repository)}/contents/${encodedPath}?ref=${sha}`))
      .data,
  );
  if (typeof value.size !== "number" || value.size > MAX_FILE_BYTES) return null;
  if (value.encoding !== "base64" || typeof value.content !== "string") return null;
  const bytes = Buffer.from(value.content.replace(/\s/g, ""), "base64");
  if (bytes.byteLength > MAX_FILE_BYTES || bytes.includes(0)) return null;
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      blobSha: giteeString(value.sha),
    };
  } catch {
    return null;
  }
}

export async function fetchGiteeSnapshot(
  client: GiteeClient,
  repository: GiteeRepository,
  target: SnapshotTarget,
): Promise<PullRequestSnapshot | null> {
  if (target.provider !== "gitee" || target.repositoryId !== repository.id) {
    throw new Error("Gitee repository identity mismatch");
  }
  const prefix = `/repos/${repositoryPath(repository)}`;
  const pr = giteeObject((await client.get(`${prefix}/pulls/${target.pullRequestNumber}`)).data);
  const baseSha = giteeString(giteeObject(pr.base).sha);
  const headSha = giteeString(giteeObject(pr.head).sha);
  // Gitee's webhook base SHA can differ from the PR API base SHA for the same head.
  if (
    pr.state !== "open" ||
    giteeInteger(pr.number) !== target.pullRequestNumber ||
    (target.expectedHeadSha && target.expectedHeadSha !== headSha)
  ) {
    return null;
  }
  const baseRepo = giteeObject(giteeObject(pr.base).repo);
  if (String(baseRepo.id) !== repository.id) throw new Error("Gitee PR base repository mismatch");
  const comparison = giteeObject(
    (await client.get(`${prefix}/compare/${baseSha}...${headSha}`)).data,
  );
  const mergeBaseSha = giteeString(giteeObject(comparison.merge_base_commit).sha);
  const response = await client.get(`${prefix}/pulls/${target.pullRequestNumber}/files`);
  if (!Array.isArray(response.data)) throw new Error("Unexpected Gitee PR files response");
  const truncatedFiles =
    comparison.truncated === true ||
    (Array.isArray(comparison.files) && comparison.files.length > response.data.length) ||
    response.data.length > MAX_FILES ||
    /rel="next"/.test(response.headers.get("link") ?? "");
  const files: SnapshotFile[] = [];
  for (const entry of response.data.slice(0, MAX_FILES)) {
    const file = giteeObject(entry);
    const patch = file.patch ? giteeObject(file.patch) : {};
    const path = giteeString(file.filename);
    const blobSha = headSha;
    if (patch.deleted_file === true || file.status === "removed") {
      files.push({ path, blobSha, reason: "unsupported" });
      continue;
    }
    const changed =
      typeof patch.diff === "string" && patch.diff.length <= 200_000
        ? changedLinesFromPatch(patch.diff)
        : null;
    if (!changed) {
      files.push({ path, blobSha, reason: "diff_unavailable" });
      continue;
    }
    try {
      const headText = await contentAt(client, repository, path, headSha);
      const oldPath =
        patch.renamed_file === true && typeof patch.old_path === "string" ? patch.old_path : path;
      const baseText =
        patch.new_file === true ? "" : await contentAt(client, repository, oldPath, mergeBaseSha);
      if (headText === null || baseText === null) {
        files.push({ path, blobSha, reason: "read_failed" });
      } else {
        files.push({
          path,
          blobSha: headText.blobSha,
          baseText: typeof baseText === "string" ? baseText : baseText.text,
          headText: headText.text,
          changedHeadLines: changed,
        });
      }
    } catch (error) {
      if (error instanceof GiteeApiError && error.retryable) throw error;
      files.push({ path, blobSha, reason: "read_failed" });
    }
  }
  return {
    provider: "gitee",
    installationId: target.installationId,
    repositoryId: repository.id,
    repositoryOwner: repository.owner,
    repositoryName: repository.name,
    pullRequestNumber: target.pullRequestNumber,
    mergeBaseSha,
    baseSha,
    headSha,
    files,
    truncatedFiles,
  };
}
