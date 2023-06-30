# 微信消息转发到 Telegram

这个项目是基于 [wechaty](https://github.com/wechaty/wechaty) 实现的微信消息转发到 Telegram 机器人的项目,使用UOS协议的puppet实现,因此可以绕过微信web版某些账号无法登陆的问题。  
![](https://s1.imagehub.cc/images/2023/06/30/imagea3d9cbc1eb0fa6c7.png)
目前已经实现的功能:
1. 将微信@你的群消息转发至telegram机器人
2. 将微信私聊的图片,语音,文字,视频消息转发到telegram机器人

后续打算实现的功能:
1. 在telegram机器人中给指定的人发送消息
2. 设置群白名单以接受该群的所有消息

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
## 声明

本项目仅用于技术研究和学习，不得用于非法用途。

## License

[MIT](LICENSE)

GitHub (https://github.com/wechaty/wechaty)
GitHub - wechaty/wechaty: Conversational RPA SDK for Chatbot Makers
Conversational RPA SDK for Chatbot Makers. Contribute to wechaty/wechaty development by creating an account on GitHub.
