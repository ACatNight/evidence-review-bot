import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createLocalSnapshot } from "../src/adapters/local/git.js";
import { parseReviewResult } from "../src/protocol/json.js";

const cli = resolve("dist/src/entrypoints/cli.js");

test("local CLI scans new files, preserves Unicode paths and serializes multiple candidates", () => {
  const root = mkdtempSync(join(tmpdir(), "evidence-cli-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init");
  git("config", "user.name", "CLI Test");
  git("config", "user.email", "cli@example.invalid");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(root, "existing.ts"), "export const value = 1;\n");
  git("add", ".");
  git("commit", "-m", "base");
  const token = `ghp_${"A".repeat(36)}`;
  const second = `ghp_${"B".repeat(36)}`;
  writeFileSync(join(root, "新增 文件.ts"), `const a = '${token}';\nconst b = '${second}';\n`);
  git("add", ".");
  git("commit", "-m", "head");
  const snapshot = createLocalSnapshot(root);
  assert.equal(snapshot.provider, "local");
  assert.equal(snapshot.files[0]?.path, "新增 文件.ts");
  assert.equal(snapshot.files[0]?.baseText, "");
  const scanned = spawnSync(process.execPath, [cli, "scan", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(scanned.status, 1, scanned.stderr);
  const report = parseReviewResult(scanned.stdout);
  assert.equal(report.status, "findings");
  assert.equal(report.findings.length, 2);
  assert.ok(!scanned.stdout.includes(token));
  assert.ok(!scanned.stdout.includes(second));
  assert.equal(report.coverage.checks.ai?.status, "not_run");
  const empty = spawnSync(process.execPath, [cli, "scan", "--base", "HEAD", "--format", "json"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(parseReviewResult(empty.stdout).coverage.checks.deterministic.status, "not_run");
  writeFileSync(join(root, "existing.ts"), `export const value = '${token}';\n`);
  const working = spawnSync(
    process.execPath,
    [cli, "scan", "--base", "HEAD", "--head", "WORKTREE", "--format", "json"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(working.status, 1, working.stderr);
  assert.equal(parseReviewResult(working.stdout).findings.length, 1);
  assert.ok(!working.stdout.includes(token));
});

test("CLI distinguishes help, invalid arguments and invalid revisions", () => {
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  const invalid = spawnSync(process.execPath, [cli, "scan", "--format", "other"], {
    encoding: "utf8",
  });
  assert.equal(invalid.status, 2);
  const missing = spawnSync(process.execPath, [cli, "scan", "--base", "--format", "json"], {
    encoding: "utf8",
  });
  assert.equal(missing.status, 2);
  const revision = spawnSync(process.execPath, [cli, "scan", "--base", "does-not-exist"], {
    encoding: "utf8",
  });
  assert.equal(revision.status, 4);
  assert.match(revision.stderr, /Cannot resolve --base/);
});
