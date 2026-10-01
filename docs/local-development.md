# 本地开发与数据库验证

Webhook API 入口已实现：在原始请求体上校验 GitHub 签名、筛选 PR 事件、持久化投递与 snapshot 任务，并提供 `/healthz`。数据库模块已有迁移、去重、租约领取/续期、重试和审计记录。当前尚未获取 PR 快照、执行 Worker 或发布 Check；真实 GitHub App 的事件与权限仍需验证。

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

以后启动时只需从同一个密钥文件读取，不要重新生成。密钥不能进入 Git、聊天、日志或公开 URL。GitHub App 选择 `Pull requests: Read-only`、`Contents: Read-only`、`Checks: Read and write`，只订阅 `Pull request` 事件；其余权限保持默认。私钥 `.pem` 也放在仓库外，当前接收 API 尚不读取它。

本机试用的临时隧道工具位于 `D:\Tools\cloudflared\cloudflared.exe`。另开 PowerShell 窗口运行以下命令，并把输出的 `https://...trycloudflare.com` 加上 `/webhooks/github` 填入 GitHub App 的 Webhook URL：

```powershell
& 'D:\Tools\cloudflared\cloudflared.exe' tunnel --no-autoupdate --url http://127.0.0.1:3000
```

临时隧道重启后地址可能变化。先访问隧道的 `/healthz` 验证转发，再到 GitHub App 的 Advanced / Recent Deliveries 检查投递。正常接收目标 PR 事件返回 HTTP `202`，响应 `{"queued":true}`；重复投递返回 `{"queued":false}`。`ping` 等不处理的事件也返回 `202` 和 `queued:false`。签名不一致返回 `401`，此时检查 GitHub 和 API 是否读取同一个密钥。

在已设置数据库环境变量的另一个窗口运行 `npm run inspect:queue`，可以查看各状态任务数、最近 10 次投递和失败代码。命令只读，不输出 Webhook 请求体或密钥。当前没有 Worker，成功入队的 snapshot 任务会保持 `queued`；这只证明接收链路正常，并不代表已完成 PR 审查或发布 Check。

其他环境可以使用自己的 PostgreSQL 凭据与连接串。`npm test` 在缺少 `TEST_DATABASE_URL` 时跳过数据库集成测试，并在 TAP 输出中标明 SKIP；只有显式提供测试库时才算数据库行为得到验证。迁移按文件名顺序在事务中执行，记录 SHA-256 校验和；已应用 SQL 不允许原地改写，新变更需新增迁移文件。

测试覆盖重复 delivery、冲突 payload、签名拒绝、并发领取、过期租约的 fencing、重试与最大次数。真实 GitHub 验证、Worker 进程崩溃恢复和远端 Check 发布仍属于后续任务。
