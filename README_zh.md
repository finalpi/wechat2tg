# wechat2tg

这个项目是基于 [wechaty](https://github.com/wechaty/wechaty) 实现的微信消息转发到 Telegram 机器人的项目,使用[puppet-wechat4u](https://github.com/wechaty/puppet-wechat4u)协议UOS实现,因此可以绕过微信web版某些账号无法登陆的问题。

# 注意事项

1. 本项目仅用于技术研究和学习，不得用于非法用途。
2. 欢迎将您遇到的问题提交到issue。

## TODO LIST

- [ ] 好友请求接受
- [ ] 发送位置
- [ ] 接受位置消息
- [ ] 群组,个人,公众号图标

## 安装

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

4. tg 中机器人发送 `/start` 开始 或者 `/login` 登陆 。

### docker中使用
```shell
docker run -itd --env BOT_TOKEN="" --env PROXY_HOST="" --env PROXY_PORT="" --env PROXY_USERNAME="" --env PROXY_PASSWORD="" --env PROXY_PROTOCOL="socks5" finalpi/wechat2tg:latest
```

### docker-compose中使用
```shell
docker-compose up -d
```
## BOT命令说明

`/login`:获取登录二维码

`/user`:获取用户列表,点击可回复

`/room`:获取群组列表,点击可回复

`/recent`:获取最近发过消息的用户或者群组,点击可回复

`/setting`:程序设置:

消息模式切换: 

切换黑名单模式或者白名单模式

白名单模式:只接受在白名单列表的群组消息

黑名单模式:不接受在黑名单列表的群组消息

反馈发送成功:是否反馈消息的发送状态

自动切换联系人:如果有用户或群组回复,则会自动切换回复到该用户或者群组

接受公众号消息:是否接受公众号消息

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

## License

[MIT](LICENSE)

## Thanks

感谢Jetbrains对本项目的支持

[![Jetbrains](https://resources.jetbrains.com/storage/products/company/brand/logos/jb_beam.png)](https://www.jetbrains.com)
