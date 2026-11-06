# Telegram Mini App 与消息长连接

> 源码新增功能，尚未包含在已发布的 `v6.0.34` 镜像中。本文不代表已部署或完成真实 Telegram WebView 验收。

## 一套页面，两种入口

- **普通浏览器**：保留 WebUI Token 登录。
- **Telegram Mini App**：通过 Telegram 签名身份登录，同一 React 配置页和消息中心，不维护另一套页面。
- **仅机器人主人**：后端验证 `initData` 的 HMAC 签名和时效，并将签名中的 `user.id` 与现有 `Configuration.chatId` 比对。不会从请求参数自动认领主人，不信任 `initDataUnsafe`。
- 未设置主人、签名不正确、签名过期、非主人访问均被拒绝。Mini App 内不会退回浏览器保存的管理员 Token。

这里的主人沿用机器人现有的 `/login` 绑定。首次配置时请由本人在私聊中完成 `/login`，保护好尚未认领的机器人；Mini App 不提供首次认领入口。

## 启用方式

1. 为现有 WebUI 配置可从 Telegram 客户端访问的 **HTTPS 域名和有效证书**，将域名根路径反向代理到 WebUI。不能使用客户端无法访问的 `127.0.0.1`、HTTP 地址、带查询参数或含 Token 的链接。
2. 在 `.env` 中配置，或在 WebUI「高级设置」中填写 Mini App 地址：

   ```dotenv
   WEBUI_MINI_APP_URL=https://wechat.example.com/
   ```

   只支持根路径，不支持 `/console/` 子路径；不要在 URL 中写 Token。留空禁用 Mini App。WebUI 持久化设置优先于 `.env`，如已通过网页保存地址，后续在网页修改。
3. 保存后按自己的部署方式重启 **Bot**。不需要更新或重启微信 server，也不需要重新登录微信。
4. 机器人启动后仅为主人私聊设置 **「控制台」** 菜单。已有主人可再发送 `/start` 刷新菜单；首次 `/login` 认领后也会设置。不会设置对所有用户生效的全局菜单。
5. 点击菜单进入。签名验证通过后免输 WebUI Token；非主人即使取得链接也不能通过 Telegram 身份登录。

关闭配置后 Mini App 登录立即在下次应用启动时禁用；Telegram 中旧菜单可能仍显示，可用 BotFather 清除，但旧入口无法换取会话。所有需要重启生效的原 WebUI 配置，在 Mini App 中仍然需要重启，不会自动部署。

## 反向代理示例

在**已有 HTTPS server 块**中配置（证书、域名和鉴权策略由部署者管理）：

```nginx
location / {
    proxy_pass http://127.0.0.1:17863;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 75s;
    client_max_body_size 50m;
}
```

- 若代理和 Bot 在同一个 Docker 网络，请使用实际的 Bot 服务地址替代 `127.0.0.1`。若 Nginx 在宿主机，可将 `WEBUI_BIND_ADDRESS=127.0.0.1`，只通过 HTTPS 对外提供访问。
- 不要删除 `Authorization` 请求头，不要缓存 API 或缓冲 SSE 响应。
- 不要为 `/api/messages/events` 开启缓存 / 压缩聚合；应用发送 `X-Accel-Buffering: no`。
- Telegram 网页客户端使用 iframe；应用在 Mini App 启用后只允许 Telegram Web 域名嵌入。上层代理若强制增加 `X-Frame-Options: DENY/SAMEORIGIN` 或另一份禁止嵌入的 CSP，会使 Telegram Web 无法打开。只对这个应用调整，不要对所有站点取消安全策略。
- TLS 在代理终止即可；应用不盲目信任外部传入的转发 Host。代理应保留公开 Host，保持 Origin 校验一致。

## 消息实时更新

消息页共用一个 `/api/messages/events` **SSE 长连接**，普通浏览器与 Mini App 行为相同：

- 不再每 5 秒请求消息、联系人和在线状态接口。
- 服务端在消息写入、同步 / 撤回状态变化、连接状态变化时推送通知；前端按通知刷新受影响的数据，短时间内多次变化合并处理。
- SSE 推送的是变化提示和消息 ID，不推送原始协议数据或密钥。附件仍然按需通过鉴权请求读取。
- 首次打开、重连和从后台返回会补齐当前数据；历史分页、搜索和手动刷新仍保留。
- 查看引用上下文时不会被新消息拉回最新页，但已加载消息的状态仍会更新。
- 15 秒心跳只维护同一个连接，不是新的轮询 HTTP 请求。连续 45 秒没有任何流量会重连；重试从约 1 秒退避至最多 30 秒，绝不退回固定消息轮询。
- 页面离开消息中心或退出登录时取消订阅和连接。消息中心本地 1 秒撤回倒计时不发网络请求。
- SQLite 自有连接上的真实写入触发通知，不使用后台数据库轮询。外部工具直接修改数据库不会发事件，可手动刷新；联系人目录在登录 / 初始化时通知，外部目录变化也可手动刷新。

## 会话与权限

Telegram `initData` 只允许在 5 分钟有效期内换取短期会话；会话最长 1 小时，只存在服务器内存及当前页面内存，**不放在 URL 或 localStorage**。页面启动后移除地址片段中的启动凭据。进程重启、退出、会话过期或主人变更都会使会话失效；关闭 Mini App 后从菜单重新打开可获取新启动数据。

每个 API 请求重新核对会话与当前主人；SSE 发送通知之前及每次心跳也检查权限。浏览器 Token 入口继续独立保留，因此仍须保护原 WebUI Token。

浏览器 SSE 使用 fetch 流而非 URL 带 Token 的 EventSource。跨站请求仍受 Origin 检查约束，长连接总数和缓冲有上限。

## 验证

```sh
npm test
npm run test:webui:browser
```

涵盖签名篡改、时效、重复字段、非主人、无主人、会话注销 / 过期 / 主人变更，消息变化通知、订阅释放、断线补齐，以及浏览器闲置时零轮询请求。Mini App 浏览器测试使用本地签名样本和模拟 Telegram SDK，不访问真实 Telegram 或微信账号。

官方协议依据：[Mini Apps 身份校验](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)、[菜单按钮](https://core.telegram.org/bots/api#setchatmenubutton)。
