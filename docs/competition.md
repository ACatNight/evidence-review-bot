# 竞品与差异化：待验证的产品位置

核查日期：2026-10-01。依据公开官方页面与官方仓库，未进行付费套餐试用或效果评测。官方介绍是能力声明，不是准确率证明。页面、版本和套餐会变化，对外发布对比前需再次核实。

## 1. 定位调整

Gitee 官方已提供原生 PR 审查助手，公开说明自动触发、结构化审查、业务上下文、规则配置和上传团队手册。因此 GitHub/Gitee 接入归入平台兼容性，团队知识与 RAG 归入后续能力，不能仅凭这些功能主张独特优势。

推荐定位：**开放、平台无关的 PR Review Engine，以确定性检查和可验证证据支持审查决策。** Bot 是平台上的交付入口，核心输出为有版本、有来源和覆盖说明的 Finding 与发布决策。

确定性优先是一项设计原则，不代表竞品只把 diff 交给 LLM，也不代表我们的规则天然更准确。证据链是需要实现和验收的契约，不是已证明的市场空白。开源、自托管、BYOK、多模型与跨平台可以影响选型，但不能简单累加成竞争壁垒。

## 2. 同一张能力对照表

| 产品及比较范围 | 已核实的官方能力 | 与本方案重叠 | 不能据现有资料下的结论 |
| --- | --- | --- | --- |
| **Gitee AI / AI 队友**，原生 PR 审查与安全扫描助手 | PR 创建/更新/重开自动触发、评论手动触发；结构化审查、业务上下文、自定义规则及团队手册；另有基于 CodePecker SCA 的安全扫描助手。[S1][S2] | 自动审查、规范配置、上下文、评论、依赖安全分析；原生工作流有接入便利性 | 不能声称它没有证据链、不能回放或内部只用 LLM；BYOK、具体部署与导出边界本次未确认 |
| **CodeRabbit**，公开产品及 Enterprise 自托管说明 | 多平台 AI 审查；官方架构写明结合静态分析器、linters/SAST、上下文探索和反馈知识；Enterprise 自托管说明包含自选模型服务。[S3][S4][S5] | 静态工具与 AI 组合、上下文、反馈、跨平台、自托管和模型选择 | 不能称其为“简单 AI 评论”；不同套餐、开放导出格式、精确回放与模型控制边界需单独验证 |
| **Semgrep**，Community Edition 与 AppSec Platform 分开看 | CE 为开源静态分析工具；平台有安全分析、策略和 PR 评论；官方 PR 文档说明按严重度/置信度筛选及 dataflow traces。[S6][S7] | 确定性分析、规则、可定位 findings、数据流证据、低噪声策略；也可成为我们的分析结果来源 | 不能声称它没有 PR 评论或证据；不能把平台全部能力归给 CE，或把本地扫描等同于全部 AI 数据不外发 [S8] |
| **PR-Agent**，开源仓库范围 | 官方 README 将其标为社区维护的 legacy 开源项目，区别于 Qodo 当前商业产品；提供 Action、CLI、Docker/自托管、模型配置；review 文档含覆盖提示、行锚点验证、摘要回退和持续评论状态。[S9][S10][S11] | 开源、自托管、多模型、PR 审查、覆盖说明及评论状态管理；是直接比较对象 | 不能把 PR-Agent 与 Qodo 商业版混为一谈，或仅凭 legacy 标签判断不可用；回放/证据导出细节本次未验证 |
| **Evidence Review Bot**，本仓库设计 | 当前只有设计文档，尚无可运行服务、平台集成或效果数据 | 计划复用成熟检测能力，统一证据、覆盖状态、发布决策和人工反馈 | 不能声称精度、时延、成本、回放或跨平台支持已优于上述产品 |

表中“本次未确认”表示证据不足，不是“不支持”。没有购买、部署和完成试用的产品不能标为经过性能验证。

## 3. 从功能列表到可验证主张

| 项目 | 项目中的角色 | 要证明什么 |
| --- | --- | --- |
| GitHub / Gitee / GitLab | 平台兼容 | 核心契约可复用，各适配器正确表达权限、坐标和输出能力 |
| 开源 / 自托管 / BYOK | 采纳与部署条件 | 目标团队有能力以可接受成本安装维护，模型数据流可控制 |
| 多模型 / 团队手册 / RAG | 后续扩展 | 在明确问题类型上改善有用发现，且没有不合理增加成本或泄露风险 |
| 确定性优先 | 执行原则 | 相同固定输入与工具版本有一致规范化输出，规则有反例与回归验证 |
| 可验证证据 | 输出质量契约 | 引用可定位、来源可追溯、推导有依据，审查者能判断规则是否适用 |
| 回放与审计 | 运维与验证契约 | 历史决策可查，输入齐全时可无发布副作用重跑，缺失时明确失败原因 |
| 反馈与校准 | 持续改进过程 | 经人工裁决的样本推动版本化改进，在留出集上验证而非自动相信反馈 |

首个商业价值假设是：**在保留有用发现的同时，减少无用评论与人工核查时间。** 这个结果要包含部署维护成本，不能靠关闭大多数检测获取好看的精确率。

SEC-001 能证明脱敏、证据与发布链路能工作，但密钥检测已有成熟方案，单条规则演示不能证明用户需要新产品。应优先比较“现有检测器直接发布”与“同一检测器经过本引擎筛选和证据整理”的差别；随后才比较新增语义能力。

## 4. 竞争位置与投入边界

建议寻找已使用自动审查或扫描工具、确实受评论噪声和追溯困难影响、愿意维护自托管工具的团队。对只需要开箱即用 AI 审查且已有原生助手满足需求的团队，本方案可能增加维护负担。

底层继续复用成熟扫描器和公告源，通过受控适配器保留原始规则 ID、工具版本及证据来源，不重新建设通用 SAST/SCA。未来可导入既有分析结果，但首次仅实现一条必要接入路径，不把“平台无关”扩张为完整插件市场。

平台首发顺序沿用 GitHub → 经验证后 Gitee/GitLab。若第一个明确试点只用 Gitee，应先验证其接口与业务需求再改顺序；Gitee 有原生助手并不构成放弃兼容或自动提前双平台开发的理由。

详细对照试验、回放和校准验收见[回放、审计与价值验证](evaluation.md)。如果试点不能证明增量价值，优先收窄为证据导出、审查报告或结果筛选组件。

## 5. 官方来源与支持范围

- **[S1]** [Gitee 官方博客：AI 队友公测启动](https://blog.gitee.com/2026/01/23/gitee-ai-teammate-beta-launch-code-review-vulnerability-detection/)。文章列出“上下文感知与规则配置”“亦可上传团队手册”及 PR 创建、更新、重新打开自动触发；安全扫描助手单独描述为 CodePecker SCA 能力。发布路径日期为 2026-01-23。
- **[S2]** [Gitee AI Teammates 产品页](https://gitee.com/ai-teammates)。确认 PR 审查助手和安全扫描助手为产品入口；本次读取的静态页面不足以判断全部配置、部署与套餐细节。
- **[S3]** [CodeRabbit 官方文档首页](https://docs.coderabbit.ai/)。列出 PR 审查、知识库、反馈及支持平台；不把营销效果用语当作实测结果。
- **[S4]** [CodeRabbit 官方架构](https://docs.coderabbit.ai/overview/architecture.md)。明确描述静态分析器、linters/SAST、上下文探索、验证与反馈知识的组合；这足以否定“竞品只调用 LLM”的简单假设。
- **[S5]** [CodeRabbit Self-hosted 官方说明](https://docs.coderabbit.ai/self-hosted/overview.md)。提供 Enterprise 自托管和 Bring your own model，且说明提示词/源码会发送到配置的模型服务。自托管应用不自动意味着推理数据不出网；商务门槛以当期页面与合同为准。
- **[S6]** [Semgrep 官方仓库 README](https://raw.githubusercontent.com/semgrep/semgrep/develop/README.md)。区分开源 CE 与 AppSec Platform；不能把平台功能全部视为开源引擎功能。
- **[S7]** [Semgrep 官方 GitHub PR comments 文档源码](https://raw.githubusercontent.com/semgrep/semgrep-docs/main/docs/semgrep-appsec-platform/github-pr-comments.mdx)。说明 findings、remediation policy、严重度/置信度筛选与 dataflow traces。
- **[S8]** [Semgrep 官方 AI privacy 文档源码](https://raw.githubusercontent.com/semgrep/semgrep-docs/main/docs/semgrep-multimodal/privacy.mdx)。说明不同 AI 功能向 AI subprocessors 发送相关代码的范围，不能将本地扫描的隐私描述泛化到所有 AI 功能。
- **[S9]** [PR-Agent 官方仓库 README](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/README.md)。本次读取明确区分社区维护的开源 legacy 项目与 Qodo 商业产品；保留这种范围区别。
- **[S10]** [PR-Agent 官方模型配置文档](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/docs/docs/usage-guide/changing_a_model.md)。说明模型、fallback、API endpoint/key 等配置；不由此推断所有模型具备相同能力。
- **[S11]** [PR-Agent 官方 review 文档](https://raw.githubusercontent.com/qodo-ai/pr-agent/main/docs/docs/tools/review.md)。包含 coverage footer、large PR chunking、inline key issues、persistent comment 与结构化 finding 状态；覆盖提示、锚点验证和跨运行评论管理不能作为我们的独有能力。

以上链接为可变官方页面或分支文档，不是冻结证据快照。若后续公开发表能力或成本对比，应固定采集版本/日期并复核相关套餐条款。
