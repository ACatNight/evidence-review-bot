import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { parseScanOptions } from "../src/cli/options.js";
import { saveReport } from "../src/cli/output.js";
import { parseReviewResult } from "../src/protocol/json.js";

const cli = resolve("dist/src/entrypoints/cli.js");

function workspace(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "evidence-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(t: TestContext) {
  const root = workspace(t);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init");
  git("config", "user.name", "CLI Test");
  git("config", "user.email", "cli@example.invalid");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(root, "base.ts"), "export const base = 1;\n");
  git("add", ".");
  git("commit", "-m", "base");
  return { root, git };
}

function scan(root: string, ...args: string[]) {
  const env = { ...process.env };
  delete env.REVIEW_HMAC_KEY;
  return spawnSync(process.execPath, [cli, "scan", "--repo", root, ...args], {
    encoding: "utf8",
    env,
  });
}

test("staged review uses index contents even when the working file differs", (t) => {
  const { root, git } = repository(t);
  const token = `ghp_${"C".repeat(36)}`;
  const path = "凭据 [a].ts";
  writeFileSync(join(root, path), `const secret = '${token}';\n`);
  git("add", ".");
  writeFileSync(join(root, path), "const secret = 'removed-only-in-worktree';\n");
  const staged = scan(root, "--staged", "--format", "json");
  assert.equal(staged.status, 1, staged.stderr);
  const report = parseReviewResult(staged.stdout);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.location.path, path);
  assert.ok(!staged.stdout.includes(token));
  assert.ok(
    report.evidence.some((node) => node.kind === "source" && node.snapshotSha.startsWith("index:")),
  );
  const working = scan(root, "--head", "WORKTREE", "--format", "json");
  assert.equal(working.status, 0, working.stderr);
  assert.equal(parseReviewResult(working.stdout).findings.length, 0);
  const chinese = scan(root, "--staged");
  assert.equal(chinese.status, 1, chinese.stderr);
  assert.match(chinese.stdout, /本地代码审查报告/);
  assert.ok(chinese.stdout.includes(path));
  assert.ok(!chinese.stdout.includes(token));
  assert.match(chinese.stdout, /范围: staged/);
  const english = scan(root, "--staged", "--lang", "en");
  assert.match(english.stdout, /Local code review report/);
});

test("empty scope, invalid repositories and missing history give actionable feedback", (t) => {
  const { root } = repository(t);
  const empty = scan(root, "--staged");
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /SEC-001 未运行/);
  const history = scan(root);
  assert.equal(history.status, 4);
  assert.match(history.stderr, /Cannot resolve --base/);
  assert.match(history.stderr, /single-commit/);
  const outside = scan(workspace(t));
  assert.equal(outside.status, 4);
  assert.match(outside.stderr, /--repo/);
  assert.equal(outside.stdout, "");
});

test("incomplete scans keep a machine-readable report and return exit code 3", (t) => {
  const { root, git } = repository(t);
  writeFileSync(join(root, "large.ts"), "x".repeat(256_001));
  git("add", ".");
  const output = scan(root, "--staged", "--format", "json");
  assert.equal(output.status, 3, output.stderr);
  const report = parseReviewResult(output.stdout);
  assert.equal(report.status, "partial");
  assert.equal(report.skipped[0]?.reason, "too_large");
});

test("saving creates parent directories and preserves existing files unless forced", (t) => {
  const root = workspace(t);
  const output = join(root, "reports", "review.json");
  saveReport(output, '{"first":true}\n', false);
  assert.throws(() => saveReport(output, '{"second":true}\n', false), /--force/);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), { first: true });
  saveReport(output, '{"second":true}\n', true);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), { second: true });
});

test("CLI saves to the caller directory and keeps stdout free of progress messages", (t) => {
  const { root } = repository(t);
  const caller = workspace(t);
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "scan",
      "--repo",
      root,
      "--staged",
      "--format",
      "json",
      "--output",
      "reports/review.json",
    ],
    { cwd: caller, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /已保存/);
  assert.equal(
    parseReviewResult(readFileSync(join(caller, "reports/review.json"), "utf8")).status,
    "passed",
  );
});

test("options reject ambiguous input and local modes default to HEAD", () => {
  assert.equal(parseScanOptions(["--staged"]).base, "HEAD");
  assert.equal(parseScanOptions(["--head", "WORKTREE"]).base, "HEAD");
  assert.equal(parseScanOptions([]).base, "HEAD~1");
  assert.throws(() => parseScanOptions(["--staged", "--head", "HEAD"]), /cannot be combined/);
  assert.throws(() => parseScanOptions(["--base", "HEAD", "--base", "main"]), /Repeated/);
  assert.throws(() => parseScanOptions(["--force"]), /requires --output/);
  assert.throws(() => parseScanOptions(["--repo", "--staged"]), /Missing value/);
  assert.throws(() => parseScanOptions(["--lang", "fr"]), /zh or en/);
});
