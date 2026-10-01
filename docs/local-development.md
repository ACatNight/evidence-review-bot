# 本地开发与数据库验证

Webhook API 在原始请求体上校验 GitHub 签名并将 PR 事件入队。Worker 使用安装令牌读取固定 SHA 的 PR 快照、执行 SEC-001 候选扫描，并发布 Check 汇总。已在测试仓库验证只读快照；Check 发布、权限撤销和故障恢复仍需真实平台验收。

## 环境

- Node.js 22.22.2，使用仓库中的 `package-lock.json` 执行 `npm ci`。
- PostgreSQL 18；测试库名称必须为 `evidence_review_bot_test`，集成测试会清空该库中 `review_bot` schema 的任务和审计数据。不要将 `TEST_DATABASE_URL` 指向其他数据库。
- 在仓库根目录运行命令，迁移器从 `db/migrations/` 读取 SQL。数据库连接信息通过环境变量提供，不写入仓库或命令行参数。

本机使用 D 盘上的 PostgreSQL 18.6 二进制包：程序位于 `D:\Tools\PostgreSQL\18.6\pgsql`，独立数据目录位于 `D:\Tools\PostgreSQL\review-bot\data`，仅监听 `127.0.0.1:55432`。该安装不改变系统级 PostgreSQL 服务，也不接触 C 盘已有数据目录。凭据保存在 D 盘本地受当前用户访问控制的文件中，不属于仓库内容。

启动或查看状态：

```powershell
$pgBin = 'D:\Tools\PostgreSQL\18.6\pgsql\bin'
$cluster = 'D:\Tools\PostgreSQL\review-bot'
& "$pgBin\pg_ctl.exe" -D "$cluster\data" status
& "$pgBin\pg_ctl.exe" -D "$cluster\data" -l "$cluster\server.log" -o '-h 127.0.0.1 -p 55432' start
```

已启动时无需再次执行 `start`。停止本项目实例：

```powershell
& 'D:\Tools\PostgreSQL\18.6\pgsql\bin\pg_ctl.exe' -D 'D:\Tools\PostgreSQL\review-bot\data' stop
```

## 迁移与测试

当前主机可在 PowerShell 会话中临时提供凭据，不打印密码：

```powershell
$env:PGPASSWORD = (Get-Content -LiteralPath 'D:\Tools\PostgreSQL\review-bot\local-password.txt' -Raw).Trim()
$env:DATABASE_URL = 'postgresql://reviewbot@127.0.0.1:55432/evidence_review_bot_dev'
$env:TEST_DATABASE_URL = 'postgresql://reviewbot@127.0.0.1:55432/evidence_review_bot_test'
npm ci
npm run db:migrate
npm run lint
npm run check
npm test
Remove-Item Env:PGPASSWORD,Env:DATABASE_URL,Env:TEST_DATABASE_URL
```

本地启动 Webhook API 时，先设置 `PGPASSWORD`、`DATABASE_URL` 和长度不少于 32 字符的 `GITHUB_WEBHOOK_SECRET`，再运行 `npm run start:api`。默认只监听 `127.0.0.1:3000`；`GET /healthz` 查询数据库，`POST /webhooks/github` 只接受有效签名的 JSON 请求。不要把真实 webhook 密钥写入仓库。若需要公网回调，使用经过审核的入口和 TLS，并配置 GitHub App 的回调地址与权限。

## GitHub App 本地联调

在 Windows PowerShell 5.1 中生成一次 Webhook 密钥并保存在仓库外。以下生成步骤只在密钥文件尚不存在时执行；如果 GitHub App 已配置了密钥，先确保保存的是同一个值，不能生成新值后继续使用旧配置。改动密钥后重启 API。

```powershell
$secretPath = 'D:\Tools\PostgreSQL\review-bot\github-webhook-secret.txt'
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$secret = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
Set-Content -LiteralPath $secretPath -Value $secret -NoNewline
$env:GITHUB_WEBHOOK_SECRET = (Get-Content -LiteralPath $secretPath -Raw).Trim()
$env:PGPASSWORD = (Get-Content -LiteralPath 'D:\Tools\PostgreSQL\review-bot\local-password.txt' -Raw).Trim()
$env:DATABASE_URL = 'postgresql://reviewbot@127.0.0.1:55432/evidence_review_bot_dev'
npm run start:api
```

以后启动时只需从同一个密钥文件读取，不要重新生成。密钥不能进入 Git、聊天、日志或公开 URL。GitHub App 选择 `Pull requests: Read-only`、`Contents: Read-only`、`Checks: Read and write`，只订阅 `Pull request` 事件；其余权限保持默认。私钥 `.pem` 也放在仓库外，由 Worker 读取。

本机试用的临时隧道工具位于 `D:\Tools\cloudflared\cloudflared.exe`。另开 PowerShell 窗口运行以下命令，并把输出的 `https://...trycloudflare.com` 加上 `/webhooks/github` 填入 GitHub App 的 Webhook URL：

```powershell
& 'D:\Tools\cloudflared\cloudflared.exe' tunnel --no-autoupdate --url http://127.0.0.1:3000
```

临时隧道重启后地址可能变化。先访问隧道的 `/healthz` 验证转发，再到 GitHub App 的 Advanced / Recent Deliveries 检查投递。正常接收目标 PR 事件返回 HTTP `202`，响应 `{"queued":true}`；重复投递返回 `{"queued":false}`。`ping` 等不处理的事件也返回 `202` 和 `queued:false`。签名不一致返回 `401`，此时检查 GitHub 和 API 是否读取同一个密钥。

Worker 需要 App ID、私钥路径和稳定的租户 HMAC 主密钥。主密钥在仓库外生成一次，后续从同一文件读取。以下命令在另一个 PowerShell 窗口运行；处理完当前一个任务就退出，持续处理改用 `npm run start:worker`：

```powershell
Set-Location 'D:\项目\Pr审查机器人'
$env:PGPASSWORD = (Get-Content 'D:\Tools\PostgreSQL\review-bot\local-password.txt' -Raw).Trim()
$env:DATABASE_URL = 'postgresql://reviewbot@127.0.0.1:55432/evidence_review_bot_dev'
$env:GITHUB_APP_ID = '5147464'
$env:GITHUB_PRIVATE_KEY_PATH = 'D:\Tools\evidence-review-bot\github-app.private-key.pem'
$env:REVIEW_HMAC_KEY = (Get-Content 'D:\Tools\evidence-review-bot\review-hmac-key.txt' -Raw).Trim()
npm run worker:once
npm run inspect:queue
```

本机首次联调已在 `D:\Tools\evidence-review-bot\review-hmac-key.txt` 创建主密钥。其他部署须自行生成至少 32 字节随机密钥并安全保存，不要每次启动时重新生成。`inspect:queue` 只读，显示最近 10 次投递、任务状态、Check 发布状态和失败代码，不输出 Webhook 请求体或密钥。`published` 表示 GitHub 已返回 Check ID；`uncertain` 表示发布结果不确定，需要核对远端后处理，不能盲目重复创建。

默认的 Bot 报告仅覆盖 SEC-001 列出的 GitHub 经典令牌和 PEM 私钥格式；不验证凭据有效性，不代表代码安全。对缺失 patch、读取失败、超限或超过 50 个文件的 PR，会在报告中标出覆盖缺口。Check 使用 `neutral` 结论，不设置为 required check。反馈、抑制、确定性回放和更完整的发布对账仍待实现。

## 可选 OpenAI 安全审查

先在 [OpenAI API Keys](https://platform.openai.com/api-keys) 创建属于自己的 API Key，并确认账户有可用的模型和计费额度。不要把密钥发到聊天、写入仓库或提交到 GitHub Actions。可在 Windows PowerShell 中交互式输入，再用当前用户的 DPAPI 加密后保存在仓库外：

```powershell
$secureKey = Read-Host 'OpenAI API key' -AsSecureString
$secureKey | ConvertFrom-SecureString | Set-Content 'D:\Tools\evidence-review-bot\openai-api-key.dpapi'
```

要启用 AI 审查，在启动 Worker 的同一个 PowerShell 窗口运行以下命令；API 进程无需 OpenAI 密钥。`OPENAI_ALLOWED_REPOSITORIES` 使用 GitHub 数字仓库 ID，此测试仓库为 `1398812131`。先停止旧 Worker，再按上一节的数据库与 GitHub App 环境变量启动新 Worker。

```powershell
$secureKey = Get-Content 'D:\Tools\evidence-review-bot\openai-api-key.dpapi' | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try { $env:OPENAI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
$env:OPENAI_REVIEW_ENABLED = 'true'
$env:OPENAI_MODEL = 'gpt-6-luna'
$env:OPENAI_ALLOWED_REPOSITORIES = '1398812131'
npm run start:worker
```

模型仅接收白名单仓库中最多 8 个 JS/TS 文件的变更行与少量上下文，单次文本上限 16,000 字符。已知凭据格式和敏感赋值会先脱敏，私钥文件跳过；这不能保证识别所有秘密，所以只对明确允许传输代码的仓库开启。调用使用 Responses API 的结构化输出及 `store: false`，结果仍需人工核对。未配置或未授权时标为 `not_run`，API 错误标为 `error`，不会显示为已通过审查。模型输出不作为确定性事实；OpenAI 用法参见[官方 Quickstart](https://developers.openai.com/api/docs/quickstart)和[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。

仓库的 `.github/workflows/quality.yml` 会在 PR 上独立运行 Biome Lint、TypeScript 类型检查、带 PostgreSQL 的测试、`npm audit` 和 CodeQL JavaScript/TypeScript 分析。npm 审计显式使用官方 registry，因为本机默认镜像未实现 audit 接口。工作流 Checks 与 Bot Check 分别展示；它们不能证明不存在所有安全缺陷。

其他环境可以使用自己的 PostgreSQL 凭据与连接串。`npm test` 在缺少 `TEST_DATABASE_URL` 时跳过数据库集成测试，并在 TAP 输出中标明 SKIP；只有显式提供测试库时才算数据库行为得到验证。迁移按文件名顺序在事务中执行，记录 SHA-256 校验和；已应用 SQL 不允许原地改写，新变更需新增迁移文件。

测试覆盖重复 delivery、冲突 payload、签名拒绝、并发领取、过期租约的 fencing、重试与最大次数。真实 GitHub 验证、Worker 进程崩溃恢复和远端 Check 发布仍属于后续任务。
