# README 图标与徽章

README 使用现成的开源图标和标准状态徽章；图标不代表项目拥有独立注册的品牌标识。

## 本地图标

`icons/` 中的四个 SVG 来自 [Lucide](https://github.com/lucide-icons/lucide)，固定来源提交为 [`aace268b9be318c4f6d8a09a35139f860d07d9c5`](https://github.com/lucide-icons/lucide/tree/aace268b9be318c4f6d8a09a35139f860d07d9c5/icons)：

| 文件 | 用途 |
| --- | --- |
| `git-pull-request.svg` | 页首通用 PR 标识、平台接入 |
| `scan-line.svg` | 确定性规则 |
| `file-search.svg` | 证据与快照 |
| `chart-no-axes-combined.svg` | 审查覆盖率 |

仅将 `stroke="currentColor"` 改为 `stroke="#2f81f7"`，使图标作为独立图片嵌入时在浅色和深色页面上均可见；未改动路径。上游完整许可保留在 [`icons/LICENSE`](icons/LICENSE)。

## 远程徽章

- [Shields.io](https://shields.io/)：许可证、运行时、语言及仓库入口。
- [Simple Icons](https://simpleicons.org/)：由 Shields.io 提供的 Node.js、TypeScript、GitHub、Gitee 标识，用于识别相应技术或平台。
- GitHub Actions：本仓库 `github` 分支的实际工作流状态。

远程徽章需要网络访问；每张图片均有替代文字。许可证、Node.js 和 TypeScript 版本为静态标签，更新项目配置时需同步更新 README。
