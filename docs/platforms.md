# 平台接入与发布设计

状态：GitHub 为首发平台；Gitee 单仓库 PR 摘要适配进入测试，GitLab 为后续目标。下表含后续能力设计，**不代表全部 API、权限及配额已实测**。

平台接入属于兼容性，不作为独有卖点。Gitee 官方已公开 PR 审查助手及团队文档配置能力，见[竞品对照](competition.md)。核心独立于平台的目标是让相同审查契约可复用，不能据此承诺各平台提供相同发布功能。

## 能力矩阵

| 能力 | GitHub 首发 | Gitee 后续 | GitLab 后续 | 实施验证项 |
| --- | --- | --- | --- | --- |
| 安装/授权与撤销 | GitHub App | 测试仓库使用私人令牌；多租户授权待设计 | 待选授权模式 | 最小权限、安装范围、短期令牌、撤销事件与权限变更通知 |
| Webhook 验签与重投 | 必需 | 适配时必需 | 适配时必需 | 签名算法、原始请求体、投递 ID、事件类型、重试语义 |
| PR 元数据与固定 SHA 文件 | 必需 | 适配时必需 | 适配时必需 | fork PR、base/head SHA、文件读取范围、私有仓库权限 |
| Changed files / diff | 必需 | 适配时必需 | 适配时必需 | 分页、最大文件/补丁限制、二进制、重命名、缺失 patch |
| 逐行评论 | 条件支持 | 能力探测后启用 | 能力探测后启用 | 行锚点、side、旧 commit、批量限制、更新/删除能力 |
| 摘要/状态输出 | Check 为首发目标 | 中文 PR 评论；原生状态待验证 | 适配平台状态/评论 | 创建与更新权限、状态/结论枚举、展示限制 |
| SARIF | 延后 | 延后 | 延后 | 接口、权限、大小和有效位置限制；不能假设通用支持 |
| API 配额与退避 | 必需 | 适配时必需 | 适配时必需 | 429/次级限流、Retry-After、分页上限、条件请求 |

平台适配器需暴露**能力声明**，例如 `supportsChecks`、`supportsInlineComment`、`supportsCommentUpdate`、`supportsSarif`、`diffCompleteness`，并在运行时确认。核心引擎只生成平台中立的 Review、Finding、Evidence、Coverage；发布器按实际能力降级到摘要。不要把 GitHub 的 review/check 语义机械映射到 Gitee 或 GitLab。

## 首发 GitHub 工作流

1. Webhook 只负责验签、鉴权、事件标准化和持久化。以安装身份获取 PR、仓库、base/head SHA；对 fork PR 不使用来自 PR 的凭据或执行配置。
2. 按页获取 changed files，统计平台声明的文件数和实际获取数，记录 `patch` 缺失、截断、二进制、重命名、子模块、过大文件等覆盖缺口。解析 diff 时保留旧/新路径、hunk、左右侧行号。固定 SHA 读取必要上下文，禁止默认读取浮动分支名。
3. Worker 在固定的 base/head 和可信 base 策略上审查。结果包含 `complete`/`partial`；获取失败与“无发现”是不同状态。
4. outbox 负责发布。发送前重新拉取 PR 状态、base/head 和安装权限。对已过期任务停止发布，并让新 SHA 任务接替。
5. 首发默认只发布 Check 汇总。可信配置开启逐行评论且规则通过质量门槛后，评论只发到当前 diff 可定位的变更行。发布前验证 path、line、side 和 commit；平台拒绝锚点或返回过期错误时，将 finding 放入 Check 摘要，并记录失败原因。不要猜一个看似接近的行号。
6. Check 展示 findings、证据摘要、覆盖范围、跳过原因、规则/数据版本和对应 SHA。新 head 创建新 Check，同一 head 的重跑可按策略更新已有 Check；没有 Finding 仍需发布摘要。`partial` 结果必须醒目标示未审查部分，不能使用“代码安全/审查通过”的措辞。结论与 required check 策略须在 GitHub 实际权限及状态语义验证后确定。

外部发布不是数据库事务的一部分。提交 API 请求成功但本地记录失败时，重试可能重复产生输出；需要稳定 fingerprint、目标 commit、平台对象 ID 和发布前查询/更新策略。仍不能保证与 PR 更新原子同步，故记录确认时的 SHA、发布返回对象的 SHA，并对过期输出做后续修正。所有平台错误按永久错误、可重试错误、限流及权限撤销分类；429 或有 `Retry-After` 的响应遵循平台退避指示并加抖动。不得无限重试或对同一 PR 形成评论风暴。

## 平台适配接口

```text
verifyWebhook(rawBody, headers)
normalizeEvent(payload)
getPullRequest(installation, repository, number)
listChangedFiles(pr, page)
getFileAtCommit(repository, path, sha)
getCapabilities(installation, repository)
publishSummary(review, expectedHeadSha)
publishInlineComment(finding, diffAnchor, expectedHeadSha)
findOrUpdatePublishedObject(fingerprint, expectedHeadSha)
```

接口结果必须携带来源、分页完成状态和错误类型，不能只返回一个可能不完整的 diff 字符串。`expectedHeadSha` 是适配器发送前的复核条件，不能被误解为平台提供原子 compare-and-swap。平台之间的权限、评论锚点和输出能力留在适配层；核心规则不得依赖特定平台 SDK。

## GitHub 实施验证清单

以下均为待验证事项，开发时以所选 GitHub API 版本和真实安装环境测试并记录证据：

- GitHub App 读取 PR/Contents、创建 Check 与 Review Comment、后续 SARIF 所需的具体权限组合和组织策略。
- changed files、diff、文件内容端点的分页与上限；`patch` 缺失、二进制、大文件、重命名、fork 与 force push 情形。
- 评论锚点使用的 path、line、side、commit 参数及平台拒绝旧 SHA 的行为；Check 更新和已有评论更新/删除的行为。
- Webhook 签名、投递标识、事件重放和安装撤销/权限变化事件；API 主/次级限流、429、403、`Retry-After` 的实际响应。
- Check 在 partial、失败和无发现时的 conclusion 展示，以及仓库把它设为 required check 后的门禁效果。

完成 GitHub 试点后，再用同一组合同测试适配 Gitee、GitLab。只有通过验签、固定 SHA、diff 完整性、行锚点、撤销权限和限流测试的平台，才开放自动逐行发布。
