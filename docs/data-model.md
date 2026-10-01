# 数据模型设计提案

> 状态：讨论稿。以下是逻辑模型与 PostgreSQL 落库建议，字段和约束应在实现及迁移时进一步细化；当前仓库尚未实现这些表。

## 1. 标识、不可变性与版本

所有内部主键建议使用 UUID；外部平台 ID 保留原始字符串，不能假设不同平台的 ID 全局唯一。仓库及 PR 的唯一性由 `provider + provider_repository_id`、`provider + provider_repository_id + provider_pr_id` 保证。时间使用 UTC，展示时再按用户时区转换。

一次 `pull_request_snapshot` 固定 `merge_base_sha`、`base_sha`、`head_sha`、抓取时间、文件清单摘要与 diff 摘要。快照生成后不原地改写；SHA 组合变化产生新快照，相同组合重新抓取复用身份并核验摘要。额外抓取尝试及其覆盖情况归属运行，不能把首次抓取不完整的数据当作完整缓存。规则包、配置、分析器、漏洞源及模型/提示模板使用版本或内容摘要固定到 `review_run`，保证分析过程可追溯。外部公告数据可能修订，必须记录公告 ID、来源、查询时间和当时使用的内容摘要。未来支持多个自建平台实例时，provider 必须包含实例域名或独立 instance_id。

## 2. 主要实体

| 实体 | 关键字段 | 约束与用途 |
| --- | --- | --- |
| `installation` | `provider`, `provider_installation_id`, `account_id`, `status`, `permissions_digest` | 平台安装与权限状态；密钥凭据引用独立机密存储 |
| `repository` | `provider`, `provider_repository_id`, `installation_id`, `full_name`, `default_branch` | 仓库身份以外部 ID 为准，名称可变 |
| `pull_request` | `repository_id`, `provider_pr_id`, `number`, `current_base_sha`, `current_head_sha`, `desired_run_id`, `publish_generation`, `state` | 当前状态用于调度及发布核验；同 SHA 下的新运行也须防止旧输出覆盖 |
| `webhook_delivery` | `provider`, `installation_id`, `delivery_id`, `event_type`, `payload_digest`, `received_at`, `processing_status` | 唯一约束 `(provider, installation_id, delivery_id)`；原始载荷按最小保留策略处理 |
| `pull_request_snapshot` | `pull_request_id`, `merge_base_sha`, `base_sha`, `head_sha`, `manifest_digest`, `diff_digest`, `captured_at` | 唯一约束三个 SHA 与 PR；内容不可变 |
| `snapshot_file` | `snapshot_id`, `path`, `old_path`, `status`, `language`, `blob_sha`, `patch_digest`, `changed_lines`, `coverage_state` | 支持 rename、删除、二进制与补丁缺失；路径不是身份主键 |
| `review_run` | `snapshot_id`, `mode`, `analysis_key`, `rerun_generation`, `superseded_by_run_id`, `rule_bundle_digest`, `config_digest`, `analyzer_version`, `advisory_snapshot_id`, `model_profile_digest`, `coverage_state`, `state`, `failure_phase`, `started_at`, `finished_at` | mode 为 review/replay；固定输入版本后生成 analysis_key；replay 禁止发布 |
| `review_job` | `kind`, `delivery_id`, `repository_id`, `pr_number`, `run_id`, `state`, `priority`, `attempts`, `available_at`, `lease_owner`, `lease_until`, `lease_generation`, `last_error_code` | snapshot 类型以事件/PR 为目标且 run_id 可空；analysis 类型必须有 run_id；短事务领取并校验租约代次 |
| `finding` | `run_id`, `rule_id`, `rule_version`, `fingerprint`, `severity`, `confidence`, `method`, `title`, `location_id`, `state` | 同一 run 内 `(run_id, fingerprint)` 唯一；跨 run 用指纹关联 |
| `finding_location` | `snapshot_id`, `path`, `side`, `start_line`, `end_line`, `blob_sha`, `diff_hunk_digest`, `semantic_anchor` | 使用新文件/旧文件侧与平台可发布坐标分离；行号可能因更新而失效 |
| `evidence_node` | `run_id`, `kind`, `source_type`, `source_ref`, `content_digest`, `redacted_excerpt`, `producer`, `producer_version`, `recorded_at` | `kind` 为 observed/derived/reasoning；不存未脱敏 Secret 原文 |
| `evidence_edge` | `from_node_id`, `to_node_id`, `relation` | 从结论或派生节点指向其依赖节点；应用层验证无环与同 run 归属 |
| `finding_evidence` | `finding_id`, `evidence_node_id`, `role` | 关联 Finding 的直接证据与推理链根节点 |
| `coverage_record` | `run_id`, `scope_type`, `scope_ref`, `rule_id`, `state`, `reason_code`, `detail` | 记录 complete/partial/not_run 及跳过原因 |
| `suppression` | `repository_id`, `rule_id`, `scope`, `fingerprint`, `reason`, `created_by`, `expires_at` | 审计可见的人工或配置抑制 |
| `publication_intent` | `run_id`, `finding_id`, `channel`, `publication_key`, `publish_generation`, `state`, `external_id`, `attempts`, `last_error_code` | 唯一 `publication_key`；Check 的 finding_id 可空；发布须匹配当前期望运行代次；不得关联 replay |
| `publication_attempt` | `intent_id`, `attempt_no`, `request_digest`, `response_code`, `external_id`, `started_at`, `finished_at` | 记录不确定结果与回查依据，不存访问令牌 |
| `publication_binding` | `repository_id`, `pull_request_id`, `channel`, `binding_scope`, `finding_fingerprint`, `external_id`, `last_run_id` | Check 的 binding_scope 为 head_sha、指纹为 summary；评论使用明确的 PR 问题作用域；按仓库/PR/渠道/scope/指纹唯一 |
| `config_snapshot` | `repository_id`, `trusted_base_sha`, `content_digest`, `schema_version`, `redacted_config` | 固定可信配置来源；引用外部凭据而非保存凭据 |
| `advisory_snapshot` | `source`, `fetched_at`, `content_digest`, `retained_payload_ref`, `retention_until` | 保留被使用的公告集合或响应；不能只凭时间戳承诺可复现 |
| `review_feedback` | `finding_id`, `external_actor_id`, `verdict`, `disposition`, `reason`, `source`, `supersedes_feedback_id`, `recorded_at` | 判断与风险处置分开；修订追加新记录；人工反馈不自动改写规则 |
| `audit_event` | `run_id`, `delivery_id`, `actor_type`, `action`, `subject_type`, `subject_id`, `redacted_metadata`, `metadata_digest`, `created_at` | 入队前后事件允许 run_id 为空；保存可读脱敏元数据及摘要，仅摘要无法解释过程 |

首版默认不持久化原始源码、完整补丁或原始 Webhook 载荷，仅保存必要元数据、脱敏证据和受控摘要；源码在有界内存中使用后释放。重跑从固定 SHA 重新读取，源码不可获取时明确说明无法完整复现。不能以 `redacted_excerpt` 作为重新分析的唯一源码依据。未来若需源码归档，应单独决策并更新安全策略；对象存储不是首版必需依赖。

## 3. 核心对象示例

```json
{
  "snapshot": {
    "merge_base_sha": "m1",
    "base_sha": "b1",
    "head_sha": "h1",
    "diff_digest": "sha256:..."
  },
  "run": {
    "rule_bundle_digest": "sha256:...",
    "config_digest": "sha256:...",
    "analyzer_version": "review-engine/0.x",
    "advisory_snapshot_id": null
  },
  "finding": {
    "rule_id": "SEC-001",
    "fingerprint": "sha256:...",
    "location": { "path": "src/config.ts", "side": "RIGHT", "start_line": 21 },
    "confidence": "high",
    "evidence_root_ids": ["ev-reasoning-1"]
  }
}
```

示例值仅说明结构；真实 SHA、摘要与 advisory 快照 ID 必须来自抓取和分析结果。`confidence` 为 `high/medium/low` 的策略等级，另记录证据强度与规则判定条件，避免把它解释成数值概率。

## 4. 证据 DAG 契约

`observed` 节点必须有可验证的来源：快照 ID、文件内容摘要、路径、行区间及必要的脱敏摘录，或外部公告 ID/来源/内容摘要。`derived` 节点必须列出输入节点、转换工具与版本，例如“锁文件解析器确定精确版本”。`reasoning` 节点引用支撑结论的观察/派生节点，并区分规则结论与模型候选解释。

边方向统一为“结论 → 依赖”。同一节点可被多个 Finding 复用，但不得跨不兼容快照或运行复用。写入时验证无环、来源存在、摘要匹配；发布时检查从 Finding 根节点能到达至少一个有效 observed 节点。不能为了填满证据链而让 LLM 编造观察或派生事实。

Secret 类规则对原文使用受控短期读取；持久化及平台输出只能放掩码、类型、长度/格式信息和内容摘要。哈希本身可能泄漏低熵值，不能直接对短密码做公开哈希；必要时使用租户密钥 HMAC，且不出现在评论中。

## 5. 键与状态语义

```text
event_key        = provider / installation_id / delivery_id
snapshot_key     = provider / repository_id / pr_id / merge_base_sha / base_sha / head_sha
analysis_key     = snapshot_key / rule_bundle_digest / config_digest /
                   analyzer_version / advisory_snapshot_id / model_profile_digest
publication_key  = provider / repository_id / pr_id / channel / run_id / finding_fingerprint
```

这些键使用规范序列化与摘要生成，斜线只是说明组合字段。`analysis_key` 相同可复用覆盖充分的既有成功结果，手动强制重跑仍建立新 `run_id` 并记原因。以 `(analysis_key, mode, rerun_generation)` 唯一约束实现：自动 review 调度 generation 为 0，显式重跑或 replay 在相应 mode 下事务分配递增代次；基础设施重试只增加 job attempt。replay 不改变 desired_run_id，也不能复用已有结果冒充重新执行。`publication_key` 保证本地只有一个发布意图，摘要使用 summary 指纹；跨运行先查 publication_binding。外部 API 超时后仍可能已经发布，因此重试需要先回查，且不能声称端到端 exactly-once。

`review_run` 的终态包括 `completed`、`failed`、`canceled`、`superseded`。覆盖状态独立为 `complete / partial / not_run`；completed + partial 表示运行已结束但有覆盖缺口，不能等同于“无问题”。规则执行的 skipped/failed 在覆盖层映射为缺口并保留具体原因。`publication_intent` 至少包括 `pending`、`publishing`、`published`、`uncertain`、`retrying`、`failed`、`skipped_superseded`；`uncertain` 必须先回查远端再决定创建。状态迁移与租约采用条件更新或行锁，防止多个 Worker 同时处理。

### 状态迁移约束

| 对象 | 正常迁移 | 失败与恢复 |
| --- | --- | --- |
| snapshot job | queued → running → completed | 重试仍属此 job，耗尽后 failed；失败可按 delivery/PR 查看，此时没有 run |
| analysis job | queued → running → completed | 租约续期及 attempt 独立记录；恢复必须校验 generation |
| review run | queued → analyzing → publishing → completed | 可重试故障维持当前阶段；耗尽后 failed 并记录 failure_phase；分析结果保留 |
| replay run | queued → analyzing → completed | 输入不可用时 run 为 failed、错误码 input_unavailable，对调用者返回 unavailable；不伪造输出或进入 publishing |
| 发布意图 | pending → publishing → published | 超时 uncertain；确定可重试才 retrying；永久失败为 failed |

外部请求未发出前，取消或被替代可使未结束运行进入 canceled/superseded。已经 completed 的历史运行保留其事实终态，填 superseded_by_run_id 并依据当前快照判断其是否仍适用，不重写旧 findings。review run 只有必需的 Check 意图完成或按规则明确跳过才能 completed；发布失败不能抹掉已完成的分析。分析与发布耗时分开计量。

完整性按启用规则及明确列出的适用范围计算：预先声明的不适用文件单列 excluded；适用文件因解析、读取、限额失败则 partial；没有启用规则或没有实际执行为 not_run。结果必须同时显示总变更数、适用数、完成数与缺口，不以缩小分母掩盖跳过文件。

### 输入版本与反馈

首版 advisory/model 字段为空且有明确 not_applicable 语义。DEP 阶段先固定使用的公告响应集合再封存分析身份；不可用时保留带原因的缺口标识，不能把“源不可用”与“不需要公告”都表示成同一个 null 并命中干净缓存。重新获取到公告构成新输入，不原地改变旧 run。模型参数、可信配置与抑制快照同样进入版本摘要。

反馈 verdict 固定为 useful、valid_not_actionable、false_positive、insufficient_evidence；disposition 为 unresolved、accepted_risk、fixed。判断真假与是否修复分别统计；未收到反馈不默认设置 useful。双人标注与裁决、dataset 版本和校准划分在 M2 增加，M1 保留原始反馈、修订与来源即可。

## 6. 发布与旧结果关系

发布前用平台 API 核对 PR 当前 head/base；变更则跳过旧快照的新增评论。已发布结果不能靠数据库回滚，需要记录外部 ID，并按明确策略更新 Check、隐藏/解决旧评论或标记过期。跨运行使用 Finding 指纹匹配同一问题，但路径重命名与代码移动需要谨慎匹配；无法确定时宁可在 Check 汇总说明，不自动合并两个不同问题。

GitHub Check Run 绑定提交：新 head 必须新建 Check，同一 head 的重新分析才能按策略更新现有 Check。旧行评论的正文更新不代表锚点移动；同一问题跨提交仍存在时可保留旧评论并在当前摘要关联，不要求平台支持重新锚定。每次远端调用的历史仍保存在 publication_attempt，不因 binding 指向新运行而丢失。

Check 是一次运行的覆盖与结论摘要，状态应表达分析失败、部分覆盖和发现问题的区别。行内评论只用于能准确映射到当前 diff、证据达到阈值且未被抑制的 Finding。SARIF 可作为后续输出适配器，不能假设所有平台都支持与 GitHub 相同的上传和展示行为。
