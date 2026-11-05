# v6：单分支、双发行通道

## 当前 Bot 正式版：v6.0.25

本版撤回 `v6.0.24` 过严的判定：昵称本身就可以是 `undefined`、`null` 这类字符串，属于真实数据，必须照常参与接龙；只有类型缺失或空白才取消发送。此前 `v6.0.24` 修复接龙署名可能写成字面量 `undefined` 的问题：群昵称/微信昵称解析现在会丢弃 `undefined`、`null` 和空值，解析不到可用名字时直接取消发送并给出提示，不再把占位文本写入微信接龙名单；请求体与解析层都加了同样的兜底。此前 `v6.0.23` 修复了 `v6.0.21`/`v6.0.22` 的回归：接龙按钮使用了嵌套键盘结构，而 `Option.inline_keyboard` 的约定是扁平按钮数组，导致 Bot API 收到 `text: undefined` 的按钮、Telegram 拒绝整条消息，带按钮的接龙（含别人发来的）显示为「Telegram 未同步」而没有转发。现在调用方改为扁平结构，两个发送器都会归一化嵌套/非法按钮：无法渲染的按钮被丢弃，正文仍照常送达，不再因为键盘问题丢消息。此前版本把接龙按钮文案改为「参与接龙」，并让单聊中的接龙也能直接参与（群聊与单聊都附带按钮，目标会话分别取群 id 与该联系人 wxid）。其余行为不变：仅机器人主人可点、群昵称优先、由服务端 `/Msg/SendSolitaire` 查找消息并拼 XML、结果不确定不自动重发、按钮 30 分钟过期。此前版本新增群接龙「参与接龙」按钮：转发群接龙时附带仅机器人主人可用的按钮，点击后取该群群昵称（回退微信昵称）调用服务端 `POST /Msg/SendSolitaire` 参与模式，由服务端按 `MsgID`/`NewMsgID` 查找已保存的接龙消息并拼 XML；客户端不传 XML/Title/Tail。结果分为成功、服务端明确拒绝（含原因）、结果不确定（提示到微信确认且不自动重发）；按钮 30 分钟过期、限 256 个。单聊接龙不加按钮，普通回复仍不会追加到名单，且本版不重放历史接龙。此前版本新增 `#[member_name]`：显示微信群里成员自己设置的群昵称，没有群昵称时用其微信昵称，且不读取通讯录备注（`#[alias]`）。同时把 7 项消息展示模板的默认值改为无装饰 emoji 的简洁格式（`ROOM_MESSAGE` / `ROOM_MESSAGE_GROUP` 直接使用 `#[member_name]`），留空或纯空格等同默认值。升级时这 7 项模板一次性重置为默认值，旧值仅备份到 `webui-config.json.message-templates-v1.json`（不含密钥），此后的自定义不会被再次覆盖；群名称模板、头像与绑定关系不变。群昵称查询按账号/群缓存 60 秒，失败或超过 1.5 秒立即回退微信昵称，不会阻塞或丢弃消息，且只在模板实际使用 `#[member_name]` 时才查询。延续 `v6.0.19` 的群元数据限流保护。仅发布 Bot，puppet 和 server 继续使用 `v6.0.16`，不部署或重启任何服务。

**三个仓库只使用 `v6` 维护分支。`dev` 是 tag / 制品通道，不是另一个分支。** 分支最新提交可能仍在开发，不能把分支 HEAD 当成已验收稳定版。

| 仓库 | 分支 | 使用的 Git 标签 | 配套制品 |
| --- | --- | --- | --- |
| `wechat2tg` | `v6` | `v6.0.25`（本次发布） | 包版本 `6.0.25`；`finalpi/wechat2tg:v6.0.25` |
| `wx2tg-puppet` | `v6` | `v6.0.16` | `wx2tg-puppet@6.0.16` 的 npm 格式打包文件 |
| `fk-zhang` / wx2tg-server | `v6` | `v6.0.16` | `finalpi/wx2tg-server:v6.0.16`（amd64） |

此前 `v6.0.16` 合并 puppet 的最新 860-v3（7d9590c），保留 v6 回调/同步保护，补齐下载完整性校验、选择性重试和兼容接口，并修复 [接龙消息被当作未知类型丢弃](solitaire-messages.md)。本版保留这些功能。

## 版本编号与通道

以下 Docker 规则只适用于 bot 仓库 `finalpi/wechat2tg`；不修改 `finalpi/wx2tg-server` 的镜像命名和版本规则。

| 类型 | 完整 Git 标签 | bot Docker 标签 | bot 滚动别名 |
| --- | --- | --- | --- |
| 稳定版 | `v6.X.Y` | `v6.X.Y` | `v6` |
| 开发版 | `v6.X.Y-dev.N` | `v6.X.Y-dev.N` | `v6-dev` |
| 手动快照 | 无，从 `v6` 分支手动构建 | `v6-dev-<提交短 SHA>` | 无，不更新稳定或开发滚动别名 |

例如：`v6.0.13-dev.1` → `v6.0.13-dev.2` → 验收后 `v6.0.13`；后续再进入 `v6.0.14-dev.1`。`N` 从 1 开始，不允许前导零。npm / `package.json` / `VERSION` 去掉前面的 `v`；Git 标签和 bot Docker 完整版本均保留 `v`，校验要求完整的 `v` + `VERSION`。

- Bot、puppet、server 可独立递增版本并创建各自 tag，只要求同为 `v6`；无需为了 Bot 更新而重发 SDK/server。Bot 仍精确固定实际使用的 puppet 版本（不用 `^` / `~`），锁文件和制品必须与该依赖版本一致。这个校验仅检查版本规则，不代替具体接口兼容性验收。
- **开发 tag 永远不更新稳定别名。** server 的开发 GitHub Release 标记为 prerelease，不抢占 stable latest。
- 完整版本 tag 不移动、不覆盖；重发修复使用新的 `dev.N` 或正式版本号。
- 历史 `wx2tg-v3`、`860-v3`、`875`、`v51.*`、裸 `v6` / `v7` 等保留，不重写历史。旧 Git tag `v6` 不是滚动发行入口；脚本使用 `refs/heads/v6` 和 `refs/tags/v6.X.Y…` 避免歧义。
- bot 只发布到 `finalpi/wechat2tg`，使用完整版本标签（含开头的 `v`）；滚动别名为稳定通道 `v6`、开发通道 `v6-dev`。此仓库不带主版本后缀，因此本工作流绝不发布全局 `latest` / `dev`，也不新增 `v6-latest` 兼容别名。旧 `finalpi/wechat2tg-v3` 仓库及其所有镜像、标签保留，不再发布或更新旧仓库。

## amd64 / arm64 独立发布

bot 工作流先验证版本并运行测试，再并行执行两个互不等待的原生构建：

- `Build amd64`：`ubuntu-24.04`，发布 `v6.0.25-amd64`。
- `Build arm64`：`ubuntu-24.04-arm`，发布 `v6.0.25-arm64`。
- 两种架构分别使用 GHA 构建缓存；`fail-fast=false`，ARM 失败不会取消已成功的 amd64。
- 两边都成功后，才合并通用多架构标签 `v6.0.25` 和对应通道别名。

想尽早部署 amd64 时，使用 `finalpi/wechat2tg:v6.0.25-amd64`，或稳定滚动别名 `v6-amd64`。ARM 对应 `v6.0.25-arm64` / `v6-arm64`。正式 Git tag `v6.0.25` 发布 Docker `v6.0.25`、`v6.0.25-amd64` 和 `v6.0.25-arm64`，稳定别名为 `v6-amd64` / `v6-arm64`，合并后更新 `v6`。手动快照只发布 `v6-dev-<短 SHA>-amd64` / `v6-dev-<短 SHA>-arm64` 和合并的 `v6-dev-<短 SHA>`，不更新任何滚动别名。

因此不必等整个工作流结束才能更新 amd64；部署端应核对目标提交和 **`Build amd64` 成功**。通用标签仍等待 ARM，保留正确的多架构内容，不会先用 amd64 覆盖掉 ARM。具体耗时受原生依赖编译、缓存和 runner 排队影响，不承诺固定 30 分钟。server 有原生库限制，仍只构建 amd64，不伪装支持 ARM。

## 固定 puppet 制品

`vendor/wx2tg-puppet-6.0.16.tgz` 沿用此前验证的 puppet 制品，本次不重打包或修改。bot 的 `package.json` 精确声明 `6.0.16`，lockfile 将其解析到本地制品并保存 npm 计算的 SHA-512 integrity。

这使 Docker / `npm ci` 不依赖尚未发布的 npm registry 版本。保留 lockfile 和 vendor 文件；不要手填不存在的 registry URL 或伪造 integrity。puppet 的 tag 工作流会上传 npm 格式 `.tgz`；独立 `publish.yml` 在验证、测试后执行 npm 发布并核验 registry，正式版用 `latest`、开发版用 `v6-dev`。发布需要有效的 NPM_TOKEN 和对应免交互权限。

更新步骤（本地，不发布）：

```sh
# wx2tg-puppet
npm ci
npm run check:version
npm test
npm pack --pack-destination ../wechat2tg/vendor

# wechat2tg
npm install --package-lock-only --ignore-scripts ./vendor/wx2tg-puppet-6.0.16.tgz
npm pkg set dependencies.wx2tg-puppet=6.0.16
npm install --package-lock-only --ignore-scripts --offline
npm ci
npm run check:version
npm test
```

只有推送 SDK 仓库的新发行标签才会触发它的 npm 发布；仅推送 Bot 标签不会重发 SDK。认证失败必须明确报告，不能把 artifact 上传当作已发布。若改用 registry 来源，重新生成 lockfile 并校验制品，不能移动已有 Git tag。

## 发布与部署检查

1. 每个待发布仓库自身的 `VERSION`、包版本、锁文件和目标 tag 一致。跨组件只要求 `v6` 大版本一致；Bot 的精确 SDK 依赖、SDK 锁文件和制品须匹配，Compose 中 server 仍固定一个完整 `v6.X.Y`（或开发版）标签。
2. bot / puppet 运行 `npm run check:version`、`npm test`；server 运行 `bash scripts/check-release-version.sh`、`go test ./buildinfo`。
3. 同时验证稳定 / dev 版本格式、错 tag 拒绝、开发构建不能覆盖稳定通道。
4. 完成 merge、检查 diff，提交本次文件；不要把 server 工作区原有测试修改、样本消息或私有配置带进提交。
5. 明确授权后仅推送本次需要发布的仓库的 `v6` 分支和指定完整 tag。Bot/server 各自的 tag 会触发自己的镜像构建；只有 server tag 才创建其 Release，只有 puppet tag 才上传 SDK artifact 并发布 npm。本次仅推送 Bot `v6.0.25`。
6. 部署前备份 SQLite、会话和 Compose，保留旧镜像；不覆盖用户现有 `.env`、`home_202.env` 等私有配置，不把示例文件覆盖到部署目录。已有微信服务的部署与新 bot 更新分开处理：此次命名修正不更改 `wx2tg-server` 镜像/命名空间/版本，也不更新或重启用户现有生产后端。
7. 先验证 amd64 制品、服务健康、旧绑定和配置校验值，再做真实双向消息验收。离线测试不等于真实微信 / Telegram 全链路已验收。

配置与存储边界见 [v6 消息链路](server-v6.md)，公众号集中模式见 [公众号 Topic](official-account-topics.md)。
