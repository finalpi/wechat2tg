# v6：单分支、双发行通道

## 当前开发版：v6.0.13-dev.1

**三个仓库只使用 `v6` 维护分支。`dev` 是 tag / 制品通道，不是另一个分支。** 分支最新提交可能仍在开发，不能把分支 HEAD 当成已验收稳定版。

| 仓库 | 分支 | 本次 Git 标签 | 配套制品 |
| --- | --- | --- | --- |
| `wechat2tg` | `v6` | `v6.0.13-dev.1` | 包版本 `6.0.13-dev.1`；`finalpi/wechat2tg:v6.0.13-dev.1` |
| `wx2tg-puppet` | `v6` | `v6.0.13-dev.1` | `wx2tg-puppet@6.0.13-dev.1` 的 npm 格式打包文件 |
| `fk-zhang` / wx2tg-server | `v6` | `v6.0.13-dev.1` | `finalpi/wx2tg-server:v6.0.13-dev.1`（amd64） |

此次合并 `origin/wx2tg-v3-dev` 的 `6625545`，包含 WebUI、MCP、消息中心和附件改进；保留 v6 的带正文回调、无损消息 ID、二进制下载、禁止自动建群及 `/official` 等改动，并增加默认关闭的公众号 Topic 模式。server 本次只调整发行元数据，不改变协议或部署配置。

## 版本编号与通道

以下 Docker 规则只适用于 bot 仓库 `finalpi/wechat2tg`；不修改 `finalpi/wx2tg-server` 的镜像命名和版本规则。

| 类型 | 完整 Git 标签 | bot Docker 标签 | bot 滚动别名 |
| --- | --- | --- | --- |
| 稳定版 | `v6.X.Y` | `v6.X.Y` | `v6` |
| 开发版 | `v6.X.Y-dev.N` | `v6.X.Y-dev.N` | `v6-dev` |
| 手动快照 | 无，从 `v6` 分支手动构建 | `v6-dev-<提交短 SHA>` | 无，不更新稳定或开发滚动别名 |

例如：`v6.0.13-dev.1` → `v6.0.13-dev.2` → 验收后 `v6.0.13`；后续再进入 `v6.0.14-dev.1`。`N` 从 1 开始，不允许前导零。npm / `package.json` / `VERSION` 去掉前面的 `v`；Git 标签和 bot Docker 完整版本均保留 `v`，校验要求完整的 `v` + `VERSION`。

- 同一套发行在三个仓库创建相同完整 tag，bot 精确依赖同版本 puppet，不用 `^` / `~`。
- **开发 tag 永远不更新稳定别名。** server 的开发 GitHub Release 标记为 prerelease，不抢占 stable latest。
- 完整版本 tag 不移动、不覆盖；重发修复使用新的 `dev.N` 或正式版本号。
- 历史 `wx2tg-v3`、`860-v3`、`875`、`v51.*`、裸 `v6` / `v7` 等保留，不重写历史。旧 Git tag `v6` 不是滚动发行入口；脚本使用 `refs/heads/v6` 和 `refs/tags/v6.X.Y…` 避免歧义。
- bot 只发布到 `finalpi/wechat2tg`，使用完整版本标签（含开头的 `v`）；滚动别名为稳定通道 `v6`、开发通道 `v6-dev`。此仓库不带主版本后缀，因此本工作流绝不发布全局 `latest` / `dev`，也不新增 `v6-latest` 兼容别名。旧 `finalpi/wechat2tg-v3` 仓库及其所有镜像、标签保留，不再发布或更新旧仓库。

## amd64 / arm64 独立发布

bot 工作流先验证版本并运行测试，再并行执行两个互不等待的原生构建：

- `Build amd64`：`ubuntu-24.04`，发布 `v6.0.13-dev.1-amd64`。
- `Build arm64`：`ubuntu-24.04-arm`，发布 `v6.0.13-dev.1-arm64`。
- 两种架构分别使用 GHA 构建缓存；`fail-fast=false`，ARM 失败不会取消已成功的 amd64。
- 两边都成功后，才合并通用多架构标签 `v6.0.13-dev.1` 和对应通道别名。

想尽早部署 amd64 时，使用 `finalpi/wechat2tg:v6.0.13-dev.1-amd64`，或开发滚动别名 `v6-dev-amd64`。ARM 对应 `v6.0.13-dev.1-arm64` / `v6-dev-arm64`。正式 Git tag `v6.0.13` 发布 Docker `v6.0.13`、`v6.0.13-amd64` 和 `v6.0.13-arm64`，稳定别名为 `v6-amd64` / `v6-arm64`，合并后更新 `v6`。手动快照只发布 `v6-dev-<短 SHA>-amd64` / `v6-dev-<短 SHA>-arm64` 和合并的 `v6-dev-<短 SHA>`，不更新任何滚动别名。

因此不必等整个工作流结束才能更新 amd64；部署端应核对目标提交和 **`Build amd64` 成功**。通用标签仍等待 ARM，保留正确的多架构内容，不会先用 amd64 覆盖掉 ARM。具体耗时受原生依赖编译、缓存和 runner 排队影响，不承诺固定 30 分钟。server 有原生库限制，仍只构建 amd64，不伪装支持 ARM。

## 固定 puppet 制品

`vendor/wx2tg-puppet-6.0.13-dev.1.tgz` 由本次 puppet 源码构建。bot 的 `package.json` 精确声明 `6.0.13-dev.1`，lockfile 将其解析到本地制品并保存 npm 计算的 SHA-512 integrity。

这使 Docker / `npm ci` 不依赖尚未发布的 npm registry 版本。保留 lockfile 和 vendor 文件；不要手填不存在的 registry URL 或伪造 integrity。puppet 的 tag 工作流会上传 npm 格式 `.tgz` 为 Actions artifact，**不自动执行 npm publish**。

更新步骤（本地，不发布）：

```sh
# wx2tg-puppet
npm ci
npm run check:version
npm test
npm pack --pack-destination ../wechat2tg/vendor

# wechat2tg
npm install --package-lock-only --ignore-scripts ./vendor/wx2tg-puppet-6.0.13-dev.1.tgz
npm pkg set dependencies.wx2tg-puppet=6.0.13-dev.1
npm install --package-lock-only --ignore-scripts --offline
npm ci
npm run check:version
npm test
```

正式 npm 发布另行授权；之后若改用 registry，重新生成 lockfile 并校验制品，不能移动已有 Git tag。

## 发布与部署检查

1. 三仓库 `VERSION`、包版本、锁文件、依赖和目标 tag 一致。
2. bot / puppet 运行 `npm run check:version`、`npm test`；server 运行 `bash scripts/check-release-version.sh`、`go test ./buildinfo`。
3. 同时验证稳定 / dev 版本格式、错 tag 拒绝、开发构建不能覆盖稳定通道。
4. 完成 merge、检查 diff，提交本次文件；不要把 server 工作区原有测试修改、样本消息或私有配置带进提交。
5. 明确授权后推送 `v6` 分支和指定完整 tag。bot/server 会构建镜像，server 会创建对应正式 / prerelease Release，puppet 会上传打包 artifact。
6. 部署前备份 SQLite、会话和 Compose，保留旧镜像；不覆盖用户现有 `.env`、`home_202.env` 等私有配置，不把示例文件覆盖到部署目录。已有微信服务的部署与新 bot 更新分开处理：此次命名修正不更改 `wx2tg-server` 镜像/命名空间/版本，也不更新或重启用户现有生产后端。
7. 先验证 amd64 制品、服务健康、旧绑定和配置校验值，再做真实双向消息验收。离线测试不等于真实微信 / Telegram 全链路已验收。

配置与存储边界见 [v6 消息链路](server-v6.md)，公众号集中模式见 [公众号 Topic](official-account-topics.md)。
