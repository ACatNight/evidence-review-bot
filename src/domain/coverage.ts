import type { CoverageRecord, CoverageSummary } from "./review.js";

export function summarizeCoverage(
  changedFiles: readonly string[],
  enabledRuleIds: readonly string[],
  records: readonly CoverageRecord[],
): CoverageSummary {
  const paths = new Set(changedFiles);
  const rules = new Set(enabledRuleIds);
  if (paths.size !== changedFiles.length || rules.size !== enabledRuleIds.length) {
    throw new Error("Duplicate paths or rule IDs in coverage scope");
  }

  const expected = paths.size * rules.size;
  const seen = new Set<string>();
  let complete = 0;
  let incomplete = 0;
  let excluded = 0;

  for (const record of records) {
    if (!paths.has(record.path) || !rules.has(record.ruleId)) {
      throw new Error("Coverage record is outside the declared scope");
    }
    const key = JSON.stringify([record.ruleId, record.path]);
    if (seen.has(key)) {
      throw new Error("Duplicate coverage record");
    }
    seen.add(key);
    if (record.state === "complete") {
      if (record.reason !== undefined) throw new Error("Complete coverage cannot have a reason");
      complete++;
    } else if (record.state === "excluded") {
      if (record.reason !== "unsupported") throw new Error("Excluded scope needs an unsupported reason");
      excluded++;
    } else {
      if (record.reason === undefined || record.reason === "unsupported" || record.reason === "rule_disabled") {
        throw new Error("Incomplete coverage needs a failure reason");
      }
      incomplete++;
    }
  }

  incomplete += expected - seen.size;
  const applicable = expected - excluded;
  const state = expected === 0 || applicable === 0
    ? "not_run"
    : incomplete > 0 ? "partial" : "complete";

  return {
    state,
    changedFiles: paths.size,
    applicableFiles: applicable,
    completedFiles: complete,
    incompleteFiles: incomplete,
    excludedFiles: excluded,
  };
}
