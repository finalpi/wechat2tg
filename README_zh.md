# 微信消息转发到 Telegram

这个项目是基于 [wechaty](https://github.com/wechaty/wechaty) 实现的微信消息转发到 Telegram 机器人的项目,使用UOS协议的puppet实现,因此可以绕过微信web版某些账号无法登陆的问题。  
![](https://s1.imagehub.cc/images/2023/06/30/imagea3d9cbc1eb0fa6c7.png)

目前已经实现的功能:
1. 将微信@你的群消息转发至telegram机器人
2. 将微信私聊的图片,语音,文字,视频消息转发到telegram机器人
3. 群消息白名单

## 使用说明

### Node.js v16以上的版本中使用

1. 安装依赖：

   ```shell
   npm install
   ```

2. 在 `.env` 文件中配置 Telegram bot 的 token和代理信息。

3. 运行程序：

   ```shell
   npm start
   ```

4. 扫描二维码登录微信账号。

### docker中使用
```shell
docker run -itd --env BOT_TOKEN="" --env HOST="" --env PORT="" --env USERNAME="" --env PASSWORD="" --env PROTOCOL="socks5" finalpi/wechat2tg:latest
```

### docker-compose
```shell
docker-compose up -d
```

## 配置项说明

`BOT_TOKEN`(必填):telegram bot的token,通过[BotFather](https://t.me/BotFather)创建

### 使用代理

使用代理转发telegram bot的请求,留空则不使用代理:
```
# 协议socks5,http,https
PROTOCOL=socks5
HOST=
PORT=
USERNAME=
PASSWORD=
```

## 声明

本项目仅用于技术研究和学习，不得用于非法用途。

## License

[MIT](LICENSE)

## Thanks
感谢Jetbrains对本项目的支持
[![Jetbrains](https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.png)](https://www.jetbrains.com)