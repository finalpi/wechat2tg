# 公众号集中到一个论坛群

自 `v6.0.13-dev.1` 开始提供，默认关闭。只改变公众号后续消息的 Telegram 目的地，不合并旧群、不搬历史消息、不删除旧绑定。

## 开启

在部署端自行配置并重建 bot 容器，或在 WebUI 的转发设置中保存后重启：

```dotenv
OFFICIAL_ACCOUNT_TOPICS_ENABLED=true
```

正常情况下不要填写 `OFFICIAL_ACCOUNT_FORUM_CHAT_ID`。它仅用于创建结果不确定时的恢复，不是切换现有论坛群的快捷方式。升级程序不会自动修改已有 `.env` 或为你开启此功能。

首次处理公众号消息，或在 bot 私聊里使用 `/official` 选择公众号时：

1. 使用已登录的 Telegram 用户账号创建一个私有超级群，默认名称为 `WeChat Official Accounts`，开启 Forum / Topics。
2. 保存论坛群 ID，加入当前机器人和配置的所有者，等待机器人获得管理话题、邀请用户和删除消息等所需管理员权限。
3. 根据服务端 `VerifyFlag` 的品牌位确认公众号，为每个已确认的公众号创建独立 Topic（包括不以 `gh_` 开头的公众号）。标题取首次识别的备注/名称；之后按微信 ID 复用 Topic，不按 ID 前缀或标题猜测。
4. 后续消息直接进入对应 Topic，已经绑定旧独立群的公众号也切换到 Topic。

机器人用户会话必须已经登录，`configuration.chatId` 必须是有效的个人所有者 ID。Telegram 的群创建数量、邀请限制和限流仍然生效。应用不会自动清理你现有的群来绕过限制。

识别规则和旧缓存补齐见 [公众号识别](official-account-classification.md)。字段暂时缺失时保留未知状态，不冒充普通用户；已有明确绑定可以暂用原目的地，没有绑定时不盲目创建独立群或 Topic。

## 与旧设置的关系

- `receivePublicAccount`、仅通知模式、自己发送消息等现有过滤规则仍然生效。
- 第一次创建 Topic 时继承原绑定的接收/转发开关；之后在 Topic 中调整的开关独立保存，不覆盖旧绑定设置。
- `AUTO_CREATE_GROUPS=false` 只禁止自动创建旧式独立群。显式开启公众号 Topic 后，仍会按本功能创建一个论坛群及其话题，不会为每个公众号另建一个群。
- 未匹配的普通联系人或微信群仍遵守原来的绑定和自动建群策略。
- 已发送消息的重试和撤回通知使用原先保存的 chat/topic，不因后来切换开关而跳到其他群或 General。

## Topic 中的操作

- 在对应 Topic 中发文字、图片、文件等，按当前 Topic 精确发送给该公众号；引用不会改变目标公众号。
- General、缺少 Topic ID、未知 Topic 不发送到微信，不能把整个论坛群当成一个联系人。
- `/message`、`/forward` 调整当前 Topic 的接收和其他成员转发设置。
- `/ai` 仅获取当前 Topic 的历史，先限定 Topic 再取上下文条数，避免混入其他公众号。
- `/revoke` 和附件重试验证消息属于当前 chat/topic。
- 私聊 `/official` 选择公众号可创建/进入对应 Topic，返回 Topic 直达链接。
- 论坛群内禁止整群 `/quit`、`/unbind`、`/update` 和旧式联系人/微信群重绑操作，避免删除论坛、重命名整个群或破坏全部 Topic 的绑定。

Telegram 向公众号发消息是否被接受，仍受微信侧该公众号的交互能力和权限限制。本功能不会绕过微信限制。

## 关闭

```dotenv
OFFICIAL_ACCOUNT_TOPICS_ENABLED=false
```

重建或重启后，公众号的新消息恢复旧的独立群路由及原来的设置；原来没有绑定的公众号依照 `AUTO_CREATE_GROUPS` 决定是否创建独立群。论坛和 Topic 保留供查看，不自动删除；从这个受管理论坛发出的新消息会被阻止发送到微信。没有历史消息搬迁。

## 持久化与安全恢复

数据在现有 bot SQLite `storage/db/wx2tg.db` 中：

- `official_account_forum`：单个论坛的创建意图、群 ID、准备状态。
- `official_account_topic`：公众号 ID、Topic ID、创建随机编号和 Topic 设置。
- `message.threadId` / `message.conversationWxId`：消息的原始 Topic 和微信会话归属，用于引用、重试、历史和撤回。

新增表/列由现有 TypeORM schema 同步机制创建；`migrations/` 中记录了增量 SQL。已有绑定和旧消息不改写。升级前备份 SQLite；不要在已经升级的数据库上重复手工执行 `ADD COLUMN`，也不要不备份就降级到不了解新列的旧镜像。

论坛群创建 RPC 没有可靠的客户端幂等键。若请求超时，无法确认群是否已创建，程序会停止再次建群并给出恢复提示，而不是重试生成重复群：

1. 在已登录的 Telegram 用户账号中检查是否已有本次创建的私有论坛群。
2. 确认后，将其 Bot API 群 ID（`-100…`）配置为 `OFFICIAL_ACCOUNT_FORUM_CHAT_ID`，重启后继续完成邀请和权限设置。
3. 若确实没有群，先由管理员明确创建一个私有论坛再填入 ID；不要删除状态后反复盲目重试。
4. 已有已确认论坛时，填写另一个群 ID 会被拒绝，不会清空旧映射。

Topic 创建使用已持久化的 `randomId` 重试，进程内还按公众号串行化并发创建。Telegram 对超时重放的实际响应仍需线上验收；不要手动删除映射来尝试“重置”。

创建失败不会把公众号内容退回旧群或 General。它也不等于实现了可靠投递队列：若消息已被 server 消费，是否能补发取决于已有归档/消息中心；开启 WebUI 时可从保存的消息查看同步状态并在恢复后显式重试。关闭 WebUI 时不要假定失败消息已被永久保存。

## 验证边界

回归覆盖并发创建、部分失败恢复、重复创建保护、Topic 双向定位、文本/媒体参数、跨 Topic 引用与 AI 隔离、旧绑定不变、SQLite 升级、WebUI/MCP 同步和撤回目的地。测试使用隔离数据库和模拟 Telegram，不会向真实公众号发消息或自动创建真实论坛群。正式启用前应在开发版做实际双向消息验收。
