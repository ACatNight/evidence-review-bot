import assert from "node:assert/strict";
import test from "node:test";
import { demoReport } from "../src/examples/demo-report.js";

test("offline example reports label their synthetic data and coverage gaps", () => {
  const github = demoReport("github");
  const gitee = demoReport("gitee");
  assert.match(github, /Synthetic example report/);
  assert.match(github, /Review Coverage/);
  assert.match(github, /Coverage gaps/);
  assert.match(gitee, /合成示例报告/);
  assert.match(gitee, /审查覆盖率/);
  assert.match(gitee, /未检查范围/);
  assert.doesNotMatch(gitee, /evidence-review-bot:gitee:/);
  assert.doesNotMatch(github + gitee, /ghp_[A-Za-z0-9]{36}/);
});
