# 配置统一与旧版迁移

日常配置在 WebUI 管理，保存到 `storage/db/wx2tg.db`（默认 Compose 对应宿主机 `./config/db/wx2tg.db`）。**非空 ENV 优先于数据库，再回退到内置默认值。** 普通启动不把 ENV 写进数据库。WebUI 显示并编辑数据库值，受环境变量影响的字段标记为「ENV 覆盖」；删除变量并重新启动进程后，恢复使用数据库值。对于 Compose 的 `env_file`，修改 `.env` 后要重新创建容器，`docker compose restart` 不会重新注入环境变量。

## 升级步骤

1. 停止 Bot，完整备份 `./config` 和 `.env`，包括旧 JSON、凭证、SQLite 及其日志文件。旧镜像回滚时只认识旧配置文件，升级后在新 WebUI 保存的值不会同步回旧文件。
2. 第一次启动新版本会把旧 `webui-config.json`、`telegram-display.json`、MCP 设置和令牌、WebUI 令牌及自动化规则和状态迁入同一个数据库。不会重复导入，也不修改旧文件；模板不重置，原有偏好、绑定、会话、消息数据库不搬迁。`WEBUI_CONFIG_PATH` 只在首次导入时用于定位旧文件（以及同目录的 MCP、访问令牌和自动化文件）。
3. 去 WebUI 核对「ENV 覆盖」。**旧版是 WebUI 优先，新版改为 ENV 优先**，尤其要检查 `.env` 里的 `BOT_TOKEN`、`BASE_API`、展示模式和模板。同一项希望由 WebUI 管理，删掉对应 ENV 后再重建容器；不需要删除旧 JSON。

如果应用配置原本只存在于 `.env`，可以保留它作为运行时覆盖，也可以明确选择导入。先停止 Bot，用**新版本镜像**和同一个挂载、同一份 `.env` 执行：

```sh
docker compose stop wechat2tg
docker compose run --rm --no-deps wechat2tg node dist/settings-cli.js --import-env
```

命令只添加尚未写入数据库的应用配置，不覆盖旧 WebUI 值，不修改 `.env`，不打印凭证。导入并核对后，再移除不想继续覆盖的 ENV，通过 `docker compose up -d wechat2tg` 启动。非 Docker 部署在应用目录执行 `node dist/settings-cli.js --import-env`。

WebUI 启动端口、监听、挂载和微信服务端自身的配置仍由 `.env` / Compose 管理。`WEBUI_TOKEN`、`MCP_TOKEN`、`MCP_READ_TOKEN` 若由 ENV 提供，仍由部署方管理，不做批量导入。WebUI 自动生成的令牌可在可信终端用 `docker compose exec wechat2tg node dist/settings-cli.js --webui-token` 查看，不要把输出发到群里或写入日志。备份数据库时按含账号密钥的数据保护。
