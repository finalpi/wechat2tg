# 公众号识别：使用 VerifyFlag，不看微信 ID 前缀

`gh_` 不是可靠分类依据：公众号可以使用自定义微信号，普通联系人名称也不应被当成类型标志。所有联系人列表、公众号列表、消息过滤和 Topic 路由共用服务端标志判断。

## 数据来源

| 接口 | 字段 |
| --- | --- |
| `POST /api/Friend/GetContractDetail` | `Data.ContactList[i].VerifyFlag` |
| `POST /api/Directory/Query`，`Kind="contact"` | `Data.list[i].profile.verify_flag` |

目录记录必须属于当前 `account_wxid`、`kind=contact` 且未删除。目录存储需要 server 的 PostgreSQL 后端；不支持时回退到联系人详情接口，不要求为此切换数据库。

## 判定规则

`MM_USERATTRVERIFYFALG_BIZ_BRAND` 是 `0x8` 位：

```ts
const isOfficial = (verifyFlag & 8) !== 0
```

- `0`、`1`、`2`、`4`、`16`：不是公众号。
- `8`、`24`、`136`：是公众号。
- 缺失、null、布尔值、非整数或超出 uint32 范围：**未知**，不能默认成 0。

此规则与微信公开协议实现中的品牌位一致，参见固定版本的 [isPublicContact](https://github.com/nodeWechat/wechat4u/blob/c775020944a1bf5e4a2d94f9f6517a2fd9e0005b/src/interface/contact.js#L69-L71) 和 [常量定义](https://github.com/nodeWechat/wechat4u/blob/c775020944a1bf5e4a2d94f9f6517a2fd9e0005b/src/util/conf.js#L25-L29)。不是 `VerifyFlag != 0`。

## 缓存与补齐

- puppet 的联系人表新增 nullable `verifyFlag`，旧记录保持 NULL。SDK 提供 `Contact.verifyFlag`、`Contact.isOfficialAccount()` 和统一的标准化/判定函数。
- 有效的显式 `0` 会更新旧值；缺失字段不覆盖旧的已知值。原子 upsert 避免并发资料同步出现重复主键。
- 旧缓存按需补查；请求共享、超时、冷却和列表前台预算避免每条消息触发请求风暴。大目录分页补齐；剩余未知条目会在 UI 提示，不冒充普通用户，也不靠前缀补猜。
- `puppet.db` 的 schema 由 SDK 管理，bot 的镜像实体仅用于读取，不再执行 schema synchronize 删除 SDK 新字段。

## 路由边界

- `/user` 只显示已确认的普通联系人，`/official` 只显示已确认的公众号。
- 开启公众号 Topic 后，只有确认的公众号才创建新 Topic；不带 `gh_` 的公众号同样支持。
- 暂时无法补齐类型时，不新建未经确认的 Topic。已有的明确旧绑定暂时保留原目的地；没有旧绑定则停止自动创建并等待资料补齐。已经通过准确分类创建的 Topic 可以继续复用，不因暂时的缓存不可用反复建群。
- 关闭公众号接收时，未知类型不会被当成普通联系人绕过过滤。

覆盖测试包含无前缀公众号、带 `gh_` 的普通联系人、未知字段、分页/查找补齐、旧缓存升级、并发写入和 Topic 路由。配置不会改动现有微信服务，也不会自动改写部署端 `.env`。
