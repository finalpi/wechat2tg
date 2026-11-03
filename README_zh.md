# wechat2tg（v6）

中文 | [English](README.md)

基于微信协议在 Telegram 收发微信消息，支持 ipad,mac,car,windows,pad 多种协议

## TG 群组: [@Wx2TgUserGroup](https://t.me/+AD02MEZa-og3ZGY1)

> [!WARNING]
> 经反馈 Windows 协议有封号的风险，请勿使用该协议

## 分支与 Server 版本对应关系

请根据使用的 `wx2tg-server` 主版本选择对应分支：

| 本仓库分支 | 配套 Server 版本 |
| --- | --- |
| `v6` | `wx2tg-server v6` |
| `v7` | `wx2tg-server v7` |

请勿将 `v6` 分支与 server v7 混用，也不要将 `v7` 分支与 server v6 混用。切换分支时，需同时切换到对应主版本的 server。

两个分支均基于同一份 `wx2tg-v3` 代码初始化。创建分支本身不代表已完成或验证版本兼容性，后续版本适配改动将在各自分支维护。

## 主要功能

1. 微信单聊消息、微信群消息、公众号消息的接收，以及企业微信消息的接收
2. 通过 Telegram 向指定的微信用户、微信群、公众号发送消息
3. 灵活的群组消息屏蔽功能
4. 基于当前微信聊天上下文生成 AI 回复建议

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
> 本次三个仓库统一为 **`v6.0.12`**：bot / puppet 包版本 `6.0.12`，server 与 bot 镜像标签 `v6.0.12`。本地标签不代表已经发布 npm/Docker。版本、发布顺序与历史分支说明见 [发行规则](docs/releases.md)；消息模式、存储与升级注意事项见 [v6 配置与消息链路说明](docs/server-v6.md)。v7 本轮不改动。

先复制一份 `.env.example` 为 `.env` 文件，然后配置 `.env` 文件中的环境变量

复制项目中的 `app.conf.example` 为 `app.conf` 文件到 `conf` 目录，将 Redis 地址设置为你部署的 Redis 的地址。已有部署请合并新增配置，不要直接覆盖自己的端口、Redis 凭据和回调地址。

默认保留 `.env` 中的 `MODE=polling`，以及 server 的 `syncmessage=false`、`msgpush=false`。服务端新增消息归档默认启用 SQLite，保存在宿主机 `./server-data/messages`，与 bot 的 `./config` 数据库独立。puppet `6.0.12` 已支持带正文回调和二进制文件分片；切换到 callback 时需同时配置 server 的 `msgpush=true` 和可达的回调地址，详见上面的说明。

### docker-compose

创建 `docker-compose.yml` 文件：

```yaml
version: '3'

services:
  wx2tg-v3:
    image: finalpi/wechat2tg-v3:v6.0.12
    container_name: wx2tg-v3
    # ports:
    #   - "8056:8056" # 仅外部 server 回调时按需发布；同一 Compose 网络无需发布
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # 保存文件夹挂载后贴纸文件不需要重新转换
    env_file: ".env"
    restart: unless-stopped
    depends_on:
      - wx2tg-server

  wx2tg-server:
    image: finalpi/wx2tg-server:v6.0.12
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

#### 运行

```shell
docker-compose up -d
```

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

### 环境变量说明

|名称| 是否必填 | 描述                                                             |
|--|------|----------------------------------------------------------------|
|`BOT_TOKEN`| 是    | Telegram Bot 的 token，通过 [BotFather](https://t.me/BotFather) 创建 |
|`API_ID`| 是    | Telegram API 的 API ID                                          |
|`API_HASH`| 是    | Telegram API 的 API HASH                                        |
|`DEVICE_TYPE`| 是    | 微信登录协议:ipad,car,mac,pad,win,ipadX                              |
|`BASE_API`| 是    | wx2tg-server 容器的 API 请求地址，需要填入完整路径名                            | |
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

 ---

### 设置项`/settings`命令说明

1.微信emoji是否以图片链接显示: 开启后会将好友发过来的小黄人表情转为图片链接的方式显示

1.启动时同步群组信息: 开启后会在程序刚启动时同步所有人的信息，会更新群组头像和名称

---

### 语音转文字

1. 配置 `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY` ，可在腾讯[语音识别控制台](https://console.cloud.tencent.com/asr)开通
   。有免费的使用额度
2. 在 `/settings` 中开启自动文字转语音功能

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

1. fork 项目，从 `v6` 创建功能分支；v7 相关改动单独处理。
2. 提交 Pull Request 到对应维护分支，版本更新遵循 [发行规则](docs/releases.md)。


## License

[MIT](LICENSE)


## Thanks

感谢Jetbrains对本项目的支持

[<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" width="200">](https://www.jetbrains.com)
