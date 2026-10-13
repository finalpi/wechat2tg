# wechat2tg-v3

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
5. 中英文 WebUI 配置、消息样式实时预览、AI 模型读取与测试
6. WebUI 联系人搜索、多类型收发、附件下载与 Telegram 同步跟踪
7. 十一个微信 MCP 工具，支持 WebUI 管理 Token 与导出客户端配置

## WebUI 配置与消息管理

WebUI 随应用启动，支持中文 / English。Docker Compose **默认对外开放 TCP 17863**，访问 `http://<服务器地址>:17863/`；本地开发默认仅监听本机，地址为 `http://127.0.0.1:17863/`。WebUI 和 MCP 共用这个端口，MCP 路径为 `/mcp`。

### 配置控制台

- 配置 Telegram / 微信连接、转发偏好、消息样式、代理、AI / 语音识别，以及重试、历史清理和日志选项。
- 支持全局配置搜索、字段校验、未保存更改提示、多个页面修改冲突检测、手机布局和重启生效提示。WebUI 语言与 Telegram 机器人语言独立。
- Telegram 代理和微信代理分块展示。消息模板支持联系人、群聊和公众号实时预览，也可测试没有备注时的回退结果；预览仅使用示例数据，不发送消息。
- 使用至少 16 字符的 `WEBUI_TOKEN` 登录；不设置时自动生成 `storage/webui-token`。登录后默认进入消息管理。当前标签页刷新会保留登录；勾选“记住访问令牌”后，该浏览器重新打开也会自动登录。退出登录或服务器拒绝旧令牌时清除保存值。
- 普通配置密钥不返回明文，留空保留原值，输入新值替换，可选密钥可显式清除。MCP Token 使用独立的显示、下载与导出操作。

### 联系人与消息收发

- 按昵称、备注或微信 ID 搜索联系人与群聊。“全部 · 最近”按最新消息排序，显示消息摘要和真实头像；无法获取头像时使用首字占位。
- 群聊中输入 `@` 或点击“@ 群成员”，可搜索并选择最多 20 位成员，也可选择 @所有人。艾特仅用于文字，@所有人的群主 / 管理员权限由微信校验；发送内容同步显示到 Telegram。
- 方向键切换成员、Enter 选中，艾特直接插入光标处，选择窗口自动关闭。编辑或删除已选择的艾特文字会移除其微信 ID 绑定。
- 点击消息“引用”，发送微信原生文字引用回复，并同步到 Telegram。点击引用卡片可定位并高亮原消息，必要时加载历史上下文，支持返回最新消息。目前引用回复不能同时带原生艾特或附件。
- 撤回本人已确认发送的消息：普通消息限 2 分钟，文档、MP3 文件和压缩包等文件限 3 小时，按实际微信消息类型判断（微信语音仍为 2 分钟）。超时或缺少原生回执时禁用撤回。微信撤回成功后，WebUI 和 Telegram 各显示一条引用原消息的撤回提示，原正文和附件保留；点击 WebUI 提示中的引用可定位原消息。主动撤回和微信回调按原消息去重，Telegram 通知发送失败可单独重试。规则见[微信派说明（澎湃转载）](https://www.thepaper.cn/newsDetail_forward_33209118)。
- 搜索已保存的会话记录、加载历史消息，新消息每 5 秒刷新。首次打开会话先显示最近 60 条记录，其余历史在后台补齐（最多导入最近 500 条），不会从微信服务器拉取全部历史。
- 微信内置表情（如 `[抱拳]`）在正文、引用、嵌套记录和公众号图文中显示为本地 WebP 表情图片，支持中英文标记；不依赖 Telegram 表情转换设置，Unicode 原样保留，未知标记或图片加载失败时保留原文。
- 支持文本、图片、GIF、MP4 视频、音频、语音和文件发送，附件最大 50 MiB。输入框支持 Ctrl / ⌘ + V 粘贴图片，先预览，再点击发送或按 Ctrl / ⌘ + Enter；附件和附带文字分别发送。
- 收到的图片默认自动加载预览，合并记录中的图片在所在记录展开后加载；加载失败可手动重试。文件和其他媒体仍可按需查看或下载。点击图片可大图预览，支持滚轮或按钮缩放、左右旋转、适应窗口和放大后拖动，按 Esc 或点击背景关闭；公众号图文按单篇或多篇文章展示可点击标题和摘要，支持阅读全文；链接、位置和名片使用卡片展示。群聊分层显示头像、发言人和内容；合并聊天记录支持展开，内嵌文件、图片及嵌套记录中的附件可下载；嵌套聊天可逐层展开。图片、文件的协议 XML 不作为正文显示，功能同步、游戏红点和计数控制包不会作为聊天消息显示或补发。
- WebUI / MCP 发出的消息会显示在消息管理中，并同步到 Telegram。请求编号防止重复提交。“已提交”仅表示微信服务返回了消息编号，不代表对方已读；结果不确定时不会自动重发。
- 通过已绑定 Telegram 会话发往微信的文字、引用回复和媒体，也会显示在 WebUI 中，标明“来自 Telegram”和微信发送状态，不会再转发回 Telegram，也不计入 Telegram 未读数量。附件和附带文字分别记录；已缓存的媒体可预览或下载，缓存失败时提示在 Telegram 查看附件。
- 红色数量只表示明确跟踪到的 Telegram 待发送、发送中或确定失败消息，同步成功后自动消除。历史零回执和结果不确定的消息单独显示，不计入未读。打开会话不会清除尚未同步到 Telegram 的消息。
- 支持“仅补发到 Telegram”，不会重发到微信；禁止并行重复补发，结果不确定时需明确确认后才能再次尝试。

### AI 与语音

填写 OpenAI 兼容服务的地址与密钥后，可以读取模型列表、选择模型并测试连接，再保存配置。测试使用当前尚未保存的输入；密钥留空时沿用已保存的密钥，切换服务来源时必须明确填写新密钥。测试仅发送通用测试提示，不发送聊天记录。`/ai` 根据会话上下文生成回复建议，不会自动发送。

配置腾讯云 ASR 凭证后，可以通过 WebUI 或 `/settings` 开启语音自动转文字。

### MCP 接入与安装

在 WebUI 的 **MCP 接入** 页面即可管理：

- 即时开启或关闭 MCP，设置客户端访问地址与本地桥接脚本路径；访问地址用于生成客户端配置，不改变服务监听地址。
- 显示、下载、自动生成或手动替换独立的只读 / 读写 Token。更换后旧 Token 在下一次请求失效，需同步更新客户端。
- 一键复制或下载 Streamable HTTP / stdio 客户端配置，默认选择只读权限。预览使用 `<TOKEN>` 占位符；显式导出的配置包含所选 Token。
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
| `storage/db/wechat2Tg.db` | 绑定关系与机器人偏好 | 偏好即时生效；启动同步在下次启动执行 |
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

Docker 部署使用 Docker Engine 和 Docker Compose v2；本地开发使用 Node.js 18+。SQLite、图像处理和媒体转换等原生依赖需要与实际运行平台匹配。

### Docker Compose

直接使用仓库的 `docker-compose.yml`，无需再叠加 WebUI 覆盖文件。主配置使用发布镜像 `finalpi/wechat2tg-v3:latest`，无需本地构建。

```bash
cp .env.example .env
mkdir -p conf
cp app.conf.example conf/app.conf
docker compose pull
docker compose up -d
docker compose exec wx2tg-v3 cat storage/webui-token
```

在 `.env` 填写 `BOT_TOKEN`、`API_ID`、`API_HASH`，也可以先进入 WebUI 填写并保存，然后重启应用。随仓库的示例使用 `BASE_API=http://wx2tg-server:8058/api` 和 `redislink=wx2tg-redis:6379`，使用整套 Compose 时保留这些服务名。

访问 `http://<服务器地址>:17863/`，使用访问令牌登录。连接凭证齐全后，在 Telegram 使用 `/login` 登录微信；凭证缺失时配置页面仍可使用。WebUI 保存环境配置后执行：

```bash
docker compose restart wx2tg-v3
```

主 Compose 默认配置如下：

```yaml
services:
  wx2tg-v3:
    image: finalpi/wechat2tg-v3:latest
    container_name: wx2tg-v3
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
    # image: finalpi/wx2tg-server:v3-latest # v3 稳定版
    image: finalpi/wx2tg-server:v5-latest
    container_name: wx2tg-server
    ports:
      - "8058:8058"
    volumes:
      - ./conf:/usr/wic-go/conf
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
docker compose logs --tail=100 wx2tg-v3
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

- `/user`：获取微信用户列表；点击按钮后可创建新群组或者绑定用户（可通过名称或备注搜索，例如： `/user 张` 查找包含「张」的微信用户）

- `/room`：获取微信群列表；点击按钮后可创建新群组或者绑定微信群（可通过名称或备注搜索，例如： `/room 外卖` 查找含有「外卖」的微信群）

- `/revoke`：撤回消息（回复需要撤回的消息）

- `/relogin`：二次登录（仅在登录后意外退出时使用，尝试用以前缓存的登录信息登录）

- `/getqr`：获取个人名片信息

- `/settings`：程序设置

- `/ai`：根据当前微信聊天上下文生成 AI 回复建议（例如：`/ai 帮我礼貌一点回复`；使用 `/ai context 30` 可保存默认上下文消息条数，使用 `/ai -n 30 帮我礼貌一点回复` 可为本次请求临时覆盖）

- `/unbind`：解绑微信群或微信用户（仅支持在群组使用）

- `/quit`：退出并解散群组

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
|`SEND_TO_TG_MAX_RETRIES`、`SEND_TO_TG_RETRY_DELAY`| 否 | 原有 Telegram 转发重试次数（`3`）与退避基数（`5000` 毫秒） |
|`MESSAGE_BUFFER_EXPIRE_TIME`| 否 | 消息缓冲有效期，默认 `300000` 毫秒 |
|`AUTO_DELETE_OLD_MESSAGES`、`MESSAGE_RETENTION_DAYS`| 否 | 清理原有机器人消息历史，默认 `false` / `7` 天 |
|`LOG_LEVEL`、`DEBUG_MODE`| 否 | 日志级别与调试模式，默认 `info` / `false` |
|`DB_SQLITE_PATH`| 否 | 机器人数据库路径，默认 `storage/db/wechat2Tg.db` |
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

如果你想修改消息发送者的格式，你可以修改 docker 中的环境变量或者 `.env` 文件

自定义消息模板占位符:

`#[alias]`：联系人备注

`#[name]`：联系人昵称

`#[topic]`：群聊昵称

`#[alias_first]`：备注优先，如果没有备注就显示联系人的昵称

`#[identity]`：身份信息文本

`#[body]`：消息体文本

`#[br]`：换行

### 如何 @所有人

发送以 `@all` 开头的消息会 @所有人，仅支持文本消息 @所有人

---

## 常见问题

### 为什么提示我输入验证码

wx2tg-server 需要保证和你登陆地在同一个区域，如果遇到输入验证码的情况，检查一下是否在同一区域

如果不在同一个区域可以在环境变量配置微信代理登录，或者迁移已经登录好的 Redis 数据

## 参与开发

1. fork 项目，切换到 `wx2tg-v3-dev` 分支，或者新建一个分支。请不要直接提交代码到主分支
2. 提交 Pull Request 到 `wx2tg-v3-dev` 分支


## License

[MIT](LICENSE)
