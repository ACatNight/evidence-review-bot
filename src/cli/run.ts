import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createLocalSnapshot } from "../adapters/local/git.js";
import { reviewSnapshot } from "../application/review-pr.js";
import { reviewReportToProtocolResult } from "../protocol/from-report.js";
import { serializeReviewResult } from "../protocol/json.js";
import { parseScanOptions, type ScanOptions, USAGE } from "./options.js";
import { saveReport } from "./output.js";
import { renderLocalReport } from "./report.js";

function hmacKey(): Buffer {
  const value = process.env.REVIEW_HMAC_KEY;
  if (value === undefined) return randomBytes(32);
  if (!/^(?:[a-fA-F0-9]{2}){32,}$/.test(value)) {
    throw new Error(
      "REVIEW_HMAC_KEY must contain at least 32 bytes of hexadecimal, or be unset for local review.",
    );
  }
  return Buffer.from(value, "hex");
}

export function runCli(argv: readonly string[]): number {
  const [command, ...args] = argv;
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h" ||
    (command === "scan" && (args.includes("--help") || args.includes("-h")))
  ) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command !== "scan") {
    process.stderr.write("Unknown command. Run evidence-review --help.\n");
    return 2;
  }
  let options: ScanOptions;
  try {
    options = parseScanOptions(args);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }
  try {
    const key = hmacKey();
    const snapshot = createLocalSnapshot(resolve(options.repo), options.base, options.head);
    const report = reviewSnapshot(snapshot, key);
    const output =
      options.format === "json"
        ? serializeReviewResult(reviewReportToProtocolResult(snapshot, report))
        : renderLocalReport(snapshot, report, options);
    if (options.output) {
      saveReport(resolve(options.output), output, options.force);
      process.stderr.write(
        options.language === "zh"
          ? "审查报告已保存到指定的 --output 路径。\n"
          : "Report saved to the requested --output path.\n",
      );
    } else process.stdout.write(output);
    if (report.coverage.state === "partial") return 3;
    return report.findings.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Review failed"}\n`);
    return 4;
  }
}
