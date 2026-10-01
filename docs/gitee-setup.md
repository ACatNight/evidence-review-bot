# Gitee 测试仓库接入

当前对明确配置的 Gitee 仓库发布中文 PR 摘要评论。`mournic/evidence-review-bot` 是首个测试仓库；额外仓库按数字 ID 配置各自的令牌与 Webhook 签名密钥。Gitee 的平台分支 `gitee` 仍是长期发布分支；Webhook 处理的是 Gitee PR 事件，与代码同步分支不是同一回事。

## 首次配置

1. 在 Gitee 的[私人令牌页面](https://gitee.com/profile/personal_access_tokens)创建有该仓库读取和 PR 评论权限的令牌。只把令牌保存在本机仓库外的文件中，推荐当前用户 DPAPI 加密文件；不要提交、发送到聊天或填进 Webhook URL。
2. 运行 `powershell -NoProfile -File .\scripts\configure-windows.ps1`，将 Gitee 审查设为 `y`，填写令牌文件路径、仓库所有者 `mournic`、仓库名 `evidence-review-bot`、数字仓库 ID `50617958`。此时 Webhook 签名密钥可留空，先手动验收。
3. 运行 `powershell -NoProfile -File .\scripts\stop-windows.ps1` 和 `powershell -NoProfile -File .\scripts\start-windows.ps1`，让 API 和 Worker 加载新配置。
4. 运行 `powershell -NoProfile -File .\scripts\review-gitee-windows.ps1 -PullRequest 1` 将 PR #1 入队；Worker 会在 Gitee PR 评论中发布中文审查报告。相同提交重新触发时，通过隐藏标记避免重复创建评论。

报告列出 SEC-001 确定性结果、已检查文件、未检查范围和可选 AI 候选；AI 默认关闭。`partial` 和 `error` 必须按未完成解释，零项候选不等于安全。私人令牌只传给 Worker 的 Gitee API 客户端，不传给 AI 服务。要向模型发送 Gitee 代码，需单独开启 AI 并把 Gitee 数字仓库 ID 加入允许列表。

## 组织仓库 `vcagegame/witness-skin`

本机已为该私有仓库配置数字 ID `49998972`，并确认现有令牌可以读取仓库。该仓库使用独立的 Webhook 签名密钥文件 `D:\Tools\evidence-review-bot\witness-skin-webhook.dpapi`；AI 白名单目前只包含该仓库。AI 会将选中的变更行及少量上下文发送到配置的第三方兼容接口。脱敏基于已知模式，不能保证识别所有敏感信息；不应在 PR 中提交真实密钥。

当前组织仓库的 Pull Request 钩子已创建。需要核对或重新部署时，在仓库「管理」→「WebHooks」使用以下设置：

- URL：`https://blandness-epilogue-garden.ngrok-free.dev/webhooks/gitee`
- 事件：仅 **Pull Request**；启用钩子。
- 安全方式：**签名密钥**，不要选择明文密码。密钥需与本机文件中的值完全一致。

在本机 PowerShell 查看密钥以核对 Gitee 页面，命令不会把密钥写入命令历史，但会显示在当前终端：

```powershell
. .\scripts\local-common.ps1
Read-ReviewBotSecret 'D:\Tools\evidence-review-bot\witness-skin-webhook.dpapi'
```

更新一个开放的组织仓库 PR 后，在 WebHook 投递记录确认返回 `202`，再到 PR 评论查看中文报告及 AI 状态。也可从仓库根目录手动重跑：

```powershell
powershell -NoProfile -File .\scripts\review-gitee-windows.ps1 -Repository 'vcagegame/witness-skin' -PullRequest 123
```

把 `123` 替换为实际开放的 PR 编号。当前 Gitee 仍只发布汇总评论，没有原生状态门禁；Lint、类型检查与依赖漏洞 CI 不会自动迁移到该组织仓库。

## 自动触发

手动发布验收通过后，在 Gitee 仓库的「管理」→「WebHooks」创建钩子，只选择 **Pull Request**，把可公网访问的 HTTPS 地址填为 `https://你的域名/webhooks/gitee`。请选择**签名密钥**模式，不使用明文密码模式；把同一个签名密钥保存在仓库外文件，并在配置向导中填写该文件路径，然后重启 API。Gitee 官方文档说明请求头包含 `X-Gitee-Token`、`X-Gitee-Timestamp`、`X-Gitee-Event`；本项目校验一小时内的时间戳和 HMAC 签名，仅接受配置仓库的 `Merge Request Hook`。相同载荷会按摘要去重。

当前临时 Cloudflare 隧道的域名可能在重启后变化；需同步更新 Gitee Webhook URL。无自有域名时可使用[Windows 快速部署](deployment-windows.md)中的 ngrok 固定 Dev Domain。Gitee 的「测试 WebHook」只用于检查测试载荷能否投递；最终验收应更新测试 PR 的提交，确认真实 PR 事件入队并随新 SHA 发布中文报告。不要把 Gitee Webhook 发往 `/webhooks/github`。

此阶段只发布 PR 汇总评论；行内评论、原生状态门禁和多人 OAuth 授权仍待验证。多个仓库可分别配置，但组织权限撤销与多仓库限流仍需真实平台验收。

参考：[Gitee 添加 WebHook](https://help.gitee.com/webhook/how-to-add-webhook)、[推送数据格式](https://help.gitee.com/webhook/gitee-webhook-push-data-format)、[签名算法](https://help.gitee.com/webhook/how-to-verify-webhook-keys)、[API 文档](https://gitee.com/api/v5/swagger)。
