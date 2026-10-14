import { demoProtocolReport, demoReport } from "../examples/demo-report.js";

const platform = process.argv[2] ?? "github";
if (platform !== "github" && platform !== "gitee" && platform !== "json") {
  process.stderr.write("Usage: npm run demo:report -- [github|gitee|json]\n");
  process.exitCode = 1;
} else {
  process.stdout.write(platform === "json" ? demoProtocolReport("github") : demoReport(platform));
  process.stdout.write("\n");
}
