# [wechat2tg](https://github.com/finalpi/wechat2tg)

本项目是基于 [wechaty](https://github.com/wechaty/wechaty) 实现了在 Telegram 收发微信消息的工具。  

使用了 [puppet-wechat4u](https://github.com/wechaty/puppet-wechat4u)（UOS协议），可以绕过某些微信账号在 Web 版无法登录的限制。

## 主要功能

1. 微信单聊消息、微信群消息、公众号消息，转发到 Telegram 机器人
2. Telegram 向指定的微信用户、微信群、公众号发送消息
3. 可设置微信群组黑名单、白名单，来简单的控制消息转发的群
4. 支持从 Telegram 发送视频、文件、贴纸、图片、语音消息
5. 可撤回通过 Telegram 发送给微信的消息
6. 配置了 `API_ID` 和 `API_HASH` ，可以自动创建单独的群聊来转发消息
7. 微信语音转文字

## 支持功能

### 微信消息类型支持列表

+ [x] 文本消息（文本内表情可转换成 Telegram 的 Emoji，但是映射很多对不上的）
+ [x] 非官方表情包
+ [x] 图片消息
+ [x] 音频/视频通话 (仅消息提醒)
+ [x] 文件消息
+ [x] 语音消息
+ [x] 撤回消息
+ [x] 链接消息
+ [x] 小程序消息（部分支持）
+ [x] 位置消息（转位置文字）
+ [x] 红包消息（提醒，无法获取红包内容）
+ [x] 群聊消息
+ [x] 群聊@消息（@所有人和@你 会转换成 Telegram @你）
+ [x] 公众号消息
+ [ ] 商店表情
+ [ ] 企业微信用户发送的消息


## 注意事项

1. 本项目仅用于技术研究和学习，不得用于非法用途
2. 无论遇到什么问题都欢迎提交 issue
3. 因 Telegram Bot API 限制，无法发送超过 **20MB** 的文件以及接收超过 **50MB** 的文件（配置API_ID和API_HASH可以解决）
4. 本项目只能尽量保证实现 **Web微信** 支持的消息类型，不支持的消息例如：微信原生表情包、收发红包等无能为力
5. 由于网络或者技术原因可能导致的消息丢失无法完全避免。如有重要的消息时请注意

## 部署安装

### docker-compose（推荐）

创建 `docker-compose.yml` 文件：

```yaml
version: '3'

services:
  wechat2tg:
    image: finalpi/wechat2tg:latest
    container_name: wx2tg
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # 保存文件夹挂载后贴纸文件不需要重新转换
    # 可以是用 env_file 指定环境变量文件
    # env_file: ".env"
    environment:
      BOT_TOKEN: ''
      # PROXY_HOST: ''
      # PROXY_PORT: ''
      # 代理类型:socks5,http,https
      # PROXY_PROTOCOL: 'socks5'
      # 用户名密码可选
      # PROXY_USERNAME: ''
      # PROXY_PASSWORD: ''
      # 发送大文件所需的Telegram API配置(可选)
      API_ID: ''
      API_HASH: ''
      # 群消息格式
      ROOM_MESSAGE: '<i>🌐#[topic]</i> ---- <b>👤#[(alias)] #[name]: </b>'
      # 公众号消息格式
      OFFICIAL_MESSAGE: '<b>📣#[name]: </b>'
      # 联系人消息格式
      CONTACT_MESSAGE: '<b>👤#[alias_first]: </b>'
      # 群消息格式(群组下)
      ROOM_MESSAGE_GROUP: '<b>👤#[(alias)] #[name]: </b>'
      # 公众号消息格式(群组下)
      OFFICIAL_MESSAGE_GROUP: '<b>📣#[name]: </b>'
      # 联系人消息格式(群组下)
      CONTACT_MESSAGE_GROUP: '<b>👤#[alias_first]: </b>'
      # 自动创建微信群组的名称格式
      CREATE_ROOM_NAME: '#[topic]'
      # 自动创建联系人群组的名称格式
      CREATE_CONTACT_NAME: '#[alias]#[[name]]'
      # 文字消息显示格式:#[identity]身份文本,#[body]:消息文本,#[br]换行
      MESSAGE_DISPLAY: '#[identity]#[br]#[body]'
      # 腾讯语音识别控制台申请的API_KEY(可选)
      TENCENT_SECRET_ID: ''
      TENCENT_SECRET_KEY: ''
    restart: unless-stopped
```

运行

```shell
docker-compose up -d
```

### docker

```shell
docker run -itd --env BOT_TOKEN="" --env PROXY_HOST="" --env PROXY_PORT="" --env PROXY_USERNAME="" --env PROXY_PASSWORD="" --env PROXY_PROTOCOL="socks5" finalpi/wechat2tg:latest
```

### Node.js 18以上

1. 安装依赖：

   ```shell
   npm install
   ```

2. 在 `.env` 文件中配置 Telegram Bot 的 Token 和代理（可选）

3. 运行程序：

   ```shell
   npm start
   # 或者
   npm run dev
   ```

4. TG 中机器人发送 `/start` 开始 或者 `/login` 登录

## 使用说明

### BOT命令

- `/login`：获取登录二维码；首次部署启动时，最先发送 `/login` 命令的人将成为 `BOT` 的所有者

- `/user`：获取微信用户列表；点击按钮后可发消息（可通过名称或备注搜索，例如： `/user 张` 查找包含「张」的微信用户）

- `/room`：获取微信群列表；点击按钮后可发消息（可通过名称或备注搜索，例如： `/room 外卖` 查找含有「外卖」的微信群）

- `/recent`：获取最近接收过消息的用户或者微信群；点击按钮后可回复

- `/setting`：程序设置

- `/bind`：查询群组中微信群或微信用户的绑定状态（仅支持在群组使用）

- `/unbind`：解绑微信群或微信用户（仅支持在群组使用）

- `/order`：可设置对某个公众号的快捷指令，快速对公众号发送指定消息内容

- `/cgdata`：更新群组的头像和名称（仅支持在群组使用，需要 BOT 拥有管理员权限）

- `/autocg`：开启自动创建群组模式；对微信消息进行自动分组，需要配置 `API_ID` 和 `API_HASH`。**推荐开启**

- `/check`：查看当前微信的登录状态

- `/source`：对被压缩的文件消息回复 `/source` 可以获取到原始文件（仅支持对文件消息使用）

- `/aad`: 转发群组内其他成员的消息。使用 `/aad all` 命令可以添加转发该群组内所有成员的消息;使用 `/aad @你想转发的用户` 单独添加转发某一成员发送的消息（仅支持在群组使用，需要开启自动创建群组模式）

- `/als`: 查看和删除转发列表（仅支持在群组使用，需要开启自动创建群组模式）

### 环境变量说明

|名称| 是否必填 | 描述                                                            |
|--|------|---------------------------------------------------------------|
|`BOT_TOKEN`| 是    | Telegram Bot 的 token，通过 [BotFather](https://t.me/BotFather) 创建 |
|`PROXY_PROTOCOL`| 否    | 代理类型可选值（socks5,http,https）                                    |
|`PROXY_HOST`| 否    | 代理的 URL                                                       |
|`PROXY_PORT`| 否    | 代理的端口号                                                        |
|`PROXY_USERNAME`| 否    | 代理的用户名                                                        |
|`PROXY_PASSWORD`| 否    | 代理的密码                                                         |
|`API_ID`| 否    | Telegram API 的 API ID                                 |
|`API_HASH`| 否    | Telegram API 的 API HASH                                       |
|`ROOM_MESSAGE`| 否    | 在 BOT 中微信群消息的显示格式                                             |
|`OFFICIAL_MESSAGE`| 否    | 在 BOT 中公众号消息的显示格式                                             |
|`CONTACT_MESSAGE`| 否    | 在 BOT 中微信用户消息的显示格式                                            |
|`ROOM_MESSAGE_GROUP`| 否    | 在群组中微信群消息的显示格式                                                |
|`CONTACT_MESSAGE_GROUP`| 否    | 在群组中微信用户消息的显示格式                                               |
|`OFFICIAL_MESSAGE_GROUP`| 否    | 在群组中公众号消息的显示格式                                                |
|`CREATE_ROOM_NAME`| 否    | 自动创建微信群的群组时， 群组名称的格式                                          |
|`CREATE_CONTACT_NAME`| 否    | 自动创建微信联系人的群组时， 群组名称的格式                                        |
|`MESSAGE_DISPLAY`| 否    | 文字消息的显示格式                                                     |
|`TENCENT_SECRET_ID`| 否    | 语音转文字腾讯语音控制台的SECRET_ID                                        |
|`TENCENT_SECRET_KEY`| 否    | 语音转文字腾讯语音控制台的SECRET_KEY                                       |

 ---

### 设置项`/setting`命令说明

1. 切换黑名单模式或者白名单模式

   - 白名单模式:只接受在白名单列表的微信群消息

   - 黑名单模式:不接受在黑名单列表的微信群消息

2. 反馈发送成功：是否反馈消息的发送状态（如果不是很需要请勿开启，因为默认失败会有提示）

3. 自动切换联系人：如果在 BOT 中有微信用户或微信群回复，则会自动切换回复到该微信用户或者微信群。 **请注意，发送前刚好有消息发给你可能会导致错误发送消息**

4. 接受公众号消息：是否接受公众号消息

5. 转发自己在微信发送的消息: 是否转发自己使用手机微信客户端发送的消息

6. 媒体质量压缩：开启后所有接收到的媒体消息以图片，视频的方式接收，可能会损失媒体的原始质量。如果关闭该选项，则所有的消息都会以文件的方式接收。对被压缩的文件消息回复 `/source` 可以获取到原始文件。

7. 自动语音转文字：开启后将微信的语音转为文字消息。

8. 屏蔽表情包：屏蔽微信发送的表情消息。

---

### 撤回消息

2分钟内发送的消息能撤回，撤回方式是回复 `&rm` 给自己发送的消息，媒体消息需要等待发送成功才能撤回。  
如果配置了 `API_ID` 和 `API_HASH` 删除消息（需要双向删除）即可撤回。

---

### 获取`API_ID` 和 `API_HASH`

1. 登录 [telegram account](https://my.telegram.org/)

2. 然后点击「API development tools」并填写应用程序详细信息（只需应用程序标题和简称）

3. 最后点击「Create application」

---

### 大文件的接受和发送

因为 Telegram Bot API 的限制，不能发送超过20MB的文件，或者接收超过50MB的文件，如果你需要收发大文件的消息内容，请配置 `API_ID` 和 `API_HASH`

**！！测试发现web协议发送超过25MB文件，切片上传服务器直接返回错误（本项目已修复）**

---

### 手动对消息进行分组

**注意：** 因为 `wechaty-puppet-wechat4u` 每次重新登录的时候，id都会变化，所以没办法获取每个联系人和群组的唯一 key。判断是否是同一个联系人和群组的方式是通过联系人的备注和昵称进行判断的。此方法，在备注或者昵称不唯一的情况下，在下一次重新登录的时候，可能会错误的绑定到联系人和群组。或者当联系人或者群组的名称发生变化的时候，有可能会出现绑定失败的情况，此情况需要重新绑定。

1. 关闭掉机器人的隐私模式，打开 BotFather，输入 `/mybots`，选择你的bot。点击 `Bot Settings` - `Group Privacy` - `Turn off`
   ，出现 `Privacy mode is disabled for xxx` 就说明关闭成功了
2. 创建 Telegram group，将 Bot 拉入该群组然后按照提示绑定即可，之后该联系人或者群组的消息就会转发到该group里面

`/bind`：查看当前group绑定的联系人或者群组

`/unbind`：解绑当前group绑定的联系人或者群组

`/cgdata`：设置group的头像和昵称为微信联系人或群组(需要管理员权限)


### 自动对消息分组

1. 配置 `API_ID` 和 `API_HASH`
2. 关闭掉机器人的隐私模式
3. 用 `/autocg` 命令开启自动分组模式，按提示登录 Telegram 即可


### 语音转文字

1. 配置 `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY` 可在腾讯 [语音识别控制台](https://console.cloud.tencent.com/asr)开通
   。有免费的使用额度
2. 在 `/setting` 中开启自动文字转语音功能


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

---

## 参与开发

1. fork 项目，切换到 `refactor/ts-single-dev` 分支，或者新建一个分支。请不要直接提交代码到 master 分支
2. 提交 Pull Request 到 `refactor/ts-single-dev` 分支


## License

[MIT](LICENSE)


## Thanks

感谢Jetbrains对本项目的支持

[<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" width="200">](https://www.jetbrains.com)
