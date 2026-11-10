# 登录恢复与诊断日志

桥接端和服务端分别保留登录状态日志，避免关键错误被 Docker 轮询日志覆盖。以下为代码默认行为，须在配套版本发布、部署后生效。

## 恢复流程

- SDK 遇到同步异常时先检查现有会话；有效会话继续使用，检查过程中取到的消息照常处理。网络不可用、响应不完整不会直接变成“需要扫码”。
- 二次登录后仍需确认会话已失效，才进入二维码流程。二维码失效或服务端返回“未找到登录信息”时，可重新获取；`Data=null` 不再触发空指针循环。
- 二维码生成和状态检查分别合并并发请求；旧请求不能覆盖新的登录状态。
- Telegram 发图遇到临时网络错误会有限重试，429 遵守 `retry_after`。旧二维码消息已删除时改发新消息；新二维码替换旧任务，登录成功或退出时取消待重试任务。最多尝试 8 次，并受二维码截止时间限制。

## 日志位置与保留

桥接端：`logs/login-events/login-events-YYYY-MM-DD.jsonl`，沿用现有 `logs` 挂载。

服务端默认：`logs/wechat-events/login-events/login-events-YYYYMMDD.jsonl`，复用现有原始事件日志挂载目录；即使原始消息日志关闭，登录诊断仍独立记录。服务端可用 `WECHAT_LOGIN_EVENT_LOG_DIR` 或 `wechatlogineventlogdir` 指定独立持久化目录。

两端均按日写入，保留 30 个日历日；单文件达到 5 MiB 后滚动，当前文件之外最多保留 4 个同日分片。异常事件会去重、限频，避免轮询洪泛占满空间。服务端还定期清理过期文件。独立日志不受应用 `LOG_LEVEL` 和 Docker 日志轮转影响。

记录内容包括恢复阶段、数值错误码、原生返回码、连续失败次数、重试间隔、二维码创建/过期/确认，以及版本信息。SDK 通过 `login-state` 事件向桥接端提供诊断数据；该事件不包含二维码内容或账号凭据。

不会记录 Bot Token、SessionKey、Cookie、Autoauthkey、二维码内容/UUID、验证链接、原始请求或微信消息正文。服务端账号仅记录摘要，便于关联同一账号的事件。

## 排查顺序

1. 先定位最早的 `sync-initial-failed`、`sync-failed`、`sync-native-rejected`、`heartbeat-failed`，保留其时间、阶段及返回码。`sync-initial-failed` 记录自动二次登录之前的触发码，避免被后续认证错误覆盖。
2. 检查随后是否出现 `secondary-auth-result`、`session-reused` 或 `qr-required`，区分会话恢复、后端暂不可用和确需扫码。
3. 进入扫码后检查 `qr-ready`、`qr-delivery-failed`、`qr-delivery-retry`、`qr-delivery-succeeded`，区分生成失败和 Telegram 发送失败。
4. `qr-state-missing` 或 `qr-expired` 后应有会话复用或新二维码流程；不能持续查询同一失效状态。

诊断代码不改变微信版本、设备标识或已保存的账号数据。日志可说明错误与恢复过程，但单次同步失败不能证明账号被微信踢下线。
