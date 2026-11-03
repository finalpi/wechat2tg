# v6 配置与消息链路

## 本次同步范围

以服务端 `fk-zhang` 的 `875` 分支、提交 `041e67b` 为对照，客户端依赖为 npm 发布的 `wx2tg-puppet@3.0.8`。本次先同步本仓库 `v6` 的部署配置；`v7` 暂不改动，后续同步时需替换为对应版本的 server 镜像。

新增配置不等于全部协议已适配。特别是带正文回调和普通文件分片下载，当前 puppet 仍有下面列出的兼容性问题。

## 配置与部署

- `.env`：bot 的配置；从 `.env.example` 复制。
- `conf/app.conf`：server 的配置；从 `app.conf.example` 复制。已有部署应合并新增项，保留自己的端口、Redis 认证和网络地址。
- Compose 使用 `finalpi/wx2tg-server:v6-latest`。server 的 `httpport=8058` 与 `.env` 的 `BASE_API=http://wx2tg-server:8058/api`、Compose 端口一致；没有照搬上游私有部署的端口和凭据。
- `syncmessagebusinessuri` 中的 `{0}` 由 server 替换为账号 wxid。同一 Compose 网络通过 `wx2tg-v3:8056` 访问时，不必把回调端口发布到宿主机。
- 这些是示例默认值，不会自动修改已有的 `.env` 或 `conf/app.conf`；本次没有部署、重启服务或执行数据库迁移。
- 消息归档查询会暴露聊天内容。server API 和回调端口应仅允许可信网络访问；如果发布到公网，需要额外的访问控制，`corsalloworigins` 不是鉴权。

### 目前保留 polling

```dotenv
MODE=polling
```

```ini
syncmessage = false
msgpush = false
```

两个 server 开关都要保留为 `false`：仅关闭 `syncmessage` 不足以阻止长连接通知在 `msgpush=true` 时主动调用 Sync 消费消息。此组合让客户端主动拉取消息，同时仍允许 server 保存消息历史。

`msgpush=false` 时 server 的长连接仍可能发送空通知；polling 模式的 puppet 不启动 HTTP 回调监听，因此可能出现空回调连接失败日志。这不等于客户端轮询失败，也不要为消除日志而打开 `msgpush`。本文不把该组合称为“server 完全不发回调”。

### 新增配置组

| 用途 | 配置项 | 模板策略 |
| --- | --- | --- |
| 原始事件诊断 | `wechatraweventlog`、`wechatraweventlogdir`、`wechatraweventlogretention` | 默认关闭；启用后包含消息原文，按小时轮转，保留约 24 小时 |
| 心跳与恢复 | `autoheartbeat`、`heartbeatmode`、`heartbeatretryinterval` | `autoheartbeat` 仅兼容旧配置，不再是关闭自动恢复的开关；模板为 `auto`、`10s` |
| 同步与回调 | `syncmessageinterval`、`syncmessageautostop`、`callbacktimeout` | `1s`、`0`、`5s`；前两项用于 server 短链同步，不控制 puppet 的轮询周期 |
| 消息去重 | `messagededupwindow` | `2m`，`0` 关闭；是进程内去重，不是消息重放队列 |
| 消息归档 | `savelocalmessage`、`messagestore`、`localmessagedir` | 启用 SQLite，`data/messages` |
| PostgreSQL | `messagepg*`、`MESSAGE_STORE_POSTGRES_DSN` | 仅提供配置，默认不启用 PG |
| PG 通讯录 | `messagecontactautosync`、`messagecontactsyncinterval`、`messagecontactrequestinterval`、`messagecontactsynctimeout` | 同步上游选项，仅 PostgreSQL 后端支持通讯录存储 |
| 浏览器跨域 | `corsalloworigins` | 默认空，仅同源/服务器调用；不是认证机制 |
| SQLite 历史维护 | `messagestoreautomigratelegacy`、`messagestoreautomigrateconversation`、`messagestoreautocleanupweixin`、`messagestoreautovacuum` | 全部关闭，避免收消息时锁库 |

原始事件日志也可通过 server 容器环境变量 `WECHAT_RAW_EVENT_LOG`、`WECHAT_RAW_EVENT_LOG_DIR`、`WECHAT_RAW_EVENT_LOG_RETENTION` 覆盖；本 Compose 未默认传入这三个变量。

## 本地消息保存

```ini
savelocalmessage = true
messagestore = "sqlite"
localmessagedir = "data/messages"
```

Compose 新增持久化挂载：

```yaml
volumes:
  - ./server-data:/usr/wic-go/data
  - ./server-logs:/usr/wic-go/logs
```

server 工作目录为 `/usr/wic-go`，因此消息目录落在宿主机 `./server-data/messages`；原始诊断日志启用时落在 `./server-logs/wechat-events`。如果自定义目录超出挂载路径，需要同步调整卷。

**已有容器如果曾把消息保存在容器内部，先停写并备份/复制原目录到宿主机，再挂载。新增空挂载会遮住容器原目录，不会自动搬迁旧记录。** 也应检查宿主机目录写权限。归档没有在本模板中设置自动过期，应自行规划磁盘和备份。

三类数据不要混淆：

| 位置 | 作用 |
| --- | --- |
| `./server-data/messages` | server 保存的微信消息归档 |
| `./config/db/wechat2Tg.db` | bot 的 Telegram/微信消息关联、引用、撤回和 AI 上下文等数据 |
| `./config/db/puppet.db` | puppet 的账号、联系人等状态 |

`.env` 的 `AUTO_DELETE_OLD_MESSAGES` / `MESSAGE_RETENTION_DAYS` **只清理 bot 数据库，不清理 server 归档**。当前 bot 不调用 `/api/Msg/QueryLocal` 补历史；`WeChatClient.onMessage` 还会过滤早于本次启动时间的消息。因此 server 留有记录不代表 bot 会自动补发漏掉的 Telegram 消息。

服务端消息落库采用容量 4096 的内存任务队列、单 worker 异步写入。队列满时丢弃归档任务并记录日志，写库失败也没有自动重试；进程退出可能丢失未落库任务。这是历史存储，不是可靠投递/回调重试队列。

### 可选 PostgreSQL

需要 PG 时，手动将 `messagestore` 改为 `postgres`，并在未提交的 `.env` 中填写 `MESSAGE_STORE_POSTGRES_DSN`；Compose 会将它传给 server 容器。不要把真实连接串提交到仓库。

- 默认 `messagepgautomigratesqlite=true`。保留原 SQLite 挂载，先备份，停止其他读写旧库或目标消息库的服务。
- 只有全新无历史的 PG 安装才设为 `false`；不能借此跳过已开始的迁移。
- server 启动前会升级 PG 布局并迁移，失败会停止启动；不会创建 PG 数据库、自动回退 SQLite 或双写。
- 预留旧表、新表、索引和 WAL 的空间，授予必要的 schema CREATE 权限，禁止新旧版本混跑。
- 消息归档是异步的，但 PG 通讯录的被动采集在 Sync 链路里同步执行，可能受 `messagepgtimeout`（模板为 `15s`）影响。关闭 `messagecontactautosync` 不会关闭被动采集。

## 当前消息怎么到 Telegram

### 默认 polling

```text
puppet 每秒调用 POST /api/Msg/Sync
  → server 向微信同步消息
  → 更新 SyncKey、过滤内部消息、按消息 ID 去重
  → 消息归档入异步队列
  → 返回 Data.AddMsgs（同时也有规范化 Data.Messages）
  → puppet 解析 Data.AddMsgs，发出 message 事件
  → WeChatClient.onMessage：过滤历史/重复消息，按绑定转发 Telegram
```

server 仍保留 `Data.AddMsgs`，新增 `Data.Messages` 本身不要求修改当前 polling 消息解析器。开启 SQLite 消息归档也不要求 bot 改读数据库。

### 当前 callback 与上游正文推送不兼容

上游 `msgpush=true` 时：

```text
server 收到微信通知
  → server 自己先 Sync，推进游标、去重、排队归档
  → POST /message/callback/{wxid}，正文带本批消息
  → puppet 3.0.8 收到请求，却忽略正文
  → puppet 再次 Sync
  → 可能已无消息，导致这一批没有转发
```

`/Msg/Sync` 不是 Redis 消息队列读取接口，也不会自动读取本地归档返回上一批消息。关闭去重窗口不能回退已经推进的游标，保存本地消息同样不能修复这个问题。

本地隔离验证运行了实际安装的 `wx2tg-puppet@3.0.8` 回调服务器逻辑，发送合成消息并模拟后续 Sync 为空，得到 **HTTP 200、Sync 调用 1 次、message 事件 0 次**。这是依赖代码的离线复现，不是连接微信/Telegram 的端到端测试。

另一个问题是该依赖在 polling 启动时会发出 `login` 事件，而 callback 初始化分支没有对应事件；bot 的 `loginSuccess` 依赖这个事件，不能只开启 HTTP 端口就认为适配完成。

### 后续应在 puppet 修复的内容

1. HTTP 回调携带消息时直接解析并处理该批数据，复用 Sync 消息解析逻辑，避免再拉一次后丢掉原批次。
2. 兼容上游仍可能发送的空通知/时间戳通知，此类通知再触发 Sync；处理并发及尾批，不能因已有同步进行中而静默丢弃带正文回调。
3. 使用保留大整数精度的 JSON 解析，避免 64 位 `NewMsgId` 被普通 `JSON.parse` 舍入，并对回调/轮询重叠做去重。
4. 补齐 callback 分支的 `login` 事件、初始化顺序和错误处理；当前 HTTP 200 并不表示已成功转发 Telegram。
5. 回调接收端限制请求大小、校验账号/数据并限制网络访问。当前路径没有新增 token/签名认证，不能把 CORS 当作鉴权。
6. 如果需要“断线不漏、失败可补发”，还需设计 server 的持久化投递队列或基于归档的游标补偿，不能把当前异步存储当作已经具备可靠投递。

上游回调目前没有可靠重试或失败回滚：游标先推进、HTTP POST 后执行，非 2xx 状态也不一定被调用方当作失败。修复 puppet 的正文处理可以消除这处确定的不兼容，但不能单独保证端到端不丢消息。

本次仅同步配置并记录适配结论，没有修改 `node_modules`、本地 puppet 仓库或服务端源码，也没有更改 bot 的默认运行模式。

## 另一个需要跟进的接口变化：文件下载

服务端提交 `db823d3` 将 `POST /api/Tools/DownloadFile` 的成功返回改为 HTTP 200/206 的二进制，不再返回 JSON/Base64。当前 puppet 的 `ToolsApi.DownloadFile` / `Message.toFileBox` 仍读取 `Data.data.iLen` 和 `Data.data.buffer`，因此走此接口的普通文件下载不兼容。

需要在 puppet 使用二进制响应、按实际收到的字节数推进分片偏移，并区分失败 JSON；不能固定按请求分片长度累加。图片、视频以及 `DownloadFileMessage` 不属于这次 server 接口格式变更。此问题与消息归档无关，但部署最新 v6 server 前也需要处理。

## 核对依据

服务端源码：

- `conf/app.conf`：配置键与示例值。
- `models/Msg/sync.go`：Sync、游标更新、去重、`AddMsgs`/`Messages` 和归档排队。
- `models/Msg/local_message.go`：异步写入、`QueryLocal`，存储副本不保留 `MsgSource`；实时消息仍保留该字段。
- `srv/wxcore/wxmodels.go` 的 `MsgListen`、`srv/sync/syncmsg.go`：正文推送与空通知。
- `comm/Util.go` 的 `HttpPosthb`：超时、HTTP 状态与重试行为。
- `docs/download-file.md`：二进制文件分片接口。

客户端实际安装依赖（本地另一个 puppet 源码仓库标为 3.0.7，不作为本次 3.0.8 行为的唯一依据）：

- `node_modules/wx2tg-puppet/dist/index.js`：`loginSuccess`、`startCallbackServer`、`handleCallbackMessage`、`startPollingMode`、`handleMsgOnce`。
- `node_modules/wx2tg-puppet/dist/core/Message.js`：`toFileBox`。
- `src/client/WechatClient.ts`：配置传入、事件订阅、`onMessage`。
