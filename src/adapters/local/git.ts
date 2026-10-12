import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { changedLinesFromPatch, type PullRequestSnapshot } from "../github/snapshot.js";
import { requiredGit, resolveCommit, safeGit } from "./git-command.js";

function diffRange(base: string, head: string): string[] {
  if (head === "INDEX") return ["--cached", base];
  return [head === "WORKTREE" ? base : `${base}...${head}`];
}

function changedPaths(root: string, base: string, head: string): string[] {
  const paths = safeGit(root, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--name-only",
    "-z",
    "--no-renames",
    "--diff-filter=ACM",
    ...diffRange(base, head),
    "--",
  ]);
  if (paths === null)
    throw new Error(
      "Could not list changed files. Check Git availability, repository access and diff size.",
    );
  return paths.split("\0").filter(Boolean);
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
  return (
    safeGit(root, ["show", "--no-textconv", `${revision === "INDEX" ? "" : revision}:${path}`]) ??
    undefined
  );
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
  const repositoryRoot = requiredGit(
    root,
    ["rev-parse", "--show-toplevel"],
    "Cannot open repository. Check --repo points to a Git working tree and Git is installed.",
  );
  const local = head === "WORKTREE" || head === "INDEX";
  if (
    local &&
    requiredGit(
      repositoryRoot,
      ["ls-files", "--unmerged", "-z"],
      "Could not read Git index. Check repository permissions.",
    ).length > 0
  ) {
    throw new Error(
      "Unresolved merge conflicts. Resolve and stage conflicted files before reviewing.",
    );
  }
  const headSha = local ? head : resolveCommit(repositoryRoot, head, "head");
  const baseSha = resolveCommit(repositoryRoot, base, "base");
  const mergeBaseSha = local
    ? baseSha
    : requiredGit(
        repositoryRoot,
        ["merge-base", baseSha, headSha],
        "No merge base available. Fetch enough history for both refs (CI shallow clones may need fetch-depth: 0).",
      );
  const paths = changedPaths(repositoryRoot, mergeBaseSha, headSha);
  const files = paths.slice(0, 50).map((path) => {
    const patch = safeGit(repositoryRoot, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=0",
      "--no-renames",
      ...diffRange(mergeBaseSha, headSha),
      "--",
      path,
    ]);
    const changedHeadLines = patch ? changedLinesFromGitDiff(patch) : null;
    const headText = readRevisionFile(repositoryRoot, headSha, path);
    const baseText =
      readRevisionFile(repositoryRoot, mergeBaseSha, path) ??
      (patch && /^new file mode \d+$/m.test(patch) ? "" : undefined);
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
    headSha: local
      ? `${head === "INDEX" ? "index" : "worktree"}:${createHash("sha256")
          .update(
            JSON.stringify(files, (_key, value: unknown) =>
              value instanceof Set ? [...value] : value,
            ),
          )
          .digest("hex")}`
      : headSha,
    files,
    truncatedFiles: paths.length > 50,
  };
}
