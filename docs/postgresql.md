# 可选 PostgreSQL：Bot 与微信服务端

默认仍是 SQLite，无需安装 PostgreSQL。`wx2tg-server` 的消息归档和 `wechat2tg` 的业务数据库可以单独切换，也可以连接**同一个 PostgreSQL 实例**。两者必须用各自的数据库和登录角色，不要共用表或凭证。Bot 需要使用包含 PostgreSQL 支持的镜像／构建。

| 组件 | PostgreSQL 中保存的数据 | 保留在本地的数据 |
| --- | --- | --- |
| `wx2tg-server` | 微信消息归档，以及后端支持的通讯录数据 | Redis 会话、配置、日志、原 SQLite 备份 |
| `wechat2tg` | 配置、令牌、绑定、话题、消息关联；WebUI 消息历史和附件索引；待发送队列及其待投递媒体；红包／转账流水；朋友圈归档（含已归档的图片） | Telegram 会话、附件文件及缓存、微信 SDK `puppet.db`、日志等 |

**启用 PG 后仍要保留原来的挂载并备份。** 两边的 PG 数据不能替代 Redis 或 `./config`，也不会自动互相补发消息。Bot 仍按 `ENV > 已保存配置 > 默认值` 读取应用设置；数据库驱动和连接串是启动配置，不通过 WebUI 持久化。

## 共用一个实例

先由 PostgreSQL 管理员在同一个实例创建两个数据库及最小权限账号，例如 `wechat_archive` / `wechat_archive_app` 和 `wechat2tg_bot` / `wechat2tg_app`。让各角色拥有自己的数据库并可在 `public` schema 创建表和索引；不要用超级用户，不要授予彼此数据库访问权限。服务不会自动建库。使用 Docker 时，PG 地址必须能从相应容器访问（同容器网络的 PG 服务名或外部地址），不要把容器内 `localhost` 当作宿主机。远程连接建议启用并校验证书（例如 `sslmode=verify-full`）。

在私有 `.env` 中填写（以下仅为占位符；密码中的特殊字符请作 URL 编码）：

```dotenv
MESSAGE_STORE_POSTGRES_DSN=postgresql://wechat_archive_app:PASSWORD@pg.example.internal:5432/wechat_archive
BOT_POSTGRES_DSN=postgresql://wechat2tg_app:PASSWORD@pg.example.internal:5432/wechat2tg_bot
```

只启用其中一个，就将另一个连接串留空。Compose 将连接串分别交给对应服务。

## `wx2tg-server`：归档切换

先停止服务并备份原 SQLite 归档（通常是 `./server-data/messages`）。修改部署目录的 `conf/app.conf`：

```ini
savelocalmessage = true
messagestore = "postgres"
messagepgautomigratesqlite = true
```

保留原 `./server-data` 挂载，使用原 `localmessagedir`。确认连接串并用 `docker compose up -d wx2tg-server` 重建服务端。已有归档由服务端在启动时迁移；失败停止启动，不会回退 SQLite 或双写。完整选项见 [服务端归档说明](server-v6.md#可选-postgresql)。

## `wechat2tg`：业务数据库切换

**新安装、没有上述业务 SQLite 文件时：** 设置 `BOT_POSTGRES_DSN` 并启动 `wechat2tg`。Bot 会在专用 PG 库建表。DSN 非空但连接失败时不会回退 SQLite。

**已有 Bot SQLite 数据时：** 先运行 `docker compose stop wechat2tg`，完整备份 `./config`、`.env` 及相关持久化目录。选用支持此功能的 Bot 镜像，保留原数据挂载，再在 `.env` 设置：

```dotenv
BOT_POSTGRES_AUTO_MIGRATE=true
```

同时填好 `BOT_POSTGRES_DSN`，然后执行 `docker compose up -d wechat2tg`。Bot 会在连接 Telegram、启动 WebUI 之前自动迁移；日志会显示各表导入行数。通常只需启用一次，成功后可以移除该参数；即使保留 `true`，之后重启也不重复导入。默认 `false`，未配置 DSN 时此参数无效。

迁移只读旧 SQLite：完整迁移目标必须是专用空库；如果已使用只支持 PG 主库的早期构建，会自动识别并只导入剩余业务库，不覆盖主库或已有 PG 业务数据。导入范围包括主库和 `webui-messages.db`、`telegram-outbox.db`、`red-packets.db`、`transfers.db`、`moments.db`。导入保留主键、游标、队列进度和操作状态；失败停止启动，不回退、不双写、不改写旧 SQLite。已派发但结果不明的动作会保留为「结果未知」，不会因迁移重发、补领或重新收款。

如需手动控制迁移时点，可不设自动参数，在 Bot 停止后执行 `docker compose run --rm --no-deps wechat2tg node dist/settings-cli.js --migrate-postgres`；PG 主库已迁移时用 `--migrate-postgres-stores`。非 Docker 部署可以在应用目录执行对应的 `node dist/settings-cli.js` 命令。

迁移后检查 WebUI 配置、已有绑定，以及一条已绑定聊天的转发；WebUI 令牌查看仍用 `docker compose exec wechat2tg node dist/settings-cli.js --webui-token`。改 DSN 后用 `docker compose up -d` 重建对应容器，单纯 `restart` 不会载入新的 ENV。回退前先停止写入并备份 PG：移除它的 DSN 会重新使用旧 SQLite，但 **PG 切换后产生的更新不会同步回来，尤其不要直接用过期的发送和收款流水启动**。避免同时运行指向同一数据的两套服务。

## 测试

常规测试默认走 SQLite。设置 `TEST_BOT_POSTGRES_DSN` 可测试完整迁移，设置 `TEST_BOT_POSTGRES_UPGRADE_DSN` 可测试仅迁移业务库的升级路径。两者需分别指向**可丢弃的空测试库**，测试不会自动删库。构建后运行 `node --test test/bot-postgres.test.cjs`。
