# 微信式通讯录分类与公众号菜单：能力结论

本文件保留 dev.3 阶段的源码审计，并记录随后获用户授权的只读实测及 dev.4 实现。没有执行菜单事件、关注 / 取消关注、点赞、授权或部署。菜单协议逐层追踪见 [菜单能力审计](wechat-official-menu-capabilities.md)。

## dev.4 更新：已核实与已实现

只请求用户指定账号的联系人详情，检查成功状态与字段；不输出原始 ID、key、令牌、完整响应或带凭据的 URL。现场仍为 Bot dev.3 / SDK 6.0.17，协议服务器 v6.0.17。以下是当次观察，不保证每个账号、每次响应都相同：

| 账号 | VerifyFlag | BrandFlag | 顶层 ServiceType | 观察 |
| --- | --- | --- | --- | --- |
| Apifox | 品牌位成立 | — | 明确 1 | 实际菜单包含普通网站链接和事件按钮 |
| 爱范儿 | 品牌位成立 | — | 缺失 | 有实际菜单，包含小程序项；缺失值不能当成 0 |
| 北通 | 24 | 2 | 明确 0 | 菜单类型 0 / 1 / 2 |
| 程序员新世界 | 8 | 2 | 明确 0 | 菜单类型 0 / 2 |
| 车代帮服务平台 | 8 | 2 | 缺失 | 菜单类型 0 / 1 / 2 / 5 |
| Animex动漫社 | 8 | 2 | 缺失 | 菜单类型 0 / 1 / 2 |
| CC侦探 | 8 | 2 | 明确 1 | 菜单类型 0 / 1 / 2 |
| 大众点评 | 24 | 2 | 明确 1 | 菜单类型 0 / 2 / 5 |
| 德邦快递 | 24 | 2 | 明确 1 | 菜单类型 0 / 2 / 5 |

“EMS中国邮政”未精确匹配本地缓存名称，因此没有向协议服务请求其详情；这不证明它不存在或没有菜单。8 / 24 和 BrandFlag=2 均不能区分服务号与订阅号。

- 已确认 `CustomizedInfo.ExternalInfo` JSON 可包含顶层 `ServiceType` 和 `MMBizMenu.button_list` / `sub_button_list`。
- SDK `6.0.18-dev.1`（`9d40313`）保存可空的服务类型和白名单菜单；仅明确类型值更新分类，缺失 / 非法内容保留旧缓存。明确有效的空菜单可清空旧菜单。
- 实际 Apifox / 爱范儿菜单大量复用占位 ID。解析器不使用这些 ID 执行操作或作为 React key，已移除错误的唯一 ID 要求，并用合成回归及授权只读解析复核；不会因正常重复 ID 丢弃整棵菜单。
- type 0 为分组，type 2 的普通 URL 从 `value` 读取；type 1 事件、type 5 小程序及未知 / 微信授权动作只显示名称与不支持原因。禁止危险协议、用户信息、控制字符与已识别授权路径；不保存原始 key、uin、appid 等。
- Bot dev.4 保留 `kind=contact|group`，另加分类与字母索引；GET `/api/contacts/menu` 只读经过二次校验的缓存，不调用远端、不提供点击接口。普通链接显式新窗口打开并阻止 opener / referrer，页面本身不代做授权。
- “聊天 / 通讯录”采用同一套 React / shadcn 界面。分类总数为去重后的缓存搜索结果（分页和类别筛选之前），不是当前页或微信实时总数；按 SSE 更新，没有新增轮询。没有明确 serviceType 的公众号仍是广义“公众号”，不声称全部为已确认订阅号。
- SDK 负责增量迁移；Bot 镜像连接仍为只读用途、`synchronize=false`。后台目录同步补齐字段，不阻塞登录、首屏或 GET。
- 原生事件点击、企业组织目录、收藏群读判据、WebUI 好友申请管理仍未实现。真实手机 / Mini App 和完整消息类型仍需验收。

以下段落是 **dev.3 / SDK 6.0.17 原状审计**；其中“尚未验证 / 尚未保存 / 未实施”的菜单读取和 SDK 存储结论已由上文更新，原生点击缺口仍然成立。

## 已确认的运行版本

- 202 的 Bot 容器 `wechat2tg`：镜像别名 `finalpi/wechat2tg:v6-dev`；读取包元数据确认 Bot `6.0.40-dev.3`、SDK `6.0.17`。
- 服务器容器 `wechat-server`：镜像别名 `finalpi/wx2tg-server:v6-latest`；启动构建记录确认 `v6.0.17`、提交 `2e95c86b2fa08f0110397d396da2b1ce42fba672`，匹配本地协议源码。
- 日志的“检测到新协议版本 869”不是发行版本号：服务器 `controllers/Tools.go:22–33` 的 Version 方法固定返回字符串 `869`，SDK `src/utils/axiosInstance.ts:35–44` 只是读取并打印它。
- 本地 SDK 待发布 `6.0.18-dev.1` 只含本轮之前的登录 / 后台联系人修复；与已部署 `6.0.17` 相比，本文涉及的 Contact 分类及 OfficialAccounts / QWContact API 文件没有变化。不能把未发布修复算作线上能力。

下文 `server:` 指协议仓库 `fk-zhang` 的上述 `2e95c86`；`sdk:` 指 `wx2tg-puppet` 的 `v6.0.17`（相关文件与本地 `ab26768` 相同）；无前缀路径指 Bot 仓库本地 `5dcd5ad`。

## 1. 截图布局可以做，但分类数据不能靠猜

服务号也属于公众号；需要额外解决的是 **订阅号 / 服务号** 细分，而不只是“公众号 / 普通联系人”。

| 截图中的类别 | 当前已知能力 | 界面边界 |
| --- | --- | --- |
| 联系人 | SDK 缓存已有联系人、备注、头像等；已有公众号品牌位判断 | 可做分组列表，但普通联系人还需排除已识别公众号、企业联系人和未知项，不能直接沿用全部 `contact` 行 |
| 群聊 | 已有 `WxRoom` 和绑定数据 | 可列群聊，不应直接称为“保存到通讯录的群聊” |
| 保存的群聊 | 协议有保存 / 取消保存操作与 `BitMask/BitVal` 字段 | 还未证明一个可靠读判据；不能把全部缓存群聊当作已保存群聊 |
| 公众号大类 | `VerifyFlag` 品牌位由现有分类器使用，支持未知状态 | 可以先接入 WebUI；不是 `gh_` 前缀判断，也不是任意非零 flag |
| 订阅号 / 服务号 | 联系人详情可返回品牌扩展信息；更专门的 proto 有 `serviceType` | **尚无已核实的分类语义和完整读取实现**。先保留“公众号（类型待确认）”，不要把 8/24 硬映射成两种账号 |
| 企业微信联系人 | 服务端已有 `GetQWContactList`，按 `@openim` 标识过滤 | 可接入已识别企业联系人；该接口不证明完整企业组织目录可用 |
| 我的企业 | 已有企业联系人搜索 / 添加等相邻能力 | 尚未确认“我所在企业列表 / 组织结构”的完整接口，不伪造类别与数量 |
| 新的朋友 | Bot 能接收好友申请并通过 Telegram 展示 | WebUI 尚无持久化待处理申请目录；内存数组不能当作重启后完整历史 / 精确待处理数量 |

来源：

- `sdk:src/utils/ContactClassification.ts:1–17`：`(flag & 8) !== 0` 仅给出公众号大类，缺失 / 非法值为未知。
- `sdk:test/contact-classification.test.cjs:28–57`：8、24、136 都通过同一品牌位判断；`Contact.type()` 仍是空实现，不能提供服务类型。
- `server:models/QWContact/GetQWContactList.go:93–117,193–226`：目录游标、页内 `contactCount`、`@openim` 过滤。页内数量不是全量企业联系人总数。
- `server:controllers/Group.go:345–349` 和 `models/Group/MoveContractList.go:43–65`：保存操作 Val=3、取消 Val=2，写 `BitVal` 并保留已读取的 `BitMask`。这只是读取分类位的线索，不足以宣称 `ContactType & 1` 就是保存状态。
- `src/client/WechatClient.ts:54,450–464`：好友请求放在实例内存 `friendshipList`，通知 Telegram；未构成 WebUI 申请管理接口。

## 2. 原始协议字段与现有数据链的缺口

`POST /api/Friend/GetContractDetail` 确实实现了 HTTP → `getcontact`（CGI 182）→ protobuf 解码的链路。返回的 `Data.ContactList[]` 是 `ModContacts`，可包含：

```text
VerifyFlag / VerifyInfo
ContactType / BitMask / BitVal
MyBrandList
CustomizedInfo:
  BrandFlag
  ExternalInfo
  BrandInfo
  BrandIconURL
ExtInfo
```

字段可能缺失；`ExternalInfo` / `BrandInfo` 是不透明字符串，并非已经解析的类型或菜单。必须先核实真实账号返回的内容，不能据字段名称猜取值。

来源：`server:models/Friend/GetContractDetail.go:17–137`；`server:Cilent/mm/mm.pb.go:20903–20975,19467–19476`。

**目前两层存储都会丢掉部分信息：**

1. 服务端目录 capture 的白名单保存 `contact_type`、`verify_flag` 等，但不保存上述品牌扩展、`BitMask/BitVal`。因此仅查 `/Directory/Query` 不能恢复已经丢掉的字段。来源：`server:srv/contactstore/capture.go:170–238`。
2. SDK `Contact.loadContactDetail()` 只挑选 `verifyFlag`、名称、备注、头像等保存；没有品牌类型和菜单字段。来源：`sdk:src/core/Contact.ts:228–265`、`sdk:src/entities/ContactEntity.ts`。

专门资料 proto 的 `BizAccountInfo.serviceType` 是 optional uint32，没有本仓库中的枚举映射；`BizProfileV2Resp.serviceInfo.menuInfo` 也只是 schema。`server:models/OfficialAccounts/BizProfileV2.go:1` 只有包声明，**不是可用的资料 / 菜单接口**。来源：`server:Cilent/mm/mm123.proto:3177–3258`。

另有 `models/Tools/GetContact.go` 内部 helper，但当前 Tools 控制器 / 路由未暴露 `/api/Tools/GetContact`；对外已确认入口是 Friend 的详情接口，不能把 helper 名称直接当成 HTTP 路由。

## 3. dev.3 的 WebUI 为何混在一起

- `webui/src/lib/messages-api.ts:3–14` 的 Contact DTO 只有 `kind: 'contact' | 'group'`。
- `src/webui/messages.ts:293–321` 从联系人、群、Telegram 绑定和公众号 Topic 合并目录；连已保存的 `verifyFlag` 都没选入这个列表 DTO，Topic 也归入 `contact`。
- `webui/src/features/messages-panel.tsx:461` 目前只有“最近 / 联系人 / 群聊”。

已有 `WechatAccountClassificationService` 可复用公众号大类和 unknown 语义，但扩展分类必须后台分批补齐，不能把逐个网络查询重新塞回登录或首屏阻塞链。来源：`src/service/WechatAccountClassificationService.ts:211–278`。

**数量也要单独设计：** 当前分页每页 60 条，没有分类总数，不能把当前页长度当成微信通讯录总数。服务端 Directory 是可选的同步 / 历史缓存，取决于实际存储是否实现目录能力（`server:srv/msgstore/directory.go:95–120`），本轮未核对现场是否启用；其 PostgreSQL 实现的 `total` 包含匹配的已删除记录（`server:srv/msgstore/postgres_directory.go:374–407`）。应区分当前账号、删除状态、去重、未知类型以及同步完整度。第一版可明确显示“已同步 / 已缓存数量”，不承诺与微信客户端实时总数一致。

## 4. 公众号底部菜单的结论

| 能力 | 结论 |
| --- | --- |
| 画出微信式底部菜单和二级子菜单 | 前端可以实现，但必须有真实菜单数据 |
| 从已有联系人详情取得菜单 | 原始扩展信息是候选来源；是否含完整、当前菜单尚未验证 |
| 专用菜单 / 公众号资料读取 | 只有相关 proto 和空 model，没有完成的对外请求链 |
| 事件型菜单点击 | 有 `ClickCommandRequest` schema，未找到 controller / model 发包实现，当前不能声称可用 |
| 普通网页跳转 | 取得真实 URL 后可用浏览器打开，但不能保证登录态、微信 JSAPI 或微信内专属功能 |
| OAuth、扫码、小程序、定位等按钮 | 存在相邻辅助接口，不等于具备完整菜单动作；部分会主动授权 / 确认登录，不能用于无操作的探测 |

`ClickCommandRequest` 的 `clickTyp` / `clickInfo` 等语义和 CGI 实现没有补齐；发送按钮文字或伪造 XML 不等于点击事件。`statusnotify(code=2)` 也不是菜单点击。来源：`server:Cilent/mm/mm123.proto:3139–3175`、`server:models/Report/statusnotify.go:13–64`。

公众号 HTTP 控制器只有 Follow、Quit、MpGetA8Key、GetAppMsgExt、GetAppMsgExtLike、OauthAuthorize、JSAPIPreVerify 七种操作；SDK 同样只有这些 wrapper，没有菜单读取 / 点击封装。来源：`server:controllers/OfficialAccounts.go:1–188`、`sdk:src/api/OfficialAccountsApi.ts:5–36`。

详细请求字段、原生状态校验、版本差异及授权风险见 [菜单能力审计](wechat-official-menu-capabilities.md)。这不是“微信协议天生不能做”，而是**当前协议服务未实现完整链路，现有原始数据还需验证**。

## 5. 初始建议的落地顺序（实施进展见顶部 dev.4 更新）

1. 将“聊天”和“通讯录”视图分开；通讯录采用截图的分类入口 / 可展开列表，不再用单个混合联系人列表。首批基于已确认字段提供联系人、群聊、公众号、已识别企业联系人；未知类型明确归入待识别，不展示虚假 0 或样例数字。
2. 请用户指定一个已知订阅号、一个已知服务号，最好都能在手机上看到底部菜单。获准后只读联系人详情，脱敏比较品牌字段和菜单候选数据，不关注 / 取消关注、不点赞、不授权、不点击菜单。
3. 若已有详情足够，优先补 SDK 保存、Bot DTO 与 WebUI 分类 / 菜单解析；若不足，再评估实现 BizProfileV2 的真实请求链。不要仅因 proto 有字段就上按钮。
4. 菜单动作另分阶段：普通链接、事件型点击、需微信客户端的动作。事件执行必须验证当前账号、目标公众号和当前菜单按钮，避免客户端任意伪造 key；结果未知不盲目重发。
5. 个性化菜单可能依账号而变；菜单缓存需账号隔离和可验证的更新策略。继续遵守 WebUI / Mini App 主人鉴权和 PWA 不缓存受保护数据的边界。
