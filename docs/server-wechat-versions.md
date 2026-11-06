# Server 发行版本与微信客户端协议版本：核对记录

本记录用于 README 的版本说明，依据本地 Git 对象及 GitHub 只读 API；未登录微信、未部署、未更改 server/SDK 或 Git 元数据。**Server 项目版本、Bot/SDK 版本、模拟的微信客户端版本、设备操作系统版本是四件不同的事。** 这里的微信版本不是要求用户手机安装的版本，也不是所有登录协议共享的版本。

## 可以直接写进 README 的主映射

| Server 发行系列 / 来源 | 确认的微信客户端协议 | 证据与限制 |
| --- | --- | --- |
| 当前配套 `finalpi/wx2tg-server:v6.0.16`；维护分支 `v6`，继承 `875` | **iPad / iPhone：微信 8.0.75.33**，`0x18004b21` | `v6.0.16:readme.md:9-10` 明确说明来源和版本；`Algorithm/Util.go:90-94` 的 `IPadVersion`、`IPadVersionx`、`IPhoneVersion` 一致；`baseinfo/basedefine.go:8-9` 交叉确认。`v6` 不是微信 6.x。 |
| 历史 `875`、server tags `v51.0.0`—`v51.0.13` | **iPad / iPhone：微信 8.0.75.33**，`0x18004b21` | 对全部 14 个 `v51.*` 标签逐一核对 `Algorithm/Util.go:90-94`，均相同。`875` 本地 ref `041e67b33bbd6a7363fdd674ed500f0d363aacf3` 的 `readme.md:8-9` 及同一常量确认。不能把 `v51` 写成微信 5.1。 |
| Server Git tag `v7`，来源分支 `878` | **iPad / iPhone：微信 8.0.78.34**（发布版本 8.0.78），`0x18004e22` | `v7:readme.md:4-10`；`baseinfo/ios_protocol.go:4-9`；`docs/protocol/ios-current.json:3-10`。这是另一发行系列，不是微信 7.x；目标参数及离线测试已核对，**不等于微信服务端真实兼容性已验证**。 |

上述 v6 iOS 常量也已逐一核对本地现存完整标签 `v6.0.1`—`v6.0.16`、`v6.0.13-dev.1`—`dev.3`，均为 `0x18004b21`；不是凭分支名推断。

### 建议 README 的准确措辞

> 当前 Bot `v6.0.34` 使用 server `v6.0.16`。Server `v6` 系列源自 `875`，其 iPad/iPhone 主协议模拟微信 **8.0.75.33**；历史 `v51.*` 也属于这一 iOS 协议系列。另一个 server `v7` / `878` 系列的目标是微信 **8.0.78.34**，不属于当前配套部署。这里的 `v6`、`v7` 是本项目发行版本，不是微信客户端的主版本，也不代表 Windows、Mac、车载、Android Pad 都使用同一微信版本。

Bot 当前版本和配套选择来自本仓库 `README_zh.md:14`；协议映射以上游 server 的固定标签为准。不要把“同一大版本配套”扩大成“所有补丁任意组合均已验证”。

## 同一 server 内的其他协议并不等于 8.0.75

`v6.0.16:Algorithm/Util.go:88-110` 的活动常量如下；旧值注释不算当前配置：

| 客户端 / 选择 | 活动客户端版本常量 | 可确认到的程度 |
| --- | --- | --- |
| iPad、iPadX、iPhone | `0x18004b21` | 明确标注 8.0.75.33 |
| Android、Android Pad（Bot 的 `pad`） | `0x28004530` | `comm/Util.go:81-89` 按位生成 UA，可复算 **8.0.69.48**；这是代码编码口径，不是另行核对 Android 官方 APK 的证明 |
| Windows（Bot 的 `win`） | `0x63090c37` | 确认整数常量；未找到可独立核对的官方客户端四段版本，不补猜 |
| Windows UWP | `0x620603C8` | 与普通 Windows 独立 |
| Unified Windows | `0xf254171e` | 与普通 Windows 独立；不拿旁边旧注释 `0x6400010D` 当活动值 |
| Car（Bot 的 `car`） | `0x2100091B` | 确认整数常量，不补猜客户端版本 |
| Mac（Bot 的 `mac`） | `0x14010100` | 确认整数常量，不补猜客户端版本 |

`Algorithm/Init.go:15-75,114-117` 将这些设备模式绑定到各自常量。SDK `src/index.ts:98-167` 根据 `deviceType` 选择登录端点；`src/api/LoginApi.ts:184-210` 明确 `pad` 是 Android Pad、`win` 是普通 Windows。`ipadX` 是 iPad 的另一登录路径，不是一个新的微信发布版本。

`v7:docs/protocol-878-update.md:49-53` 明确 Android、Windows、macOS、车载版本常量未改变：**878 的升级不能描述为全部设备协议一起升级到 8.0.78。**

## 历史名称的边界与未解问题

- **`wx2tg-v3` 是 Bot 分支/旧镜像名称，不是微信 3.x。** 本地分支固定在 `cc6c7ac72eac16b448c60359a681df9173df90bf`，`README_zh.md:85-87` 的 server 示例实际为 `finalpi/wx2tg-server:v5-latest`（注释保留 `v3-latest`）；`package.json:34` 依赖 SDK `3.0.8`。因此不能把 Bot 名称一对一映射到某一个微信客户端版本。
- **`860-v3` 是 SDK 分支，不是足够的协议版本证据。** 本地 ref 为 `2269b9f89efecf474d353b7bbdeb82453096b185`，`package.json:2-3` 为 `wx2tg-puppet` / `3.0.7`。SDK 本身通过 HTTP 调 server；不能仅凭 `860` 字样断言它模拟微信 8.0.60。
- Server **`860` 存在“名字/注释与活动代码不一致”**：本地 ref `a28ef4153d2cdf929fda93853dcc57ede554bb18` 的 `Algorithm/Util.go:93` 是 `IPadVersion = 0x18003b20`，旁边却注释 `0x18003C20 8.0.60`。按本分支 `comm/Util.go:69-77`，活动值产生 iPad UA **8.0.59**，不是 8.0.60；不能把旧注释作为已确认映射。server `v2.0.0` / `v2.0.6` 也见这一差异。未核对对应官方 IPA，故 README 不宜给它填一个无保留的“8.0.60”。
- Server `v3.0.2`（`2d239e1e0dabc40c84da759d4d7e82cd799d53e4`）的 `Algorithm/Util.go:93` 则为 `0x18003d18`、注释 8.0.61。说明旧 `v3` 范围也不能混成 `860` 的固定版本。
- `v51.0.13:.github/workflows/build-and-push-docker-image.yml:48-50` 发布目标为 `v5-latest` / `v5-${APP_VERSION}`；`860` 同一路径 `:48-50` 则为 `v3-latest` / `v3-${APP_VERSION}`。这是**历史 CI 命名证据**，不是镜像存在性、当前滚动别名指向或运行兼容性的验收。

## 固定来源与复查方法

上游仓库：[fk-zhang / wx2tg-server](https://github.com/finalpi/fk-zhang)；SDK：[wx2tg-puppet](https://github.com/finalpi/wx2tg-puppet)。

- Server `v6.0.16` commit：`5b3f42d8d384db944f1065314d2db7c96d9e2e44`。
- Server `v7` / 本地 `878` commit：`2765462bbc8a5bbbda0484c4ec2949b5a58ecc20`。
- Server `v51.0.0` / `v51.0.13` commits：`0f72083d68af442351d4c114cb0367cb198babe5` / `da9811335b10a5c349eb1f8605643000eff4888d`。
- [v6.0.16 README](https://github.com/finalpi/fk-zhang/blob/v6.0.16/readme.md#L9-L10)、[版本常量](https://github.com/finalpi/fk-zhang/blob/v6.0.16/Algorithm/Util.go#L88-L110)。
- [v7 README](https://github.com/finalpi/fk-zhang/blob/v7/readme.md#L4-L10)、[iOS 单点配置](https://github.com/finalpi/fk-zhang/blob/v7/baseinfo/ios_protocol.go#L4-L9)、[兼容性限制](https://github.com/finalpi/fk-zhang/blob/v7/docs/protocol-878-update.md#L49-L53)。
- GitHub Release API `GET /repos/finalpi/fk-zhang/releases` 的 `v6.0.16` 正文确认 875/v51 继承关系，`v7` 正文明确 8.0.78 / iOS 8.0.78.34：[v6.0.16 Release](https://github.com/finalpi/fk-zhang/releases/tag/v6.0.16)、[v7 Release](https://github.com/finalpi/fk-zhang/releases/tag/v7)。

复查时用 `git show <完整 tag 或 commit>:<路径>` 并按该 ref 的行号核对；分支 HEAD 会变化，不能用今天的分支内容倒推历史镜像。全部结论为源码/发行声明核对，不声称真实微信登录实测或镜像运行时验收。
