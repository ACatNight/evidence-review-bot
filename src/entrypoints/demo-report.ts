import { demoReport } from "../examples/demo-report.js";

const platform = process.argv[2] ?? "github";
if (platform !== "github" && platform !== "gitee") {
  process.stderr.write("Usage: npm run demo:report -- [github|gitee]\n");
  process.exitCode = 1;
} else {
  process.stdout.write(demoReport(platform));
  process.stdout.write("\n");
}
