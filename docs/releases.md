# v6：单分支、双发行通道

## 当前 Bot 正式版：v6.0.37

- 优化 Mini App / 手机首页：将导航合并到顶部选择器，隐藏重复品牌和消息标题，去掉外层卡片留白。
- 联系人搜索与刷新合为一行，筛选与实时连接入口合为一行；详细微信 / Telegram 在线状态点击查看，不再常驻占用多行。
- 小屏聊天搜索默认收起，点击放大镜展开；缩小会话标题区和输入区高度。桌面侧栏与双栏布局保留。
- 本地 720px 高度样例中，会话列表由 398px 增至 579px，约从 55% 提升至 80%。浏览器测试覆盖 425×650、390×720、320×600，要求会话列表至少占 75%、默认聊天记录区至少占 60%，无横向溢出。
- 验证范围为浏览器和模拟 Telegram SDK，实际 Telegram 客户端仍需用户验收。SDK/server 保持 v6.0.16，不改变主人鉴权与 SSE 行为。

### v6.0.36：Mini App 菜单修复

- 修复设置 Mini App 地址后，主人私聊菜单仍未变为「控制台」的问题。
- 修正 Telegraf 菜单参数，确保实际请求包含主人 ID 和 Mini App 链接；继续只设置主人私聊菜单，不设置全局菜单。
- 升级后保留原 `WEBUI_MINI_APP_URL`，启动时自动重设菜单，也可由主人在私聊发送 `/start` 刷新。SDK/server 无需更新。
- 使用真实 Telegraf 封装验证最终请求，462 项测试通过；未调用真实 Telegram 菜单接口。

### v6.0.35：Mini App、消息长连接与配置保存修复

### 新增功能

- Telegram Mini App：从机器人主人私聊的「控制台」菜单进入，与浏览器共用同一套配置页和消息中心。后端校验 Telegram 签名和主人身份；非主人无法进入，不回退使用浏览器保存的 Token。
- 消息实时更新：使用 SSE 长连接，有新消息或状态变化时才更新，不再每 5 秒轮询消息、联系人和在线状态；支持断线重连与历史补齐。
- Mini App 适配 Telegram 主题、窗口高度、安全区域与返回按钮。配置 HTTPS 根地址后启用；普通浏览器 Token 登录继续保留。

### 问题修复

- 修复 AI / WebUI 配置保存成功后页面仍保留旧版本号、再次保存报 conflict 的问题。
- 修复无关登录信息变化导致配置冲突；真实冲突时可重新加载最新配置并保留未保存输入，分批保存失败不会重复提交已保存部分。
- 修复长连接场景下迟到消息、旧消息状态更新和断线期间消息补齐；处理提前断开造成的订阅泄漏。

配套 SDK / server 仍为 v6.0.16，iPad/iPhone 主协议为微信 8.0.75.33。Mini App 需要设置 `WEBUI_MINI_APP_URL=https://你的域名/` 并在重启 Bot 后生效；反向代理须允许 SSE 长连接且关闭缓冲，见 [Mini App 配置](telegram-mini-app.md)。

验证：462 项测试、三组本地浏览器回归通过，Node 18 容器内构建通过。Telegram SDK 使用模拟数据验证，尚未完成真实 Telegram WebView 验收。

从 v3.3.1 升级的累计功能说明见 [v6 累计 Release](https://github.com/finalpi/wechat2tg/releases/tag/v6.0.34)；本版在该基础上增加以上功能及修复。

### v6.0.34：WebUI 重写与媒体发送改进

- WebUI 与消息页迁移到 React + shadcn：靛蓝主题、深浅色切换和网站图标，保留会话搜索、历史、引用、附件、群成员选择、撤回和 Telegram 同步操作。
- 移除无意义的「处理中…」占位及删除流程。同会话媒体与文字分开排队，慢上传不再阻塞后续文字；语音发送真实音频后编辑原消息字幕。没有可用预览的表情仍在文件就绪后直接发送，不伪造占位保序。
- 并发发送的限流/不确定状态按请求隔离；结果未知时停止自动整条重发。撤回通知等待此前的原消息发送完成，但不拖住后续文字。
- 消息页增加不确定 HTTP 响应的同请求重试、离开期间的历史缺口补齐，以及原顺序展示合并记录中的附件。
- 本地预览每次构建，打印与后端一致的令牌并转发退出信号；修复 Node 18 构建时 PostCSS 配置的模块格式问题。

验证：422 项回归测试通过；Chromium 使用本地模拟消息适配器验证主要页面交互；Node 18 容器完成依赖安装与构建检查（跳过原生安装脚本，不等同于完整生产镜像/真实微信和 Telegram 端到端验收）。仅更新 Bot，puppet/server 仍固定 v6.0.16；不部署或重启现有服务。

当前 React 页面使用中文；旧版页面的一些交互（如行内 @ 键盘选择和 MCP 客户端配置导出）尚未迁移，不把本次改版视为完整功能等价验收。实现与测试边界见 [WebUI 开发](webui-development.md)和[媒体发送](telegram-media-delivery.md)。

### v6.0.33：接龙名单更新

本版让参与/发起接龙后立即发一条新消息：从服务端成功响应里解析名单（appmsg 的 title）与新消息 ID，机器人把名单原样发成一条新消息并带上两个按钮，按钮指向最新消息 ID，可连续往下接；不编辑、不删除、不等微信同步。此前 `v6.0.32` 误改为等微信同步转发自己发出的消息（实际不会推回），也不再删除用户输入，而是等微信同步把“实际发出去的那条接龙”推回来，机器人原样转发成一条**新消息**（完整名单 + 「参与接龙／自定义」两个按钮），可一直往下接。此前 `v6.0.31` 误改为编辑原消息显示名单：服务端成功响应里带着它实际发出的 appmsg XML，机器人从中取 `title`，把原接龙消息就地编辑成最新名单（保留「参与接龙／自定义」按钮），编辑失败则改为回复该名单；不再删除你输入的接龙内容。此前 `v6.0.30` 让同一个群里的媒体也“先占位、后替换”：上传前先发一条「处理中…」占住位置，上传完成后把媒体挂在该占位下并删除占位；上传失败同样清理占位，不会残留卡住的提示。大文件沿用原有进度消息，文字消息不受影响。

最近几次修复的要点：

- `v6.0.29`：出站队列由“全局单串行”改为“每会话一条串行通道”，一个群转码或上传时不再阻塞其他群；会话内仍严格保序。语音先发、后补字幕，ASR 慢或失败不卡线程。
- `v6.0.26`～`v6.0.28`：接龙支持自定义内容与发起命令，成功后不再刷确认消息，提示文案简化；`v6.0.25` 撤回了对字面量 `undefined` 昵称的误判。
- `v6.0.23`：修复按钮键盘结构错误导致带按钮的接龙被 Telegram 拒收。
- `v6.0.20`～`v6.0.22`：新增 `#[member_name]` 变量、无装饰默认模板与一次性模板重置；接龙参与支持单聊。

仅发布 Bot；puppet 与 server 继续使用 `v6.0.16`，不部署或重启任何服务。

**三个仓库只使用 `v6` 维护分支。`dev` 是 tag / 制品通道，不是另一个分支。** 分支最新提交可能仍在开发，不能把分支 HEAD 当成已验收稳定版。

| 仓库 | 分支 | 使用的 Git 标签 | 配套制品 |
| --- | --- | --- | --- |
| `wechat2tg` | `v6` | `v6.0.37`（本次发布） | 包版本 `6.0.37`；`finalpi/wechat2tg:v6.0.37` |
| `wx2tg-puppet` | `v6` | `v6.0.16` | `wx2tg-puppet@6.0.16` 的 npm 格式打包文件 |
| `fk-zhang` / wx2tg-server | `v6` | `v6.0.16` | `finalpi/wx2tg-server:v6.0.16`（amd64） |

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

- `Build amd64`：`ubuntu-24.04`，发布 `v6.0.37-amd64`。
- `Build arm64`：`ubuntu-24.04-arm`，发布 `v6.0.37-arm64`。
- 两种架构分别使用 GHA 构建缓存；`fail-fast=false`，ARM 失败不会取消已成功的 amd64。
- 两边都成功后，才合并通用多架构标签 `v6.0.37` 和对应通道别名。

想尽早部署 amd64 时，使用 `finalpi/wechat2tg:v6.0.37-amd64`，或稳定滚动别名 `v6-amd64`。ARM 对应 `v6.0.37-arm64` / `v6-arm64`。正式 Git tag `v6.0.37` 发布 Docker `v6.0.37`、`v6.0.37-amd64` 和 `v6.0.37-arm64`，稳定别名为 `v6-amd64` / `v6-arm64`，合并后更新 `v6`。手动快照只发布 `v6-dev-<短 SHA>-amd64` / `v6-dev-<短 SHA>-arm64` 和合并的 `v6-dev-<短 SHA>`，不更新任何滚动别名。

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
5. 明确授权后仅推送本次需要发布的仓库的 `v6` 分支和指定完整 tag。Bot/server 各自的 tag 会触发自己的镜像构建；只有 server tag 才创建其 Release，只有 puppet tag 才上传 SDK artifact 并发布 npm。本次仅推送 Bot `v6.0.37`。
6. 部署前备份 SQLite、会话和 Compose，保留旧镜像；不覆盖用户现有 `.env`、`home_202.env` 等私有配置，不把示例文件覆盖到部署目录。已有微信服务的部署与新 bot 更新分开处理：此次命名修正不更改 `wx2tg-server` 镜像/命名空间/版本，也不更新或重启用户现有生产后端。
7. 先验证 amd64 制品、服务健康、旧绑定和配置校验值，再做真实双向消息验收。离线测试不等于真实微信 / Telegram 全链路已验收。

配置与存储边界见 [v6 消息链路](server-v6.md)，公众号集中模式见 [公众号 Topic](official-account-topics.md)。
