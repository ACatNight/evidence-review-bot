export interface ScanOptions {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly format: "text" | "json";
  readonly language: "zh" | "en";
  readonly output?: string;
  readonly force: boolean;
}

export const USAGE = `用法 / Usage: evidence-review scan [options]

  --repo <path>       目标 Git 仓库；默认当前目录 / Target repository
  --base <ref>        比较基准；提交模式默认 HEAD~1 / Base revision
  --head <ref>        目标提交，或 WORKTREE；默认 HEAD / Head revision
  --staged           只检查暂存区；默认基准 HEAD / Review staged changes only
  --format <format>  text 或 json；默认 text / Report format
  --lang <language>  zh 或 en；默认 zh；仅影响文本报告 / Report language
  --output <path>    保存报告；相对调用目录 / Save report relative to current directory
  --force            允许替换已有报告；须配合 --output / Replace existing report
  -h, --help         显示帮助 / Show help

WORKTREE 模式默认基准 HEAD；未跟踪文件需先 git add。
仅执行 SEC-001，不调用 AI、不启动目标项目的 Lint、构建或测试。
退出码 / Exit codes: 0 无候选, 1 有候选, 2 参数错误, 3 覆盖不完整, 4 执行失败。

Examples (from this project's checkout):
  npm run review -- scan --repo ../my-project --staged
  npm run --silent review -- scan --repo ../my-project --base origin/main --format json
`;

export function parseScanOptions(args: readonly string[]): ScanOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valuedOptions = new Set(["--repo", "--base", "--head", "--format", "--lang", "--output"]);
  for (let index = 0; index < args.length; index++) {
    const option = args[index] as string;
    if (values.has(option) || flags.has(option)) throw new Error(`Repeated option: ${option}`);
    if (option === "--staged" || option === "--force") {
      flags.add(option);
      continue;
    }
    if (!valuedOptions.has(option)) throw new Error(`Unknown option: ${option}. See --help.`);
    const value = args[++index];
    if (!value || value.startsWith("--") || value === "-h") {
      throw new Error(`Missing value for ${option}. See --help.`);
    }
    values.set(option, value);
  }
  if (flags.has("--staged") && values.has("--head")) {
    throw new Error("--staged cannot be combined with --head.");
  }
  if (flags.has("--force") && !values.has("--output")) {
    throw new Error("--force requires --output.");
  }
  const format = values.get("--format") ?? "text";
  const language = values.get("--lang") ?? "zh";
  if (format !== "text" && format !== "json") throw new Error("--format must be text or json.");
  if (language !== "zh" && language !== "en") throw new Error("--lang must be zh or en.");
  const head = flags.has("--staged") ? "INDEX" : (values.get("--head") ?? "HEAD");
  if (head === "INDEX" && !flags.has("--staged"))
    throw new Error("Use --staged to scan the index.");
  const output = values.get("--output");
  return {
    repo: values.get("--repo") ?? ".",
    base: values.get("--base") ?? (head === "WORKTREE" || head === "INDEX" ? "HEAD" : "HEAD~1"),
    head,
    format,
    language,
    ...(output ? { output } : {}),
    force: flags.has("--force"),
  };
}
