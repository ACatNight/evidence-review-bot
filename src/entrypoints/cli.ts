#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLocalSnapshot } from "../adapters/local/git.js";
import { checkOutput, reviewSnapshot } from "../application/review-pr.js";
import { reviewReportToProtocolResult } from "../protocol/from-report.js";
import { serializeReviewResult } from "../protocol/json.js";

type Format = "text" | "json";

interface CliOptions {
  readonly base: string;
  readonly head: string;
  readonly format: Format;
  readonly output?: string;
}

function usage(): string {
  return [
    "Usage: evidence-review scan [options]",
    "",
    "Options:",
    "  --base <ref>       Base commit or branch (default: HEAD~1)",
    "  --head <ref>       Head commit, or WORKTREE (default: HEAD)",
    "  --format <format>  text or json (default: text)",
    "  --output <path>    Write the report to a file instead of stdout",
    "",
    "Example:",
    "  npm run review -- scan --base origin/main --format json",
  ].join("\n");
}

function parseOptions(args: readonly string[]): CliOptions {
  let base = "HEAD~1";
  let head = "HEAD";
  let format: Format = "text";
  let output: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const next = args[index + 1];
    const value = next?.startsWith("--") ? undefined : next;
    if (argument === "--base" && value) {
      base = value;
      index++;
    } else if (argument === "--head" && value) {
      head = value;
      index++;
    } else if (argument === "--format" && value) {
      if (value !== "text" && value !== "json") throw new Error("--format must be text or json");
      format = value;
      index++;
    } else if (argument === "--output" && value) {
      output = value;
      index++;
    } else {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
  }
  return { base, head, format, ...(output ? { output } : {}) };
}

function main(): number {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "help" || args.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (command !== "scan") {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  let options: CliOptions;
  try {
    options = parseOptions(args);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid options"}\n`);
    return 2;
  }
  try {
    const root = process.cwd();
    const snapshot = createLocalSnapshot(root, options.base, options.head);
    const hmacKey = process.env.REVIEW_HMAC_KEY
      ? Buffer.from(process.env.REVIEW_HMAC_KEY, "hex")
      : randomBytes(32);
    const report = reviewSnapshot(snapshot, hmacKey);
    const output =
      options.format === "json"
        ? serializeReviewResult(reviewReportToProtocolResult(snapshot, report))
        : `${checkOutput(report, snapshot.headSha).text}\n`;
    if (options.output) writeFileSync(resolve(root, options.output), output, "utf8");
    else process.stdout.write(output);
    if (report.coverage.state === "partial") return 3;
    return report.findings.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      error instanceof Error && error.message.startsWith("Command failed")
        ? "Git snapshot could not be read. Check the repository and base/head refs.\n"
        : `${error instanceof Error ? error.message : "Review failed"}\n`,
    );
    return 4;
  }
}

process.exitCode = main();
