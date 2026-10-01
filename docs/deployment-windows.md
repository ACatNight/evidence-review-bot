# Windows 快速部署

当前启动器适用于本机 GitHub App 与 Gitee 单仓库试点。首次填写配置，之后一条命令构建、迁移并启动 Webhook API 和 Worker；它不会创建 GitHub App、安装 PostgreSQL，或自动配置公网 HTTPS 入口。Gitee 设置见[测试仓库接入](gitee-setup.md)。

## 准备资料

- Node.js 22.22.2、npm、已创建的 PostgreSQL 数据库。`DATABASE_URL` 不含密码，密码单独保存在文件中。
- GitHub App ID、下载的 `.pem` 私钥、与 App 页面一致的 Webhook Secret。
- 可选 Gitee：有仓库读取和 PR 评论权限的私人令牌、仓库所有者/名称/数字 ID；配置自动触发时还需要 Webhook 签名密钥。
- 长度至少 32 字节的十六进制 Review HMAC 主密钥。密钥必须长期保持一致。
- 可选：`pg_ctl.exe` 与 PostgreSQL 数据目录，用于数据库未启动时自动启动。
- 可选 AI：API Key 文件、模型、HTTPS API 根地址、允许传输代码的 GitHub 数字仓库 ID。AI 默认关闭。

密钥文件放在仓库外；`.dpapi` 文件按当前 Windows 用户解密，普通文本文件也可读取，但应由操作系统访问控制保护。当前主机已有的文件路径列在[本地开发说明](local-development.md)，填写时可直接使用。此前发在聊天中的密钥应先撤销并更换。

## 配置与启动

在仓库根目录打开 PowerShell：

```powershell
powershell -NoProfile -File .\scripts\configure-windows.ps1
powershell -NoProfile -File .\scripts\start-windows.ps1
```

向导将非敏感选项与密钥**路径**保存到仓库外的 `local-config.json`；默认位置为 `D:\Tools\evidence-review-bot`（若该目录存在），否则为当前用户的 `%LOCALAPPDATA%\EvidenceReviewBot`。可在运行前设置 `EVIDENCE_REVIEW_BOT_HOME` 指定其他目录。配置文件不保存密钥值。

启动命令会在缺少 `node_modules` 时运行 `npm ci --ignore-scripts`，然后编译、应用数据库迁移、检查本地端口、启动 API 和 Worker，并调用 `/healthz` 验证 API。进程 ID 与启动时间记录在同目录的 `local-run.json`；日志也在该目录。重复运行会拒绝启动第二套进程。查看状态或停止：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/healthz
powershell -NoProfile -File .\scripts\stop-windows.ps1
```

端口以向导填写的值为准。若 3000 端口已被原有 API 占用，先停止旧进程或在向导中选择其他端口，并同步调整公网入口。启动器只停止它自己记录的进程，不会停止外部 PostgreSQL 服务或 Cloudflare 隧道。

GitHub App 的 Webhook URL 仍必须是可从 GitHub 访问的 HTTPS 地址，并以 `/webhooks/github` 结尾。使用临时 Cloudflare 隧道时，隧道重启可能改变域名；这一步需要在 GitHub App 页面更新。要获得稳定回调地址，应配置固定域名或命名隧道。部署完成后在 GitHub App 的 Recent Deliveries 检查 `202`，并在 PR Checks 查看报告。

`github` 与 `gitee` 是分别推送到 GitHub 和 Gitee 的长期发布分支；开发改动先进入 `dev`，验证后再同步到两个分支。Gitee 单仓库适配启用后可接收 Gitee PR Webhook，并在 PR 评论中发布中文报告；它不提供 GitHub Check 或 Gitee 平台原生状态门禁。

发布时在 `dev` 完成测试与 PR 验证，再将同一提交快进到本地 `github` 和 `gitee`，分别推送到 GitHub 的 `github` 分支与 Gitee 的 `gitee` 分支。两边的分支不直接开发，也不强制推送。GitHub 对 `github` 分支运行现有质量工作流；Gitee 暂未配置对应的远端 CI，推送前需先通过本地检查。对外发布前应分别在两平台启用分支保护，限制直接推送与强制推送。
