> [!WARNING]
> 该分支处于测试状态，欢迎反馈问题

# wechat2tg-mac

基于 855 Mac 协议收发微信消息

## TG 群组: [@Wx2TgUserGroup](https://t.me/+AD02MEZa-og3ZGY1)

## 主要功能

1. 微信单聊消息、微信群消息、公众号消息的接收、企业微信消息的接收
2. Telegram 向指定的微信用户、微信群、公众号发送消息
3. 屏蔽指定群组的消息

## 支持的消息类型

### 微信消息类型支持列表

+ [x] 文本消息
+ [x] 企业微信消息
+ [x] 微信表情包
+ [x] 图片消息
+ [x] 视频消息（需要登录文件传输助手）
+ [x] 音频/视频通话 (仅消息提醒)
+ [x] 文件消息（需要登录文件传输助手）
+ [x] 链接消息
+ [x] 群聊消息
+ [x] 群聊@消息（@所有人和@你 会转换成 Telegram @你）
+ [x] 公众号消息
+ [x] emoji
+ [x] 位置消息
+ [x] 撤回消息
+ [x] 语音消息
+ [ ] 红包消息（提醒，无法获取红包内容）
+ [ ] 小程序消息

### Telegram 消息类型支持列表

+ [x] 文本消息
+ [x] 贴纸表情（部分支持，只能发送静态表情）
+ [x] 图片消息
+ [x] 视频消息
+ [x] 文件消息
+ [x] 语音消息

## 注意事项

1. 本项目仅用于技术研究和学习，不得用于非法用途
2. 无论遇到什么问题都欢迎提交 issue

## 部署安装

先复制一份 `.env.example` 为 `.env` 文件，然后配置 `.env` 文件中的环境变量

复制项目中的 `app.conf.example` 为 `app.conf` 文件到 `conf` 目录

### docker-compose

创建 `docker-compose.yml` 文件：

```yaml
version: '3'

services:
  wx2tg-pad:
    image: finalpi/wechat2tg-mac-dev:latest
    container_name: wx2tg-pad
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # 保存文件夹挂载后贴纸文件不需要重新转换
    env_file: ".env"
    restart: unless-stopped

  wx2tg-server:
    image: finalpi/wx2tg-server:latest # 拉取镜像
    container_name: wx2tg-server
    ports:
      - "8058:8058"
    volumes:
      - ./conf:/usr/wic-go/conf
    restart: unless-stopped

  wx2tg-redis:
    image: redis:7.2
    container_name: wx2tg-redis
    ports:
      - "16379:6379"
    restart: unless-stopped
```

#### 运行

```shell
docker-compose up -d
```

#### 关闭 bot 隐私模式

关闭掉机器人的隐私模式，打开 BotFather，输入 `/mybots`，选择你的bot。点击 `Bot Settings` - `Group Privacy` - `Turn off`
，出现 `Privacy mode is disabled for xxx` 就说明关闭成功了

## 使用说明

### BOT命令

- `/login`：获取登录二维码；首次部署启动时，最先发送 `/login` 命令的人将成为 `BOT` 的所有者

- `/flogin`：获取文件传输助手登录二维码，支持接收视频和文件

- `/update`：更新群组头像和昵称信息

- `/add`：根据手机号添加微信好友，例如 `/add 18888888888`

- `/message`：开关群组消息接收

- `/forward`：开关转发群组内其他人或者 bot 的消息

- `/user`：获取微信用户列表；点击按钮后可创建新群组或者绑定用户（可通过名称或备注搜索，例如： `/user 张` 查找包含「张」的微信用户）

- `/room`：获取微信群列表；点击按钮后可创建新群组或者绑定微信群（可通过名称或备注搜索，例如： `/room 外卖` 查找含有「外卖」的微信群）

- `/settings`：程序设置

- `/getqr`：获取自己的二维码名片

- `/unbind`：解绑微信群或微信用户（仅支持在群组使用）

### 环境变量说明

|名称| 是否必填 | 描述                                                             |
|--|------|----------------------------------------------------------------|
|`BOT_TOKEN`| 是    | Telegram Bot 的 token，通过 [BotFather](https://t.me/BotFather) 创建 |
|`API_ID`| 是    | Telegram API 的 API ID                                          |
|`API_HASH`| 是    | Telegram API 的 API HASH                                        |
|`BASE_API`| 是    | gewechat 容器的 API 请求地址，需要填入完整路径名                                |
|`FILE_API`| 是    | gewechat 容器的文件请求地址，需要填入完整路径名                                   |
|`CALLBACK_API`| 是    | wechat2tg 容器的回调服务的地址（3000 端口映射后的地址）                            |
|`PROXY_PROTOCOL`| 否    | 代理类型可选值（socks5,http,https）                                     |
|`PROXY_HOST`| 否    | 代理的 URL                                                        |
|`PROXY_PORT`| 否    | 代理的端口号                                                         |
|`PROXY_USERNAME`| 否    | 代理的用户名                                                         |
|`PROXY_PASSWORD`| 否    | 代理的密码                                                          |
|`ROOM_MESSAGE`| 否    | 在 BOT 中微信群消息的显示格式                                              |
|`OFFICIAL_MESSAGE`| 否    | 在 BOT 中公众号消息的显示格式                                              |
|`CONTACT_MESSAGE`| 否    | 在 BOT 中微信用户消息的显示格式                                             |
|`ROOM_MESSAGE_GROUP`| 否    | 在群组中微信群消息的显示格式                                                 |
|`CONTACT_MESSAGE_GROUP`| 否    | 在群组中微信用户消息的显示格式                                                |
|`OFFICIAL_MESSAGE_GROUP`| 否    | 在群组中公众号消息的显示格式                                                 |
|`CREATE_ROOM_NAME`| 否    | 自动创建微信群的群组时， 群组名称的格式                                           |
|`CREATE_CONTACT_NAME`| 否    | 自动创建微信联系人的群组时， 群组名称的格式                                         |
|`MESSAGE_DISPLAY`| 否    | 文字消息的显示格式                                                      |

 ---

### 设置项`/settings`命令说明

1. 文件传输助手接收文件和视频消息：是否使用文件传输助手接收文件和视频消息（上游没办法下载视频和文件，所以需要用文件传输助手接收）

2. 接受公众号消息：是否接受公众号消息

---

### 获取`API_ID` 和 `API_HASH`

1. 登录 [telegram account](https://my.telegram.org/)

2. 然后点击「API development tools」并填写应用程序详细信息（只需应用程序标题和简称）

3. 最后点击「Create application」

---

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

### 如何 @所有人

发送以 `@all` 开头的消息会 @所有人，仅支持文本消息 @所有人

---

## 常见问题


## 参与开发

1. fork 项目，切换到 `wx2tg-pad-dev` 分支，或者新建一个分支。请不要直接提交代码到主分支
2. 提交 Pull Request 到 `wx2tg-pad-dev` 分支


## License

[MIT](LICENSE)


## Thanks

感谢Jetbrains对本项目的支持

[<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" width="200">](https://www.jetbrains.com)