import { execFileSync } from "node:child_process";

export function git(root: string, args: readonly string[]): string {
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function safeGit(root: string, args: readonly string[]): string | null {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

export function requiredGit(root: string, args: readonly string[], hint: string): string {
  const value = safeGit(root, args);
  if (value === null) throw new Error(hint);
  return value.trim();
}

export function resolveCommit(root: string, ref: string, role: "base" | "head"): string {
  return requiredGit(
    root,
    ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    `Cannot resolve --${role}. Use an existing commit or branch; fetch the base branch if needed. For a single-commit repository use --staged or --base HEAD --head WORKTREE.`,
  );
}
