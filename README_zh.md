# [wechat2tg](https://github.com/finalpi/wechat2tg)

这个项目是基于 [wechaty](https://github.com/wechaty/wechaty) 实现的微信消息转发到 Telegram
机器人的项目,使用[puppet-wechat4u](https://github.com/wechaty/puppet-wechat4u)协议UOS实现,因此可以绕过微信web版某些账号无法登陆的问题。

# 主要功能

1. 微信单聊消息,群组消息,公众号消息转发到telegram
2. telegram向指定的用户回复消息
3. 支持群组黑名单白名单模式
4. 支持视频,文件,贴纸,图片,语音消息的发送

# 注意事项

**在最近 2024-07-12 左右，部分用户使用多开或者分身登陆的微信被限制包括但不限扫码加群等功能**

1. 本项目仅用于技术研究和学习，不得用于非法用途。
2. 遇到问题请提交issue。
3. 因Telegram Bot API限制,无法发送超过20MB的文件以及接收超过50MB的文件(配置API_ID和API_HASH可以解决)

## 安装

### docker-compose中使用

创建`docker-compose.yml`文件:

```yaml
version: '3'

services:
  wechat2tg:
    image: finalpi/wechat2tg:latest
    container_name: wx2tg
    volumes:
      - ./config:/app/storage
      - ./save-files:/app/save-files # 保存文件夹挂载后表情不需要重新转换
    # use env file or you can jest set environment here
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
      # 发送大文件所需Telegram API配置(可选)
      # API_ID: ''
      # API_HASH: ''
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
    restart: unless-stopped
```

运行

```shell
docker-compose up -d
```

### Node.js v18以上的版本中使用

1. 安装依赖：

   ```shell
   npm install
   ```

2. 在 `.env` 文件中配置 Telegram bot 的 token和代理信息。

3. 运行程序：

   ```shell
   npm start
   ```

4. tg 中机器人发送 `/start` 开始 或者 `/login` 登陆 。

5. (可选)如需发送tgs表情需要安装[gifski](https://gif.ski),并配置系统环境变量

### docker中使用

```shell
docker run -itd --env BOT_TOKEN="" --env PROXY_HOST="" --env PROXY_PORT="" --env PROXY_USERNAME="" --env PROXY_PASSWORD="" --env PROXY_PROTOCOL="socks5" finalpi/wechat2tg:latest
```

## BOT命令说明

`/login`:获取登录二维码

`/user`:获取用户列表,点击可回复（可以加名称或者备注搜索,例如"/user 张"可以搜索名称或备注含有"张"的用户）

`/room`:获取群组列表,点击可回复（可以加名称或者备注搜索,例如"/room 外卖"可以搜索名称或备注含有"外卖"的群组）

`/recent`:获取最近发过消息的用户或者群组,点击可回复

`/setting`:程序设置:

**消息模式切换**:

切换黑名单模式或者白名单模式

白名单模式-只接受在白名单列表的群组消息

黑名单模式-不接受在黑名单列表的群组消息

**反馈发送成功**:是否反馈消息的发送状态

**自动切换联系人**:如果有用户或群组回复,则会自动切换回复到该用户或者群组。**请注意，发送前刚好有消息发给你可能会导致错误发送消息！
**

**接受公众号消息**:是否接受公众号消息

**转发自己在微信发送的消息**: 是否转发使用手机微信客户端发送的消息

**媒体质量压缩**:开启后所有接收到的媒体消息以图片,视频的方式接收,可能会损失媒体的原始质量,如果关闭该选项,则所有的消息都会以文件的方式接收

## 特殊回复说明

2分钟内发送的消息能撤回 撤回方式是回复自己发送的消息 内容为&rm
媒体消息需要等待发送成功才能撤回

## 配置项说明

`BOT_TOKEN`(必填):telegram bot的token,通过[BotFather](https://t.me/BotFather)创建

### 使用代理

使用代理转发telegram bot的请求,留空则不使用代理:

```
# 代理配置(可选)
# 协议socks5,http,https
PROXY_PROTOCOL=socks5
PROXY_HOST=
PROXY_PORT=
PROXY_USERNAME=
PROXY_PASSWORD=
```

### 大文件的接受和发送

因为Telegram Bot
API的限制,不能发送超过20MB的文件,或者接收超过50MB的文件,如果你需要收发大文件的消息内容,请配置你的`API_ID`和`API_HASH`

**!!测试发现web协议发送超过25MB文件，切片上传服务器直接返回错误**

`API_ID`和`API_HASH`的获取方法:

1. 登录您的[telegram account](https://my.telegram.org/)

2. 然后点击“API development tools”并填写您的应用程序详细信息（只需应用程序标题和简称）

3. 最后点击“Create application”

### 手动对消息进行分组

**注意:** 因为`wechaty-puppet-wechat4u`
每次重新登录的时候,id都会变化,所以没办法获取每个联系人和群组的唯一key,判断是否是同一个联系人和群组的方式是通过联系人的备注和昵称进行判断的,此方法在备注或者昵称不唯一的情况下,在下一次重新登录的时候,可能会错误的绑定到联系人和群组,或者当联系人或者群组的名称发生变化的时候,有可能会出现绑定失败的情况,此情况需要重新绑定.

1. 关闭掉机器人的隐私模式,打开BotFather,输入`/mybots`,选择你的bot,点击`Bot Settings`-`Group Privacy`-`Turn off`
   ,出现`Privacy mode is disabled for xxx`就说明关闭成功了.
2. 创建telegram group,将bot拉入该群组然后按照提示绑定即可,之后该联系人或者群组的消息就会转发到该group里面

`/bind`:查看当前group绑定的联系人或者群组

`/unbind`:解绑当前group绑定的联系人或者群组

`/cgdata`:设置group的头像和昵称为微信联系人或群组(需要管理员权限)

### 自动对消息分组

1. 配置`API_ID`和`API_HASH`
2. 关闭掉机器人的隐私模式,打开BotFather,输入`/mybots`,选择你的bot,点击`Bot Settings`-`Group Privacy`-`Turn off`
   ,出现`Privacy mode is disabled for xxx`就说明关闭成功了.
3. 用`/autocg`命令开启自动分组模式,按提示登录Telegram即可

### 自定义消息模板

如果你想修改消息发送者的格式,你可以修改docker中的环境变量或者.env文件

自定义消息模板占位符:

`#[alias]`:联系人备注

`#[name]`:联系人昵称

`#[topic]`:群聊昵称

`#[alias_first]`:备注优先,如果没有备注就显示联系人的昵称

## License

[MIT](LICENSE)

## Thanks

感谢Jetbrains对本项目的支持

[<img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" width="200">](https://www.jetbrains.com)
