import {
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function saveReport(path: string, contents: string, force: boolean): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = mkdtempSync(join(dirname(path), ".evidence-report-"));
  try {
    const source = join(temporary, "report");
    writeFileSync(source, contents, { encoding: "utf8", mode: 0o600 });
    if (force) renameSync(source, path);
    else copyFileSync(source, path, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Report already exists. Choose another --output path or use --force.");
    }
    throw new Error("Could not save report. Check --output and directory write permissions.");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
