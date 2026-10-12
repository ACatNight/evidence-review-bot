import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { changedLinesFromPatch, type PullRequestSnapshot } from "../github/snapshot.js";

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function safeGit(root: string, args: readonly string[]): string | null {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

function changedPaths(root: string, base: string, head: string): string[] {
  const range = head === "WORKTREE" ? base : `${base}...${head}`;
  return git(root, ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=ACM", range, "--"])
    .split("\0")
    .filter(Boolean);
}

function readRevisionFile(root: string, revision: string, path: string): string | undefined {
  if (revision === "WORKTREE") {
    try {
      const target = resolve(root, path);
      const stat = lstatSync(target);
      const withinRoot = relative(realpathSync(root), realpathSync(target));
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 256_000 ||
        withinRoot.startsWith("..") ||
        isAbsolute(withinRoot)
      )
        return undefined;
      return readFileSync(target, "utf8");
    } catch {
      return undefined;
    }
  }
  return safeGit(root, ["show", "--no-textconv", `${revision}:${path}`]) ?? undefined;
}

function changedLinesFromGitDiff(patch: string): ReadonlySet<number> | null {
  const firstHunk = /^@@ /m.exec(patch)?.index;
  return firstHunk !== undefined ? changedLinesFromPatch(patch.slice(firstHunk)) : null;
}

export function createLocalSnapshot(
  root: string,
  base = "HEAD~1",
  head = "HEAD",
): PullRequestSnapshot {
  const repositoryRoot = git(root, ["rev-parse", "--show-toplevel"]).trim();
  const headSha =
    head === "WORKTREE"
      ? "WORKTREE"
      : git(repositoryRoot, [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${head}^{commit}`,
        ]).trim();
  const baseSha = git(repositoryRoot, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]).trim();
  const mergeBaseSha =
    headSha === "WORKTREE" ? baseSha : git(repositoryRoot, ["merge-base", baseSha, headSha]).trim();
  const paths = changedPaths(repositoryRoot, mergeBaseSha, headSha);
  const files = paths.slice(0, 50).map((path) => {
    const range = head === "WORKTREE" ? mergeBaseSha : `${mergeBaseSha}...${headSha}`;
    const patch = safeGit(repositoryRoot, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=0",
      "--no-renames",
      range,
      "--",
      path,
    ]);
    const changedHeadLines = patch ? changedLinesFromGitDiff(patch) : null;
    const headText = readRevisionFile(repositoryRoot, headSha, path);
    const baseText =
      readRevisionFile(repositoryRoot, mergeBaseSha, path) ??
      (patch?.includes("new file mode") ? "" : undefined);
    if (!changedHeadLines || headText === undefined || baseText === undefined) {
      return { path, blobSha: "local", reason: "diff_unavailable" as const };
    }
    if (headText.includes("\0") || baseText.includes("\0"))
      return { path, blobSha: "local", reason: "unsupported" as const };
    if (Buffer.byteLength(headText) > 256_000 || Buffer.byteLength(baseText) > 256_000)
      return { path, blobSha: "local", reason: "too_large" as const };
    return {
      path,
      blobSha: createHash("sha256").update(headText).digest("hex"),
      headText,
      baseText,
      changedHeadLines,
    };
  });
  const repositoryId = createHash("sha256").update(repositoryRoot).digest("hex").slice(0, 16);
  return {
    provider: "local",
    installationId: `local:${repositoryId}`,
    repositoryId,
    repositoryOwner: "local",
    repositoryName: repositoryRoot.split(/[\\/]/).at(-1) ?? "repository",
    pullRequestNumber: 0,
    mergeBaseSha,
    baseSha,
    headSha:
      headSha === "WORKTREE"
        ? `worktree:${createHash("sha256").update(JSON.stringify(files)).digest("hex")}`
        : headSha,
    files,
    truncatedFiles: paths.length > 50,
  };
}
