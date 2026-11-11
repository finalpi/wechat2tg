# wechat2tg（v6）

中文 | [English](README.md)

基于微信协议在 Telegram 收发微信消息，支持 ipad,mac,car,windows,pad 多种协议

## TG 群组: [@Wx2TgUserGroup](https://t.me/+AD02MEZa-og3ZGY1)

> [!WARNING]
> 经反馈 Windows 协议有封号的风险，请勿使用该协议

## 主要功能

1. 微信单聊消息、微信群消息、公众号消息的接收，以及企业微信消息的接收
2. 通过 Telegram 向指定的微信用户、微信群、公众号发送消息
3. 灵活的群组消息屏蔽功能
4. 基于当前微信聊天上下文生成 AI 回复建议
5. WebUI 配置、消息样式预览、AI 模型读取与测试（当前 React 界面主要为中文）
6. WebUI 基础消息查看、有限操作、通讯录分类与 Telegram 同步跟踪；消息类型尚未完整支持
7. 十一个微信 MCP 工具和 WebUI Token 管理，客户端配置方式见 MCP 文档

## 聊天文件夹自动扩容

新群按 Telegram 返回的账号限额依次放入 `WeChat`、`WeChat 2`、`WeChat 3` 等文件夹。文件夹总数也满额时，群组照常创建、绑定和转发，仍可在「全部聊天」找到。保留现有设置和其他/共享文件夹。详见 [文件夹分配与失败处理](docs/telegram-chat-folders.md)。

## 公众号集中到论坛 Topic

可选设置 `OFFICIAL_ACCOUNT_TOPICS_ENABLED=true`，重启后首次处理公众号时自动创建一个私有论坛群，每个公众号对应独立 Topic。所有公众号的新消息切换到各自 Topic，支持从 Topic 回复；General 区域不会发送到微信。默认关闭，旧群和绑定保留，关闭后恢复旧路由。详见 [公众号 Topic 模式](docs/official-account-topics.md)。

## 微信行内自定义表情

设置 `WECHAT_CUSTOM_EMOJI_ENABLED=true` 后，将 `[微笑]`、`[捂脸]` 等原生表情替换为 [WeChatPack](https://t.me/addemoji/WeChatPack) 行内自定义表情，保留富文本和普通 Unicode Emoji。需机器人创建者 Premium 或 Fragment 资格。默认关闭，开启后优先于旧图片链接；未知标记保留原文。详见 [映射、覆盖范围与限制](docs/wechat-custom-emoji.md)。自 `v6.0.13-dev.3` 起提供。

## WebUI 配置与消息管理

WebUI 随应用启动，当前 React 界面主要为中文。Docker Compose **默认对外开放 TCP 17863**，访问 `http://<服务器地址>:17863/`；本地开发默认仅监听本机，地址为 `http://127.0.0.1:17863/`。WebUI 和 MCP 共用这个端口，MCP 路径为 `/mcp`。

### Telegram Mini App 与实时消息

同一套 WebUI 可从 Telegram 私聊「控制台」菜单打开。配置 `WEBUI_MINI_APP_URL=https://你的域名/` 并重启 Bot 后，后端校验 Telegram 签名且**仅允许现有机器人主人访问**，不需要输入 WebUI Token；普通浏览器入口继续保留。消息页改用 SSE 长连接通知，不再每 5 秒轮询。需要可访问的 HTTPS 根域名和支持 SSE 的反向代理，详见[配置说明与安全边界](docs/telegram-mini-app.md)。自 v6.0.35 起提供；**请使用 v6.0.36 或更新版本，以包含私聊菜单修复。**

### 配置控制台

- 配置 Telegram / 微信连接、转发偏好、消息样式、代理、AI / 语音识别，以及重试、历史清理和日志选项。
- 支持已有配置字段校验、未保存更改提示、冲突检测、手机布局和重启提示。Telegram 机器人语言设置不代表 WebUI 已支持相同的语言切换。
- Telegram 代理和微信代理分块展示。消息模板支持联系人、群聊和公众号实时预览，也可测试没有备注时的回退结果；预览仅使用示例数据，不发送消息。
- 使用至少 16 字符的 `WEBUI_TOKEN` 登录；不设置时自动生成 `storage/webui-token`。登录后默认进入聊天。普通浏览器会在本地保存访问令牌，刷新或重新打开后可恢复登录；Mini App 会话独立且仅保存在内存。退出登录或服务器拒绝旧令牌时清除保存值。
- 普通配置密钥不返回明文，留空保留原值，输入新值替换，可选密钥可显式清除。MCP Token 使用独立的显示和重新生成操作。

### 聊天能力与当前局限（请先阅读）

> [!IMPORTANT]
> **WebUI 聊天目前主要用于查看文字等简单消息，并提供有限的发送、引用、撤回和同步操作。尚未完整支持微信的所有消息类型，也不等价于微信客户端。** 页面能显示某种消息的摘要、链接或附件入口，不代表该消息类型已完整解析、交互可用或经过全面验收。复杂内容请以微信客户端为准。

- **消息展示是有限适配。** 图片、音视频、文件、公众号图文和合并聊天记录等已有部分预览 / 下载 / 解析路径，但受协议返回内容、媒体有效期、缓存和嵌套结构影响，可能出现摘要、占位、缺失附件或加载失败，不能保证完整还原。红包、转账、小程序、视频号、特殊卡片、实时语音 / 视频通话等不能当作已完整支持的 Web 功能。
- **历史不是微信的完整历史。** 页面读取本项目已保存 / 已同步的记录；首次打开先展示近期记录并补齐本地历史，不会自动从微信获取全部旧消息。Telegram 转发能力与 WebUI 渲染能力也不能混为一谈。
- **有操作入口不等于所有类型都能操作。** 文字、部分附件发送和符合条件的引用 / 撤回可使用；附件上传上限 50 MiB，文字与附件分开发送。引用不能同时带附件或原生艾特，群成员需通过成员选择器选择。撤回需真实回执且受微信时限约束；复杂卡片的原生交互不保证可用。
- **状态不冒充已读。** “已提交微信”只表示取得微信侧回执，不代表对方收到或读过；Telegram 待同步数不是微信未读数。结果不确定时不自动重发。
- **通讯录是已缓存视图。** dev.4 增加微信式分类、字母分组、头像、搜索和分页；服务号只依明确的协议字段识别，其余公众号不冒充已确认的订阅号。数量不是当前页长度，也不是微信客户端实时全量计数。群聊不等于“保存到通讯录的群聊”；新的朋友、我的企业、添加 / 删除 / 审批联系人尚未接入。
- **公众号菜单仅部分支持。** dev.4 可显示已同步菜单及子菜单，普通 HTTP(S) 网页链接可在新窗口打开；事件点击、小程序、微信授权 / 扫码等操作不可执行，会标为未支持。不会把按钮文字发给公众号冒充点击。没有缓存菜单不代表公众号本身没有菜单，链接也不保证能在微信外完成登录和业务流程。
- **PWA 不等于离线微信或后台常驻。** 安装需受信任 HTTPS；只缓存公共界面资源，不缓存受保护 API、聊天正文或附件。草稿仅保留在当前登录窗口内存，关闭 / 强制刷新后不承诺恢复；不自动排队补发，不提供关闭窗口后的可靠推送。真实手机键盘、安装和 Telegram WebView 仍需设备验收。
- **界面迁移尚未完整。** 当前 React 界面主要为中文；旧页面的独立语言切换、全局配置搜索、行内 @ 键盘选择、MCP 客户端配置一键导出等尚未完整迁移，不能沿用旧界面的完整能力描述。

聊天入口为 `/chat`，管理入口为 `/manage`。已实现部分继续使用 SSE 更新，不新增定时消息 / 联系人轮询；桌面专注模式和聊天 / 管理切换会保留当前窗口的聊天草稿与阅读位置。详细边界见 [PWA 与聊天说明](docs/pwa-chat.md)、[通讯录与菜单能力](docs/research/wechat-contact-classification.md)及 [WebUI 开发说明](docs/webui-development.md)。

### AI 与语音

填写 OpenAI 兼容服务的地址与密钥后，可以读取模型列表、选择模型并测试连接，再保存配置。当前模型工具使用已保存的密钥，不要假定尚未保存的新密钥已参与测试；更换来源时请先保存并核对配置。测试仅发送通用测试提示，不发送聊天记录。`/ai` 根据会话上下文生成回复建议，不会自动发送。

配置腾讯云 ASR 凭证后，可以通过 WebUI 或 `/settings` 开启语音自动转文字。

### MCP 接入与安装

在 WebUI 的 **MCP 接入** 页面即可管理：

- 即时开启或关闭 MCP，设置客户端访问地址与本地桥接脚本路径；访问地址用于生成客户端配置，不改变服务监听地址。
- 显示或重新生成独立的只读 / 读写 Token；更换后需同步更新客户端。
- 当前 React 页面尚无完整的客户端配置一键导出，按下方 MCP 文档中的 Streamable HTTP / stdio 示例手工配置，勿公开凭据。
- stdio 桥接支持直接使用本机文件路径上传、下载。仓库中的路径均为通用占位符，实际路径、地址和凭证应保存在仓库外的私有客户端配置中。

| 工具 | 功能 |
|---|---|
| `wechat_status` | 查询微信和 Telegram 在线状态 |
| `wechat_search_contacts` | 搜索联系人与群聊 |
| `wechat_get_group_members` | 搜索群成员，获取原生艾特所需成员 ID |
| `wechat_list_conversations` | 按最近消息列出已有会话 |
| `wechat_read_messages` | 搜索、分页读取会话历史 |
| `wechat_get_new_messages` | 使用持久化游标读取新增入站消息 |
| `wechat_send_text` | 按唯一请求编号发送已授权文本 |
| `wechat_revoke_message` | 明确确认后撤回时限内的本人消息 |
| `wechat_send_media` | 发送已上传附件，或通过桥接发送本地文件 |
| `wechat_download_attachment` | 下载普通消息或合并聊天记录附件 |
| `wechat_get_send_status` | 查询微信提交和 Telegram 同步结果 |

MCP 复用已有微信登录和发送队列。读取消息不会自动唤醒空闲 AI，也不会启用自动回复；增量游标与 Telegram 未送达标记分别统计。完整参数、连接方式与示例见 [MCP 文档](docs/MCP.md)。

### 持久化与配置优先级

| 文件 / 目录 | 用途 | 生效方式 |
|---|---|---|
| `storage/webui-config.json` | WebUI 保存的环境配置 | 重启应用后生效 |
| `storage/db/wx2tg.db` | 绑定关系与机器人偏好 | 偏好即时生效；启动同步在下次启动执行 |
| `storage/db/webui-messages.db` | 消息管理记录和发送跟踪 | 即时 |
| `storage/webui-media` / `storage/webui-avatars` | 附件和头像缓存 | 即时 |
| `storage/mcp-settings.json` | MCP 开关、客户端信息和 Token | 即时，包含 Token 更换 |
| `storage/webui-token`、`storage/mcp-token`、`storage/mcp-read-token` | 自动生成的访问凭证 | 分别用于对应接口 |

Docker 将 `./config` 挂载为 `/app/storage`；备份时同时保留 `save-files`、`conf` 和 `redis-data`。WebUI 环境配置优先于 `.env` / Docker 环境变量；要恢复环境变量默认值，先停止应用，删除 `webui-config.json` 中对应键，再重启。已保存的 MCP 设置优先于 `MCP_ENABLED`、`MCP_TOKEN`、`MCP_READ_TOKEN`，这些环境变量仅初始化首次保存前的设置。`WEBUI_CONFIG_PATH` 可以改变 WebUI 配置文件及同目录的 MCP 设置与令牌位置。

正常应用缺少 Telegram 凭证时仍保留 WebUI 配置入口。需要独立初始化时，运行 `npm run build` 后执行 `npm run webui`，保存后停止独立进程，再启动正常应用。独立模式不启动客户端、不连接数据库，因此不能修改机器人数据库偏好或发送消息。

## 支持的消息类型

### 微信消息类型支持列表

+ [x] 文本消息
+ [x] 企业微信消息
+ [x] 微信表情包
+ [x] 图片消息
+ [x] 视频消息
+ [x] 音频/视频通话（仅消息提醒）
+ [x] 文件消息
+ [x] 链接消息
+ [x] 群聊消息
+ [x] 群聊@消息（@所有人和@你 会转换成 Telegram @你）
+ [x] 公众号消息
+ [x] emoji
+ [x] 位置消息
+ [x] 撤回消息
+ [x] 语音消息
+ [ ] 红包消息（仅提醒，无法获取红包内容）
+ [ ] 小程序消息

### Telegram 消息类型支持列表

+ [x] 文本消息
+ [x] 贴纸表情
+ [x] 图片消息
+ [x] 视频消息
+ [x] 文件消息
+ [x] 语音消息

## 注意事项

1. 本项目仅用于技术研究和学习，严禁用于非法用途
2. 欢迎随时提交 issue 报告使用中遇到的任何问题
3. 请确保 wx2tg-server 服务的 IP 与登录地区一致，否则可能需要输入验证码
4. 在 arm-64 架构环境下，由于缺少必要的依赖文件，无法使用 wx2tg-server 镜像
5. 登录后一天之后会掉线一次，再次登录后就能稳定在线了

## 部署安装

> [!IMPORTANT]
> 当前 Bot 正式版为 **`v6.0.39`**：修复群聊 / 公众号历史接口 500，补齐安全异常日志与启动提示；升级 SDK 至 `v6.0.17`，修复联系人初始化异常刷屏。修复已通过用户验收；server 保持 `v6.0.16`。

全新部署先复制一份 `.env.example` 为 `.env` 文件，然后配置环境变量。已有私有配置（包括用户的 `home_202.env`）绝不能覆盖，所需新增项应手动合并。

复制项目中的 `app.conf.example` 为 `app.conf` 文件到 `conf` 目录，将 Redis 地址设置为你部署的 Redis 的地址。已有部署请合并新增配置，不要直接覆盖自己的端口、Redis 凭据和回调地址。

默认保留 `.env` 中的 `MODE=polling`，以及 server 的 `syncmessage=false`、`msgpush=false`。服务端新增消息归档默认启用 SQLite，保存在宿主机 `./server-data/messages`，与 bot 的 `./config` 数据库独立。puppet `6.0.12` 已支持带正文回调和二进制文件分片；切换到 callback 时需同时配置 server 的 `msgpush=true` 和可达的回调地址，详见上面的说明。

Docker 部署使用 Docker Engine 和 Docker Compose v2；本地开发使用 Node.js 18+。SQLite、图像处理和媒体转换等原生依赖需要与实际运行平台匹配。

### Docker Compose

下面的 Compose 示例使用 `finalpi/wechat2tg:latest`，保存为 `docker-compose.yml` 后即可使用，无需 WebUI 覆盖文件。

以下命令用于初始化全新整套服务。已有部署应保留旧镜像和私有配置，核对本地 Compose 后，仅用 `docker compose pull wechat2tg` 和 `docker compose up -d --no-deps wechat2tg` 更新 bot。本示例的 `wx2tg-server` 镜像、命名空间和版本保持不变；本次 bot 命名修正不能替换或重启已有生产后端。

```bash
test -e .env || cp .env.example .env
mkdir -p conf
test -e conf/app.conf || cp app.conf.example conf/app.conf
docker compose pull
docker compose up -d
docker compose exec wechat2tg cat storage/webui-token
```

在 `.env` 填写 `BOT_TOKEN`、`API_ID`、`API_HASH`，也可以先进入 WebUI 填写并保存，然后重启应用。随仓库的示例使用 `BASE_API=http://wx2tg-server:8058/api` 和 `redislink=wx2tg-redis:6379`，使用整套 Compose 时保留这些服务名。

访问 `http://<服务器地址>:17863/`，使用访问令牌登录。连接凭证齐全后，在 Telegram 使用 `/login` 登录微信；凭证缺失时配置页面仍可使用。WebUI 保存环境配置后执行：

```bash
docker compose restart wechat2tg
```

Compose 示例配置如下：

```yaml
services:
  wechat2tg:
    image: finalpi/wechat2tg:latest
    container_name: wechat2tg-v6
    environment:
      WEBUI_ENABLED: "${WEBUI_ENABLED:-true}"
      WEBUI_HOST: "0.0.0.0"
      WEBUI_PORT: "${WEBUI_PORT:-17863}"
    ports:
      - "${WEBUI_BIND_ADDRESS:-0.0.0.0}:${WEBUI_PORT:-17863}:${WEBUI_PORT:-17863}"
      # - "8056:8056" # callback 模式且需宿主机访问时启用 / Optional callback exposure
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # 保存文件夹挂载后贴纸文件不需要重新转换
    env_file: ".env"
    restart: unless-stopped
    depends_on:
      - wx2tg-server

  wx2tg-server:
    image: finalpi/wx2tg-server:v6.0.16
    container_name: wx2tg-server
    ports:
      - "8058:8058"
    volumes:
      - ./conf:/usr/wic-go/conf
      - ./server-data:/usr/wic-go/data
      - ./server-logs:/usr/wic-go/logs
    environment:
      MESSAGE_STORE_POSTGRES_DSN: "${MESSAGE_STORE_POSTGRES_DSN:-}"
    restart: unless-stopped
    depends_on:
      - wx2tg-redis

  wx2tg-redis:
    image: redis:7.2
    container_name: wx2tg-redis
    ports:
      - "16379:6379"
    volumes:
      - ./redis-data:/data
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
```

| 宿主机端口 | 服务 | 默认开放方式 |
|---|---|---|
| TCP `17863` | WebUI 与 MCP（`/mcp`） | 所有宿主机网络接口 |
| TCP `8058` | 微信协议服务 | 按 Compose 配置开放 |
| TCP `16379` | Redis（容器内 `6379`） | 按 Compose 配置开放 |
| TCP `8056` | 可选 callback 模式 | 默认注释，需要时再启用 |

在 `.env` 修改 `WEBUI_PORT` 可同时改变容器监听端口和宿主机 WebUI 映射端口；`WEBUI_BIND_ADDRESS=127.0.0.1` 可改为仅本机访问。Compose 内的 `WEBUI_HOST` 固定为 `0.0.0.0`。修改端口映射、绑定地址或 `.env` 后执行 `docker compose up -d` 重建容器，仅重启进程不会改变 Docker 端口映射。

公网访问时，将 HTTPS 入口反向代理到 WebUI 端口，并在 MCP 接入页面填入对应的公开 `/mcp` 地址；按实际网络放行防火墙、路由器或转发服务的 TCP 端口。自签名部署需在客户端信任对应 CA；stdio 桥接可配置 `NODE_EXTRA_CA_CERTS=/absolute/path/to/ca.pem`，保留正常 TLS 校验。真实 IP、端口、路径和证书放在部署端的私有配置中。

### 本地开发

```bash
npm install
npm run build
npm run dev
```

默认访问 `http://127.0.0.1:17863/`；`npm start` 运行已编译的生产代码。配置项参考 `.env.example`，原生依赖需与本机系统匹配。

### 验证与日志

```bash
npm run test:webui
npm run test:mcp
docker compose logs --tail=100 wechat2tg
```

测试使用隔离消息数据，不向真实微信联系人发送消息。

#### 关闭 bot 隐私模式

关闭掉机器人的隐私模式，打开 BotFather，输入 `/mybots`，选择你的bot。点击 `Bot Settings` - `Group Privacy` - `Turn off`
，出现 `Privacy mode is disabled for xxx` 就说明关闭成功了

## 使用说明

### BOT命令

- `/login`：获取登录二维码；首次部署启动时，最先发送 `/login` 命令的人将成为 `BOT` 的所有者

- `/logout`：退出登录，删除登录缓存

- `/update`：更新群组头像和昵称信息

- `/message`：开关群组消息接收

- `/forward`：开关转发群组内其他人或者 bot 的消息

- `/user`：获取微信联系人列表（不含公众号）；点击按钮后可创建新群组或者绑定用户（可通过名称或备注搜索，例如：`/user 张`）

- `/official`：单独获取公众号列表；支持名称或备注搜索，例如：`/official 微信支付`。点击按钮可创建公众号群组或绑定到当前 Telegram 群。

- `/room`：获取微信群列表；点击按钮后可创建新群组或者绑定微信群（可通过名称或备注搜索，例如： `/room 外卖` 查找含有「外卖」的微信群）

- `/contacts [名称或备注]`：只读联系人列表，点击姓名查看微信 ID、微信号、备注、地区、签名等本地缓存资料；支持翻页、返回原列表，不会绑定或建群。在已绑定联系人的 Telegram 群组/Topic 内，不带参数（含 `/contacts@机器人`）直接显示当前联系人的详情；带搜索词仍打开列表。

- `/members [群名称或备注]`：只读选择微信群并查看成员，点击成员查看资料；支持成员分页及返回原群列表。在已绑定微信群的 Telegram 群组或 Topic 中，不带参数会直接显示对应微信群的成员。群成员资料不完整时仅显示已知信息。

- `/revoke`：撤回消息（回复需要撤回的消息）

- `/relogin`：二次登录（仅在登录后意外退出时使用，尝试用以前缓存的登录信息登录）

- `/getqr`：获取个人名片信息

- `/settings`：程序设置

- `/ai`：根据当前微信聊天上下文生成 AI 回复建议（例如：`/ai 帮我礼貌一点回复`；使用 `/ai context 30` 可保存默认上下文消息条数，使用 `/ai -n 30 帮我礼貌一点回复` 可为本次请求临时覆盖）

- `/unbind`：解绑微信群或微信用户（仅支持在群组使用）

- `/quit`：退出并解散群组

联系人、公众号和群聊查询均支持群组中的机器人后缀，例如：

```text
/user@your_bot 张 三
/official@your_bot 微信支付
/room@your_bot 项目 A（研发）
```

`@your_bot` 替换为自己的机器人用户名。关键词会保留内部空格、括号和标点；列表显示原始名称或备注，不额外添加 emoji 前缀。

自 v6.0.15 起，列表使用 Telegram 原生 RichMessage：直接点击正文中的名字、翻页和返回，不重复显示名单，也不跳转 Start 链接。仍每页 30 条并保留搜索与返回位置；不支持时使用简洁的兼容键盘和安全回退。详见 [列表分页说明](docs/directory-pagination.md)。

### 环境变量说明

|名称| 是否必填 | 描述                                                             |
|--|------|----------------------------------------------------------------|
|`BOT_TOKEN`| 是    | Telegram Bot 的 token，通过 [BotFather](https://t.me/BotFather) 创建 |
|`API_ID`| 是    | Telegram API 的 API ID                                          |
|`API_HASH`| 是    | Telegram API 的 API HASH                                        |
|`DEVICE_TYPE`| 是    | 微信登录协议:ipad,car,mac,pad,win,ipadX                              |
|`BASE_API`| 是    | wx2tg-server 容器的 API 请求地址，需要填入完整路径名                            |
|`PROXY_PROTOCOL`| 否    | 代理类型可选值（socks5,http,https）                                     |
|`PROXY_HOST`| 否    | 代理的 URL                                                        |
|`PROXY_PORT`| 否    | 代理的端口号                                                         |
|`PROXY_USERNAME`| 否    | 代理的用户名                                                         |
|`PROXY_PASSWORD`| 否    | 代理的密码                                                          |
|`ROOM_MESSAGE`| 否    | 在 BOT 中微信群消息的显示格式                                              |
|`OFFICIAL_MESSAGE`| 否    | 在 BOT 中公众号消息的显示格式                                              |
|`CONTACT_MESSAGE`| 否    | 在 BOT 中微信用户消息的显示格式                                             |
|`ROOM_MESSAGE_GROUP`| 否    | 在群组中微信群消息的显示格式                                                 |
|`CONTACT_MESSAGE_GROUP`| 否    | 在群组中微信用户消息的显示格式                                                |
|`OFFICIAL_MESSAGE_GROUP`| 否    | 在群组中公众号消息的显示格式                                                 |
|`CREATE_ROOM_NAME`| 否    | 自动创建微信群的群组时， 群组名称的格式                                           |
|`CREATE_CONTACT_NAME`| 否    | 自动创建微信联系人的群组时， 群组名称的格式                                         |
|`MESSAGE_DISPLAY`| 否    | 文字消息的显示格式                                                      |
|`AI_API_KEY`| 否    | `/ai` 回复建议使用的 OpenAI-compatible API Key                         |
|`AI_API_URL`| 否    | OpenAI-compatible chat completions 请求地址，例如 `https://api.openai.com/v1/chat/completions` |
|`AI_MODEL`| 否    | AI 模型名称，默认：`gpt-4o-mini`                                      |
|`AI_CONTEXT_LIMIT`| 否    | AI 上下文使用的兜底默认消息条数，默认：`20`；运行时默认值可通过 `/ai context <条数>` 保存到 sqlite，也可通过 `/ai -n <条数>` 为单次请求覆盖 |
|`MODE`、`CALLBACK_PORT`、`CALLBACK_API`、`FILE_API`| 否 | 消息模式、回调监听端口 / 地址、可选文件服务 |
|`WX_PROXY_HOST`、`WX_PROXY_USERNAME`、`WX_PROXY_PASSWORD`| 否 | 独立的微信 SOCKS 登录代理 |
|`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`| 否 | 腾讯云 ASR 凭证 |
|`SEND_TO_WX_MAX_RETRIES`、`SEND_TO_WX_TIMEOUT`| 否 | 原有微信转发重试次数（`3`）与超时（`30000` 毫秒） |
|`SEND_TO_TG_MAX_RETRIES`、`SEND_TO_TG_RETRY_DELAY`| 否 | 普通错误重试上限（`3`）与退避基数（`5000` 毫秒）；明确未连接和 429 持续重试，结果未知需先核对。见[持久转发说明](docs/diagnostics/telegram-forwarding.md)。 |
|`MESSAGE_BUFFER_EXPIRE_TIME`| 否 | 兼容旧配置的已完成转发记录清理时间（实际至少 7 天）；待发送、失败和未知记录不自动过期。 |
|`AUTO_DELETE_OLD_MESSAGES`、`MESSAGE_RETENTION_DAYS`| 否 | 清理原有机器人消息历史，默认 `false` / `7` 天 |
|`LOG_LEVEL`、`DEBUG_MODE`| 否 | 日志级别与调试模式，默认 `info` / `false` |
|`DB_SQLITE_PATH`| 否 | 兼容保留字段；当前绑定数据库实际固定为 `storage/db/wx2tg.db` |
|`WEBUI_ENABLED`| 否 | 是否启用 WebUI，默认 `true`；MCP 共用此监听服务 |
|`WEBUI_HOST`| 否 | 本地默认 `127.0.0.1`；Compose 覆盖为 `0.0.0.0` |
|`WEBUI_PORT`| 否 | WebUI 与 MCP 端口，默认 `17863` |
|`WEBUI_BIND_ADDRESS`| 否 | Compose 宿主机绑定地址，默认 `0.0.0.0` |
|`WEBUI_TOKEN`| 否 | WebUI 访问令牌，至少 16 字符；不填则自动生成 |
|`WEBUI_CONFIG_PATH`| 否 | WebUI 持久化文件，默认 `storage/webui-config.json` |
|`MCP_ENABLED`| 否 | MCP 初始启用状态，默认 `true`；之后以已保存 MCP 设置为准 |
|`MCP_TOKEN`、`MCP_READ_TOKEN`| 否 | MCP 初始读写 / 只读凭证，不填自动生成，两者必须不同 |
|`WECHAT_MCP_URL`、`WECHAT_MCP_TOKEN_FILE`、`WECHAT_MCP_TOKEN`| 客户端 | stdio 桥接地址与凭证来源；地址必填，Token 值优先于 Token 文件 |
|`NODE_EXTRA_CA_CERTS`| 客户端 | 自签名 HTTPS 部署的可选 CA PEM 文件 |

---

### 设置项`/settings`命令说明

1.微信emoji是否以图片链接显示: 开启后会将好友发过来的小黄人表情转为图片链接的方式显示

2.启动时同步群组信息: 开启后会在程序刚启动时同步所有人的信息，会更新群组头像和名称

---

### 语音转文字

1. 配置 `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY` ，可在腾讯[语音识别控制台](https://console.cloud.tencent.com/asr)开通
   。有免费的使用额度
2. 在 `/settings` 中开启自动语音转文字功能

---

### 获取`API_ID` 和 `API_HASH`

1. 登录 [telegram account](https://my.telegram.org/)

2. 然后点击「API development tools」并填写应用程序详细信息（只需应用程序标题和简称）

3. 最后点击「Create application」

---

### 自定义消息模板

如果你想修改消息发送者的格式，你可以修改 docker 中的环境变量、`.env`，或 WebUI 的「消息样式」。

默认消息模板（不含装饰 emoji；正文里的 emoji 保留）：

```dotenv
CONTACT_MESSAGE='<b>#[alias_first]: </b>'
OFFICIAL_MESSAGE='<b>#[name]: </b>'
ROOM_MESSAGE='<b>#[member_name]: </b>'
CONTACT_MESSAGE_GROUP='<b>#[alias_first]: </b>'
OFFICIAL_MESSAGE_GROUP='<b>#[name]: </b>'
ROOM_MESSAGE_GROUP='<b>#[member_name]: </b>'
MESSAGE_DISPLAY='#[identity]#[br]#[body]'
```

未设置、留空或纯空格的模板使用上述默认值。`CREATE_ROOM_NAME` / `CREATE_CONTACT_NAME` 是群名称模板，不受消息模板重置影响。

自定义消息模板占位符:

`#[alias]`：联系人备注

`#[name]`：联系人昵称

`#[topic]`：群聊昵称

`#[member_name]`：成员自己在该群设置的群昵称；没有群昵称时使用其微信昵称。**不读取你给联系人的通讯录备注**，可直接用于 `ROOM_MESSAGE`、`ROOM_MESSAGE_GROUP` 和 `MESSAGE_DISPLAY`。

`#[alias_first]`：备注优先，如果没有备注就显示联系人的昵称

`#[identity]`：身份信息文本

`#[body]`：消息体文本

`#[br]`：换行

说明：

- 群昵称通过微信群成员接口查询，按账号与群缓存 60 秒；查询失败或超过 1.5 秒时不发送昵称查询请求的等待，直接回退到微信昵称，不会阻塞或丢弃消息。失败后同一账号/群会在 60 秒内直接回退。
- 只有模板里出现 `#[member_name]` 时才查询群成员，自定义模板未使用时不会产生额外请求。
- 群昵称会做 HTML 转义，管理员自定义的群名不会破坏消息格式。
- 从旧版本升级时，上述 7 项消息展示模板会**一次性重置为默认值**（包括 `.env` 和环境变量中的旧值）；重置前会把旧值备份到 `webui-config.json.message-templates-v1.json`（仅这 7 项，不含密钥），之后你修改的模板不会被再次覆盖。群名称模板、头像和绑定关系不变。

`#[identity]`：身份信息文本

`#[body]`：消息体文本

`#[br]`：换行

- 群聊和单聊的接龙转发都会附带「参与接龙」按钮（仅机器人主人可用，群昵称优先）；点击后调用服务端 `POST /Msg/SendSolitaire` 参与接龙，失败或结果不确定时不会自动重发。详见 [接龙消息](docs/solitaire-messages.md)。
- 「自定义参与」与 `/join 2 份` 可按自定义文本参与（完全替换昵称）；`/solitaire 标题 | 首条 | 尾注` 可在已绑定群直接发起接龙。成功不额外回复，微信的接龙更新会照常转发。详见 [接龙消息](docs/solitaire-messages.md)。

### 如何 @所有人

发送以 `@all` 开头的消息会 @所有人，仅支持文本消息 @所有人

---

## 常见问题

### 为什么提示我输入验证码

wx2tg-server 需要保证和你登陆地在同一个区域，如果遇到输入验证码的情况，检查一下是否在同一区域

如果不在同一个区域可以在环境变量配置微信代理登录，或者迁移已经登录好的 Redis 数据

## 参与开发

1. fork 项目，从 `v6` 创建功能分支；v7 相关改动单独处理。
2. 提交 Pull Request 到对应维护分支，版本更新遵循 [发行规则](docs/releases.md)。


## License

[MIT](LICENSE)
