# 可选 PostgreSQL：Bot 与微信服务端

默认仍是 SQLite，无需安装 PostgreSQL。`wx2tg-server` 的消息归档和 `wechat2tg` 的主数据库可以单独切换，也可以连接**同一个 PostgreSQL 实例**。两者必须用各自的数据库和登录角色，不要共用表或凭证。Bot 需要使用包含 PostgreSQL 支持的镜像／构建。

| 组件 | PostgreSQL 中保存的数据 | 保留在本地的数据 |
| --- | --- | --- |
| `wx2tg-server` | 微信消息归档，以及后端支持的通讯录数据 | Redis 会话、配置、日志、原 SQLite 备份 |
| `wechat2tg` | 原 `storage/db/wx2tg.db` 中的配置、访问令牌、主人及偏好、聊天绑定、公众号话题、转发消息关联／回执 | 微信 SDK `puppet.db`、WebUI 消息历史库、待发送队列、红包／转账与朋友圈归档、Telegram 会话、附件、缓存等 |

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

## `wechat2tg`：主库切换

**新安装、没有 SQLite 主库时：** 设置 `BOT_POSTGRES_DSN` 并启动 `wechat2tg`。Bot 会在专用 PG 库建表。DSN 非空但连接失败时中止启动，不会悄悄开启一个空 SQLite 主库。

**已有 `./config/db/wx2tg.db` 时：** 先停止 Bot，再完整备份 `./config`、`.env` 及相关持久化目录。确认已经选用包含此功能的 Bot 镜像，并让 Compose 使用同一个原数据挂载。在填好 `BOT_POSTGRES_DSN` 后执行：

```sh
docker compose stop wechat2tg
docker compose run --rm --no-deps wechat2tg node dist/settings-cli.js --migrate-postgres
docker compose up -d wechat2tg
```

本地部署可在应用目录运行 `node dist/settings-cli.js --migrate-postgres`。迁移只读旧 SQLite，要求目标为专用空库；有数据时拒绝覆盖。迁移保留 SQL 主键、绑定、消息关联及设置，导入数据在一个事务内提交，失败不会留下半份导入数据。不删除或改写旧 SQLite，也不做后续双写。未迁移时启动会明确报错。

迁移后检查 WebUI 配置、已有绑定，以及一条已绑定聊天的转发；WebUI 令牌查看仍用 `docker compose exec wechat2tg node dist/settings-cli.js --webui-token`。改 DSN 后用 `docker compose up -d` 重建对应容器，单纯 `restart` 不会载入新的 ENV。回退前先停止写入并备份 PG：移除它的 DSN 会重新使用旧 SQLite，但 **PG 切换后产生的更新不会同步回来**。避免同时运行指向同一数据的两套服务。

## 测试

常规测试默认走 SQLite。真实 PostgreSQL 集成测试只对明确设置的 `TEST_BOT_POSTGRES_DSN` 启用，**只使用可丢弃的空测试库**，不会自动删库。构建后运行 `node --test test/bot-postgres.test.cjs`。
