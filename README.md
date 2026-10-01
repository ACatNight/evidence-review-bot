# Evidence Review Bot

开放、平台无关的 PR Review Engine，以确定性检查和可验证证据支持审查决策。

**当前状态：GitHub Webhook、固定 SHA 的 PR 快照、SEC-001 候选扫描和 Check 汇总已接通；Gitee 单仓库适配提供 Webhook、固定 SHA 快照和中文 PR 评论报告。可选 OpenAI 安全审查默认关闭；GitHub PR 工作流另跑 Lint、类型检查、测试、npm 依赖审计和 CodeQL。反馈、抑制、回放和完整审计仍未实现；当前只适合测试仓库联调。**

项目希望减少没有依据的审查评论：先使用可验证的规则发现问题，再按需获取上下文和调用模型，并把每项结论绑定到具体代码快照、规则版本和证据来源。

GitHub、Gitee、GitLab 接入属于平台兼容性。自托管、自选模型和团队规范属于部署与扩展能力。我们希望验证的价值是：在保留有用发现的同时减少无用评论，让维护者能够核查、反馈并回顾每次审查决策。当前尚无对照数据证明产品优于现有工具。

## 推荐首版

- GitHub App，自托管部署，单仓库闭环后再验证多个安装之间的隔离。
- 以 JavaScript / TypeScript、npm 为试点生态；这是可调整的设计默认，尚未由试点需求验证。
- 首版仅实现高精度 Secret 检测；锁文件已知漏洞匹配安排在 M3。
- Check 汇总优先，逐行评论经准确率与定位验证后按配置开启。
- LLM 后续先以静默模式评估；关闭 LLM 时仍可完成基础审查。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [产品与范围](docs/product.md) | 目标用户、首版边界、成功指标 |
| [首版实施基线](docs/mvp.md) | 统一范围、默认行为与 A01–A12 验收 |
| [竞品与差异化](docs/competition.md) | Gitee AI、CodeRabbit、Semgrep、PR-Agent 的已知重叠与待验证价值 |
| [回放、审计与评估](docs/evaluation.md) | 证据验证、无副作用回放、对照试验和反馈校准 |
| [架构设计](docs/architecture.md) | 模块、进程、任务执行、发布一致性 |
| [数据模型](docs/data-model.md) | 快照、运行、Finding、Evidence、发布记录 |
| [平台接入](docs/platforms.md) | 平台能力、授权、diff 定位与降级 |
| [规则契约](docs/rules.md) | 三条候选规则、抑制、覆盖范围、测试约束 |
| [SEC-001 当前实现边界](docs/sec-001-implementation.md) | 已支持格式、漏报边界与接入前验证 |
| [本地开发与数据库验证](docs/local-development.md) | D 盘 PostgreSQL 实例、迁移与集成测试 |
| [Windows 快速部署](docs/deployment-windows.md) | 首次填写配置，之后一条命令启动或停止 |
| [Gitee 测试仓库接入](docs/gitee-setup.md) | 令牌、Webhook 签名和中文 PR 报告验收 |
| [安全与数据处理](docs/security.md) | 信任边界、脱敏、访问隔离、留存 |
| [架构决策记录](docs/decisions.md) | 推荐方案、取舍、待验证问题 |
| [实施路线](docs/roadmap.md) | 阶段交付、验收、试点门槛 |

建议阅读顺序：首版实施基线 → 架构设计 → 数据模型 → 实施路线。竞争定位与试点评估分别见对应文档。

## 本地验证

Windows 本机部署先运行 `powershell -NoProfile -File .\scripts\configure-windows.ps1` 填写一次路径和参数，之后运行 `powershell -NoProfile -File .\scripts\start-windows.ps1` 启动 API 与 Worker。停止使用 `powershell -NoProfile -File .\scripts\stop-windows.ps1`。需要 Node.js、PostgreSQL 和可到达本机 API 的 HTTPS Webhook 地址，详见[快速部署](docs/deployment-windows.md)。

需要 Node.js 22.22.2 和 npm。执行 `npm ci` 安装锁定依赖，`npm run check` 做类型检查，`npm test` 编译并运行测试。`src/domain/` 包含平台无关契约、覆盖汇总与证据图校验；`src/rules/secret.ts` 包含仅支持明确格式的 Secret 候选检测器。测试位于 `test/`。

`npm run db:migrate` 应用数据库迁移，`npm run start:api` 启动 Webhook 接收 API，`npm run start:worker` 处理任务并发布 Check，`npm run inspect:queue` 查看任务与发布状态。OpenAI 密钥、仓库白名单及本地 GitHub App 联调步骤见[本地开发说明](docs/local-development.md)。

## 设计原则

1. 可重复执行的规则也可能误报；每条规则都需要正例、反例与回归集。
2. 证据来源、工具推导和风险解释分别记录；模型输出不能充当已观察事实。
3. 每次分析绑定不可变代码快照；发布时核对当前 PR，保留过期与部分覆盖状态。
4. 检测到零条问题不等于扫描完整；失败、跳过和截断必须明确显示。
5. Secret 在持久化、日志、平台输出和外部模型调用前脱敏。
6. 先验证一个平台上的可靠闭环，再扩展平台、语言和 AI 能力。

## 开发状态

当前文档不是安装指南，也不表示已通过真实平台集成验证。技术栈、API 权限、容量预算和规则发布阈值的确认条件见[架构决策记录](docs/decisions.md)与[实施路线](docs/roadmap.md)。

## License

[Apache License 2.0](LICENSE)。第三方分析工具和漏洞数据仍需分别检查许可证、署名及再分发要求。
