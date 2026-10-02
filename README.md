# Evidence Review Bot

开源 PR 审查引擎，以确定性规则、证据和覆盖状态辅助审查。

**当前状态：GitHub Webhook、固定 SHA 的 PR 快照、SEC-001 候选扫描和 Check 汇总已接通。可选 OpenAI 安全审查默认关闭；PR 工作流另跑 Lint、类型检查、测试、npm 依赖审计和 CodeQL。反馈、抑制、回放和完整审计仍未实现；当前只适合测试仓库联调。**

## 使用入口

最新功能、离线报告示例和接入步骤见维护分支：

- [GitHub：github 分支](https://github.com/ACatNight/evidence-review-bot/tree/github)
- [Gitee：gitee 分支](https://gitee.com/mournic/evidence-review-bot/tree/gitee)

运行示例前请先切换到相应维护分支；此分支保留既有代码版本。

## 本地开发

需要 Node.js 22.22.2 和 npm：

```bash
npm ci
npm run lint
npm run check
npm test
```

数据库集成测试使用 `TEST_DATABASE_URL` 指定名为 `evidence_review_bot_test` 的专用 PostgreSQL 数据库。测试会清理测试数据，请勿使用业务数据库。

## 许可证

[Apache License 2.0](LICENSE)。
