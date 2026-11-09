# Telegram 长轮询截止时间与健康状态

## 边界与结论

Telegraf 向 `getUpdates` 传入的服务端等待时间是 50 秒，而已安装版本底层 HTTP 超时为 500 秒。这个不一致可能放大异常请求的等待时间，但不能据此认定某一次故障确实卡满了 500 秒。本改动补充应用侧容错和可观测性，不替代具体故障的日志、网络和主机证据。

不修改路由、代理节点、全局 Agent、Telegraf 的通用 HTTP 超时，也不缩短文件上传/下载的超时。

## 应用侧控制

- 仅包装当前 Bot 实例的 `telegram.callApi('getUpdates', ...)`，每次请求 85 秒截止。
- 到期通过 AbortController 中止底层请求，不是只用 Promise.race 留下孤立请求。转换为 Telegraf 可重试的 FetchError / ETIMEDOUT，继续使用它原有的重试间隔、429 retry_after 和 offset 管理。
- 保留外部取消信号；明确停止轮询不会计为网络故障。每次请求结束都移除监听器、清理截止定时器。
- 退出时的 offset-sync 请求也有截止时间，但不会伪造「最近成功轮询」；只有正式长轮询成功返回更新数组（包括空数组）才记录成功。
- 不修改节点依赖源码。sendDocument、sendVideo、sendMessage、getMe 等方法原样透传。

## 日志

- 首次成功：INFO，表示真正完成过一次 getUpdates，而非仅 getMe 或账号登录成功。
- 拉取失败：WARN，记录白名单错误类别、连续失败次数和最近成功时间；第一次失败立即记录，持续失败最多每分钟再次记录。
- 恢复：INFO，记录轮询恢复，不要求打开 DEBUG。
- 超过 90 秒没有成功拉取：WARN / stalled；提示检查轮询或消息处理耗时。过慢的更新处理器也可能造成进度停滞，不一律归咎于网络。
- 不记录 Bot Token、请求 URL、原始错误正文或聊天内容。

## WebUI

消息状态接口附带 `telegramPolling`：状态、是否有在途请求、最近请求开始/成功/失败时间（毫秒时间戳）、连续失败次数、最近耗时、错误类别和请求截止时间。

在线状态需要账号就绪且实际轮询健康；首次成功前、失败重试中、进度停滞或停止后，不因旧 `hasLogin=true` 而继续显示在线。健康变化通过现有 SSE 推送，不新增 HTTP 定时探测。点击聊天界面的连接图标即可查看详情，浏览器 SSE 连接正常不等于 Telegram 轮询正常。

发送/同步路径没有因为轮询暂时失败而被全局重写，上传的长超时也保持原样。状态指示关注收取 Telegram 更新的进度。

## 回归验证

- `test/telegram-polling-health.test.cjs`：85 秒边界、底层取消、外部取消、空结果成功、失败日志限频与脱敏、进度过期、非 getUpdates 原样透传、真实 Telegraf 轮询重试与 offset、实际本地 HTTP 请求被中止。
- `test/webui-contact-directory.test.cjs`：真实消息中心状态接口不被旧登录标志误导。
- `scripts/test-telegram-health-browser.cjs`：浏览器通过 SSE 展示首次轮询、成功时间、失败、恢复与停滞。

测试只使用本地 HTTP 和合成更新，不访问真实 Telegram 账号、不改生产配置。
